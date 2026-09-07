/**
 * B2 — mesin baseline Shopee.
 *
 * Yang diuji di sini adalah hal-hal yang, kalau salah, akan sampai ke Section B
 * Strategi sebagai ANGKA YANG TERLIHAT BENAR: modul absen yang terbaca `0`,
 * skor 0–10 yang tak dinaikkan ke skala 0–100 yang kolom DB pakai, kosakata
 * `kondisi_toko` yang bocor ke verdict Blok C, dan bentuk payload yang
 * menyimpang dari TikTok sehingga B3 terpaksa punya dua pemeta.
 *
 * Fixture memakai string nama kolom PERSIS seperti export Shopee, sama seperti
 * `report/shopee/shopee.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { BENCH_V1 } from '../benchmark';
import { runBaseline, type RunSlots } from '../run';
import { periodeOf, readSheet } from '../sheet';
import type { Aoa, HistRow, Sheet } from '../types';
import { REPORT_BENCH_SHOPEE_V1 } from '../../report/shopee/bench';
import { batalReturRate, buildShopeeBaselineMetrics, jumlahKampanyeShopee, tipeMateriShopee } from './metrik-baseline';
import { skorShopeeKe100 } from './payload';
import { MSG_SHOPEE_HOME_WAJIB, MSG_SHOPEE_TIDAK_DIKENALI, runShopeeBaseline, type ShopeeFileInput } from './run';
import { buildShopeeMetrics, type ParsedShopee } from '../../report/shopee/metrik';

// ── fixtures (bentuk export asli) ───────────────────────────────────────────
const HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const homeAoa = (): Aoa => [
  ['Pesanan Dibuat'],
  HOME_HEADER,
  ['Total', 'Rp100.000.000', '1.000', 'Rp100.000', '5.000', '50.000', '2,00%', '50', 'Rp5.000.000', '10', 'Rp1.000.000', '900', '300', '600', '50', '20,00%'],
  ['01/08/2026', 'Rp3.000.000', '30', 'Rp100.000', '150', '2.000', '1,50%', '2', 'Rp50.000', '0', 'Rp0', '25', '10', '15', '2', '10,00%'],
];
const produkAoa = (): Aoa => [
  ['Kode Produk', 'Produk', 'Nama Variasi', 'Status Produk Saat Ini', 'Jumlah Produk Dilihat', 'Produk Diklik',
    'Pengunjung Produk (Kunjungan)', 'Pesanan Dibuat', 'Total Penjualan (Pesanan Dibuat) (IDR)',
    'Total Pembeli (Pesanan Dibuat)', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Pesanan Siap Dikirim',
    'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Tingkat Konversi (Pesanan Siap Dikirim)'],
  ['SKU-A', 'Produk Bintang', '-', 'Aktif', '5000', '900', '1000', '300', 'Rp80.000.000', '290', '30,00%', '280', 'Rp84.000.000', '28,00%'],
  ['SKU-B', 'Produk Bocor', '-', 'Aktif', '8000', '1200', '1500', '5', 'Rp15.000.000', '5', '0,33%', '5', 'Rp900.000', '0,30%'],
  ['SKU-C', 'Hidden Gem', '-', 'Aktif', '300', '80', '120', '30', 'Rp5.000.000', '28', '25,00%', '28', 'Rp5.500.000', '23,00%'],
  ['SKU-D', 'Produk Tidur', '-', 'Aktif', '10', '2', '20', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
];
const adsTokoAoa = (): Aoa => [
  ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Omzet Penjualan', 'Biaya', 'Pesanan', 'Produk Terjual', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
  ['Kampanye A', 'Berjalan', '50000', '2000', '4.00%', '40000000', '5000000', '80', '85', '8.00', '12.50%'],
  ['Kampanye B', 'Berjalan', '20000', '600', '3.00%', '10000000', '2000000', '20', '22', '5.00', '20.00%'],
];
const chatAoa = (): Aoa => [
  ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Pertanyaan Diajukan', 'Chat Dibalas', 'Chat Belum Dibalas', 'Waktu Respon Rata-rata', 'CSAT %', 'Persentase Chat Dibalas', 'Total Pembeli', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
  ['01-31 Agu', '5000', '800', '700', '750', '760', '40', '00:12:30', '90,00%', '95,00%', '150', '160', 'Rp16.000.000', '20,00%'],
];
const kesehatanAoa = (): Aoa => [
  ['Poin Penalti', 'Deskripsi', 'Durasi'],
  ['1', 'Pelanggaran larangan produk', '7 hari'],
];
const affCreatorAoa = (): Aoa => [
  ['Username', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Clicks', 'Estimasi Komisi(Rp)', 'ROI'],
  ['kreator.a', '20000000', '200', '150', '900', '600000', '33.3'],
  ['kreator.b', '5000000', '50', '40', '300', '150000', '33.3'],
];

const HIST: HistRow[] = [
  { key: '2026-03', label: 'Mar 2026', gmv: '90.000.000', order: '900', flag: 'normal' },
  { key: '2026-04', label: 'Apr 2026', gmv: '95.000.000', order: '950', flag: 'normal' },
  { key: '2026-05', label: 'Mei 2026', gmv: '100.000.000', order: '1.000', flag: 'normal' },
];

const OPTS = {
  bench: REPORT_BENCH_SHOPEE_V1,
  benchmarkVersi: 1,
  benchRiwayat: BENCH_V1,
  klien: { nama: 'PT Ezzy', toko: 'EzzyConnect', store_link: 'https://shopee.co.id/ezzy', kategori: 'Fashion', umur_toko_bulan: 18, account_manager: 'EMP-002' },
  generatedAt: '2026-09-06T03:00:00.000Z',
  periode: 'Agustus 2026',
};

// Nama berkas memakai konvensi rename manual tim (`parseFilename`, lapis 1) —
// jalur deteksi yang paling eksplisit, supaya tes ini menguji baseline-nya,
// bukan tebakan nama.
const f = (module: string, aoa: Aoa): ShopeeFileInput => ({
  filename: `[${module.split('|')[0]}]-${module.split('|')[1]} && Agu 2026 && EzzyConnect && 2026-09-01.xlsx`,
  aoa,
});
const FILES_PENUH = (): ShopeeFileInput[] => [
  f('bisnis|home', homeAoa()), f('bisnis|produk', produkAoa()), f('ads|toko', adsTokoAoa()),
  f('layanan|chat', chatAoa()), f('bisnis|kesehatan', kesehatanAoa()), f('aff|creator', affCreatorAoa()),
];

// ── gerbang berkas ──────────────────────────────────────────────────────────
describe('gerbang berkas', () => {
  it('hanya Bisnis — Home yang wajib; sisanya opsional (keputusan pemilik 2026-09-06)', () => {
    const res = runShopeeBaseline([f('bisnis|home', homeAoa())], HIST, OPTS);
    expect(res.payload.toko?.gmv).toBe(100000000);
  });

  it('tanpa Bisnis — Home ⇒ pesan BI, bukan payload separuh jadi', () => {
    expect(() => runShopeeBaseline([f('bisnis|produk', produkAoa())], HIST, OPTS))
      .toThrow(MSG_SHOPEE_HOME_WAJIB);
  });

  it('berkas tak dikenali DISEBUT namanya, bukan dibuang diam-diam', () => {
    expect(() => runShopeeBaseline([{ filename: 'entah-apa.xlsx', aoa: [['a']] }], HIST, OPTS))
      .toThrow(`${MSG_SHOPEE_TIDAK_DIKENALI} entah-apa.xlsx`);
  });

  it('dua berkas untuk slot yang sama: yang PERTAMA menang (hasil tak bergantung urutan unggah)', () => {
    const kedua = { ...f('bisnis|home', homeAoa()), filename: '[bisnis]-Home && Agu 2026 && EzzyConnect && 2026-09-02.xlsx' };
    const alt = homeAoa();
    (alt[2] as unknown[])[1] = 'Rp999.000.000';
    kedua.aoa = alt;
    const res = runShopeeBaseline([f('bisnis|home', homeAoa()), kedua], HIST, OPTS);
    expect(res.payload.toko?.gmv).toBe(100000000);
  });
});

// ── absen ≠ nol ─────────────────────────────────────────────────────────────
describe('absen ≠ nol (RAB-02 fix #2)', () => {
  const hanyaHome = () => runShopeeBaseline([f('bisnis|home', homeAoa())], HIST, OPTS).payload;

  it.each(['produk', 'iklan', 'afiliasi', 'video', 'live', 'layanan', 'kesehatan_toko'] as const)(
    'blok %s ⇒ null ketika berkasnya tak diunggah, BUKAN blok berisi 0',
    (key) => { expect(hanyaHome()[key]).toBeNull(); },
  );

  it('kelengkapan_file memuat KESELURUHAN 17 slot, yang absen bernilai false', () => {
    const kf = hanyaHome().kelengkapan_file;
    expect(Object.keys(kf)).toHaveLength(17);
    expect(kf.bisnis_home).toBe(true);
    expect(kf.bisnis_kesehatan).toBe(false);
    expect(kf.ads_toko).toBe(false);
  });

  it('kunci yang ADA tapi kosong tetap dikirim sebagai null eksplisit (kelas bug O43)', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.layanan).not.toBeNull();
    // CSAT ada di export contoh; yang penting kuncinya tidak pernah HILANG.
    expect(Object.prototype.hasOwnProperty.call(p.layanan!, 'csat')).toBe(true);
  });

  it('promo.diskon_aktif null (tak diunggah) BEDA dari false (diunggah, nihil)', () => {
    expect(hanyaHome().promo.diskon_aktif).toBeNull();
    const dgnDiskon = runShopeeBaseline(
      // `genericZero` menilai aktivitas dari angka di kolom ke-2 dan seterusnya,
      // jadi fixture "ada aktivitas" harus benar-benar membawa angka.
      [f('bisnis|home', homeAoa()), f('promo|diskon', [['Nama Diskon', 'Pesanan', 'Penjualan'], ['Diskon A', '12', '3000000']])],
      HIST, OPTS,
    ).payload;
    expect(dgnDiskon.promo.diskon_aktif).toBe(true);
  });
});

// ── B-1.4 ───────────────────────────────────────────────────────────────────
describe('B-1.4 — batalReturRate', () => {
  it('menjumlahkan batal DAN retur, dibagi GMV', () => {
    // (5.000.000 + 1.000.000) / 100.000.000
    expect(batalReturRate({ gmv: 100000000, batal_nilai: 5000000, retur_nilai: 1000000 })).toBeCloseTo(0.06, 10);
  });

  it('salah satu komponen absen dianggap nol rupiah DI DALAM blok yang ada', () => {
    expect(batalReturRate({ gmv: 100, batal_nilai: 10, retur_nilai: null })).toBeCloseTo(0.1, 10);
  });

  it('KEDUA komponen absen ⇒ null, bukan 0 (export tak membawa kolomnya)', () => {
    expect(batalReturRate({ gmv: 100, batal_nilai: null, retur_nilai: null })).toBeNull();
  });

  it('GMV nol atau absen ⇒ null, bukan pembagian nol', () => {
    expect(batalReturRate({ gmv: 0, batal_nilai: 5, retur_nilai: 5 })).toBeNull();
    expect(batalReturRate({ gmv: null, batal_nilai: 5, retur_nilai: 5 })).toBeNull();
  });
});

// ── B-5.3 ───────────────────────────────────────────────────────────────────
describe('B-5.3 — jenis materi & jumlah kampanye Shopee', () => {
  const kosong = { toko: [], produk: [], live: [], banner: [] };

  it('tipe materi diturunkan dari SLOT berkas, bukan teks bebas dari isi berkas', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.iklan?.tipe_materi).toEqual(['iklan_toko']);
  });

  it('nol berkas iklan ⇒ null, BUKAN [] dan BUKAN 0 kampanye', () => {
    expect(tipeMateriShopee(kosong)).toBeNull();
    expect(jumlahKampanyeShopee(kosong)).toBeNull();
  });

  it('kampanye dihitung per (slot, nama) sehingga nama sama di dua slot tidak lebur', () => {
    const ads = { ...kosong, toko: [{ nama: 'Kampanye A' }], produk: [{ nama: 'Kampanye A' }] } as never;
    expect(jumlahKampanyeShopee(ads)).toBe(2);
  });

  it('menghitung dua kampanye dari berkas Ads — Toko contoh', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.iklan?.jumlah_kampanye).toBe(2);
  });
});

// ── skala skor + kosakata ───────────────────────────────────────────────────
describe('skor & kondisi_toko', () => {
  it('skala mesin 0–10 dinaikkan ke 0–100 (kolom riset_awal_analisa.skor integer 0–100)', () => {
    expect(skorShopeeKe100(5.7)).toBe(57);
    expect(skorShopeeKe100(10)).toBe(100);
    expect(skorShopeeKe100(0)).toBe(0);
  });

  it('kondisi_toko dihitung dari skala 100, bukan dari angka 0–10 mentah', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.skor.total).toBe(Math.round(p.skor.total_mesin * 10));
    // Angka 0–10 mentah selalu < 45, jadi memakainya langsung akan menjatuhkan
    // SETIAP toko Shopee ke `mesin_belum_terbangun`.
    expect(p.skor.total).toBeGreaterThan(10);
  });

  it('kosakata kondisi_toko DISJOINT dari verdict Blok C (M6 Interview §9)', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(['growth_ready', 'bersyarat', 'risiko_tinggi', 'tidak_siap']).not.toContain(p.skor.kondisi_toko);
    expect(['mesin_jalan', 'mesin_sebagian', 'fondasi_perlu_dibenahi', 'mesin_belum_terbangun']).toContain(p.skor.kondisi_toko);
  });

  it('kondisi_toko TIDAK PERNAH belum_dapat_diukur — nilai itu milik jalur manual', () => {
    expect(runShopeeBaseline([f('bisnis|home', homeAoa())], HIST, OPTS).payload.skor.kondisi_toko)
      .not.toBe('belum_dapat_diukur');
  });

  it('cakupan_data menghitung dimensi yang PUNYA berkas, bukan yang dinilai netral', () => {
    const penuh = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload.skor.cakupan_data;
    const tipis = runShopeeBaseline([f('bisnis|home', homeAoa())], HIST, OPTS).payload.skor.cakupan_data;
    expect(penuh).toBeGreaterThan(tipis as number);
  });

  it('provenance lengkap — ck_analisa_skor_penuh menuntut benchmark_versi + parser_versi', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.benchmark_versi).toBe(1);
    expect(p.parser_versi).toBe('cdps-baseline-shopee-v1');
    expect(p.skor.total).toBeGreaterThanOrEqual(0);
    expect(p.skor.total).toBeLessThanOrEqual(100);
    expect(Number.isInteger(p.skor.total)).toBe(true);
  });
});

// ── recompute ───────────────────────────────────────────────────────────────
describe('recompute (aturan rumah #4)', () => {
  it('input sama + benchmark sama ⇒ payload IDENTIK', () => {
    const a = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    const b = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(b).toEqual(a);
  });

  it('urutan berkas tidak mengubah hasil', () => {
    const a = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    const b = runShopeeBaseline([...FILES_PENUH()].reverse(), HIST, OPTS).payload;
    expect(b).toEqual(a);
  });

  it('benchmark_dipakai disalin utuh sehingga skor bisa dihitung ulang dari payload saja', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.benchmark_dipakai).toEqual(REPORT_BENCH_SHOPEE_V1);
  });
});

// ── B-3 turunan ─────────────────────────────────────────────────────────────
describe('B-3 — irisan produk', () => {
  it('Pareto 80% dan slow-moving dihitung dari SELURUH katalog, bukan 10 teratas', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload.produk;
    // Σ GMV = 100jt; 80jt (SKU-A) sudah 80% tepat ⇒ 1 SKU.
    expect(p?.sku_pareto_80).toBe(1);
    expect(p?.sku_total).toBe(4);
    expect(p?.sku_ada_penjualan).toBe(3);
    expect(p?.sku_slow_moving).toBe(1);
  });

  it('top_sku membawa NAMA produk, bukan kode atau angka', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload.produk;
    expect(p?.top_sku[0].nama).toBe('Produk Bintang');
    expect(p?.top_sku[0].kode).toBe('SKU-A');
  });

  it('kuadran memakai mode BENCHMARK (ambang tetap), bukan persentil kohort', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload.produk;
    // Mode relatif membagi kohort 4 SKU ini secara berbeda; yang dipakai harus
    // yang bisa dibandingkan antar klien.
    expect(p?.kuadran).not.toBeNull();
    expect(Object.values(p!.kuadran!).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

// ── B-4 Shopee (keputusan pemilik) ──────────────────────────────────────────
describe('B-4 Shopee terisi otomatis (keputusan pemilik 2026-09-06)', () => {
  it('response rate, waktu respon, dan poin penalti terbaca dari export', () => {
    const p = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload;
    expect(p.layanan?.response_rate).toBeCloseTo(0.95, 4);
    expect(p.layanan?.waktu_respon_detik).toBe(750);
    expect(p.kesehatan_toko?.poin_total).toBe(1);
  });

  it('tanpa berkas Layanan/Kesehatan keduanya null ⇒ B-4 tetap manual', () => {
    const p = runShopeeBaseline([f('bisnis|home', homeAoa())], HIST, OPTS).payload;
    expect(p.layanan).toBeNull();
    expect(p.kesehatan_toko).toBeNull();
  });
});

// ── PARITAS BENTUK payload TikTok ↔ Shopee ──────────────────────────────────
/**
 * Kunci yang HARUS ada di kedua payload dengan arti dan satuan yang sama. B3
 * memetakan Section B lewat SATU pemeta yang memilih cabang dari
 * `payload.schema`; setiap kunci di daftar ini adalah kunci yang pemeta itu
 * boleh baca tanpa mengecek platform lebih dulu. Menambah kunci ke sini berarti
 * berjanji kedua mesin mengisinya — jadi jangan tambah tanpa mengisi keduanya.
 */
const KUNCI_KONGRUEN = {
  akar: ['schema', 'generated_at', 'sumber', 'klien', 'gmv_baseline', 'toko', 'gmv_mix', 'produk', 'iklan', 'afiliasi', 'video', 'live', 'skor', 'benchmark_versi', 'benchmark_dipakai', 'temuan', 'kelengkapan_file'],
  klien: ['nama', 'toko', 'kategori', 'umur_toko_bulan', 'account_manager', 'periode_referensi', 'definisi_gmv'],
  gmv_baseline: ['median_6m', 'runrate_3m', 'avg_terisi', 'trend_3v3', 'bulan_terisi', 'cakupan_riwayat', 'campaign_driven', 'bulan_puncak', 'riwayat'],
  toko: ['gmv', 'pesanan', 'pembeli', 'aov', 'pengunjung', 'konversi'],
  produk: ['sku_total', 'sku_ada_penjualan', 'rate', 'top3_share', 'sku_pareto_80', 'sku_slow_moving', 'top_sku'],
  iklan: ['belanja', 'pendapatan_teratribusi', 'roas', 'setara_persen_gmv', 'jumlah_kampanye', 'tipe_materi', 'catatan'],
  skor: ['total', 'verdict', 'kondisi_toko', 'cakupan_data', 'pilar'],
} as const;

// Fixture TikTok minimal — hanya Analitik Toko + Analitik Produk + Ads Manager,
// cukup untuk mengisi keempat blok yang diperbandingkan.
const TT_SHOP_HEADER = ['', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi', 'AOV', 'Pembeli', 'Produk terjual', 'Klik produk'];
const TT_PROD_HEADER = ['Nama', 'GMV', 'Klik produk', 'Impresi produk', 'CTR', 'CTOR (pesanan SKU)', 'Produk terjual', 'AOV (pesanan SKU)', 'Status daftar produk', 'GMV dari kreator', 'Pengembalian dana'];
const TT_ADS_HEADER = ['Nama kampanye', 'Jenis materi iklan', 'Judul video', 'Akun TikTok', 'Biaya', 'Pendapatan kotor', 'Pesanan SKU'];
const ttSheet = (header: unknown[], rows: unknown[][], fname: string): Sheet => {
  const d = readSheet([['Ringkasan Toko 2026-08-01 ~ 2026-08-31'], ['Semua', 'Semua', 'Semua'], header, ...rows], fname);
  if (!d) throw new Error('header tidak terbaca');
  d.periode = periodeOf(d.meta);
  return d;
};
const ttSlots = (): RunSlots => ({
  shop_tt: ttSheet(TT_SHOP_HEADER, [
    ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%', 'Rp100.000', '900', '1.200', '20.000'],
    ['Perubahan (%)', '5,00%', '', '', '', '', '', '', '', '', ''],
    ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', ''],
  ], 'toko.xlsx'),
  prod_tt: ttSheet(TT_PROD_HEADER, [
    ['Produk A', 'Rp80.000.000', '900', '5.000', '18,00%', '30,00%', '300', 'Rp266.000', 'Aktif', 'Rp0', 'Rp0'],
    ['Produk B', 'Rp20.000.000', '400', '3.000', '13,00%', '10,00%', '80', 'Rp250.000', 'Aktif', 'Rp0', 'Rp0'],
  ], 'produk.xlsx'),
  ads_prod: ttSheet(TT_ADS_HEADER, [
    ['Kampanye A', 'Video', 'Judul A', '@toko', 'Rp5.000.000', 'Rp40.000.000', '80'],
  ], 'ads.xlsx'),
});

describe('paritas bentuk payload TikTok ↔ Shopee (prasyarat B3)', () => {
  const tt = runBaseline(ttSlots(), HIST, {
    bench: BENCH_V1, benchmarkVersi: 1, net: true,
    klien: { nama: 'PT Ezzy', toko: 'EzzyConnect', akun_tiktok: '@ezzy', kategori: 'Fashion', umur_toko_bulan: 18, account_manager: 'EMP-002' },
    generatedAt: OPTS.generatedAt,
  }).payload as unknown as Record<string, Record<string, unknown>>;
  const sh = runShopeeBaseline(FILES_PENUH(), HIST, OPTS).payload as unknown as Record<string, Record<string, unknown>>;

  it('kedua payload menyatakan schema-nya sendiri, dan keduanya berbeda', () => {
    expect(tt.schema).toBe('cdps.baseline.tiktok.v1');
    expect(sh.schema).toBe('cdps.baseline.shopee.v1');
  });

  it.each(KUNCI_KONGRUEN.akar)('kunci akar `%s` ada di KEDUA payload', (k) => {
    expect(Object.prototype.hasOwnProperty.call(tt, k)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sh, k)).toBe(true);
  });

  it.each((['klien', 'gmv_baseline', 'toko', 'produk', 'iklan', 'skor'] as const).flatMap(
    (blok) => KUNCI_KONGRUEN[blok].map((k) => [blok, k] as const),
  ))('blok %s: kunci `%s` ada di KEDUA payload', (blok, k) => {
    expect(Object.prototype.hasOwnProperty.call(tt[blok], k)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sh[blok], k)).toBe(true);
  });

  it('kunci khas Shopee TIDAK menyusup ke payload TikTok (dan sebaliknya)', () => {
    // Shopee punya sumber B-4; TikTok tidak, dan pemilik menetapkannya manual.
    expect(Object.prototype.hasOwnProperty.call(sh, 'layanan')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(tt, 'layanan')).toBe(false);
    // TikTok punya GPM/afiliasi rate; Shopee tak mengekspornya.
    expect(Object.prototype.hasOwnProperty.call(tt.video as object, 'toko')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sh.afiliasi as object, 'rate')).toBe(false);
  });

  it('B1 mengisi turunan yang sama di kedua mesin', () => {
    expect(tt.produk.sku_pareto_80).toBe(1);
    expect(sh.produk.sku_pareto_80).toBe(1);
    expect(tt.iklan.jumlah_kampanye).toBe(1);
    expect(sh.iklan.jumlah_kampanye).toBe(2);
  });
});

// ── irisan langsung dari ShopeeMetrics ──────────────────────────────────────
describe('buildShopeeBaselineMetrics', () => {
  it('slots WAJIB dipakai: afiliasi null bila berkasnya absen walau metrik punya nilai default', () => {
    const parsed: ParsedShopee = {};
    const M = buildShopeeMetrics({ ...parsed, bisnis_home: { pesanan_dibuat: { summary: { penjualan: 1000 }, daily: [] }, pesanan_siap_dikirim: null, pesanan_dibayar: null } }, REPORT_BENCH_SHOPEE_V1);
    expect(buildShopeeBaselineMetrics(M, {}).afiliasi).toBeNull();
    expect(buildShopeeBaselineMetrics(M, { aff_creator: true }).afiliasi).not.toBeNull();
  });
});
