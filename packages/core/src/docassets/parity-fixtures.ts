/**
 * Fixture untuk `css-parity.test.ts` — bukan fixture uji perilaku.
 *
 * Tugasnya SATU: menghasilkan HTML yang menyentuh sebanyak mungkin jalur kode
 * yang memancarkan `class="…"` di ketiga renderer, supaya tes paritas punya
 * bahan untuk diperiksa.
 *
 * KENAPA BUKAN MEMAKAI ULANG FIXTURE DI `report.test.ts` / `shopee.test.ts` /
 * `adsscanner.test.ts`. Dua alasan, dan keduanya disengaja:
 *
 *  1. Fixture di berkas tes itu **lokal** (helper di dalam berkas, tidak
 *     diekspor). Mengangkatnya jadi modul bersama berarti menyunting tiga
 *     berkas tes berisi ~2.900 tes yang hijau, demi tes keempat — risiko yang
 *     tidak sebanding.
 *  2. Fixture di sana disetel untuk membuktikan ARITMATIKA (null bukan nol,
 *     bagi-nol jadi `—`, pro-rate mingguan). Yang dibutuhkan di sini justru
 *     kebalikannya: setiap seksi HADIR, setiap cabang warna terpakai, kedua
 *     mode ikut. Angkanya sendiri tidak diperiksa satu pun di tes paritas.
 *
 * Yang membuat duplikasi ini aman: fixture di sini tidak boleh menjadi sumber
 * kebenaran apa pun. Nol assertion tentang angka. Kalau parser export berubah
 * dan fixture di sini jadi basi, tes paritas akan gagal keras di tahap
 * membangun payload — bukan lolos diam-diam dengan HTML kosong. `assertPadat()`
 * di bawah menegakkan itu.
 */
import { periodeOf, readSheet, type Aoa, type Sheet } from '../baseline';
import { runReport } from '../report/run';
import type { ReportSlots } from '../report/types';
import type { ReportPayload } from '../report/payload';
import { runShopeeReport } from '../report/shopee/run';
import { REPORT_BENCH_SHOPEE_V1 } from '../report/shopee/bench';
import type { ShopeeSlots } from '../report/shopee/types';
import type { ShopeeReportPayload } from '../report/shopee/payload';
import { runAdsScanner } from '../adsscanner/tiktok/run';
import { DEFAULT_ADS_SCANNER_CFG } from '../adsscanner/tiktok/types';
import type { AdsScannerPayload } from '../adsscanner/tiktok/payload';

const META = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
const GEN_AT = '2026-09-01T03:00:00.000Z';
const KLIEN_TT = {
  nama: 'PT Paritas', toko: 'Toko Paritas', platform: 'TikTok Shop',
  kategori: 'Fashion', account_manager: 'EMP-001', store_link: null,
};
const KLIEN_SH = { ...KLIEN_TT, platform: 'Shopee' };

const aoa = (header: unknown[], rows: unknown[][], meta = META): Aoa =>
  [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const sheet = (a: Aoa, fname: string): Sheet => {
  const d = readSheet(a, fname);
  if (!d) throw new Error(`fixture paritas tidak terbaca: ${fname}`);
  d.periode = periodeOf(d.meta);
  return d;
};

// ── TikTok ──────────────────────────────────────────────────────────────────
const shopTt = (): Sheet => sheet(aoa(
  ['', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
    'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
    'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut'],
  [
    ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
      'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
    ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
    ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
    ['02/08/2026', 'Rp4.000.000', '', '', '', '40', '', '', '', '', '', '', '', '', ''],
  ]), 'toko.xlsx');

const liveToko = (): Sheet => sheet(aoa(
  ['Waktu Live', 'Kreator', 'Durasi', 'GMV dari LIVE (Rp)', 'Penonton', 'Klik Produk', 'Produk dilihat'],
  [
    ['2026/08/03 19:30', 'Host A', '2h 30min', 'Rp6.000.000', '1.200', '400', '5.000'],
    // Sesi nol penjualan — memicu kartu internal "Jam Siaran Tanpa Hasil" (amber).
    ['2026/08/04 20:00', 'Host A', '2h 0min', 'Rp0', '300', '50', '900'],
    ['2026/08/10 19:00', 'Host B', '3h 0min', 'Rp9.000.000', '2.000', '700', '8.000'],
  ]), 'live.xlsx');

// Lima produk = kelima kuadran, supaya seluruh palet KUADRAN_META terpakai.
const prodTt = (): Sheet => sheet(aoa(
  ['Nama', 'ID Produk', 'GMV', 'Klik produk', 'Impresi produk', 'CTOR (pesanan SKU)', 'Pesanan SKU', 'Produk terjual'],
  [
    ['Produk Bintang', 'P1', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30'],
    ['Produk Bocor', 'P2', 'Rp5.000.000', '800', '30.000', '0,20%', '2', '3'],
    ['Hidden Gem', 'P3', 'Rp8.000.000', '60', '1.000', '4,00%', '2', '4'],
    ['Produk Tidur', 'P4', 'Rp0', '3', '100', '0', '0', '0'],
    ['Belum Tayang', 'P5', 'Rp0', '0', '0', '0', '0', '0'],
  ]), 'produk.xlsx');

// Baris kedua nol pesanan = kartu internal "Budget Terbakar" (merah).
const adsProd = (): Sheet => sheet(aoa(
  ['Nama kampanye', 'Jenis materi iklan', 'Judul video', 'Akun TikTok', 'Biaya', 'Pendapatan kotor',
    'Pesanan SKU', 'Impresi iklan produk', 'Jumlah klik iklan produk'],
  [
    ['Kampanye A', 'Video', 'Video jualan', '@toko', '1000000', '9000000', '90', '500000', '20000'],
    ['Kampanye A', 'Video', 'Video gagal', '@toko', '500000', '0', '0', '200000', '3000'],
  ]), 'ads.xlsx');

// Refund tinggi pada satu kreator = banner "Refund Affiliate Tinggi" (merah).
const affKr = (): Sheet => sheet(aoa(
  ['Creator name', 'GMV dari kreator', 'Video', 'Siaran LIVE', 'Sampel terkirim',
    'Pesanan teratribusi', 'Pengembalian dana', 'Perkiraan komisi'],
  [
    ['Kreator Produktif', 'Rp20.000.000', '5', '2', '1', '150', 'Rp6.000.000', 'Rp2.000.000'],
    ['Kreator Nempel', 'Rp0', '4', '0', '1', '0', 'Rp0', 'Rp0'],
    ['Kreator Pasif', 'Rp0', '0', '0', '0', '0', 'Rp0', 'Rp0'],
    ['Toko Resmi', 'Rp30.000.000', '10', '5', '0', '200', 'Rp0', 'Rp0'],
  ]), 'aff.xlsx');

const vidToko = (): Sheet => sheet(aoa(
  ['Informasi Video', 'Nama Kreator', 'ID Video', 'Waktu', 'GMV dari video (Rp)', 'GPM (Rp)', 'VV', 'CTOR (pesanan SKU)'],
  [
    ['Promo Agustus #promo', 'Toko Resmi', 'v1', '2026/08/05 10:00', 'Rp2.000.000', 'Rp100.000', '20.000', '1,20%'],
    ['', 'Toko Resmi', 'v2', '2026/08/12 09:00', 'Rp0', 'Rp0', '5.000', '0'],
  ]), 'video-toko.xlsx');

const shopTp = (): Sheet => sheet(aoa(
  ['', 'GMV', 'Pengunjung', 'Pesanan', 'Persentase konversi', 'Produk terjual', 'Pembeli'],
  [
    ['Total nilai penjualan', 'Rp20.000.000', '9.000', '200', '2,20%', '260', '180'],
    // GMV turun sementara pesanan naik = banner "Perhatian: AOV melemah" (amber).
    ['Perubahan persentase', '-8,00%', '4,00%', '12,00%', '', '', ''],
  ]), 'tokopedia.xlsx');

const ttam = (extra: string[], rows: unknown[][]): Sheet => sheet(aoa(
  ['Ad group name', 'Primary status', 'Spend', 'Impressions', 'Reach', 'Clicks (destination)', ...extra],
  rows, 'Ads 2026-08-01 ~ 2026-08-31'), 'ttam.xlsx');

const ttamShowcase = (): Sheet => ttam(
  ['Checkouts initiated (Shop)', 'Adds to cart (Shop)', 'Product page views (Shop)'],
  [['AG1', 'Active', '1400000', '200000', '150000', '16000', '300', '800', '15000']]);
const ttamVideoViews = (): Sheet => ttam(['Video views', 'CPM'],
  [['AG1', 'Active', '4900000', '1600000', '900000', '2000', '1500000', '3014']]);
const ttamConsideration = (): Sheet => ttam(['New consideration size'],
  [['AG1', 'Active', '900000', '400000', '250000', '9000', '38000']]);
// Belanja nol = cabang "Kampanye belum berjalan" (amber) di blok Paid Follows.
const ttamFollows = (): Sheet => ttam(['Paid follows'],
  [['AG1', 'Active', '0', '90000', '900', '1100', '0']]);

const jalankanTt = (slots: ReportSlots, tahapFokus: 'awareness' | null): ReportPayload =>
  runReport(slots, {
    periodeTipe: 'bulanan', klien: KLIEN_TT, generatedAt: GEN_AT, benchmarkVersi: 1,
    akunSendiri: ['Toko Resmi'], tahapFokus,
  }).payload;

/** Seluruh seksi hadir: LIVE, iklan, produk, afiliasi, video, Tokopedia, ketiga
 *  berkas Ads Manager, plus lencana fokus tahap. */
export const payloadTiktokPenuh = (): ReportPayload => jalankanTt({
  shop_tt: shopTt(), live_toko: liveToko(), prod_tt: prodTt(), ads_prod: adsProd(),
  aff_kr: affKr(), vid_toko: vidToko(), shop_tp: shopTp(),
  ttam_showcase: ttamShowcase(), ttam_videoviews: ttamVideoViews(),
  ttam_follows: ttamFollows(), ttam_consideration: ttamConsideration(),
}, 'awareness');

/** Hanya berkas toko — setiap seksi opsional jatuh ke jalur `kosong()`, dan
 *  tahap terbit TANPA lencana fokus (`tahap_fokus` NULL, keadaan sah). */
export const payloadTiktokMinimal = (): ReportPayload => jalankanTt({ shop_tt: shopTt() }, null);

/** Payload sebelum R3: tanpa kunci `tahap` sama sekali. Renderer melewati
 *  lapisan tahap, dan HTML-nya tetap harus lengkap secara kelas. */
export const payloadTiktokPraR3 = (): ReportPayload => {
  const p = payloadTiktokPenuh();
  const { tahap: _tahap, ...sisa } = p as ReportPayload & { tahap?: unknown };
  return sisa as ReportPayload;
};

// ── Shopee ──────────────────────────────────────────────────────────────────
const bisnisHome = (): Aoa => [
  ['Pesanan Dibuat'],
  ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
    'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
    'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru',
    'Total Pembeli Saat Ini', 'Total Potensi Pembeli', 'Tingkat Pembelian Berulang'],
  ['Total', 'Rp100.000.000', '1.000', 'Rp100.000', '5.000', '50.000', '2,00%', '50', 'Rp5.000.000',
    '10', 'Rp1.000.000', '900', '300', '600', '50', '20,00%'],
  ['01/08/2026', 'Rp3.000.000', '30', 'Rp100.000', '150', '2.000', '1,50%', '2', 'Rp50.000', '0', 'Rp0', '25', '10', '15', '2', '10,00%'],
  ['02/08/2026', 'Rp4.000.000', '40', 'Rp100.000', '160', '2.100', '1,90%', '1', 'Rp30.000', '0', 'Rp0', '30', '12', '18', '2', '11,00%'],
];

const bisnisProduk = (): Aoa => [
  ['Kode Produk', 'Produk', 'Nama Variasi', 'Status Produk Saat Ini', 'Jumlah Produk Dilihat', 'Produk Diklik',
    'Pengunjung Produk (Kunjungan)', 'Pesanan Dibuat', 'Total Penjualan (Pesanan Dibuat) (IDR)',
    'Total Pembeli (Pesanan Dibuat)', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Pesanan Siap Dikirim',
    'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Tingkat Konversi (Pesanan Siap Dikirim)'],
  ['SKU-A', 'Produk Bintang', '-', 'Aktif', '5000', '900', '1000', '300', 'Rp90.000.000', '290', '30,00%', '280', 'Rp84.000.000', '28,00%'],
  ['SKU-B', 'Produk Bocor', '-', 'Aktif', '8000', '1200', '1500', '5', 'Rp1.000.000', '5', '0,33%', '5', 'Rp900.000', '0,30%'],
  ['SKU-C', 'Hidden Gem', '-', 'Aktif', '300', '80', '120', '30', 'Rp6.000.000', '28', '25,00%', '28', 'Rp5.500.000', '23,00%'],
  ['SKU-D', 'Produk Tidur', '-', 'Aktif', '10', '2', '20', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
  ['SKU-E', 'Tidak Tayang', '-', 'Aktif', '0', '0', '0', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
];

const adsToko = (): Aoa => [
  ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Omzet Penjualan', 'Biaya',
    'Pesanan', 'Produk Terjual', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
  ['Kampanye A', 'Berjalan', '50000', '2000', '4.00%', '40000000', '5000000', '80', '85', '8.00', '12.50%'],
];

const adsLive = (): Aoa => [
  ['Nama Iklan', 'Status', 'Penonton', 'Pesanan', 'Tingkat Konversi', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan'],
  ['Live Ads A', 'Berjalan', '3000', '40', '1.33%', '15000000', '3000000', '5.00'],
];

const layananChat = (): Aoa => [
  ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Pertanyaan Diajukan', 'Chat Dibalas',
    'Chat Belum Dibalas', 'Waktu Respon Rata-rata', 'CSAT %', 'Persentase Chat Dibalas', 'Total Pembeli',
    'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
  ['01-31 Agu', '5000', '800', '700', '750', '760', '40', '00:12:30', '90,00%', '95,00%', '150', '160', 'Rp16.000.000', '20,00%'],
];

const bisnisVideo = (): Aoa => [
  ['Periode Data', 'Penjualan(Pesanan Dibuat)', 'Penjualan(Pesanan Siap Dikirim)', 'Pesanan(Pesanan Dibuat)',
    'Pesanan(Pesanan Siap Dikirim)', 'Produk Terjual(Pesanan Dibuat)', 'Penonton', 'Ditonton', 'Penonton Efektif',
    'Persentase Klik', 'Pembeli(Pesanan Dibuat)', 'Tambah ke Keranjang', 'Klik Produk', 'Suka', 'Share',
    'Komentar', 'Pengikut Baru dari Video', 'Tingkat Video Selesai Ditonton'],
  ['01-31 Agu 2026', 'Rp5.000.000', 'Rp4.800.000', '50', '48', '52', '8000', '12000', '6000', '3,00%', '45', '200', '360', '500', '80', '120', '30', '40,00%'],
];

const affCreator = (): Aoa => [
  ['Username', 'Omzet', 'Produk Terjual', 'Pesanan', 'Click', 'Komisi', 'ROI', 'Total Pembeli', 'Pembeli Baru'],
  ['@kreator1', '10000000', '20', '18', '500', '1000000', '3.5', '15', '4'],
];

const promoVoucher = (): Aoa => [
  ['Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)',
    'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)'],
  ['01-31 Agu', '200', '150', 'Rp8.000.000', '75,00%', '140', 'Rp500.000'],
];

/** Satu poin penalti aktif = blok penalti merah + ikon `fa-triangle-exclamation`. */
const kesehatanBerpenalti = (): Aoa => [
  ['Poin Penalti', 'Deskripsi', 'Durasi'],
  ['1', 'Pelanggaran larangan produk', '7 hari'],
];
/** Nol poin = cabang teal + ikon `fa-shield-halved`. Cabang KEDUA seksi yang
 *  sama, jadi kedua-duanya perlu dirender untuk menutup kelasnya. */
const kesehatanBersih = (): Aoa => [['Poin Penalti', 'Deskripsi', 'Durasi']];

const jalankanShopee = (slots: ShopeeSlots): ShopeeReportPayload =>
  runShopeeReport(slots, {
    bench: REPORT_BENCH_SHOPEE_V1, benchmarkVersi: 1, klien: KLIEN_SH,
    generatedAt: GEN_AT, periode: 'Agustus 2026',
  }).payload;

export const payloadShopeePenuh = (): ShopeeReportPayload => jalankanShopee({
  bisnis_home: bisnisHome(), bisnis_produk: bisnisProduk(), ads_toko: adsToko(), ads_live: adsLive(),
  layanan_chat: layananChat(), bisnis_video: bisnisVideo(), aff_creator: affCreator(),
  promo_voucher: promoVoucher(), bisnis_kesehatan: kesehatanBerpenalti(),
});

/** Sama, tapi kesehatan toko bersih — menutup cabang hijau seksi Layanan. */
export const payloadShopeeBersih = (): ShopeeReportPayload => jalankanShopee({
  bisnis_home: bisnisHome(), bisnis_produk: bisnisProduk(), ads_toko: adsToko(), ads_live: adsLive(),
  layanan_chat: layananChat(), bisnis_video: bisnisVideo(), aff_creator: affCreator(),
  promo_voucher: promoVoucher(), bisnis_kesehatan: kesehatanBersih(),
});

/** Hanya berkas Home — setiap seksi opsional jatuh ke jalur kosongnya. */
export const payloadShopeeMinimal = (): ShopeeReportPayload => jalankanShopee({ bisnis_home: bisnisHome() });

// ── Ads Scanner ─────────────────────────────────────────────────────────────
/**
 * SKU dirancang supaya SETIAP bucket dan SETIAP gerbang punya penghuni: itulah
 * yang membuat seluruh `BUCKET_META[*].cls` dan `GATE_CLS[*]` ikut dirender.
 * Ditambah satu baris belanja tanpa Analitik Produk (SKU mati).
 */
export const payloadAdsScanner = (): AdsScannerPayload => {
  const pid = (n: number): string => `17296435404626${String(n).padStart(5, '0')}`;
  const analitik = [
    { 'ID Produk': pid(1), Nama: 'SKU Menang', GMV: 'Rp50.000.000', 'Pesanan SKU': '400', 'Impresi produk': '200000', 'Klik produk': '12000', CTR: '6%', 'CTOR (pesanan SKU)': '3,3%' },
    { 'ID Produk': pid(2), Nama: 'SKU Boros', GMV: 'Rp1.000.000', 'Pesanan SKU': '5', 'Impresi produk': '100000', 'Klik produk': '900', CTR: '0,9%', 'CTOR (pesanan SKU)': '0,5%' },
    { 'ID Produk': pid(3), Nama: 'SKU Belum Diiklankan', GMV: 'Rp9.000.000', 'Pesanan SKU': '70', 'Impresi produk': '40000', 'Klik produk': '2500', CTR: '6,2%', 'CTOR (pesanan SKU)': '2,8%' },
    { 'ID Produk': pid(4), Nama: 'SKU Konten Kering', GMV: 'Rp0', 'Pesanan SKU': '0', 'Impresi produk': '500', 'Klik produk': '5', CTR: '1%', 'CTOR (pesanan SKU)': '0%' },
  ];
  const ads = [
    { 'ID produk': pid(1), Biaya: 'Rp5.000.000', 'Pendapatan kotor': 'Rp45.000.000', 'Nama kampanye': 'K-Menang' },
    { 'ID produk': pid(2), Biaya: 'Rp4.000.000', 'Pendapatan kotor': 'Rp900.000', 'Nama kampanye': 'K-Boros' },
    { 'ID produk': pid(4), Biaya: 'Rp1.500.000', 'Pendapatan kotor': 'Rp0', 'Nama kampanye': 'K-Kering' },
    // Belanja pada ID yang TIDAK ada di Analitik Produk = seksi "SKU Mati".
    { 'ID produk': pid(9), Biaya: 'Rp800.000', 'Pendapatan kotor': 'Rp0', 'Nama kampanye': 'K-Hantu' },
  ];
  const videos = [
    { rows: [
      { Produk: `SKU Menang (${pid(1)})`, VV: '90000', 'GMV dari video (Rp)': 'Rp12.000.000', 'Nama Kreator': 'C1', 'Informasi Video': 'review jujur produk ini' },
      { Produk: `SKU Belum Diiklankan (${pid(3)})`, VV: '60000', 'GMV dari video (Rp)': 'Rp7.000.000', 'Nama Kreator': 'C2', 'Informasi Video': 'unboxing paket datang' },
    ], kind: 'kreator' as const },
    { rows: [
      { Produk: `SKU Menang (${pid(1)})`, VV: '30000', 'GMV dari video (Rp)': 'Rp3.000.000', 'Nama Kreator': 'Toko', 'Informasi Video': 'tutorial pemakaian' },
    ], kind: 'toko' as const },
  ];
  return runAdsScanner({ analitik, ads, adslive: [], videos }, {
    cfg: { ...DEFAULT_ADS_SCANNER_CFG, category: 'Fashion Accessories' },
    klien: { nama: 'Klien Paritas', account_manager: 'EMP-001' },
    generatedAt: GEN_AT,
    periode: { weekStart: '2026-08-24' },
  }).payload;
};

/**
 * Penjaga bahwa fixture di atas tidak diam-diam membusuk jadi halaman kosong.
 *
 * Tanpa ini, parser export yang berubah bisa membuat setiap seksi jatuh ke
 * cabang "berkas tidak diunggah", tes paritas tetap HIJAU (nol kelas yang
 * hilang karena nyaris nol kelas yang dirender), dan penjaga CSS-nya berhenti
 * menjaga apa pun tanpa satu pun tanda.
 */
export function assertPadat(html: string, minTokenUnik: number, label: string): void {
  const token = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) token.add(t);
  }
  if (token.size < minTokenUnik) {
    throw new Error(
      `fixture paritas "${label}" terlalu tipis: ${token.size} token kelas unik, minimal ${minTokenUnik}. ` +
      'Kemungkinan besar parser export berubah dan payload-nya jadi kosong — perbaiki fixture-nya, ' +
      'JANGAN turunkan ambangnya.',
    );
  }
}
