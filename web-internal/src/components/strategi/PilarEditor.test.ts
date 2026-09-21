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
  angkaAtauNull,
  angleText,
  catatanVendor,
  masalahBaris,
  parseAngle,
  pilarDariAksi,
  pilihVendor,
  targetBawaan,
} from './PilarEditor';
import { blankPilar, type PilarBody } from '@/lib/strategi-pilar';
import type { Vendor } from '@/lib/strategi';
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

// ---------------------------------------------------------------------------
// Vendor live (E-8 / Rule 18)
// ---------------------------------------------------------------------------

const vendor = (over: Partial<Vendor> = {}): Vendor => ({
  id: 'VND-202609-0001',
  nama_vendor: 'PT Live Kita',
  jenis_layanan: 'live_stream',
  status: 'Aktif',
  pic_nama: 'Sari',
  pic_kontak: '08123',
  skema_biaya: 'per_jam',
  tarif: '350000.00',
  bagi_hasil_persen: null,
  catatan_kinerja: '',
  dokumen: [],
  created_by: 'ZZ-AM',
  created_at: '2026-09-01T00:00:00Z',
  ...over,
});

describe('angkaAtauNull', () => {
  it('kosong dan bukan-angka jadi null, BUKAN 0', () => {
    // 0 jam live adalah pernyataan; kolom kosong adalah ketiadaan pernyataan.
    for (const t of ['', '   ', 'abc']) expect(angkaAtauNull(t)).toBeNull();
  });

  it('angka terbaca apa adanya, termasuk pecahan', () => {
    expect(angkaAtauNull('36')).toBe(36);
    expect(angkaAtauNull(' 7.5 ')).toBe(7.5);
    expect(angkaAtauNull('0')).toBe(0);
  });
});

describe('pilihVendor', () => {
  it('memilih vendor per_jam ikut men-prefill tarifnya', () => {
    expect(pilihVendor([vendor()], 'VND-202609-0001')).toEqual({
      vendor_id: 'VND-202609-0001',
      tarif: '350000.00',
    });
  });

  it('vendor bagi_hasil TIDAK men-prefill tarif — ia tak punya tarif rupiah', () => {
    // `ck_vendor_tarif_pair`: bagi_hasil memakai persen dan HANYA persen.
    // Menyalin apa pun ke kolom tarif melahirkan angka yang tak pernah ditagih.
    const v = vendor({ skema_biaya: 'bagi_hasil', tarif: null, bagi_hasil_persen: 15 });
    expect(pilihVendor([v], v.id)).toEqual({ vendor_id: v.id });
  });

  it('mengosongkan pilihan melepas vendor, tanpa menyentuh tarif yang sudah diketik', () => {
    expect(pilihVendor([vendor()], '')).toEqual({ vendor_id: null });
  });

  it('id yang tak ada di daftar tetap diset, tarif tidak ditebak', () => {
    expect(pilihVendor([vendor()], 'VND-LAIN')).toEqual({ vendor_id: 'VND-LAIN' });
  });
});

describe('catatanVendor', () => {
  it('menyebut persen untuk bagi_hasil — satu-satunya tempat angka itu terlihat', () => {
    const v = vendor({ skema_biaya: 'bagi_hasil', tarif: null, bagi_hasil_persen: 15 });
    expect(catatanVendor([v], v.id)).toContain('bagi hasil 15%');
  });

  it('menyebut tarif kartu harga untuk skema rupiah, dan bahwa tarif baris boleh beda', () => {
    const t = catatanVendor([vendor()], 'VND-202609-0001');
    expect(t).toContain('350000.00');
    expect(t).toContain('boleh berbeda');
  });

  it('tanpa vendor terpilih tidak ada catatan', () => {
    expect(catatanVendor([vendor()], null)).toBeNull();
    expect(catatanVendor(null, 'VND-202609-0001')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// masalahBaris — cermin ketiga penolakan `savePillars`
// ---------------------------------------------------------------------------

describe('masalahBaris', () => {
  const baris = (over: Partial<PilarBody>): PilarBody => ({
    ...blankPilar('live', 1), aksi: 'L1 Mulai / tambah jam live', ...over,
  });

  it('baris live ber-vendor lolos', () => {
    expect(masalahBaris(baris({ vendor_id: 'VND-202609-0001', slot_jam: 36 }))).toBeNull();
  });

  it('Rule 18: vendor di luar pilar live ditolak', () => {
    const m = masalahBaris(baris({ jenis: 'konten', vendor_id: 'VND-202609-0001' }));
    expect(m).toContain('Rule 18');
  });

  it('E-4: floor price di luar pilar harga ditolak', () => {
    expect(masalahBaris(baris({ jenis: 'konten', floor_price: '79000' }))).toContain('pilar harga');
  });

  it('E-4: floor price tanpa SKU ditolak — Brief membandingkannya per SKU', () => {
    expect(masalahBaris(baris({ jenis: 'harga', floor_price: '79000' }))).toContain('butuh SKU');
    expect(masalahBaris(baris({ jenis: 'harga', floor_price: '79000', sku: '  ' }))).toContain('butuh SKU');
  });

  it('floor price dengan SKU lolos', () => {
    expect(masalahBaris(baris({ jenis: 'harga', sku: 'SERUM-30', floor_price: '79000' }))).toBeNull();
  });

  it('Rule 11: harga promo di bawah floor ditolak', () => {
    const m = masalahBaris(baris({ jenis: 'harga', sku: 'SERUM-30', floor_price: '79000', harga_promo: '75000' }));
    expect(m).toContain('di bawah floor');
  });

  it('harga promo sama dengan floor lolos — batasnya inklusif, sama seperti CHECK-nya', () => {
    expect(masalahBaris(baris({ jenis: 'harga', sku: 'SERUM-30', floor_price: '79000', harga_promo: '79000' }))).toBeNull();
  });

  it('string kosong diperlakukan sebagai tak diisi, bukan angka nol', () => {
    // `''` yang dibaca `Number('')` jadi 0 akan memerahkan baris yang benar.
    expect(masalahBaris(baris({ jenis: 'harga', sku: 'S', floor_price: '', harga_promo: '' }))).toBeNull();
  });

  it('baris katalog polos apa adanya lolos', () => {
    for (const jenis of ['konten', 'live', 'affiliate', 'iklan', 'sku', 'retensi', 'operasional']) {
      expect(masalahBaris(baris({ jenis })), jenis).toBeNull();
    }
  });
});
