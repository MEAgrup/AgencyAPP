/**
 * Editor pilar Section E — logika murninya.
 *
 * Yang diuji di sini adalah tiga jahitan yang bisa diam-diam salah dan baru
 * ketahuan sebagai Plan kosong atau Brief tanpa angle:
 *
 *  1. `targetBawaan` — bentuk target katalog, dan konsekuensinya di `plan-row-suggest`;
 *  2. `pilarDariAksi` — pemetaan aksi katalog → baris `strategi_pillar`;
 *  3. `angleText` / `parseAngle` — `detail.angle_video`, yang jalurnya sampai ke Brief.
 */
import { describe, expect, it } from 'vitest';
import {
  JENIS_TANPA_KATALOG,
  angleText,
  parseAngle,
  pilarDariAksi,
  targetBawaan,
} from './PilarEditor';
import { parseTargetKuota, suggestRowFromPillar } from '@/lib/plan-row-suggest';
import type { KatalogPilarAksi } from '@/lib/strategi';

const aksi = (over: Partial<KatalogPilarAksi> = {}): KatalogPilarAksi => ({
  kode: 'L1',
  pilar: 'LIVE',
  jenis: 'live',
  divisi: 'Live Stream',
  nama: 'Mulai / tambah jam live',
  deskripsi: 'Menaikkan frekuensi atau durasi sesi',
  jembatan: 'Jam live / minggu',
  unit: 'jam',
  arah: 'naik',
  minggu: 4,
  field_id_bukti: 'B-7.2',
  quick_win: false,
  platform: ['tiktok', 'shopee', 'meta'],
  relevan_saat: ['jam live di bawah benchmark MEA'],
  ...over,
});

describe('targetBawaan', () => {
  it('menyebut jembatan, satuan, arah, dan horizon', () => {
    expect(targetBawaan(aksi())).toBe(
      'jembatan Jam live / minggu (jam, harus naik) dalam 4 minggu',
    );
  });

  it('TIDAK diawali angka — jadi tidak terbaca sebagai kuota PC-6', () => {
    // Konsekuensi yang disengaja, bukan bug: kuota adalah *berapa deliverable
    // dibuat*, angka yang berbeda dari target jembatan. Baris Plan turunannya
    // jatuh ke `butuh_kuota` dan AM mengisinya di halaman Plan.
    expect(parseTargetKuota(targetBawaan(aksi()))).toBeNull();
  });

  it('AM boleh mengawalinya dengan angka agar barisnya disemai penuh', () => {
    const diketik = `36 jam, ${targetBawaan(aksi())}`;
    expect(parseTargetKuota(diketik)).toMatchObject({ kuota: 36 });
  });
});

describe('pilarDariAksi', () => {
  it('memetakan jenis, divisi lewat aksi, channel, dan provenance', () => {
    const p = pilarDariAksi(aksi(), 3, 'TikTok Shop');
    expect(p.jenis).toBe('live');
    expect(p.channel).toBe('TikTok Shop');
    expect(p.urutan).toBe(3);
    expect(p.aksi).toBe('L1 Mulai / tambah jam live');
    expect(p.target).toBe(targetBawaan(aksi()));
    expect(p.detail).toMatchObject({
      sumber: 'cdps.pilarkatalog.v1',
      kode_aksi: 'L1',
      field_id_bukti: 'B-7.2',
      pilar: 'LIVE',
    });
  });

  it('`peran` SELALU null — ia enum peran SKU, bukan label pilar', () => {
    // Mengisinya di luar `ck_strpil_peran` membuat INSERT `savePillars`
    // melempar galat Postgres tak terpetakan ("internal server error").
    expect(pilarDariAksi(aksi({ pilar: 'VIDEO', jenis: 'konten' }), 1, null).peran).toBeNull();
  });

  it('baris konten lahir dengan angle_video kosong — AM yang mengisinya', () => {
    const p = pilarDariAksi(aksi({ kode: 'V3', pilar: 'VIDEO', jenis: 'konten' }), 1, null);
    expect(p.detail.angle_video).toEqual([]);
  });

  it('barisnya mengusulkan baris Plan lengkap: divisi terisi, kuota yang tersisa', () => {
    const p = pilarDariAksi(
      aksi({ kode: 'V5', pilar: 'VIDEO', jenis: 'konten', nama: 'Perbaikan listing hero SKU', divisi: 'Creative' }),
      1, 'TikTok Shop',
    );
    const usul = suggestRowFromPillar({
      id: 9, jenis: p.jenis, channel: p.channel, urutan: p.urutan, sku: p.sku, peran: p.peran,
      aksi: p.aksi, target: p.target, harga_normal: null, harga_promo: null, floor_price: null,
      vendor_id: null, slot_jam: null, tarif: null, target_gmv_per_jam: null, detail: p.detail,
    });
    // Divisi PIC sudah terisi otomatis — yang tersisa untuk AM benar-benar
    // hanya satu angka (kuota), bukan tiga kolom kosong.
    expect(usul.divisiPic).toBe('Creative');
    expect(usul.aksi).toBe('V5 Perbaikan listing hero SKU');
    expect(usul.hasilDiharapkan).toBe(p.target);
    expect(usul.kuota).toBe('');
  });

  it('angle video yang AM ketik sampai ke instruksi Brief', () => {
    const p = pilarDariAksi(aksi({ kode: 'V3', pilar: 'VIDEO', jenis: 'konten' }), 1, 'TikTok Shop');
    const denganAngle = { ...p, detail: { ...p.detail, angle_video: parseAngle('Racun skincare #serum') } };
    const usul = suggestRowFromPillar({
      id: 10, jenis: denganAngle.jenis, channel: denganAngle.channel, urutan: 1, sku: null,
      peran: null, aksi: denganAngle.aksi, target: denganAngle.target, harga_normal: null,
      harga_promo: null, floor_price: null, vendor_id: null, slot_jam: null, tarif: null,
      target_gmv_per_jam: null, detail: denganAngle.detail,
    });
    expect(usul.instruksiBrief).toContain('Racun skincare #serum');
  });
});

describe('angle video — detail.angle_video ↔ textarea', () => {
  it('bolak-balik tanpa kehilangan isi', () => {
    const angle = ['Racun skincare #serum', 'Before after 14 hari'];
    expect(parseAngle(angleText({ angle_video: angle }))).toEqual(angle);
  });

  it('membuang baris kosong dan spasi — bukan menyimpan angle hampa', () => {
    expect(parseAngle('  A  \n\n   \nB\n')).toEqual(['A', 'B']);
  });

  it('detail tanpa angle_video terbaca sebagai teks kosong, bukan crash', () => {
    expect(angleText({})).toBe('');
    expect(angleText({ angle_video: 'bukan array' })).toBe('');
    expect(angleText({ angle_video: [1, 'A', null] })).toBe('A');
  });
});

describe('JENIS_TANPA_KATALOG', () => {
  it('memuat empat jenis yang katalognya memang kosong', () => {
    expect(JENIS_TANPA_KATALOG.map((j) => j.value)).toEqual(['sku', 'harga', 'retensi', 'operasional']);
  });

  it('tidak tumpang-tindih dengan jenis yang katalog sediakan', () => {
    const dariKatalog = new Set(['konten', 'live', 'affiliate', 'iklan']);
    for (const j of JENIS_TANPA_KATALOG) {
      expect(dariKatalog.has(j.value), `${j.value} sudah ada di katalog`).toBe(false);
    }
  });
});
