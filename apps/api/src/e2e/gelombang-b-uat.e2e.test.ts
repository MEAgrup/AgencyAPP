/**
 * UAT Gelombang B §10 — butir 1..7 dijalankan LEWAT RUTE, di DB sungguhan.
 *
 * `HANDOFF_GELOMBANG_B_TUTUP_20260907.md` §4 butir 1 mencatat satu utang yang
 * jujur: "Uji terima §10 butir 1–7 belum dijalankan end-to-end di aplikasi
 * nyata. Yang terbukti adalah tesnya, bukan layarnya." Berkas ini membayar
 * utang itu setinggi yang bisa dibayar tanpa browser: setiap langkah §10
 * dipanggil sebagai `Request` ke route handler `apps/api` yang sungguhan —
 * lewat `requireActor` (JWT), lewat `wire.ts`, lewat domain, ke Postgres hasil
 * `scripts/db-rebuild.sh`. Yang TIDAK dibuktikan di sini hanya piksel: React
 * merender apa yang dikembalikan rute ini.
 *
 * Kenapa di lapis rute, bukan domain: bug kelas O43 (kunci wire hilang ⇒
 * halaman blank walau 200) hidup PERSIS di antara domain dan halaman, dan
 * itulah lapis yang belum pernah dilalui rantai B1→B5 dari ujung ke ujung.
 * Aturan §2.4 handoff yang sama: satu tes wajib memanggil KEDUA sisi jahitan
 * yang sungguhan — di sini tujuh jahitan sekaligus, berurutan, satu klien.
 *
 * Dilewati bila `DATABASE_URL` tak diset. Semua baris ber-awalan `ZZ-UATB`
 * dan dihapus di `afterAll`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';

import { POST as baselineSubmit, GET as baselineGet } from '../app/api/v1/interview/[id]/baseline/route';
import { POST as baselineConfirm } from '../app/api/v1/interview/[id]/baseline/confirm/route';
import { GET as prefillGet } from '../app/api/v1/strategi/[id]/baseline-prefill/route';
import { POST as strategiCreate } from '../app/api/v1/services/[id]/strategi/route';
import { PUT as channelsPut } from '../app/api/v1/strategi/[id]/channels/route';
import { PUT as baselinePut } from '../app/api/v1/strategi/[id]/channels/[channelId]/baseline/route';
import { GET as kekuranganGet } from '../app/api/v1/strategi/[id]/kekurangan/route';
import { POST as strategiSubmit } from '../app/api/v1/strategi/[id]/submit/route';
import { GET as copilotGet } from '../app/api/v1/strategi/[id]/copilot/route';
import { PUT as pillarsPut } from '../app/api/v1/strategi/[id]/pillars/route';
import { PUT as konteksPut } from '../app/api/v1/strategi/[id]/konteks/route';
import { PUT as aksesPut } from '../app/api/v1/strategi/[id]/akses/route';
import { PUT as diagnosaPut } from '../app/api/v1/strategi/[id]/diagnosa/route';
import { PUT as targetsPut } from '../app/api/v1/strategi/[id]/targets/route';
import { PUT as assumptionsPut } from '../app/api/v1/strategi/[id]/assumptions/route';
import { PUT as kpiPut } from '../app/api/v1/strategi/[id]/kpi/route';
import { PUT as narasiPut } from '../app/api/v1/strategi/[id]/narasi/route';
import { PUT as risksPut } from '../app/api/v1/strategi/[id]/risks/route';
import { PUT as ketergantunganPut } from '../app/api/v1/strategi/[id]/ketergantungan/route';
import { PUT as kalenderPut } from '../app/api/v1/strategi/[id]/kalender/route';
import { PUT as triggerRevisiPut } from '../app/api/v1/strategi/[id]/trigger-revisi/route';
import { PUT as handoffPut } from '../app/api/v1/strategi/[id]/handoff/route';
import { POST as strategiApprove } from '../app/api/v1/strategi/[id]/approve/route';
import { GET as planDetailGet } from '../app/api/v1/plan/[id]/route';
import { POST as planSubmit } from '../app/api/v1/plan/[id]/submit/route';
import { POST as planBriefs } from '../app/api/v1/plan/[id]/briefs/route';
import { GET as briefGet } from '../app/api/v1/briefs/[id]/route';

const SECRET = 'uat-gelombang-b-secret';
const URL_DB = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL_DB);
let sql: Sql;
if (URL_DB) sql = createClient(URL_DB);

// ---------------------------------------------------------------------------
// Aktor — token GoTrue asli (HS256), diverifikasi `requireActor` seperti biasa.
// ---------------------------------------------------------------------------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
function sign(c: { employeeId: string; division: string; level: string; od?: boolean; director?: boolean }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: {
      employee_id: c.employeeId, division: c.division, level: c.level,
      od: c.od ?? false, director: c.director ?? false,
    },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const AM = 'ZZ-UATB-AM';
const LEAD = 'ZZ-UATB-LEAD';
const SALES = 'ZZ-UATB-SALES';
const amToken = sign({ employeeId: AM, division: 'Account', level: 'staff' });
const leadToken = sign({ employeeId: LEAD, division: 'Account', level: 'lead' });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ctx2 = (id: string, channelId: string) => ({ params: Promise.resolve({ id, channelId }) });
function post(path: string, token: string, body: unknown): Request {
  return new Request(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function put(path: string, token: string, bodyJson: unknown): Request {
  return new Request(`http://localhost/api/v1${path}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(bodyJson),
  });
}
function get(path: string, token: string): Request {
  return new Request(`http://localhost/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
}
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Export TikTok — bentuk kolom PERSIS seperti `detect.ts`/`metrik.ts` menuntut.
// Satu unggahan = delapan berkas (butir 1: "upload … satu kali").
// ---------------------------------------------------------------------------
const AKUN_TOKO = 'zztoko_official';

const sheet = (meta: string, header: unknown[], rows: unknown[][]): unknown[][] =>
  [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Pendapatan bruto', 'Tayangan halaman', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV LIVE penjual', 'GMV tidak langsung dari LIVE penjual',
  'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTtAoa = (): unknown[][] => {
  const tot = [
    'Total nilai penjualan', 'Rp500.000.000', 'Rp50.000.000', '250.000', 'Rp25.000.000',
    '5.000', '2,00%', 'Rp100.000', '4.500', '6.000', 'Rp475.000.000', '400.000', '2.500.000', '100.000',
    'Rp40.000.000', 'Rp0', 'Rp0', 'Rp75.000.000', 'Rp60.000.000',
  ];
  const chg = ['Perubahan (%)', '5,00%', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const daily = (t: string, g: string, o: string): unknown[] => {
    const r = new Array(SHOP_TT_HEADER.length).fill('');
    r[0] = t; r[1] = g; r[5] = o;
    return r;
  };
  return sheet('Ringkasan Toko 2026-08-01 ~ 2026-08-31', SHOP_TT_HEADER, [
    tot, chg,
    daily('01/08/2026', 'Rp15.000.000', '150'),
    daily('02/08/2026', 'Rp16.000.000', '160'),
    daily('03/08/2026', 'Rp17.000.000', '170'),
  ]);
};

const PROD_HEADER = [
  'ID Produk', 'Nama', 'GMV', 'Klik produk', 'Impresi produk', 'CTR', 'CTOR (pesanan SKU)',
  'Produk terjual', 'AOV (pesanan SKU)', 'Status daftar produk', 'GMV dari kreator', 'Pengembalian dana',
];
const prodAoa = (): unknown[][] => {
  const row = (id: string, nama: string, gmv: string, klik: string, ctor: string): unknown[] =>
    [id, nama, gmv, klik, '50.000', '4,00%', ctor, '100', 'Rp100.000', 'Aktif', 'Rp10.000.000', 'Rp1.000.000'];
  return sheet('Produk 2026-08-01 ~ 2026-08-31', PROD_HEADER, [
    row('p1', 'Serum Zeta 30ml', 'Rp200.000.000', '40.000', '5,00%'),
    row('p2', 'Toner Zeta 100ml', 'Rp120.000.000', '25.000', '4,00%'),
    row('p3', 'Sabun Zeta', 'Rp80.000.000', '15.000', '3,00%'),
    row('p4', 'Masker Zeta', 'Rp0', '900', '0,00%'),
    row('p5', 'Sisir Zeta', 'Rp0', '400', '0,00%'),
  ]);
};

const VIDEO_HEADER = [
  'Informasi Video', 'Nama Kreator', 'ID Video', 'Waktu', 'GMV dari video (Rp)', 'GPM (Rp)', 'VV', 'Likes',
  'Komentar', 'Dibagikan', 'Klik Produk', 'Rasio klik tayang (Video)', 'CTOR (pesanan SKU)',
  'Persentase Video yang Ditonton Hingga Selesai', 'Produk yang terjual melalui video',
];
const vid = (judul: string, kreator: string, id: string, waktu: string, gmv: string, gpm: string, vv: string): unknown[] =>
  [judul, kreator, id, waktu, gmv, gpm, vv, '1.200', '80', '40', '900', '3,00%', '2,00%', '35,00%', '30'];
const vidTokoAoa = (): unknown[][] => sheet('Video 2026-08-01 ~ 2026-08-31', VIDEO_HEADER, [
  vid('Racun skincare #serum #glowing', AKUN_TOKO, 'v1', '2026/08/05 10:00', 'Rp30.000.000', 'Rp250.000', '120.000'),
  vid('Before after 14 hari #serum', AKUN_TOKO, 'v2', '2026/08/12 19:00', 'Rp20.000.000', 'Rp180.000', '110.000'),
  vid('Tutorial layering #skincare', AKUN_TOKO, 'v3', '2026/08/20 20:00', 'Rp10.000.000', 'Rp90.000', '90.000'),
  vid('Unboxing paket #zeta', AKUN_TOKO, 'v4', '2026/08/25 21:00', 'Rp0', 'Rp0', '15.000'),
]);
const vidAffAoa = (): unknown[][] => sheet('Video 2026-08-01 ~ 2026-08-31', VIDEO_HEADER, [
  vid('Review jujur #serum', 'kreator.satu', 'a1', '2026/08/06 10:00', 'Rp25.000.000', 'Rp200.000', '150.000'),
  vid('Bandingin dua serum', 'kreator.dua', 'a2', '2026/08/09 11:00', 'Rp15.000.000', 'Rp120.000', '100.000'),
  vid('Skincare hemat', 'kreator.tiga', 'a3', '2026/08/17 12:00', 'Rp5.000.000', 'Rp60.000', '80.000'),
]);

const LIVE_HEADER = [
  'Waktu Live', 'Kreator', 'Durasi', 'GMV dari LIVE (Rp)', 'Penonton', 'Live Stream Dilihat',
  'Durasi menonton rata-rata (Siaran LIVE)', 'CTOR', 'CTR', 'Klik Produk', 'Produk Terjual', 'Komentar',
];
const liveRow = (waktu: string, kreator: string, dur: string, gmv: string): unknown[] =>
  [waktu, kreator, dur, gmv, '3.000', '20.000', '90', '2,00%', '3,00%', '1.500', '120', '400'];
const liveTokoAoa = (): unknown[][] => sheet('LIVE 2026-08-01 ~ 2026-08-31', LIVE_HEADER, [
  liveRow('2026/08/04 19:00', AKUN_TOKO, '4h 0min', 'Rp20.000.000'),
  liveRow('2026/08/11 19:00', AKUN_TOKO, '4h 0min', 'Rp12.000.000'),
  liveRow('2026/08/18 20:00', AKUN_TOKO, '3h 30min', 'Rp8.000.000'),
]);
const liveAffAoa = (): unknown[][] => sheet('LIVE 2026-08-01 ~ 2026-08-31', LIVE_HEADER, [
  liveRow('2026/08/07 20:00', 'kreator.satu', '2h 0min', 'Rp30.000.000'),
  liveRow('2026/08/14 21:00', 'kreator.dua', '2h 0min', 'Rp20.000.000'),
]);

const AFF_HEADER = [
  'Creator name', 'GMV dari kreator', 'GMV dari LIVE kreator', 'GMV dari video afiliasi', 'Video', 'Siaran LIVE',
  'Sampel terkirim', 'Pesanan teratribusi', 'Perkiraan komisi',
];
const affAoa = (): unknown[][] => sheet('Afiliasi 2026-08-01 ~ 2026-08-31', AFF_HEADER, [
  ['kreator.satu', 'Rp55.000.000', 'Rp30.000.000', 'Rp25.000.000', '1', '1', '10', '500', 'Rp5.500.000'],
  ['kreator.dua', 'Rp35.000.000', 'Rp20.000.000', 'Rp15.000.000', '1', '1', '8', '300', 'Rp3.500.000'],
  ['kreator.tiga', 'Rp5.000.000', 'Rp0', 'Rp5.000.000', '1', '0', '6', '50', 'Rp500.000'],
  ['kreator.empat', 'Rp0', 'Rp0', 'Rp0', '2', '0', '6', '0', 'Rp0'],
  ['kreator.lima', 'Rp0', 'Rp0', 'Rp0', '0', '0', '5', '0', 'Rp0'],
]);

const ADS_HEADER = [
  'Nama kampanye', 'Jenis materi iklan', 'Biaya', 'Pendapatan kotor', 'Pesanan SKU', 'Nama akun',
  'Informasi Video', 'Rasio konversi', 'Tingkat penyelesaian 2 detik', 'Tingkat penyelesaian 100%',
];
const adsAoa = (): unknown[][] => sheet('Ads 2026-08-01 ~ 2026-08-31', ADS_HEADER, [
  ['Kampanye Produk A', 'Video', 'Rp20.000.000', 'Rp80.000.000', '800', AKUN_TOKO, 'Racun skincare', '2,00%', '30,00%', '10,00%'],
  ['Kampanye Produk B', 'Gambar', 'Rp10.000.000', 'Rp30.000.000', '300', AKUN_TOKO, 'Before after', '1,50%', '25,00%', '8,00%'],
  ['Kampanye GMV Max', 'Video', 'Rp5.000.000', 'Rp20.000.000', '200', AKUN_TOKO, 'Tutorial layering', '1,80%', '28,00%', '9,00%'],
]);

interface FileWire {
  filename: string; aoa: unknown[][]; sha256: string; ukuran_bytes: number;
  tipe_override?: string | null; tanggal_ambil?: string | null;
}
const f = (filename: string, aoa: unknown[][], seed: string): FileWire => ({
  filename, aoa, sha256: seed.repeat(64).slice(0, 64), ukuran_bytes: 4096, tanggal_ambil: '2026-09-01',
});

const HIST_TT = [
  { key: '2026-06', label: 'Jun 2026', gmv: '420.000.000', order: '4.200', flag: 'normal' },
  { key: '2026-07', label: 'Jul 2026', gmv: '460.000.000', order: '4.600', flag: 'normal' },
  { key: '2026-08', label: 'Agu 2026', gmv: '500.000.000', order: '5.000', flag: 'normal' },
];

// ---------------------------------------------------------------------------
// Export Shopee — satu berkas "Bisnis — Home" (gerbang mesin Shopee, B2).
// ---------------------------------------------------------------------------
const SHOPEE_HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const shopeeHomeAoa = (): unknown[][] => [
  ['Pesanan Dibuat'],
  SHOPEE_HOME_HEADER,
  ['Total', 'Rp300.000.000', '3.000', 'Rp100.000', '20.000', '150.000', '2,00%', '150', 'Rp15.000.000', '30', 'Rp3.000.000', '2.700', '900', '1.800', '150', '20,00%'],
  ['01/08/2026', 'Rp10.000.000', '100', 'Rp100.000', '700', '5.000', '2,00%', '5', 'Rp500.000', '1', 'Rp100.000', '90', '30', '60', '5', '20,00%'],
];
// Layanan/Chat + Kesehatan Toko — DUA berkas yang membuat B-4 Shopee terisi
// otomatis (keputusan pemilik 2026-09-06). Tanpa keduanya B-4 Shopee `null`,
// dan itu benar: berkas "Bisnis — Home" memang tidak membawa Layanan.
const shopeeChatAoa = (): unknown[][] => [
  ['Ringkasan'],
  ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Chat Dibalas',
   'Waktu Respon Rata-rata', 'CSAT %', 'Persentase Chat Dibalas', 'Total Pembeli', 'Total Pesanan', 'Penjualan (IDR)'],
  ['01/08/2026 - 31/08/2026', '150.000', '2.000', '1.500', '1.900', '180', '92,00%', '95,00%', '300', '320', 'Rp30.000.000'],
];
const shopeeKesehatanAoa = (): unknown[][] => [
  ['Kesehatan Toko'],
  ['Poin Pinalti', 'Deskripsi', 'Durasi'],
  ['2', 'Pesanan tidak terkirim', '01/08/2026 - 31/08/2026'],
  ['1', 'Keterlambatan pengiriman', '10/08/2026 - 31/08/2026'],
];

// Tiga berkas Shopee lain yang mengisi B-3 (produk), B-5 (iklan) dan B-6
// (afiliasi). Namanya memakai konvensi rename tim — lapis deteksi paling
// eksplisit, jadi yang diuji di sini baseline-nya, bukan tebakan nama.
const shopeeProdukAoa = (): unknown[][] => [
  ['Kode Produk', 'Produk', 'Nama Variasi', 'Status Produk Saat Ini', 'Jumlah Produk Dilihat', 'Produk Diklik',
   'Pengunjung Produk (Kunjungan)', 'Pesanan Dibuat', 'Total Penjualan (Pesanan Dibuat) (IDR)',
   'Total Pembeli (Pesanan Dibuat)', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Pesanan Siap Dikirim',
   'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Tingkat Konversi (Pesanan Siap Dikirim)'],
  ['SKU-A', 'Serum Zeta 30ml', '-', 'Aktif', '50000', '9000', '10000', '3000', 'Rp180.000.000', '2900', '30,00%', '2800', 'Rp175.000.000', '28,00%'],
  ['SKU-B', 'Toner Zeta 100ml', '-', 'Aktif', '30000', '5000', '6000', '900', 'Rp90.000.000', '880', '15,00%', '870', 'Rp88.000.000', '14,50%'],
  ['SKU-C', 'Sabun Zeta', '-', 'Aktif', '8000', '1200', '1500', '300', 'Rp30.000.000', '290', '20,00%', '285', 'Rp29.000.000', '19,00%'],
  ['SKU-D', 'Masker Zeta', '-', 'Aktif', '100', '20', '40', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
];
const shopeeAdsAoa = (): unknown[][] => [
  ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Omzet Penjualan', 'Biaya', 'Pesanan',
   'Produk Terjual', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
  ['Kampanye Serum', 'Berjalan', '200000', '8000', '4.00%', '60000000', '12000000', '600', '620', '5.00', '20.00%'],
  ['Kampanye Toner', 'Berjalan', '80000', '2400', '3.00%', '20000000', '5000000', '200', '210', '4.00', '25.00%'],
];
const shopeeAffAoa = (): unknown[][] => [
  ['Username', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Clicks', 'Estimasi Komisi(Rp)', 'ROI'],
  ['kreator.satu', '30000000', '300', '250', '1500', '900000', '33.3'],
  ['kreator.dua', '10000000', '100', '80', '600', '300000', '33.3'],
];
/** Nama berkas konvensi tim: `[modul]-Sub && periode && toko && tanggal.xlsx`. */
const fShopee = (modul: string, sub: string, aoa: unknown[][], seed: string): FileWire =>
  f(`[${modul}]-${sub} && Agu 2026 && Zeta Beauty && 2026-09-01.xlsx`, aoa, seed);

const HIST_SHOPEE = [
  { key: '2026-06', label: 'Jun 2026', gmv: '260.000.000', order: '2.600', flag: 'normal' },
  { key: '2026-07', label: 'Jul 2026', gmv: '280.000.000', order: '2.800', flag: 'normal' },
  { key: '2026-08', label: 'Agu 2026', gmv: '300.000.000', order: '3.000', flag: 'normal' },
];

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const CLI = 'ZZ-UATB-CLI-0001';
const ITV = 'ZZ-UATB-ITV-0001';
let ttPlatformId = 0;
let shPlatformId = 0;

/** Hapus semua jejak UAT ini. Dipanggil DUA kali: sebelum (sisa run yang gagal
 *  di tengah tak boleh menabrak) dan sesudah. */
async function bersihkan(): Promise<void> {
  await sql`delete from briefs where service_id like 'ZZ-UATB%' or created_by like 'ZZ-UATB%'`;
  await sql`delete from plan where client_id like 'ZZ-UATB%'`;
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-UATB%'`;
  await sql`delete from service_plan_gate where created_by like 'ZZ-UATB%'`;
  await sql`delete from services where client_id like 'ZZ-UATB%'`;
  await sql`delete from contracts where client_id like 'ZZ-UATB%'`;
  await sql`delete from riset_awal_analisa where interview_id like 'ZZ-UATB%'`;
  await sql`delete from interview where client_id like 'ZZ-UATB%'`;
  await sql`delete from client_platforms where client_id like 'ZZ-UATB%'`;
  await sql`delete from clients where id like 'ZZ-UATB%'`;
  await sql`delete from employees where employee_id like 'ZZ-UATB%'`;
}

beforeAll(async () => {
  if (!sql) return;
  process.env.SUPABASE_JWT_SECRET = SECRET;
  await bersihkan();
  // Employees: FK-nya nyata (`fk_interview_am`), jadi aktor UAT ini pegawai nyata.
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, created_by)
    values (${AM}, 'UAT AM', 'uatb.am@zz.example', 'Account', 'Account Manager', 'SYSTEM'),
           (${LEAD}, 'UAT Lead', 'uatb.lead@zz.example', 'Account', 'Head of Account', 'SYSTEM'),
           (${SALES}, 'UAT Sales', 'uatb.sales@zz.example', 'Sales', 'Sales Executive', 'SYSTEM')`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${CLI}, 'Rani', 'Zeta Beauty', 'Bandung', 'https://tiktok.com/@zztoko', 'Beauty', 0, 0, 0,
            ${SALES}, ${SALES}, ${AM}, now(), ${AM})`;
  await sql`
    insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
    values (${ITV}, ${CLI}, ${AM}, ${SALES}, 'Selesai', ${AM})`;
  await sql`
    insert into interview_kualifikasi
      (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, margin_bersih_basis,
       kualitas_data, config_snapshot, dihitung_oleh)
    values (${ITV}, 80, '{}'::jsonb, 'growth_ready', 'bersih_klien', 'terverifikasi', '{}'::jsonb, ${AM})`;
  await sql`
    insert into interview_riset_awal (interview_id, dimulai_oleh) values (${ITV}, ${AM})`;
  const tt = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'TikTok Shop', 'https://tt.example', true, ${AM}) returning id`;
  ttPlatformId = Number(tt[0].id);
  const sh = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'Shopee', 'https://sh.example', true, ${AM}) returning id`;
  shPlatformId = Number(sh[0].id);
});

afterAll(async () => {
  if (!sql) return;
  await bersihkan();
  await sql.end();
});

// ---------------------------------------------------------------------------
// §10 butir 1 — satu upload TikTok
// ---------------------------------------------------------------------------
interface BaselineWire {
  analisa: {
    client_platform_id: number; platform: string; metode_baseline: string; kondisi_toko: string;
    skor: number | null; benchmark_versi: number | null; benchmark_versi_shopee: number | null;
    parser_versi: string | null;
  }[];
  isian: { section: string; field_key: string; sumber: string; dikonfirmasi: boolean; nilai_angka: number | null; nilai_uang: string | null }[];
  semua_terkonfirmasi: boolean;
}

dDb('UAT §10 butir 1 — satu upload TikTok lewat POST /interview/{id}/baseline', () => {
  it('delapan berkas sekali unggah ⇒ analisa_penuh ber-skor, tanpa Video Factory', async () => {
    const res = await baselineSubmit(post(`/interview/${ITV}/baseline`, amToken, {
      client_platform_id: ttPlatformId,
      analisa: {
        files: [
          f('Shop Analytics_Key metrics.xlsx', shopTtAoa(), 'a'),
          f('product_list.xlsx', prodAoa(), 'b'),
          f('Video Performance List_toko.xlsx', vidTokoAoa(), 'c'),
          f('Video Performance List_afiliasi.xlsx', vidAffAoa(), 'd'),
          f('Live Analysis_toko.xlsx', liveTokoAoa(), 'e'),
          f('Live Analysis_afiliasi.xlsx', liveAffAoa(), '1'),
          f('Transaction_Analysis_Creator_List.xlsx', affAoa(), '2'),
          f('creative data for product campaigns.xlsx', adsAoa(), '3'),
        ],
        hist: HIST_TT,
        net: true,
        linked_accounts: [AKUN_TOKO],
      },
    }), ctx(ITV));
    expect(res.status).toBe(200);
    const v = await body<BaselineWire>(res);
    const tt = v.analisa.find((a) => a.client_platform_id === ttPlatformId)!;
    expect(tt.metode_baseline).toBe('analisa_penuh');
    expect(typeof tt.skor).toBe('number');
    expect(tt.kondisi_toko).not.toBe('belum_dapat_diukur');
    expect(tt.parser_versi).toBe('cdps-baseline-v1');
  });
});

dDb('UAT §10 butir 1 (lanjutan) — provenance unggahan', () => {
  it('kedelapan berkas dikenali tipenya, pemisahan toko-vs-afiliasi benar', async () => {
    const rows = await sql<{ tipe_terdeteksi: string | null; jumlah_baris: number | null }[]>`
      select tipe_terdeteksi, jumlah_baris from riset_awal_sumber_berkas
       where interview_id = ${ITV} order by tipe_terdeteksi`;
    const tipe = rows.map((r) => r.tipe_terdeteksi).sort();
    expect(tipe).toEqual(
      ['ads_prod', 'aff_kr', 'live_aff', 'live_toko', 'prod_tt', 'shop_tt', 'vid_aff', 'vid_toko'],
    );
  });

  it('payload membawa blok toko/produk/iklan/afiliasi/video/live — bukan hanya toko', async () => {
    const [row] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from riset_awal_analisa where client_platform_id = ${ttPlatformId}`;
    const p = row.payload;
    expect(p.schema).toBe('cdps.baseline.tiktok.v1');
    for (const k of ['toko', 'produk', 'iklan', 'afiliasi', 'video', 'live', 'gmv_mix']) {
      expect(p[k], `blok ${k} hilang dari payload`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// §10 butir 2 — satu upload Shopee
// ---------------------------------------------------------------------------
dDb('UAT §10 butir 2 — satu upload Shopee', () => {
  it('unggahan Shopee ⇒ analisa_penuh ber-skor + kondisi_toko terhitung', async () => {
    const res = await baselineSubmit(post(`/interview/${ITV}/baseline`, amToken, {
      client_platform_id: shPlatformId,
      analisa: {
        files: [
          f('zeta.shopee-shop-stats.20260801-20260831.xlsx', shopeeHomeAoa(), '4'),
          f('zeta.chat-performance.20260801-20260831.xlsx', shopeeChatAoa(), '5'),
          f('Kesehatan_Toko_20260831.xlsx', shopeeKesehatanAoa(), '6'),
          fShopee('bisnis', 'Produk', shopeeProdukAoa(), '7'),
          fShopee('ads', 'Toko', shopeeAdsAoa(), '8'),
          fShopee('aff', 'Creator', shopeeAffAoa(), '9'),
        ],
        hist: HIST_SHOPEE,
        periode: 'Agustus 2026',
      },
    }), ctx(ITV));
    expect(res.status).toBe(200);
    const v = await body<BaselineWire>(res);
    const sh = v.analisa.find((a) => a.client_platform_id === shPlatformId)!;
    expect(sh.metode_baseline).toBe('analisa_penuh');
    expect(typeof sh.skor).toBe('number');
    expect(sh.kondisi_toko).not.toBe('belum_dapat_diukur');
    expect(sh.parser_versi).toBe('cdps-baseline-shopee-v1');
    expect(sh.benchmark_versi_shopee).toBe(1);
    expect(sh.benchmark_versi).toBeNull();
  });

  it('GET baseline mengembalikan dua baris analisa (satu per platform aktif)', async () => {
    const res = await baselineGet(get(`/interview/${ITV}/baseline`, amToken), ctx(ITV));
    expect(res.status).toBe(200);
    const v = await body<BaselineWire>(res);
    expect(v.analisa).toHaveLength(2);
  });

  it('isian usulan RAB-05 bisa dikonfirmasi lewat rute confirm', async () => {
    const before = await body<BaselineWire>(await baselineGet(get(`/interview/${ITV}/baseline`, amToken), ctx(ITV)));
    const items = before.isian.map((i) => ({
      section: i.section, field_key: i.field_key,
      nilai_angka: i.nilai_angka, nilai_uang: i.nilai_uang, dikonfirmasi: true,
    }));
    const res = await baselineConfirm(post(`/interview/${ITV}/baseline/confirm`, amToken, { items }), ctx(ITV));
    expect(res.status).toBe(200);
    expect((await body<BaselineWire>(res)).semua_terkonfirmasi).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Strategi — layanan full-management ini yang halamannya diuji butir 1–7.
// ---------------------------------------------------------------------------
const SVC = 'ZZ-UATB-SVC-0001';
let strategiId = '';

interface PrefillChannelWire {
  client_platform_id: number; platform: string; channel: string;
  metode_baseline: string; kondisi_toko: string; skor: number | null;
  periode_baseline_bulan: number | null; cakupan_riwayat: string | null;
  alasan_periode_pendek_wajib: boolean;
  sumber_data: string | null; tanggal_ambil_data: string | null; lampiran: string | null;
  payload_schema: string | null; payload_terbaca: boolean; periode_referensi: string | null;
  baseline_bulan: { month_index: number; label: string | null; gmv: string | null; jumlah_pesanan: number | null }[];
  roas: number | null; ad_spend: string | null; aov: string | null;
  refund_rate_persen: number | null;
  chat_response_rate_persen: number | null; chat_response_menit: number | null; poin_penalti: number | null;
  pengunjung_per_bulan: number | null; conversion_rate_persen: number | null;
  trafik_organik_persen: number | null; trafik_iklan_persen: number | null; trafik_affiliate_persen: number | null;
  trafik_live_persen: number | null; trafik_video_persen: number | null; trafik_luar_persen: number | null;
  sku_listed: number | null; sku_aktif: number | null; sku_pareto_80: number | null; sku_slow_moving: number | null;
  top_sku: { nama: string; gmv: string | null; klik: number | null; ctor_persen: number | null }[];
  jumlah_kampanye_aktif: number | null; tipe_kampanye: string[];
  affiliate_aktif_30hari: number | null; gmv_affiliate: string | null; gmv_affiliate_persen: number | null;
  top_kreator: { nama: string; gmv: string | null }[]; sampel_terkirim: number | null;
  jumlah_video_per_bulan: number | null; total_views: number | null; gmv_video: string | null;
  jam_live_per_bulan: number | null; gmv_live: string | null;
}
interface PrefillWire { interview_id: string; channels: PrefillChannelWire[] }

dDb('UAT §10 butir 1+2 — Section B terisi dari SATU Riset Awal (GET /strategi/{id}/baseline-prefill)', () => {
  it('Strategi dibuat lewat rute POST /services/{id}/strategi', async () => {
    const msv = await sql<{ service_id: string; version_no: number }[]>`
      select service_id, version_no from master_service_versions
       where name = 'Ads Management' order by version_no desc limit 1`;
    await sql`
      insert into services
        (id, client_id, master_service_id, master_version_no, name, standard_price,
         commission_rule, status, requires_strategy_plan, plan_tier, created_by)
      values (${SVC}, ${CLI}, ${msv[0].service_id}, ${msv[0].version_no},
              'Full Store Management', '40000000.00', '10%', '[Awaiting Onboarding]',
              true, 'plan_wajib', ${AM})`;
    const res = await strategiCreate(post(`/services/${SVC}/strategi`, amToken, {
      durasi_kontrak_bulan: 6,
      tanggal_mulai_kontrak: '2026-09-01',
      tanggal_akhir_kontrak: '2027-02-28',
      tanggal_mulai_siklus: '2026-09-01',
    }), ctx(SVC));
    expect(res.status).toBe(201);
    strategiId = (await body<{ id: string }>(res)).id;
    expect(strategiId).toMatch(/^STRG-/);
  });

  it('dua channel usulan: TikTok Shop + Shopee, keduanya ber-skor', async () => {
    const res = await prefillGet(get(`/strategi/${strategiId}/baseline-prefill`, amToken), ctx(strategiId));
    expect(res.status).toBe(200);
    const p = await body<PrefillWire>(res);
    expect(p).not.toBeNull();
    expect(p.channels.map((c) => c.channel).sort()).toEqual(['Shopee', 'TikTok Shop']);
    for (const c of p.channels) {
      expect(c.metode_baseline).toBe('analisa_penuh');
      expect(c.payload_terbaca).toBe(true);
      expect(typeof c.skor).toBe('number');
    }
  });

  it('TikTok: B-1, B-2.1/2.2, B-3.1..3.4, B-5.3, B-6.1/6.2/6.4/6.5, B-7.1/7.2 terisi', async () => {
    const p = await body<PrefillWire>(await prefillGet(get(`/strategi/${strategiId}/baseline-prefill`, amToken), ctx(strategiId)));
    const c = p.channels.find((x) => x.channel === 'TikTok Shop')!;
    // B-1 — riwayat bulanan + ROAS/ad spend/AOV
    expect(c.baseline_bulan.length).toBeGreaterThanOrEqual(3);
    expect(c.baseline_bulan.every((m) => m.gmv !== null)).toBe(true);
    expect(c.roas).not.toBeNull();
    expect(c.ad_spend).not.toBeNull();
    expect(c.aov).not.toBeNull();
    expect(c.refund_rate_persen).not.toBeNull();
    // B-2.1 / B-2.2
    expect(c.pengunjung_per_bulan).toBe(250_000);
    expect(c.conversion_rate_persen).toBe(2);
    // B-2.3 — organik & affiliate TIDAK pernah residu
    expect(c.trafik_organik_persen).toBeNull();
    expect(c.trafik_affiliate_persen).toBeNull();
    expect(c.trafik_video_persen).not.toBeNull();
    expect(c.trafik_live_persen).not.toBeNull();
    // B-3.1..3.4 (3.3 = top SKU, 3.4 = slow moving) — B1 mengisi pareto & slow
    expect(c.sku_listed).toBe(5);
    expect(c.sku_aktif).toBe(3);
    expect(c.sku_pareto_80).not.toBeNull();
    expect(c.sku_slow_moving).not.toBeNull();
    expect(c.top_sku.length).toBeGreaterThan(0);
    expect(c.top_sku[0].nama).toBe('Serum Zeta 30ml');
    // B-5.3 — jumlah kampanye + tipe materi (B1)
    expect(c.jumlah_kampanye_aktif).toBe(3);
    expect(c.tipe_kampanye.length).toBeGreaterThan(0);
    // B-6.1/6.2/6.4/6.5
    expect(c.affiliate_aktif_30hari).not.toBeNull();
    expect(c.gmv_affiliate).not.toBeNull();
    expect(c.gmv_affiliate_persen).not.toBeNull();
    expect(c.top_kreator.length).toBeGreaterThan(0);
    expect(c.sampel_terkirim).toBe(35);
    // B-7.1 / B-7.2
    expect(c.jumlah_video_per_bulan).toBe(7);
    expect(c.total_views).toBe(665_000);
    expect(c.gmv_video).not.toBeNull();
    expect(c.jam_live_per_bulan).toBeCloseTo(11.5, 5);
    expect(c.gmv_live).not.toBeNull();
  });

  it('B-4: TikTok tetap manual (null), Shopee terisi otomatis — keputusan pemilik 2026-09-06', async () => {
    const p = await body<PrefillWire>(await prefillGet(get(`/strategi/${strategiId}/baseline-prefill`, amToken), ctx(strategiId)));
    const tt = p.channels.find((x) => x.channel === 'TikTok Shop')!;
    expect(tt.chat_response_rate_persen).toBeNull();
    expect(tt.chat_response_menit).toBeNull();
    expect(tt.poin_penalti).toBeNull();
    const sh = p.channels.find((x) => x.channel === 'Shopee')!;
    expect(sh.pengunjung_per_bulan).toBe(150_000);
    expect(sh.conversion_rate_persen).toBe(2);
    expect(sh.refund_rate_persen).not.toBeNull();
    // B-4 Shopee: chat response rate + waktu respon + poin penalti dari export
    // Layanan/Chat + Kesehatan Toko yang ikut diunggah.
    expect(sh.chat_response_rate_persen).not.toBeNull();
    expect(sh.chat_response_menit).not.toBeNull();
    expect(sh.poin_penalti).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §10 butir 3 — yang manual TETAP terlihat manual (dan tetap menggerbang submit)
//
// Yang disimpan di bawah adalah persis apa yang browser kirim setelah
// `mergeBaselinePrefill` (web-internal/src/lib/strategi-baseline-inherit.ts)
// mengisi draft Section B dari prefill: hanya field yang payload-nya bersumber,
// tak satu pun yang tidak. Field tanpa sumber dibiarkan kosong — itulah yang
// diuji butir 3.
// ---------------------------------------------------------------------------
interface DetailWire {
  channels: { id: number; channel: string }[];
}
interface KekuranganWire { kode: string; pesan: string }

/** Bulan yang `% batal` (B-1.4, agregat periode) boleh disemai ke sana. */
function bulanPeriode(c: PrefillChannelWire): number | null {
  return c.periode_referensi
    ? (c.baseline_bulan.find((m) => m.label === c.periode_referensi)?.month_index ?? null)
    : null;
}

/** Bentuk body PUT /channels untuk satu kanal, warisan-dari-prefill saja. */
function channelDariPrefill(c: PrefillChannelWire): Record<string, unknown> {
  return {
    channel: c.channel,
    channel_lain: null,
    status_channel: 'Eksisting',
    nama_toko: 'Zeta Beauty',
    url_toko: 'https://toko.example/zeta',
    // B-0.6 provenance + B-0.7 window — diwarisi dari Riset Awal.
    sumber_data: c.sumber_data ?? 'Export Riset Awal',
    tanggal_ambil_data: c.tanggal_ambil_data ?? '2026-09-01',
    lampiran: 'https://toko.example/zeta',
    periode_baseline_bulan: c.periode_baseline_bulan ?? 3,
    periode_mulai: '2026-06-01',
    periode_akhir: '2026-08-31',
    // B-2 / B-3 / B-5 / B-6 / B-7 — semuanya dari payload, tak satu pun diketik.
    pengunjung_per_bulan: c.pengunjung_per_bulan,
    conversion_rate_persen: c.conversion_rate_persen,
    trafik_organik_persen: c.trafik_organik_persen,
    trafik_iklan_persen: c.trafik_iklan_persen,
    trafik_affiliate_persen: c.trafik_affiliate_persen,
    trafik_live_persen: c.trafik_live_persen,
    trafik_video_persen: c.trafik_video_persen,
    trafik_luar_persen: c.trafik_luar_persen,
    sku_listed: c.sku_listed,
    sku_aktif: c.sku_aktif,
    sku_pareto_80: c.sku_pareto_80,
    sku_slow_moving: c.sku_slow_moving,
    top_sku: c.top_sku.map((t) => ({
      nama: t.nama, gmv: t.gmv ?? '0', unit_terjual: 0, harga_jual: '0', margin_persen: 0,
    })),
    jumlah_kampanye_aktif: c.jumlah_kampanye_aktif,
    tipe_kampanye: c.tipe_kampanye,
    affiliate_aktif_30hari: c.affiliate_aktif_30hari,
    gmv_affiliate: c.gmv_affiliate,
    gmv_affiliate_persen: c.gmv_affiliate_persen,
    top_kreator: c.top_kreator.map((k) => ({ nama: k.nama, gmv: k.gmv ?? '0' })),
    jumlah_video_per_bulan: c.jumlah_video_per_bulan,
    total_views: c.total_views,
    gmv_video: c.gmv_video,
    jam_live_per_bulan: c.jam_live_per_bulan,
    gmv_live: c.gmv_live,
    // B-4: hanya Shopee yang punya sumber (keputusan pemilik 2026-09-06).
    chat_response_rate_persen: c.chat_response_rate_persen,
    chat_response_menit: c.chat_response_menit,
    poin_penalti: c.poin_penalti,
  };
}

dDb('UAT §10 butir 3 — yang manual tetap terlihat manual', () => {
  it('Section B disimpan dari warisan Riset Awal saja (PUT /strategi/{id}/channels)', async () => {
    const p = await body<PrefillWire>(await prefillGet(get(`/strategi/${strategiId}/baseline-prefill`, amToken), ctx(strategiId)));
    const res = await channelsPut(put(`/strategi/${strategiId}/channels`, amToken, {
      channels: p.channels.map(channelDariPrefill),
    }), ctx(strategiId));
    expect(res.status).toBe(200);
    const d = await body<DetailWire>(res);
    expect(d.channels).toHaveLength(2);

    // B-1: baris bulanan ikut disimpan per kanal, dari prefill.
    for (const ch of d.channels) {
      const sug = p.channels.find((x) => x.channel === ch.channel)!;
      const bres = await baselinePut(put(`/strategi/${strategiId}/channels/${ch.id}/baseline`, amToken, {
        // GMV + jumlah pesanan diwarisi dari Riset Awal; `% batal` hanya untuk
        // bulan periode referensi. `ad_spend`/`roas`/`acos` per bulan SENGAJA
        // tidak diwarisi (angka payload adalah agregat periode — menyebarnya ke
        // enam bulan mengarang angka), jadi di sini ketiganya adalah yang AM
        // ketik sendiri. Itu bukan celah: `saveBaseline` mewajibkannya, dan
        // butir 3 justru menuntut yang manual tetap manual.
        months: sug.baseline_bulan.map((m) => ({
          month_index: m.month_index,
          gmv: m.gmv,
          jumlah_pesanan: m.jumlah_pesanan,
          persen_batal: m.month_index === bulanPeriode(sug) ? sug.refund_rate_persen : 5,
          ad_spend: '10000000',
          roas: 4,
          acos: 25,
        })),
      }), ctx2(strategiId, String(ch.id)));
      expect(bres.status, JSON.stringify(await bres.clone().json())).toBe(200);
    }
  });

  it('panel Kekurangan menyebut B-4 TikTok, B-8, B-9, host/studio — per kanal', async () => {
    const res = await kekuranganGet(get(`/strategi/${strategiId}/kekurangan`, amToken), ctx(strategiId));
    expect(res.status).toBe(200);
    const k = await body<KekuranganWire[]>(res);
    const kode = k.map((x) => x.kode);

    // B-4 TikTok masih menggerbang, dan pesannya menyebut keenam kolomnya.
    const b4tt = k.find((x) => x.kode === 'B-4/TikTok Shop')!;
    expect(b4tt).toBeDefined();
    for (const kol of ['Rating toko', 'Jumlah ulasan', 'Chat response rate', 'Response time', 'Pesanan terlambat', 'Poin penalti']) {
      expect(b4tt.pesan, `kolom "${kol}" tak disebut panel Kekurangan`).toContain(kol);
    }
    // B-4 Shopee: chat + poin sudah terisi ⇒ tinggal 3 kolom tanpa sumber.
    const b4sh = k.find((x) => x.kode === 'B-4/Shopee')!;
    expect(b4sh).toBeDefined();
    expect(b4sh.pesan).not.toContain('Chat response rate');
    expect(b4sh.pesan).not.toContain('Poin penalti');
    expect(b4sh.pesan).toContain('Rating toko');

    // B-8 dan B-9 tanpa sumber di kedua kanal.
    for (const ch of ['TikTok Shop', 'Shopee']) {
      expect(kode).toContain(`B-8/${ch}`);
      expect(kode).toContain(`B-9/${ch}`);
      expect(kode).toContain(`B-9.1/${ch}`);
      // host & studio hidup di grup B-7 — sisanya sudah terisi dari payload.
      const b7 = k.find((x) => x.kode === `B-7/${ch}`);
      expect(b7, `B-7/${ch} harus tersisa (host/studio tanpa sumber)`).toBeDefined();
      expect(b7!.pesan).toContain('Host live');
      expect(b7!.pesan).toContain('Studio');
    }

    // Yang SUDAH bersumber tak boleh muncul lagi untuk TikTok.
    expect(kode).not.toContain('B-2/TikTok Shop');
    expect(kode).not.toContain('B-5/TikTok Shop');
    expect(kode).not.toContain('B-3.3/TikTok Shop');
    // B-3 TikTok penuh (listed/aktif/pareto/slow semuanya dari payload B1).
    expect(kode).not.toContain('B-3/TikTok Shop');
  });

  it('submit ditolak selama kekurangan masih ada — gerbangnya sungguhan', async () => {
    const res = await strategiSubmit(post(`/strategi/${strategiId}/submit`, amToken, {}), ctx(strategiId));
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toMatch(/^\[/);
  });
});

// ---------------------------------------------------------------------------
// §10 butir 4 — klien lama tidak rusak
//
// Payload versi lama = hanya `gmv_baseline` (riwayat bulanan), tanpa satu pun
// blok yang pemeta B3 baca. Baris `riset_awal_analisa` immutable by trigger,
// jadi payload lamanya di-INSERT apa adanya — bukan hasil UPDATE.
// ---------------------------------------------------------------------------
const CLI_LAMA = 'ZZ-UATB-CLI-0002';
const ITV_LAMA = 'ZZ-UATB-ITV-0002';
const SVC_LAMA = 'ZZ-UATB-SVC-0002';

dDb('UAT §10 butir 4 — klien lama: 4 field lama saja, halaman MENGATAKAN payloadnya versi lama', () => {
  it('prefill klien lama: payload_terbaca=false, angka B-2..B-7 null (bukan 0)', async () => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
      values (${CLI_LAMA}, 'Budi', 'Toko Lama', 'Solo', 'https://shopee.co.id/lama', 'Home Living', 0, 0, 0,
              ${SALES}, ${SALES}, ${AM}, now(), ${AM})`;
    await sql`
      insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
      values (${ITV_LAMA}, ${CLI_LAMA}, ${AM}, ${SALES}, 'Selesai', ${AM})`;
    await sql`
      insert into interview_kualifikasi
        (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, margin_bersih_basis,
         kualitas_data, config_snapshot, dihitung_oleh)
      values (${ITV_LAMA}, 70, '{}'::jsonb, 'bersyarat', 'bersih_klien', 'terverifikasi', '{}'::jsonb, ${AM})`;
    await sql`insert into interview_riset_awal (interview_id, dimulai_oleh) values (${ITV_LAMA}, ${AM})`;
    const cp = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, store_link, active, created_by)
      values (${CLI_LAMA}, 'Shopee', 'https://sh.example/lama', true, ${AM}) returning id`;
    const lamaPlatformId = Number(cp[0].id);
    await sql`
      insert into riset_awal_analisa
        (interview_id, client_platform_id, platform, metode_baseline, kondisi_toko, skor,
         benchmark_versi, parser_versi, cakupan_riwayat, payload, created_by)
      values (${ITV_LAMA}, ${lamaPlatformId}, 'Shopee', 'analisa_penuh', 'mesin_sebagian', 60,
              1, 'cdps-baseline-v0', 'cukup',
              ${sql.json({
                gmv_baseline: {
                  bulan_terisi: 3,
                  cakupan_riwayat: 'cukup',
                  riwayat: [
                    { label: 'Jun 2026', gmv: 100000000, order: 1000 },
                    { label: 'Jul 2026', gmv: 110000000, order: 1100 },
                    { label: 'Agu 2026', gmv: 120000000, order: 1200 },
                  ],
                },
              })}, ${AM})`;

    const msv = await sql<{ service_id: string; version_no: number }[]>`
      select service_id, version_no from master_service_versions
       where name = 'Ads Management' order by version_no desc limit 1`;
    await sql`
      insert into services
        (id, client_id, master_service_id, master_version_no, name, standard_price,
         commission_rule, status, requires_strategy_plan, plan_tier, created_by)
      values (${SVC_LAMA}, ${CLI_LAMA}, ${msv[0].service_id}, ${msv[0].version_no},
              'Full Store Management', '40000000.00', '10%', '[Awaiting Onboarding]',
              true, 'plan_wajib', ${AM})`;
    const created = await strategiCreate(post(`/services/${SVC_LAMA}/strategi`, amToken, {
      durasi_kontrak_bulan: 3,
      tanggal_mulai_kontrak: '2026-09-01',
      tanggal_akhir_kontrak: '2026-11-30',
      tanggal_mulai_siklus: '2026-09-01',
    }), ctx(SVC_LAMA));
    const lamaStrategiId = (await body<{ id: string }>(created)).id;

    const p = await body<PrefillWire>(
      await prefillGet(get(`/strategi/${lamaStrategiId}/baseline-prefill`, amToken), ctx(lamaStrategiId)),
    );
    const c = p.channels[0];
    // Yang MASIH terisi: window + riwayat bulanan (empat field lama).
    expect(c.periode_baseline_bulan).toBe(3);
    expect(c.baseline_bulan).toHaveLength(3);
    expect(c.baseline_bulan[0].gmv).toBe('100000000');
    // Halaman MENGATAKAN payloadnya versi lama.
    expect(c.payload_terbaca).toBe(false);
    expect(c.payload_schema).toBeNull();
    // Semua angka B3 `null` — bukan 0. Nol akan membuat AM mengajukan angka karangan.
    for (const [nama, v] of [
      ['pengunjung_per_bulan', c.pengunjung_per_bulan],
      ['conversion_rate_persen', c.conversion_rate_persen],
      ['sku_listed', c.sku_listed],
      ['sku_aktif', c.sku_aktif],
      ['jumlah_kampanye_aktif', c.jumlah_kampanye_aktif],
      ['affiliate_aktif_30hari', c.affiliate_aktif_30hari],
      ['gmv_affiliate', c.gmv_affiliate],
      ['jumlah_video_per_bulan', c.jumlah_video_per_bulan],
      ['jam_live_per_bulan', c.jam_live_per_bulan],
      ['chat_response_rate_persen', c.chat_response_rate_persen],
      ['poin_penalti', c.poin_penalti],
      ['refund_rate_persen', c.refund_rate_persen],
    ] as const) {
      expect(v, `${nama} harus null pada payload lama, bukan 0`).toBeNull();
    }
    expect(c.top_sku).toEqual([]);
    expect(c.top_kreator).toEqual([]);
    expect(c.tipe_kampanye).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 butir 5 — Section E otomatis + angle video, TANPA export/paste/file
// ---------------------------------------------------------------------------
interface CopilotAksiWire {
  kode: string; pilar: string; divisi: string; jenis: string; nama: string;
  target: string; jembatan: string; unit: string; arah: string; minggu_terlihat: number;
  field_id_bukti: string; quick_win: boolean; alasan: string;
  angle: { judul: string; akun: string | null; gmv: number | null; gpm: number | null; vv: number | null; ringkas: string }[];
}
interface CopilotChannelWire {
  client_platform_id: number; platform: string; channel: string; channel_lain: string | null;
  metode_baseline: string; payload_schema: string | null; payload_terbaca: boolean;
  periode_referensi: string | null; benchmark_versi: number | null; catatan: string[];
  pilar: { urutan: number; pilar: string; label: string; jenis: string; divisi: string; skor_baseline: number | null; aksi: CopilotAksiWire[] }[];
}
interface CopilotWire { interview_id: string; channels: CopilotChannelWire[] }

let usulan: CopilotWire;

dDb('UAT §10 butir 5 — AM Co-Pilot mengisi Section E dari server', () => {
  it('daftar pilar muncul tanpa export/tempel — GET /strategi/{id}/copilot', async () => {
    const res = await copilotGet(get(`/strategi/${strategiId}/copilot`, amToken), ctx(strategiId));
    expect(res.status).toBe(200);
    usulan = await body<CopilotWire>(res);
    expect(usulan).not.toBeNull();
    expect(usulan.channels.length).toBe(2);
    const semuaAksi = usulan.channels.flatMap((c) => c.pilar.flatMap((p) => p.aksi));
    expect(semuaAksi.length).toBeGreaterThan(0);
    // Setiap aksi menyebut jembatan + buktinya — bukan saran generik.
    for (const a of semuaAksi) {
      expect(a.kode).not.toBe('');
      expect(a.jenis).not.toBe('');
      expect(a.target).not.toBe('');
    }
  });

  it('pilar konten membawa angle video yang SUDAH perform, dengan angka aslinya', async () => {
    const tt = usulan.channels.find((c) => c.channel === 'TikTok Shop')!;
    const konten = tt.pilar.filter((p) => p.jenis === 'konten').flatMap((p) => p.aksi);
    expect(konten.length).toBeGreaterThan(0);
    const beranggle = konten.filter((a) => a.angle.length > 0);
    expect(beranggle.length, 'tak satu pun aksi konten membawa angle video').toBeGreaterThan(0);
    const angle = beranggle[0].angle[0];
    // Judulnya benar-benar dari export video toko yang diunggah di butir 1.
    expect(['Racun skincare #serum #glowing', 'Before after 14 hari #serum', 'Tutorial layering #skincare'])
      .toContain(angle.judul);
    expect(angle.gmv ?? 0).toBeGreaterThan(0);
    expect(angle.vv ?? 0).toBeGreaterThan(0);
    expect(angle.ringkas).not.toBe('');
  });

  it('centang → simpan: E-3…E-10 terisi (PUT /strategi/{id}/pillars)', async () => {
    const res = await pillarsPut(put(`/strategi/${strategiId}/pillars`, amToken, {
      pillars: pilarDariCopilot(usulan),
    }), ctx(strategiId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const d = await body<{ pillars: { jenis: string; aksi: string; target: string; detail: Record<string, unknown> }[] }>(res);
    expect(d.pillars.length, JSON.stringify(d.pillars.map((x) => x.jenis))).toBeGreaterThan(0);
    // Provenance: tiap baris menyebut asalnya. Angle video hanya melekat pada
    // aksi konten yang MEMANG punya video ber-penjualan (aksi konten lain, mis.
    // "naikkan jumlah posting", tak punya angle — dan itu benar).
    const konten = d.pillars.filter((p) => p.jenis === 'konten');
    expect(konten.length).toBeGreaterThan(0);
    for (const p of konten) expect(Array.isArray(p.detail.angle_video)).toBe(true);
    const berangle = konten.filter((p) => (p.detail.angle_video as string[]).length > 0);
    expect(berangle.length, 'tak satu pun pilar konten tersimpan membawa angle video').toBeGreaterThan(0);
    expect((berangle[0].detail.angle_video as string[])[0]).toMatch(/\S/);
  });
});

/**
 * Cermin `buildCopilotPillars` (web-internal/src/lib/strategi-copilot.ts) —
 * bentuk baris yang browser kirim setelah AM mencentang SEMUA aksi. `peran`
 * selalu null (enum peran SKU tertutup; label pilar masuk `detail.pilar`).
 *
 * DUA pilar tambahan diketik AM sendiri, sama seperti di layar: satu `harga`
 * dan satu `sku` (butir 6 menuntut keduanya muncul di panel "menunggu divisi"),
 * plus satu `tidak_dikerjakan` yang digerbangkan §Yang Tidak Dikerjakan.
 */
function pilarDariCopilot(u: CopilotWire): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let urutan = 1;
  for (const c of u.channels) {
    const label = c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel;
    for (const p of c.pilar) {
      for (const a of p.aksi) {
        out.push({
          jenis: a.jenis,
          channel: label.slice(0, 32),
          urutan: urutan++,
          sku: null,
          peran: null,
          aksi: `${a.kode} ${a.nama}`,
          target: a.target,
          detail: {
            sumber: 'cdps.cockpit.copilot.v1',
            kode_aksi: a.kode,
            field_id_bukti: a.field_id_bukti,
            pilar: p.label,
            jembatan: a.jembatan,
            unit: a.unit,
            arah: a.arah,
            minggu_terlihat: a.minggu_terlihat,
            alasan: a.alasan,
            angle_video: a.angle.map((g) => g.ringkas),
            periode_referensi: c.periode_referensi,
            benchmark_versi: c.benchmark_versi,
          },
        });
      }
    }
  }
  out.push({
    jenis: 'harga', channel: 'TikTok Shop', urutan: urutan++, sku: 'SERUM-30',
    aksi: 'Kunci floor price hero SKU', target: 'floor price dijaga sepanjang periode',
    floor_price: '79000.00', harga_promo: '85000.00', detail: {},
  });
  out.push({
    jenis: 'sku', channel: 'TikTok Shop', urutan: urutan++, sku: 'SERUM-30',
    aksi: 'Rombak listing hero SKU', target: 'listing hero SKU ditulis ulang', detail: {},
  });
  out.push({
    jenis: 'tidak_dikerjakan', channel: 'TikTok Shop', urutan: urutan++,
    aksi: 'Tanpa reshoot foto produk di periode 1', target: '', detail: {},
  });
  return out;
}

// ---------------------------------------------------------------------------
// §10 butir 6 — baris Plan tersemai dari Section E
//
// Sisa Section A/C/D/F/G/H/I diisi di sini lewat rutenya masing-masing: tanpa
// itu Strategi tak pernah sampai `Diajukan`, dan tanpa `Aktif` tidak ada Plan.
// Yang diuji butir 6 adalah apa yang terjadi SETELAH approve.
// ---------------------------------------------------------------------------
/** Kolom Section B yang TIDAK punya sumber export — diketik AM, seperti di layar. */
function channelLengkap(c: PrefillChannelWire): Record<string, unknown> {
  return {
    ...channelDariPrefill(c),
    // B-4 (TikTok seluruhnya, Shopee sisanya)
    rating_toko: 4.8,
    jumlah_ulasan: 1200,
    chat_response_rate_persen: c.chat_response_rate_persen ?? 90,
    chat_response_menit: c.chat_response_menit ?? 5,
    pesanan_terlambat_persen: 1.5,
    poin_penalti: c.poin_penalti ?? 0,
    // E-2 prioritas kanal + alasannya
    prioritas: c.channel === 'TikTok Shop' ? 'engine_utama' : 'pendukung',
    prioritas_alasan: c.channel === 'TikTok Shop'
      ? 'GMV terbesar dan mesin konten sudah jalan'
      : 'kontribusi lebih kecil, digarap setelah TikTok stabil',
    // Kolom yang platform ini tak punya sumber export-nya — diketik AM.
    sku_listed: c.sku_listed ?? 4,
    sku_aktif: c.sku_aktif ?? 3,
    sku_pareto_80: c.sku_pareto_80 ?? 1,
    sku_slow_moving: c.sku_slow_moving ?? 1,
    top_sku: c.top_sku.length > 0
      ? c.top_sku.map((t) => ({ nama: t.nama, gmv: t.gmv ?? '0', unit_terjual: 0, harga_jual: '0', margin_persen: 0 }))
      : [{ nama: 'Serum Zeta 30ml', gmv: '180000000', unit_terjual: 0, harga_jual: '0', margin_persen: 0 }],
    jumlah_kampanye_aktif: c.jumlah_kampanye_aktif ?? 2,
    tipe_kampanye: c.tipe_kampanye.length > 0 ? c.tipe_kampanye : ['manual_keyword'],
    affiliate_aktif_30hari: c.affiliate_aktif_30hari ?? 2,
    gmv_affiliate: c.gmv_affiliate ?? '40000000',
    gmv_affiliate_persen: c.gmv_affiliate_persen ?? 13.3,
    jumlah_video_per_bulan: c.jumlah_video_per_bulan ?? 0,
    total_views: c.total_views ?? 0,
    gmv_video: c.gmv_video ?? '0',
    jam_live_per_bulan: c.jam_live_per_bulan ?? 0,
    gmv_live: c.gmv_live ?? '0',
    // B-6 sisanya
    komisi_open_persen: 6,
    komisi_target_persen: 12,
    program_sampel: 'tidak_ada',
    // B-7 host & studio
    host_live: 'belum_ada',
    studio_live: 'tidak_ada',
    // B-8
    beban_promo_persen: 7,
    voucher_aktif: [{ tipe: 'diskon toko', nilai: '10%', syarat: 'min. Rp 100.000' }],
    program_platform: ['gratis_ongkir_xtra'],
    // B-9
    kompetitor: [{
      nama: 'Beta Beauty', url: 'https://toko.example/beta',
      harga_sebanding: '89000.00', estimasi_penjualan_bulan: '300000000.00',
    }],
    kompetitor_lebih_baik: ['harga', 'konten'],
    celah_kompetitor: 'belum ada yang menggarap bundling serum + toner',
  };
}

/** Pilar Section E + kuota yang AM ketik (satu angka per baris — handoff §2.3). */
function pilarDenganKuota(u: CopilotWire): Record<string, unknown>[] {
  const KUOTA: Record<string, string> = {
    konten: '40 video, ', iklan: '12 kampanye, ', affiliate: '30 kreator, ',
    live: '36 jam, ', operasional: '10 listing, ',
  };
  return pilarDariCopilot(u).map((p) => {
    const prefix = KUOTA[String(p.jenis)];
    if (!prefix) return p;
    return { ...p, target: `${prefix}${String(p.target)}` };
  });
}

let planIds: string[] = [];

dDb('UAT §10 butir 6 — Strategi lengkap → approve → baris Plan periode 1 tersemai', () => {
  it('sisa Section A/C/D/F/G/H/I diisi lewat rutenya, kekurangan habis', async () => {
    const p = await body<PrefillWire>(await prefillGet(get(`/strategi/${strategiId}/baseline-prefill`, amToken), ctx(strategiId)));
    const put1 = await channelsPut(put(`/strategi/${strategiId}/channels`, amToken, {
      channels: p.channels.map(channelLengkap),
    }), ctx(strategiId));
    expect(put1.status, JSON.stringify(await put1.clone().json())).toBe(200);

    // Baris B-1 harus ditulis ulang: `saveChannels` mengganti-set channel.
    const d = await body<DetailWire>(await channelsPut(put(`/strategi/${strategiId}/channels`, amToken, {
      channels: p.channels.map(channelLengkap),
    }), ctx(strategiId)));
    for (const ch of d.channels) {
      const sug = p.channels.find((x) => x.channel === ch.channel)!;
      await baselinePut(put(`/strategi/${strategiId}/channels/${ch.id}/baseline`, amToken, {
        months: sug.baseline_bulan.map((m) => ({
          month_index: m.month_index, gmv: m.gmv, jumlah_pesanan: m.jumlah_pesanan,
          persen_batal: m.month_index === bulanPeriode(sug) ? sug.refund_rate_persen : 5,
          ad_spend: '10000000', roas: 4, acos: 25,
        })),
      }), ctx2(strategiId, String(ch.id)));
    }

    await konteksPut(put(`/strategi/${strategiId}/konteks`, amToken, {
      nama_brand: 'Zeta Beauty', kategori_utama: 'Beauty', sub_kategori: ['serum', 'toner'],
      model_bisnis: 'brand_owner', margin_kotor_persen: 42, posisi_harga: 'mid',
      usp: ['formula lokal', 'BPOM', 'harga terjangkau'],
      kapasitas_stok: 'ready_stock', lead_time_restock_hari: 14, plafon_unit_per_bulan: 12000,
      titik_kirim_kota: 'Bandung',
      ekspektasi_klien: 'omzet naik 2x tanpa bakar iklan',
      riwayat_agensi: 'agensi sebelumnya hanya menjalankan iklan',
      pantangan_klien: ['harga hero SKU tidak boleh di bawah Rp 79.000'],
      decision_maker: [{ nama: 'Owner', jabatan: 'Pemilik', berhak_approve: true, jalur_eskalasi: 'langsung' }],
      sla_klien_jam: 36,
      aset_dari_klien: ['foto_produk', 'katalog', 'budget_iklan'],
    }), ctx(strategiId));

    await aksesPut(put(`/strategi/${strategiId}/akses`, amToken, {
      akses: [
        { channel: 'TikTok Shop', akses: 'seller_center', status: 'sudah' },
        { channel: 'TikTok Shop', akses: 'ads_manager', status: 'sudah' },
        { channel: 'Shopee', akses: 'seller_center', status: 'sudah' },
        { channel: 'Shopee', akses: 'ads_manager', status: 'sudah' },
        { channel: 'Umum', akses: 'gudang_stok', status: 'sudah' },
      ],
    }), ctx(strategiId));

    await diagnosaPut(put(`/strategi/${strategiId}/diagnosa`, amToken, {
      diagnosa: [
        { channel: 'TikTok Shop', bottleneck: 'konversi', alasan: 'CR 2,0% di bawah benchmark',
          akar_masalah: 'listing hero SKU belum dioptimasi', gap_kompetitor: 'kompetitor CR 2,8%' },
        { channel: 'Shopee', bottleneck: 'trafik', alasan: 'pengunjung stagnan tiga bulan',
          akar_masalah: 'iklan Shopee belum dijalankan', gap_kompetitor: 'kompetitor pasang search ads' },
      ],
      quick_wins: [
        { aksi: 'Tulis ulang listing hero SKU', channel: 'TikTok Shop', pic_divisi: 'Account', dampak_diharapkan: 'CR +0,3pp' },
        { aksi: 'Pasang voucher toko 10%', channel: 'Shopee', pic_divisi: 'Account', dampak_diharapkan: 'repeat +5%' },
        { aksi: 'Perbaiki thumbnail video hero', channel: 'TikTok Shop', pic_divisi: 'Creative', dampak_diharapkan: 'CTR +10%' },
      ],
      risiko_struktural: [{ risiko: 'Restock 14 hari — lonjakan demand tak bisa dipenuhi instan' }],
      prasyarat_klien: [{ item: 'Akses Ads Manager Shopee', pic_klien: 'Owner', deadline: '2026-09-10' }],
    }), ctx(strategiId));

    await targetsPut(put(`/strategi/${strategiId}/targets`, amToken, {
      targets: [
        { channel: 'TikTok Shop', month_index: 1, metric: 'gmv', nilai_floor: '550000000.00', nilai_stretch: '600000000.00' },
        { channel: 'TikTok Shop', month_index: 1, metric: 'cr', nilai_floor: null, nilai_stretch: '2.50' },
        { channel: 'Shopee', month_index: 1, metric: 'gmv', nilai_floor: '330000000.00', nilai_stretch: '360000000.00' },
        { channel: 'Shopee', month_index: 1, metric: 'cr', nilai_floor: null, nilai_stretch: '2.40' },
      ],
    }), ctx(strategiId));

    await assumptionsPut(put(`/strategi/${strategiId}/assumptions`, amToken, {
      assumptions: ['A1', 'A2', 'A3'].map((kode) => ({
        kode, asumsi: `budget cair tanggal 1 (${kode})`, pemilik: 'Klien',
        cara_verifikasi: 'mutasi rekening', target_terkait: [],
      })),
    }), ctx(strategiId));

    await kpiPut(put(`/strategi/${strategiId}/kpi`, amToken, {
      definisi_berhasil_30: 'listing hero SKU selesai ditulis ulang',
      definisi_berhasil_60: 'CR TikTok naik dari 2,0% ke 2,5%',
      definisi_berhasil_90: 'GMV gabungan menyentuh Rp 960jt',
      leading_indicator: ['cr', 'jumlah_video'],
    }), ctx(strategiId));

    await narasiPut(put(`/strategi/${strategiId}/narasi`, amToken, {
      growth_thesis: 'Toko ini tumbuh dengan mengonversi trafik yang sudah ada lebih dulu — ad spend sudah wajar, CR dan kualitas listing yang tertinggal.',
      urutan_eksekusi_alasan: 'Listing dibereskan sebelum budget dinaikkan.',
      skenario_mundur: 'Kalau CR tidak naik di fase 1, budget digeser ke Shopee.',
    }), ctx(strategiId));

    await risksPut(put(`/strategi/${strategiId}/risks`, amToken, {
      risks: ['restock 14 hari', 'approval klien 36 jam', 'kategori jenuh'].map((risiko) => ({
        risiko, dampak: 'sedang', kemungkinan: 'tinggi', mitigasi: 'buffer stok', pic: AM,
      })),
    }), ctx(strategiId));

    await ketergantunganPut(put(`/strategi/${strategiId}/ketergantungan`, amToken, {
      ketergantungan: [{ item: 'Budget iklan cair', kapan: 'tiap tanggal 1', konsekuensi: 'fase scale mundur satu minggu' }],
    }), ctx(strategiId));

    await kalenderPut(put(`/strategi/${strategiId}/kalender`, amToken, {
      fase: [
        { nama: 'Fase 1 — Perbaikan listing', tanggal_mulai: '2026-09-01', tanggal_akhir: '2026-09-30',
          tujuan: 'Menaikkan CR tanpa menambah budget', kriteria_lulus: 'CR >= 2,3%' },
        { nama: 'Fase 2 — Scale iklan', tanggal_mulai: '2026-10-01', tanggal_akhir: '2026-10-31',
          tujuan: 'Menambah volume di listing yang sudah mengonversi', kriteria_lulus: 'ROAS >= 4,0' },
      ],
      tanggal_besar: [{ tanggal: '2026-09-09', nama: '9.9', peran: 'Puncak penjualan — stok disiapkan H-14' }],
      review_klien_frekuensi: 'bulanan',
      review_klien_format: 'Deck performa + rekomendasi bulan berikutnya',
      review_klien_pic: AM,
      review_internal_frekuensi: 'mingguan',
    }), ctx(strategiId));

    await triggerRevisiPut(put(`/strategi/${strategiId}/trigger-revisi`, amToken, {
      trigger_revisi: [
        { kode: 'pencapaian_di_bawah_target', ambang: 80 },
        { kode: 'stok_kosong', ambang: 14 },
      ],
    }), ctx(strategiId));

    await handoffPut(put(`/strategi/${strategiId}/handoff`, amToken, {
      dispatch: [
        { divisi: 'Creative', urutan: 1, catatan: 'Foto lama saja di periode 1' },
        { divisi: 'Ads', urutan: 2 },
      ],
      metrik_laporan_klien: ['gmv', 'cr', 'roas_min'],
    }), ctx(strategiId));

    // Pilar Section E + satu angka kuota per baris (yang tersisa untuk AM).
    expect((await pillarsPut(put(`/strategi/${strategiId}/pillars`, amToken, {
      pillars: pilarDenganKuota(usulan),
    }), ctx(strategiId))).status).toBe(200);

    const sisa = await body<KekuranganWire[]>(
      await kekuranganGet(get(`/strategi/${strategiId}/kekurangan`, amToken), ctx(strategiId)),
    );
    expect(sisa, JSON.stringify(sisa)).toEqual([]);
  });

  it('submit → approve: Strategi Aktif dan periode Plan terbentuk', async () => {
    const sub = await strategiSubmit(post(`/strategi/${strategiId}/submit`, amToken, {}), ctx(strategiId));
    expect(sub.status, JSON.stringify(await sub.clone().json())).toBe(200);
    expect((await body<{ status: string }>(sub)).status).toBe('Diajukan');

    const app = await strategiApprove(post(`/strategi/${strategiId}/approve`, leadToken, {}), ctx(strategiId));
    expect(app.status, JSON.stringify(await app.clone().json())).toBe(200);
    expect((await body<{ status: string }>(app)).status).toBe('Aktif');

    const rows = await sql<{ id: string; periode_no: number }[]>`
      select id, periode_no from plan where strategi_id = ${strategiId} order by periode_no`;
    planIds = rows.map((r) => r.id);
    expect(planIds.length).toBe(6); // durasi kontrak 6 bulan
  });

  it('periode 1: baris kerja tersemai ber-strategi_pillar_id (BUKAN "Di Luar Strategi")', async () => {
    const res = await planDetailGet(get(`/plan/${planIds[0]}`, amToken), ctx(planIds[0]));
    expect(res.status).toBe(200);
    const detail = await body<{ rows: { pilar: string; channel: string; strategi_pillar_id: number | null; kuota: number; satuan: string; divisi_pic: string; di_luar_strategi: boolean }[] }>(res);
    expect(detail.rows.length).toBeGreaterThan(0);
    for (const r of detail.rows) {
      expect(r.strategi_pillar_id, `baris ${r.pilar} tanpa strategi_pillar_id`).not.toBeNull();
      expect(r.kuota).toBeGreaterThan(0);
      expect(r.divisi_pic).not.toBe('');
      expect(r.di_luar_strategi).toBe(false);
    }
    // Pilar kerja yang disemai memang pilar kerja — bukan `sku`/`harga`.
    const jenis = new Set(detail.rows.map((r) => r.pilar));
    expect(jenis.has('sku')).toBe(false);
    expect(jenis.has('harga')).toBe(false);
    expect(jenis.has('tidak_dikerjakan')).toBe(false);

    // Periode 2 tidak disemai (aturan: hanya periode 1).
    const p2 = await body<{ rows: unknown[] }>(await planDetailGet(get(`/plan/${planIds[1]}`, amToken), ctx(planIds[1])));
    expect(p2.rows).toEqual([]);
  });

  it('pilar sku & harga TIDAK disemai — mereka yang mengisi panel "menunggu divisi"', async () => {
    const detail = await body<{ rows: { strategi_pillar_id: number | null }[] }>(
      await planDetailGet(get(`/plan/${planIds[0]}`, amToken), ctx(planIds[0])),
    );
    const sudah = new Set(detail.rows.map((r) => r.strategi_pillar_id));
    const pil = await sql<{ id: number; jenis: string }[]>`
      select id, jenis from strategi_pillar where strategi_id = ${strategiId}`;
    for (const p of pil.filter((x) => x.jenis === 'sku' || x.jenis === 'harga')) {
      expect(sudah.has(Number(p.id)), `pilar ${p.jenis} seharusnya menunggu divisi, bukan disemai`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §10 butir 7 — Brief tetap satu klik, dan angle-nya ikut
// ---------------------------------------------------------------------------
interface BriefWire {
  id: string; title: string; assigned_division: string; deliverable_type: string;
  quantity_target: number; due_date: string | null; priority: string;
  instructions: string; reference_attachments: string | null; plan_row_id: number | null;
}

dDb('UAT §10 butir 7 — aktifkan periode → Berikan Brief (satu klik)', () => {
  it('periode 1 Draft → Aktif lewat POST /plan/{id}/submit', async () => {
    const res = await planSubmit(post(`/plan/${planIds[0]}/submit`, amToken, {}), ctx(planIds[0]));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await body<{ status: string }>(res)).status).toBe('Aktif');
  });

  it('AM hanya mengisi jatuh tempo + prioritas; sisanya diwarisi', async () => {
    const detail = await body<{ rows: { id: number; divisi_pic: string; pilar: string; kuota: number; satuan: string }[] }>(
      await planDetailGet(get(`/plan/${planIds[0]}`, amToken), ctx(planIds[0])),
    );
    const res = await planBriefs(post(`/plan/${planIds[0]}/briefs`, amToken, {
      fills: detail.rows.map((r) => ({ plan_row_id: r.id, due_date: '2026-09-25', priority: 'Medium' })),
    }), ctx(planIds[0]));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const hasil = await body<{ created: BriefWire[]; skipped: { plan_row_id: number; reason: string }[] }>(res);
    expect(hasil.created.length, JSON.stringify(hasil.skipped)).toBeGreaterThan(0);

    for (const b of hasil.created) {
      // Diwarisi, bukan diketik: divisi, deliverable, kuota, judul.
      expect(b.assigned_division).not.toBe('');
      expect(b.deliverable_type).not.toBe('');
      expect(b.quantity_target).toBeGreaterThan(0);
      expect(b.due_date).toBe('2026-09-25');
      expect(b.plan_row_id).not.toBeNull();
      // Jejak instruksi membawa kanal + pilar + aksi dari baris Plan.
      expect(b.instructions).toContain('Kanal: ');
      expect(b.instructions).toContain('Pilar: ');
    }
  });

  it('Brief pilar konten membawa angle video dari Section E', async () => {
    // Brief yang berasal dari pilar konten yang MEMANG punya angle — bukan
    // sembarang pilar konten (aksi konten tanpa video ber-penjualan tak punya
    // angle, dan itu benar).
    const konten = await sql<{ id: string; detail: { angle_video?: string[] } }[]>`
      select b.id, p.detail
        from briefs b
        join plan_row r on r.id = b.plan_row_id
        join strategi_pillar p on p.id = r.strategi_pillar_id
       where r.plan_id = ${planIds[0]} and r.pilar = 'konten'
         and jsonb_array_length(coalesce(p.detail->'angle_video', '[]'::jsonb)) > 0
       order by b.id limit 1`;
    expect(konten.length, 'tak ada Brief dari pilar konten ber-angle').toBe(1);
    const res = await briefGet(get(`/briefs/${konten[0].id}`, amToken), ctx(konten[0].id));
    expect(res.status).toBe(200);
    const b = await body<BriefWire>(res);
    // Angle video yang dibawa Co-Pilot ke Section E harus sampai ke Creative:
    // judul video yang SUDAH perform, apa adanya dari export butir 1.
    const contoh = (konten[0].detail.angle_video ?? [])[0];
    expect(contoh).toBeTruthy();
    expect(b.instructions, `instructions Brief tidak memuat angle "${contoh}"`).toContain(contoh);
  });
});
