import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ZipFile } from 'yazl';
import { describe, expect, it, afterEach } from 'vitest';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from './pdt-zip';

/**
 * Kumpulkan output stream yazl jadi satu Buffer (fixture ZIP untuk tes).
 *
 * `yazl` sendiri MENOLAK menulis nama berkas zip-slip (`validateMetadataPath`)
 * — otentik untuk seorang PENULIS zip yang baik, tapi berarti fixture "zip-slip
 * jahat" tidak bisa dibuat lewat `addBuffer` langsung (persis kelas serangan
 * yang harus tetap teruji di jalur PEMBACA, yang tidak boleh mengandalkan
 * penulisnya berkelakuan baik). Untuk kasus itu, `nama` dimasukkan dengan
 * placeholder SEPANJANG BYTE YANG SAMA lalu ditukar langsung di buffer akhir —
 * offset/panjang field lain di header ZIP tidak berubah karena panjangnya sama.
 */
function bangunZip(entries: { nama: string; isi: Buffer; compress?: boolean }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const tukar: { placeholder: Buffer; asli: Buffer }[] = [];
    for (const e of entries) {
      const perluTukar = e.nama.startsWith('/') || e.nama.includes('..') || e.nama.includes('\\');
      const namaUntukZip = perluTukar ? 'z'.repeat(e.nama.length - 4) + '.bin' : e.nama;
      if (perluTukar) tukar.push({ placeholder: Buffer.from(namaUntukZip, 'utf8'), asli: Buffer.from(e.nama, 'utf8') });
      zip.addBuffer(e.isi, namaUntukZip, { compress: e.compress ?? true });
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => {
      let buf = Buffer.concat(chunks);
      for (const { placeholder, asli } of tukar) {
        const idx = buf.indexOf(placeholder);
        if (idx === -1) return reject(new Error(`placeholder ${placeholder.toString()} tidak ditemukan di buffer zip`));
        asli.copy(buf, idx);
        // Bisa muncul dua kali (local file header + central directory) — ganti keduanya.
        const idx2 = buf.indexOf(placeholder, idx + placeholder.length);
        if (idx2 !== -1) asli.copy(buf, idx2);
      }
      resolve(buf);
    });
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe('bacaDanEkstrakPdtZip (G1-04)', () => {
  const direktoriUntukDibersihkan: string[] = [];
  afterEach(async () => {
    while (direktoriUntukDibersihkan.length) {
      await bersihkanDirektoriSementaraPdt(direktoriUntukDibersihkan.pop() as string);
    }
  });

  it('extracts normal entries with correct sha256 and byte count', async () => {
    const isiXlsx = Buffer.from('konten xlsx palsu untuk tes'.repeat(50));
    const isiCsv = Buffer.from('a,b,c\n1,2,3\n');
    const paket = await bangunZip([
      { nama: 'shop_stats.xlsx', isi: isiXlsx },
      { nama: 'orders.csv', isi: isiCsv },
    ]);

    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(true);
    expect(hasil.sha256Paket).toBe(sha256(paket));
    expect(hasil.gagalEkstrak).toEqual([]);
    expect(hasil.diekstrak).toHaveLength(2);

    const shop = hasil.diekstrak.find((e) => e.meta.nama === 'shop_stats.xlsx');
    expect(shop).toBeDefined();
    expect(shop?.bytes).toBe(isiXlsx.length);
    expect(shop?.sha256).toBe(sha256(isiXlsx));
    const isiTerbaca = await readFile(shop!.pathSementara);
    expect(isiTerbaca.equals(isiXlsx)).toBe(true);

    const orders = hasil.diekstrak.find((e) => e.meta.nama === 'orders.csv');
    expect(orders?.sha256).toBe(sha256(isiCsv));
  });

  it('rejects zip-slip entries (not extracted, package still ok)', async () => {
    const paket = await bangunZip([
      { nama: 'ok.xlsx', isi: Buffer.from('isi normal') },
      { nama: '../../../etc/passwd.xlsx', isi: Buffer.from('jahat') },
    ]);
    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(true);
    expect(hasil.diekstrak).toHaveLength(1);
    expect(hasil.diekstrak[0].meta.nama).toBe('ok.xlsx');
    const ditolak = hasil.pagar.entri.find((e) => e.meta.nama.includes('passwd'));
    expect(ditolak?.keputusan).toEqual({ kode: 'ditolak', alasan: 'zip_slip' });
  });

  it('rejects a nested zip entry (zip_bersarang, not extracted)', async () => {
    const zipDalam = await bangunZip([{ nama: 'inner.xlsx', isi: Buffer.from('x') }]);
    const paket = await bangunZip([
      { nama: 'ok.xlsx', isi: Buffer.from('isi normal') },
      { nama: 'nested.zip', isi: zipDalam },
    ]);
    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(true);
    expect(hasil.diekstrak).toHaveLength(1);
    const ditolak = hasil.pagar.entri.find((e) => e.meta.nama === 'nested.zip');
    expect(ditolak?.keputusan).toEqual({ kode: 'ditolak', alasan: 'zip_bersarang' });
  });

  it('skips macOS junk entries silently (not "ditolak", not extracted)', async () => {
    const paket = await bangunZip([
      { nama: 'ok.xlsx', isi: Buffer.from('isi normal') },
      { nama: '__MACOSX/._ok.xlsx', isi: Buffer.from('junk') },
      { nama: '.DS_Store', isi: Buffer.from('junk') },
    ]);
    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(true);
    expect(hasil.diekstrak).toHaveLength(1);
    const dilewati = hasil.pagar.entri.filter((e) => e.keputusan.kode === 'dilewati');
    expect(dilewati).toHaveLength(2);
  });

  it('rejects the WHOLE package for a synthetic zip bomb (decompression ratio > 100:1)', async () => {
    // 20 MB nol byte, sangat kompresibel — deflate menyusutkannya jauh di bawah 200KB (rasio > 100).
    const isiBesar = Buffer.alloc(20 * 1024 * 1024, 0);
    const paket = await bangunZip([{ nama: 'bomb.xlsx', isi: isiBesar }]);
    expect(paket.length).toBeLessThan(1024 * 1024); // pastikan paketnya sendiri kecil (rasio tinggi, bukan cuma ukuran besar)

    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(false);
    expect(hasil.pagar.alasanTolakPaket).toBe('rasio_dekompresi_melebihi_100x');
    expect(hasil.diekstrak).toEqual([]);
    expect(hasil.direktoriSementara).toBeNull();
  }, 20_000);

  it('rejects a package over 50MB (stored, no compression, isolating the size cap from the ratio cap)', async () => {
    const isiBesar = Buffer.alloc(51 * 1024 * 1024, 7);
    const paket = await bangunZip([{ nama: 'besar.xlsx', isi: isiBesar, compress: false }]);
    expect(paket.length).toBeGreaterThan(50 * 1024 * 1024);

    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(false);
    expect(hasil.pagar.alasanTolakPaket).toBe('ukuran_melebihi_50mb');
    expect(hasil.diekstrak).toEqual([]);
  }, 20_000);

  it('rejects a package with more than 40 entries', async () => {
    const entries = Array.from({ length: 41 }, (_, i) => ({ nama: `f${i}.xlsx`, isi: Buffer.from(`isi ${i}`) }));
    const paket = await bangunZip(entries);
    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.pagar.ok).toBe(false);
    expect(hasil.pagar.alasanTolakPaket).toBe('entri_melebihi_40');
  });

  it('rejects an unsupported extension without extracting it', async () => {
    const paket = await bangunZip([
      { nama: 'ok.xlsx', isi: Buffer.from('isi normal') },
      { nama: 'readme.pdf', isi: Buffer.from('pdf palsu') },
    ]);
    const hasil = await bacaDanEkstrakPdtZip(paket);
    if (hasil.direktoriSementara) direktoriUntukDibersihkan.push(hasil.direktoriSementara);

    expect(hasil.diekstrak).toHaveLength(1);
    const ditolak = hasil.pagar.entri.find((e) => e.meta.nama === 'readme.pdf');
    expect(ditolak?.keputusan).toEqual({ kode: 'ditolak', alasan: 'ekstensi_tidak_didukung' });
  });
});
