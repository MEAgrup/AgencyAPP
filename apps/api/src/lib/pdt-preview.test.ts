/**
 * G1-09 — `bangunPreviewBerkasInputs`: perekat G1-04 (`bacaDanEkstrakPdtZip`)
 * + G1-05 (`parsePdtZipEntries`) → `pdt.PdtPreviewBerkasInput[]` (domain).
 *
 * Bagian pertama sintetik (membangun `PdtZipBacaHasil`/`PdtParseBatchHasil`
 * langsung, tanpa ZIP/XLSX sungguhan) — cukup untuk menguji pemetaan lima
 * jalur (ditolak pagar/dilewati/gagal ekstrak/gagal decode/berhasil). Bagian
 * kedua satu tes ASLI end-to-end (ZIP `yazl` sungguhan lewat pipeline penuh
 * G1-04→G1-05→sini) — bukti pipa nyambung, cermin pola `pdt-parse.test.ts`.
 */
import { ZipFile } from 'yazl';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { pdt } from '@cdps/core';
import { bangunPreviewBerkasInputs } from './pdt-preview';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt, type PdtZipBacaHasil } from './pdt-zip';
import { parsePdtZipEntries } from './pdt-parse';

const { PDT_MODULES } = pdt;

const metaOf = (nama: string) => ({ nama, ukuranTerkompresi: 10, ukuranAsli: 10, terenkripsi: false });

describe('bangunPreviewBerkasInputs — sintetik', () => {
  it('entri "dilewati" (junk macOS) TIDAK disertakan sama sekali (Rule 41 — tanpa peringatan)', () => {
    const zip: PdtZipBacaHasil = {
      pagar: { ok: true, entri: [{ meta: metaOf('.DS_Store'), keputusan: { kode: 'dilewati', alasan: 'macos_junk' } }] },
      sha256Paket: 'x', diekstrak: [], gagalEkstrak: [], direktoriSementara: null,
    };
    const hasil = bangunPreviewBerkasInputs(zip, { berkas: [], gagal: [], durasiMs: 0 });
    expect(hasil).toEqual([]);
  });

  it('entri "ditolak" pagar ⇒ ditolakPagar terisi, sisanya null/kosong', () => {
    const zip: PdtZipBacaHasil = {
      pagar: { ok: true, entri: [{ meta: metaOf('nested.zip'), keputusan: { kode: 'ditolak', alasan: 'zip_bersarang' } }] },
      sha256Paket: 'x', diekstrak: [], gagalEkstrak: [], direktoriSementara: null,
    };
    const hasil = bangunPreviewBerkasInputs(zip, { berkas: [], gagal: [], durasiMs: 0 });
    expect(hasil).toEqual([{
      nama: 'nested.zip', sha256: null, bytes: null,
      ditolakPagar: { pesan: "[berkas 'nested.zip' adalah ZIP bersarang, tidak didukung]" },
      decodeGagal: null, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
    }]);
  });

  it('entri "diproses" tapi GAGAL EKSTRAK (G1-04, mis. metadata bohong) ⇒ decodeGagal dari gagalEkstrak, nol sha256/bytes', () => {
    const zip: PdtZipBacaHasil = {
      pagar: { ok: true, entri: [{ meta: metaOf('a.xlsx'), keputusan: { kode: 'diproses' } }] },
      sha256Paket: 'x', diekstrak: [], gagalEkstrak: [{ meta: metaOf('a.xlsx'), pesan: 'ukuran tidak cocok' }], direktoriSementara: '/tmp/x',
    };
    const hasil = bangunPreviewBerkasInputs(zip, { berkas: [], gagal: [], durasiMs: 0 });
    expect(hasil).toEqual([{
      nama: 'a.xlsx', sha256: null, bytes: null, ditolakPagar: null,
      decodeGagal: 'ukuran tidak cocok', aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
    }]);
  });

  it('entri "diproses" berhasil DIEKSTRAK tapi GAGAL DECODE (G1-05, berkas rusak) ⇒ decodeGagal dari gagal parse, sha256/bytes tetap terisi', () => {
    const zip: PdtZipBacaHasil = {
      pagar: { ok: true, entri: [{ meta: metaOf('b.xlsx'), keputusan: { kode: 'diproses' } }] },
      sha256Paket: 'x',
      diekstrak: [{ meta: metaOf('b.xlsx'), pathSementara: '/tmp/0', sha256: 'sha-b', bytes: 42 }],
      gagalEkstrak: [], direktoriSementara: '/tmp/x',
    };
    const hasil = bangunPreviewBerkasInputs(zip, { berkas: [], gagal: [{ nama: 'b.xlsx', pesan: 'berkas tidak berisi sheet apa pun' }], durasiMs: 0 });
    expect(hasil).toEqual([{
      nama: 'b.xlsx', sha256: 'sha-b', bytes: 42, ditolakPagar: null,
      decodeGagal: 'berkas tidak berisi sheet apa pun', aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
    }]);
  });

  it('entri berhasil PENUH (ekstrak + decode + deteksi) ⇒ seluruh field terisi apa adanya', () => {
    const zip: PdtZipBacaHasil = {
      pagar: { ok: true, entri: [{ meta: metaOf('c.xlsx'), keputusan: { kode: 'diproses' } }] },
      sha256Paket: 'x',
      diekstrak: [{ meta: metaOf('c.xlsx'), pathSementara: '/tmp/0', sha256: 'sha-c', bytes: 99 }],
      gagalEkstrak: [], direktoriSementara: '/tmp/x',
    };
    const aoa = [['Kode Produk', 'Kode Variasi', 'SKU Induk']];
    const hasil = bangunPreviewBerkasInputs(zip, {
      berkas: [{ nama: 'c.xlsx', aoa, modul: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'] }],
      gagal: [], durasiMs: 0,
    });
    expect(hasil).toEqual([{
      nama: 'c.xlsx', sha256: 'sha-c', bytes: 99, ditolakPagar: null, decodeGagal: null,
      aoa, modulTerdeteksi: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'],
    }]);
  });

  it('mengembalikan SATU baris per entri, urutan mengikuti pagar.entri', () => {
    const zip: PdtZipBacaHasil = {
      pagar: {
        ok: true,
        entri: [
          { meta: metaOf('a.zip'), keputusan: { kode: 'ditolak', alasan: 'zip_bersarang' } },
          { meta: metaOf('.DS_Store'), keputusan: { kode: 'dilewati', alasan: 'macos_junk' } },
          { meta: metaOf('b.xlsx'), keputusan: { kode: 'diproses' } },
        ],
      },
      sha256Paket: 'x',
      diekstrak: [{ meta: metaOf('b.xlsx'), pathSementara: '/tmp/0', sha256: 's', bytes: 1 }],
      gagalEkstrak: [], direktoriSementara: '/tmp/x',
    };
    const hasil = bangunPreviewBerkasInputs(zip, {
      berkas: [{ nama: 'b.xlsx', aoa: [['x']], modul: null, ambiguous: false, matches: [] }],
      gagal: [], durasiMs: 0,
    });
    expect(hasil.map((h) => h.nama)).toEqual(['a.zip', 'b.xlsx']); // .DS_Store dibuang
  });
});

// ---------------------------------------------------------------------------
// End-to-end: ZIP `yazl` sungguhan → bacaDanEkstrakPdtZip (G1-04) →
// parsePdtZipEntries (G1-05) → bangunPreviewBerkasInputs (G1-09). Cermin
// pola `pdt-parse.test.ts`.
// ---------------------------------------------------------------------------
function zipkan(entries: { nama: string; isi: Buffer }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const e of entries) zip.addBuffer(e.isi, e.nama, { compress: true });
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

function xlsxDariAoa(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('bangunPreviewBerkasInputs — end-to-end (ZIP sungguhan)', () => {
  const direktoriUntukDibersihkan: string[] = [];
  afterEach(async () => {
    for (const d of direktoriUntukDibersihkan.splice(0)) await bersihkanDirektoriSementaraPdt(d);
  });

  it('satu ZIP berisi shopee_parent_sku sungguhan ⇒ input pratinjau siap-pakai domain', async () => {
    const aoa = [['Kode Produk', 'Kode Variasi', 'SKU Induk'], ['P1', 'V1', 'SKU1']];
    const buf = await zipkan([{ nama: 'parent_sku.xlsx', isi: xlsxDariAoa(aoa) }]);
    const zipHasil = await bacaDanEkstrakPdtZip(buf);
    if (zipHasil.direktoriSementara) direktoriUntukDibersihkan.push(zipHasil.direktoriSementara);
    const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);

    const hasil = bangunPreviewBerkasInputs(zipHasil, parseHasil);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].modulTerdeteksi).toBe('shopee_parent_sku');
    expect(hasil[0].decodeGagal).toBeNull();
    expect(hasil[0].ditolakPagar).toBeNull();
    expect(hasil[0].sha256).toEqual(expect.any(String));
    expect(hasil[0].aoa).toEqual(aoa);
  });
});
