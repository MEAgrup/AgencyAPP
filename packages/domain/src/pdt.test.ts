/**
 * PDT (Pusat Data Toko) — predikat izin (G1-01) + pratinjau deteksi batch
 * (G1-09, `previewUploadBatch`).
 *
 * Bagian pertama murni, tanpa DB: ketiga predikat izin adalah fungsi
 * permission murni (sama seperti `showcase.canKelolaIzinPitch`, yang
 * lingkupnya disalin). Bagian `describeDb` (real Postgres, di-skip tanpa
 * `DATABASE_URL`) menguji `previewUploadBatch` — pemanggil NYATA pertama yang
 * menyambungkan `@cdps/core` `pdt` ke baris `client_platforms`/`clients`
 * sungguhan. Baris di-namespace `ZPDT-`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { permission, tz } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';

/** `date` datang dari driver sebagai string ATAU Date tergantung konfigurasi — pola sama `dailyops.ts` `ymd()`. */
function ymd(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  canKelolaBenchmark,
  canKirimLaporan,
  canUploadBatch,
  commitUploadBatch,
  finalizePdtOrphanPurgeTick,
  finalizePdtPurgeTick,
  markRawStored,
  planPdtOrphanPurgeTick,
  planPdtPurgeTick,
  planPdtReparseTick,
  platformKeVokabPdt,
  previewUploadBatch,
  reparsePdtBatch,
  siapkanUploadBatch,
  type PdtCommitOverride,
  type PdtPreviewBerkasInput,
} from './pdt';

const OWNER = 'ZPDT-AM';
const am = (id = OWNER) => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZPDT-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = () => ({ employeeId: 'ZPDT-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZPDT-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const sales = () => ({ employeeId: 'ZPDT-SALES', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
/** Director yang kebetulan terpetakan ke divisi lain — haknya dari peran berlapis. */
const directorDiSales = () => ({ employeeId: 'ZPDT-DS', role: permission.makeRole({ division: 'Sales', level: 'staff', director: true }) });

describe('canUploadBatch — AM pemilik klien, atau lead/Director Account', () => {
  it('AM pemilik klien boleh mengunggah batch kliennya', () => {
    expect(canUploadBatch(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengunggah batch klien yang bukan miliknya', () => {
    expect(canUploadBatch(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account boleh, Director (di mana pun terpetakan) membawa lead', () => {
    expect(canUploadBatch(accountLead(), OWNER)).toBe(true);
    expect(canUploadBatch(director(), OWNER)).toBe(true);
    expect(canUploadBatch(directorDiSales(), OWNER)).toBe(true);
  });

  it('OD murni (bukan Director) TIDAK boleh mengunggah batch klien orang lain', () => {
    expect(canUploadBatch(od(), OWNER)).toBe(false);
  });

  it('divisi Sales TIDAK boleh mengunggah batch PDT', () => {
    expect(canUploadBatch(sales(), OWNER)).toBe(false);
  });

  it('klien tanpa AM (ownerAm null) TIDAK bisa diunggah siapa pun kecuali lead/Director', () => {
    expect(canUploadBatch(am(OWNER), null)).toBe(false);
    expect(canUploadBatch(accountLead(), null)).toBe(true);
  });
});

describe('canKelolaBenchmark — Director SAJA (bukan OD murni)', () => {
  it('Director boleh mengelola kalibrasi', () => {
    expect(canKelolaBenchmark(director())).toBe(true);
  });

  it('OD murni, lead Account, dan AM biasa TIDAK boleh', () => {
    expect(canKelolaBenchmark(od())).toBe(false);
    expect(canKelolaBenchmark(accountLead())).toBe(false);
    expect(canKelolaBenchmark(am())).toBe(false);
  });
});

describe('canKirimLaporan — lingkup sama seperti canUploadBatch', () => {
  it('AM pemilik klien boleh mengirim laporan kliennya', () => {
    expect(canKirimLaporan(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengirim laporan klien yang bukan miliknya', () => {
    expect(canKirimLaporan(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account dan Director boleh', () => {
    expect(canKirimLaporan(accountLead(), OWNER)).toBe(true);
    expect(canKirimLaporan(director(), OWNER)).toBe(true);
  });
});

describe('platformKeVokabPdt (PDT-22 — vokab client_platforms.platform ≠ vokab pdt)', () => {
  it('Shopee → shopee, TikTok Shop → tiktok', () => {
    expect(platformKeVokabPdt('Shopee')).toBe('shopee');
    expect(platformKeVokabPdt('TikTok Shop')).toBe('tiktok');
  });

  it('Tokopedia/Lazada/Blibli → null (manual, PDT tidak berlaku)', () => {
    expect(platformKeVokabPdt('Tokopedia')).toBeNull();
    expect(platformKeVokabPdt('Lazada')).toBeNull();
    expect(platformKeVokabPdt('Blibli')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// previewUploadBatch (G1-09) — integrasi Postgres nyata (di-skip tanpa
// DATABASE_URL). Pola fixture sama dengan account.test.ts/client.test.ts:
// prefix 'ZPDT-'/'ZZ-PDT-', dibersihkan afterEach.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-ZPDT-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(
  clientId: string,
  platform: string,
  shopId: string | null = null,
  akunKontenToko: readonly string[] | null = null,
): Promise<number> {
  // sql.json(...) TANPA JSON.stringify/::jsonb manual — pola sama seperti `commitUploadBatch`
  // (`docs/DECISIONS.md` 2026-09-14, sub-langkah 2b-i "Temuan sampingan": `${JSON.stringify(obj)}::jsonb`
  // DOUBLE-ENCODE, tersimpan sebagai jsonb SCALAR STRING (`jsonb_typeof` = 'string'), bukan array —
  // ditemukan lewat tes `ekstrakBarisTtVideo`/`is_akun_toko` sesi ini yang PERTAMA KALI menembus
  // `validasiIdentitasTiktok` cabang `tolak` dengan `akunKontenToko` non-kosong (`.join()` melempar
  // pada string, bukan array; cabang `cocok`/`usulkan_ikat` "kebetulan lolos" sebelumnya karena
  // `.includes()` pada STRING adalah substring-match, bukan keanggotaan array sungguhan).
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, akun_konten_toko, created_by)
    values (${clientId}, ${platform}, true, ${shopId}, ${akunKontenToko ? sql.json(akunKontenToko as never) : null}, 'ZZ-TEST')
    returning id`;
  return rows[0].id;
}

afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = ${OWNER_AM}`;
  await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // pdt_upload_batch/pdt_file (commitUploadBatch, FK ke clients/client_platforms) dulu —
  // urutan penghapusan mengikuti arah FK, sama seperti test lain di repo ini. audit_log
  // SENGAJA tidak dibersihkan — append-only (trigger menolak DELETE juga, bukan cuma UPDATE),
  // baris uji menumpuk seperti test suite lain yang menembus sm_transition/insertAudit.
  await sql`delete from pdt_file where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-ZPDT-%')`;
  // pdt_fact_ads (G1-09 sub-langkah 2b-ii) — FK ke client_platforms TANPA ON DELETE CASCADE
  // (migrasi G1-01), jadi harus dibersihkan SEBELUM client_platforms atau FK menolak DELETE.
  await sql`delete from pdt_fact_ads where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  // pdt_fact_content (G1-09 sub-langkah 2b-ii, modul kedua tt_video) — sama alasan.
  await sql`delete from pdt_fact_content where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  // pdt_sku_master (G1-09 sub-langkah 2b-ii, modul KETIGA) — sama alasan (FK ke client_platforms
  // TANPA ON DELETE CASCADE).
  await sql`delete from pdt_sku_master where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  // pdt_fact_creator_period (G1-09 sub-langkah 2b-ii, modul KEEMPAT tt_transaction_creator) — sama alasan.
  await sql`delete from pdt_fact_creator_period where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  // pdt_fact_sku_period (G1-09 sub-langkah 2b-ii, modul KEDELAPAN shopee_ams_produk, sesi 23) —
  // sama alasan (FK ke client_platforms, kolom baru migrasi 20261025010000, TANPA ON DELETE CASCADE).
  await sql`delete from pdt_fact_sku_period where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-ZPDT-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

const OWNER_AM = 'ZPDT-AM-DB';
const ownerActor = () => ({ employeeId: OWNER_AM, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const otherAm = () => ({ employeeId: 'ZPDT-AM-LAIN', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const leadActor = () => ({ employeeId: 'ZPDT-SPV-DB', role: permission.makeRole({ division: 'Account', level: 'lead' }) });

// commitUploadBatch menulis pdt_upload_batch.dibuat_oleh (FK employees) — OWNER_AM harus jadi
// baris employees sungguhan (pola sama auth.test.ts insertEmployee), beda dari clients/
// client_platforms.created_by yang tidak ber-FK ke employees.
beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${OWNER_AM}, 'AM Uji PDT', 'zpdt-am-db@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});

const decodeGagalBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: null, decodeGagal: pesan, aoa: null, sheets: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

const ditolakPagarBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: { pesan }, decodeGagal: null, aoa: null, sheets: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

/** Berkas shopee_ads_cpc LENGKAP (seluruh kolomDipanen + preamble) — cukup untuk status 'ok' dan sinyal identitas/periode. */
function shopeeAdsCpcBerkas(nama: string, idToko: string, periode: string): PdtPreviewBerkasInput {
  const header = [
    'ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
    'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)',
  ];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`],
    ['Username: tokoku'],
    ['Nama Toko: Toko Saya'],
    [`Periode: ${periode}`],
    [],
    [],
    [],
    header,
    ['P1', '01/07/2026', 'PRD-1', '100', '10', '2', '5000', 'Iklan A', '200000', '4x', '2,5'],
  ];
  return { nama, sha256: 'sha-cpc', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'] };
}

/**
 * Berkas `shopee_ads_live` LENGKAP (seluruh `kolomDipanen`) — modul PERTAMA
 * yang dipetakan ke `pdt_fact_ads` (G1-09 sub-langkah 2b-ii, `fakta.ts`
 * `@cdps/core`). Tidak membawa preamble toko (`MODUL_PREAMBLE_SHOPEE` hanya
 * ketiga modul iklan CPC/Search/Live BUKAN — lihat `pdt.ts`, tapi khusus
 * modul ini pratinjau/komentar `MODUL_PREAMBLE_SHOPEE` menyebut ketiganya;
 * fixture ini tetap menambahkan preamble sama seperti `shopeeAdsCpcBerkas`
 * supaya identitas/periode batch bisa diselesaikan tanpa berkas lain).
 */
function shopeeAdsLiveBerkas(nama: string, idToko: string, periode: string, baris: readonly [string, string, string, string, string, string][]): PdtPreviewBerkasInput {
  const header = ['Nama Iklan', 'ID Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan'];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`],
    ['Username: tokoku'],
    ['Nama Toko: Toko Saya'],
    [`Periode: ${periode}`],
    [],
    [],
    header,
    ...baris.map(([namaIklan, idIklan, penonton, pesanan, omzet, biaya]) => [namaIklan, idIklan, penonton, pesanan, omzet, biaya, '10']),
  ];
  return { nama, sha256: 'sha-adslive', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'shopee_ads_live', ambiguous: false, matches: ['shopee_ads_live'] };
}

/**
 * `shopee_ads_cpc` LENGKAP untuk uji `pdt_fact_ads` (G1-09 sub-langkah 2b-ii,
 * modul KEENAM) — parametrized per baris iklan, pola sama `shopeeAdsLiveBerkas`.
 * `Kode Produk` diikutkan di header/baris (boleh `'-'`, sama seperti baris
 * "Shop GMV Max" sample Fim Motor asli) untuk membuktikan kolom itu TIDAK
 * dipakai sebagai `kampanye_id` (lihat `fakta.ts` docblock).
 */
function shopeeAdsCpcBerkasLengkap(
  nama: string,
  idToko: string,
  periode: string,
  baris: readonly [string, string, string, string, string, string, string][],
): PdtPreviewBerkasInput {
  const header = [
    'nama iklan', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'omzet penjualan', 'Biaya', 'Efektifitas Iklan',
    'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)',
  ];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`],
    ['Username: tokoku'],
    ['Nama Toko: Toko Saya'],
    [`Periode: ${periode}`],
    [],
    [],
    header,
    ...baris.map(([namaIklan, kodeProduk, dilihat, klik, konversi, omzet, biaya]) => [namaIklan, kodeProduk, dilihat, klik, konversi, omzet, biaya, '10%']),
  ];
  return { nama, sha256: 'sha-adscpc-lengkap', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'] };
}

/**
 * `shopee_ads_search` LENGKAP untuk uji `pdt_fact_ads` (G1-09 sub-langkah
 * 2b-ii, modul KETUJUH, sesi 22) — parametrized per baris [namaIklan,
 * kataPencarian, dilihat, klik, konversi, omzet, biaya], pola sama
 * `shopeeAdsCpcBerkasLengkap`.
 */
function shopeeAdsSearchBerkasLengkap(
  nama: string,
  idToko: string,
  periode: string,
  baris: readonly [string, string, string, string, string, string, string][],
): PdtPreviewBerkasInput {
  const header = [
    'Nama Iklan', 'Kata Pencarian', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan',
  ];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`],
    ['Username: tokoku'],
    ['Nama Toko: Toko Saya'],
    [`Periode: ${periode}`],
    [],
    [],
    header,
    ...baris.map(([namaIklan, kataPencarian, dilihat, klik, konversi, omzet, biaya]) => [namaIklan, kataPencarian, dilihat, klik, konversi, omzet, biaya, '5.24']),
  ];
  return { nama, sha256: 'sha-adssearch-lengkap', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'shopee_ads_search', ambiguous: false, matches: ['shopee_ads_search'] };
}

/** Berkas tt_video LENGKAP — cukup untuk status 'ok' dan sinyal identitas TikTok ('ID Kreator' terbanyak). */
function ttVideoBerkas(nama: string, idKreator: string): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
    [idKreator, 'V2', '02/07/2026', 'Produk B', '200', '20', '4', '10', 'Kreator A', 'info', '2000', '80000'],
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

/**
 * Sama seperti `ttVideoBerkas`, + kolom 'Rentang Tanggal' (Rule 5,
 * `KANDIDAT_KOLOM_PERIODE_TIKTOK`) — `tt_video` sendiri tidak membawa
 * kolom periode (`ttVideoBerkas` polos cukup untuk tes identitas/status
 * berkas yang tidak menyentuh commit, yang MEWAJIBKAN periode batch sah).
 */
function ttVideoBerkasDenganPeriode(nama: string, idKreator: string, rentang: string): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Rentang Tanggal', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [], [],
    header,
    [idKreator, 'V1', '01/07/2026', rentang, 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

/**
 * `tt_video` LENGKAP untuk uji `pdt_fact_content` (G1-09 sub-langkah 2b-ii,
 * modul kedua) — parametrized per baris video, + 'Rentang Tanggal' (sama
 * seperti `ttVideoBerkasDenganPeriode`, tt_video sendiri tidak membawa
 * kolom periode) supaya `commitUploadBatch` (yang MEWAJIBKAN periode sah)
 * bisa dipanggil dengan HANYA berkas ini.
 */
function ttVideoBerkasLengkap(
  nama: string,
  rentang: string,
  baris: readonly [string, string, string, string, string, string, string][],
): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Rentang Tanggal', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [], [],
    header,
    ...baris.map(([idKreator, idVideo, vv, likes, dibagikan, klikProduk, gmv]) => [idKreator, idVideo, '01/07/2026', rentang, 'Produk A', vv, likes, dibagikan, klikProduk, 'Kreator', 'info', '1000', gmv]),
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

// ---------------------------------------------------------------------------
// Fixture rekonsiliasi Shopee (G1-09 sub-langkah 2b-i) — sheet `shopee_shop_stats`
// SUDAH terisolasi per basis (`namaSheet`, G1-09-SHEET-BUKAN-PERTAMA): header
// (HEADER_SHOP_STATS_15, dites `validasiKolomWajib` Rule 9 DAN dibaca
// `parseShopeeShopStatsBasisTerisolasi`, G1-07) diikuti LANGSUNG oleh baris
// ringkasan periode — bentuk PERSIS sample asli terverifikasi (rekonsiliasi.test.ts
// FIM_MOTOR_SHOP_STATS_SIAP_DIKIRIM). Detection (`detectPdtModuleAntarSheet`)
// TIDAK disentuh di sini (fixture domain-level menyuntik `modulTerdeteksi`
// langsung), jadi hanya bentuk baris yang perlu benar, bukan `tandaTanganKolom`.
// ---------------------------------------------------------------------------
const HEADER_SHOP_STATS_15 = [
  'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
  'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
  'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];

function shopeeShopStatsBerkas(nama: string, gmvSiapKirim: number, pesananSiapKirim: number): PdtPreviewBerkasInput {
  const dataRow15 = [String(gmvSiapKirim), String(pesananSiapKirim), '0', '0', '500', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
  const aoa: unknown[][] = [HEADER_SHOP_STATS_15, dataRow15];
  return {
    nama, sha256: 'sha-shopstats', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
  };
}

const HEADER_PARENT_SKU = [
  'Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
  'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Jumlah Produk Dilihat', 'Produk Diklik',
  'Tingkat Konversi (Pesanan yang Dibuat)', 'repeat order', 'Pengunjung Produk (Kunjungan)',
];

function shopeeParentSkuBerkas(nama: string, gmvSiapKirimTotal: number): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_PARENT_SKU,
    ['P1', 'V1', 'SKU1', String(gmvSiapKirimTotal), String(gmvSiapKirimTotal), '100', '10', '5%', '10%', '50'],
  ];
  return {
    nama, sha256: 'sha-parentsku', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'],
  };
}

describeDb('previewUploadBatch (G1-09) — gerbang izin + platform', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    await expect(previewUploadBatch(sql, ownerActor(), 999999999, [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('403 untuk AM yang bukan pemilik klien (dan bukan lead/Director)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(previewUploadBatch(sql, otherAm(), cpId, [])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lead Account boleh membaca pratinjau batch klien siapa pun', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await previewUploadBatch(sql, leadActor(), cpId, []);
    expect(hasil.platform).toBe('shopee');
  });

  it('platform Tokopedia/Lazada/Blibli ⇒ ValidationError (PDT-22, manual saja)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    await expect(previewUploadBatch(sql, ownerActor(), cpId, [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('moduleOptions hanya modul platform batch ini (bukan lintas platform)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, []);
    expect(hasil.moduleOptions.length).toBeGreaterThan(0);
    expect(hasil.moduleOptions.some((m) => m.kode === 'shopee_shop_stats')).toBe(false);
    expect(hasil.moduleOptions.some((m) => m.kode === 'tt_video')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// siapkanUploadBatch (G1-09-BODY-BESAR, docs/DECISIONS.md 2026-09-13) — gerbang
// izin + path staging SEBELUM upload. Gerbang identik previewUploadBatch;
// cakupan di sini murni memastikan fungsi BARU ini memakai gerbang yang sama
// (bukan menduplikasi logikanya dengan bug baru) + bentuk path staging.
// ---------------------------------------------------------------------------
describeDb('siapkanUploadBatch (G1-09-BODY-BESAR) — gerbang izin + path staging', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    await expect(siapkanUploadBatch(sql, ownerActor(), 999999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('403 untuk AM yang bukan pemilik klien (dan bukan lead/Director)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(siapkanUploadBatch(sql, otherAm(), cpId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('platform Tokopedia/Lazada/Blibli ⇒ ValidationError (PDT-22, manual saja) — SEBELUM path staging dibuat', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    await expect(siapkanUploadBatch(sql, ownerActor(), cpId)).rejects.toBeInstanceOf(ValidationError);
  });

  it('AM pemilik ⇒ path staging di bawah _staging/{client_id}/{client_platform_id}/, bukan path final Rule 44', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await siapkanUploadBatch(sql, ownerActor(), cpId);
    expect(hasil.clientPlatformId).toBe(cpId);
    expect(hasil.stagingPath).toMatch(new RegExp(`^_staging/${clientId}/${cpId}/[0-9a-f-]{36}\\.zip$`));
  });

  it('dua panggilan berturut-turut ⇒ path staging berbeda (nol tabrakan)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const a = await siapkanUploadBatch(sql, ownerActor(), cpId);
    const b = await siapkanUploadBatch(sql, ownerActor(), cpId);
    expect(a.stagingPath).not.toBe(b.stagingPath);
  });

  it('lead Account boleh menyiapkan upload batch klien siapa pun', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await siapkanUploadBatch(sql, leadActor(), cpId);
    expect(hasil.stagingPath).toContain(`_staging/${clientId}/${cpId}/`);
  });
});

describeDb('previewUploadBatch (G1-09) — status per berkas', () => {
  async function fixture(platform = 'Shopee'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, platform);
  }

  it('ditolakPagar ⇒ status ditolak_pagar, pesan apa adanya', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ditolakPagarBerkas('a.zip', '[berkas terenkripsi]')]);
    expect(hasil.berkas).toEqual([
      expect.objectContaining({ nama: 'a.zip', status: 'ditolak_pagar', pesan: '[berkas terenkripsi]', modulKode: null }),
    ]);
  });

  it('decodeGagal ⇒ status gagal, pesan = pesan decode (Rule 10 — "berkas tidak diunggah" tidak pernah dipakai)', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('b.xlsx', 'berkas tidak berisi sheet apa pun')]);
    expect(hasil.berkas[0]).toMatchObject({ status: 'gagal', pesan: 'berkas tidak berisi sheet apa pun' });
    expect(hasil.berkas[0].pesan).not.toContain('tidak diunggah');
  });

  it('ambiguous (>1 modul cocok) ⇒ status perlu_pilih_modul, menyebut daftar modul', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'c.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], sheets: null, modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('perlu_pilih_modul');
    expect(hasil.berkas[0].pesan).toContain('shopee_diskon');
    expect(hasil.berkas[0].pesan).toContain('shopee_flash_sale');
  });

  it('nol modul cocok (bukan ambiguous) ⇒ status perlu_pilih_modul juga, pesan berbeda', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'd.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], sheets: null, modulTerdeteksi: null, ambiguous: false, matches: [],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('perlu_pilih_modul');
    expect(hasil.berkas[0].pesan).toContain('tidak dikenali');
  });

  it('modul terdeteksi, kolom wajib LENGKAP ⇒ status ok, baris header DICARI bukan hint mentah', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('e.xlsx', '111', '01/07/2026 - 31/07/2026')]);
    // `ID Toko`/`Periode` (preamble, sengaja masih ada di header fixture ini untuk
    // uji identitas/periode di describeDb lain) BUKAN lagi bagian kolomDipanen
    // sejak sesi 19 (docs/DECISIONS.md modul KEENAM) — keduanya ikut kolomBaru.
    expect(hasil.berkas[0]).toMatchObject({
      status: 'ok', modulKode: 'shopee_ads_cpc', barisHeader: 8, kolomDipanen: 9,
      kolomBaru: ['ID Toko', 'Periode'], pesan: null,
    });
  });

  it('modul terdeteksi, kolom wajib HILANG ⇒ status gagal, pesan menyebut nama kolom (Rule 9)', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'f.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['Kode Produk', 'Dilihat', 'Biaya']], // shopee_ads_cpc, tapi 6 dari 9 kolomDipanen hilang
      sheets: null, modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('gagal');
    expect(hasil.berkas[0].pesan).toContain("'Konversi'");
  });

  it('kolom di luar whitelist/alias tercatat sebagai kolomBaru (Rule 8, NAMA saja)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkas('g.xlsx', '111', '01/07/2026 - 31/07/2026');
    (berkas.aoa as unknown[][])[7] = [...(berkas.aoa as unknown[][])[7], 'Kolom Rahasia Baru'];
    (berkas.aoa as unknown[][])[8] = [...(berkas.aoa as unknown[][])[8], 'nilai-rahasia'];
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [berkas]);
    // `ID Toko`/`Periode` JUGA kolomBaru sekarang (preamble, bukan kolomDipanen sejak sesi 19).
    expect(hasil.berkas[0].kolomBaru).toEqual(['ID Toko', 'Periode', 'Kolom Rahasia Baru']);
  });
});

describeDb('previewUploadBatch (G1-09) — identitas (Rule 2-4) + periode (Rule 5)', () => {
  it('Shopee, shop_id belum terikat ⇒ usulkan_ikat dari preamble; periode dari preamble', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')]);
    expect(hasil.identitas).toEqual({ status: 'usulkan_ikat', usulan: '938284780' });
    expect(hasil.periode).toEqual({ status: 'ok', mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('Shopee, ID Toko berkas ≠ shop_id tersimpan ⇒ tolak, menyebut KEDUA nilai', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-LAMA');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')]);
    expect(hasil.identitas.status).toBe('tolak');
    expect((hasil.identitas as { pesan: string }).pesan).toContain('938284780');
    expect((hasil.identitas as { pesan: string }).pesan).toContain('SHOP-LAMA');
  });

  it('Shopee tanpa satu pun berkas Ads ber-preamble ⇒ tidak_dapat_divalidasi', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const header = ['Pesanan Dibuat', 'Total Pengunjung']; // shopee_shop_stats, tak ada preamble
    const berkas: PdtPreviewBerkasInput = {
      nama: 'stats.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [header], sheets: null, modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [berkas]);
    expect(hasil.identitas.status).toBe('tidak_dapat_divalidasi');
  });

  it('TikTok, akun_konten_toko belum terikat ⇒ usulkan_ikat dari ID Kreator terbanyak', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkas('v.xlsx', 'kreator-a')]);
    expect(hasil.identitas).toEqual({ status: 'usulkan_ikat', usulan: 'kreator-a' });
  });

  it('TikTok, ID Kreator terdaftar di akun_konten_toko ⇒ cocok', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a', 'kreator-b']);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkas('v.xlsx', 'kreator-a')]);
    expect(hasil.identitas).toEqual({ status: 'cocok' });
  });

  it('nol berkas ber-status ok ⇒ periode null (bukan objek "tolak")', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('x.xlsx', 'rusak')]);
    expect(hasil.periode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2a) — Flow A langkah 6 (batch/berkas)
// + langkah 9 (error path). Beda dari previewUploadBatch: baris
// pdt_upload_batch/pdt_file SUNGGUHAN ditulis di sini — setiap test yang
// menegaskan isi baris query langsung ke DB, bukan cuma nilai balik fungsi.
// ---------------------------------------------------------------------------
interface BatchRow {
  id: number;
  status: string;
  alasan_ditolak: string | null;
  reconcile_delta_pct: string | null; // numeric — datang sebagai string dari driver
  periode_mulai: string | Date;
  periode_selesai: string | Date;
  parser_versi: number;
  identitas_sumber: unknown;
  retensi_sampai: string | Date;
  retensi_alasan: string | null;
  raw_path: string | null;
  raw_sha256: string | null;
  raw_bytes: string | null;
  raw_entri: number | null;
  raw_entri_dilewati: number | null;
}

async function loadBatch(id: number): Promise<BatchRow> {
  const rows = await sql<BatchRow[]>`select * from pdt_upload_batch where id = ${id}`;
  return rows[0];
}

interface FileRow {
  modul_kode: string | null;
  nama_entri: string;
  sha256: string;
  bytes: string; // bigint — datang sebagai string dari driver
  baris_header: number;
  deteksi_oleh: string;
  kolom_dipanen: number;
  kolom_baru: string[];
  parse_status: string;
  parse_error: string | null;
}

async function loadFiles(batchId: number): Promise<FileRow[]> {
  return sql<FileRow[]>`select * from pdt_file where batch_id = ${batchId} order by nama_entri`;
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — gerbang izin + platform', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    await expect(commitUploadBatch(sql, ownerActor(), 999999999, [], [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('403 untuk AM yang bukan pemilik klien (dan bukan lead/Director)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(commitUploadBatch(sql, otherAm(), cpId, [], [])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('platform Tokopedia/Lazada/Blibli ⇒ ValidationError (PDT-22, manual saja)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [], [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('override modul di luar platform toko ini ⇒ ValidationError', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const overrides: PdtCommitOverride[] = [{ nama: 'a.xlsx', modulKode: 'tt_video' }];
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '111', '01/07/2026 - 31/07/2026')], overrides))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — batas periode (Rule 5): nol baris bila periode tidak sah', () => {
  it('nol berkas ber-status ok ⇒ ValidationError, NOL baris pdt_upload_batch ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('x.xlsx', 'rusak')], []))
      .rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select id from pdt_upload_batch where client_id = ${clientId}`;
    expect(rows.length).toBe(0);
  });

  it('berkas dari bulan kalender berbeda ⇒ ValidationError, NOL baris pdt_upload_batch ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const juli = shopeeAdsCpcBerkas('juli.xlsx', '111', '01/07/2026 - 31/07/2026');
    const agustus = shopeeAdsCpcBerkas('agustus.xlsx', '111', '01/08/2026 - 31/08/2026');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [juli, agustus], [])).rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select id from pdt_upload_batch where client_id = ${clientId}`;
    expect(rows.length).toBe(0);
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — status batch dari identitas (Rule 2-4)', () => {
  it("identitas 'tolak' (ID Toko ≠ shop_id tersimpan) ⇒ status ditolak, alasan_ditolak terisi, TETAP tersimpan (Flow A langkah 9)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-LAMA');
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], []);
    expect(persiapan.status).toBe('ditolak');
    expect(persiapan.alasanDitolak).toContain('938284780');
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('ditolak');
    expect(row.alasan_ditolak).toBe(persiapan.alasanDitolak);
    expect(row.retensi_alasan).toBe('ditolak');
  });

  it("identitas 'usulkan_ikat' (shop_id belum terikat) ⇒ status identitas_belum_terikat, identitas_sumber terisi, client_platforms.shop_id TIDAK berubah (AM belum konfirmasi)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], []);
    expect(persiapan.status).toBe('identitas_belum_terikat');
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('identitas_belum_terikat');
    expect(row.identitas_sumber).toEqual({ shop_id: '938284780', username: 'tokoku', nama_toko: 'Toko Saya' });
    const cp = await sql`select shop_id from client_platforms where id = ${cpId}`;
    expect(cp[0].shop_id).toBeNull();
  });

  it("identitas 'cocok' TikTok ⇒ status parsing (rekonsiliasi TikTok belum ada, G1-07-TIKTOK-REKONSILIASI — beda dari Shopee, lihat describeDb rekonsiliasi di bawah)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkasDenganPeriode('v.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026')], []);
    expect(persiapan.status).toBe('parsing');
    expect(persiapan.reconcileDeltaPct).toBeNull();
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('parsing');
    expect(row.retensi_alasan).toBe('default');
  });

  it("identitas 'tidak_dapat_divalidasi' (nol sinyal identitas di batch, TAPI periode tetap terbaca dari kolom lain) ⇒ status parsing juga (advisory, bukan pagar blokir)", async () => {
    // shopee_shop_stats/shopee_parent_sku dkk TIDAK PERNAH membawa periode sendiri (Rule 5 ayat
    // 2 — mewarisi dari berkas lain), jadi Shopee tanpa satu pun berkas Ads 'ok' TIDAK BISA
    // punya periode valid (lihat ekstrakPreambleShopee/MODUL_PREAMBLE_SHOPEE) — kombinasi
    // "tidak_dapat_divalidasi + periode valid" hanya mungkin di TikTok, yang membaca periode
    // dari SETIAP berkas 'ok' (ekstrakPeriodeKolomTiktok), independen dari 'ID Kreator'.
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const header = [
      'GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
      'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi',
      'GMV dari video akun tertaut', 'Tanggal analisis',
    ];
    const dataRow = ['1000000', '10', '8', '12', '500', '2', '1000000', '0', '200000', '100000', '50000', '50000', '01/07/2026 - 31/07/2026'];
    const berkas: PdtPreviewBerkasInput = {
      nama: 'shop-analytics.xlsx', sha256: 's-sa', bytes: 20, ditolakPagar: null, decodeGagal: null,
      aoa: [header, dataRow], sheets: null, modulTerdeteksi: 'tt_shop_analytics', ambiguous: false, matches: ['tt_shop_analytics'],
    };
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    expect(persiapan.identitas.status).toBe('tidak_dapat_divalidasi');
    expect(persiapan.status).toBe('parsing');
    expect(persiapan.periodeMulai).toBe('2026-07-01');
    expect(persiapan.periodeSelesai).toBe('2026-07-31');
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-i) — rekonsiliasi Shopee (Rule
// 13-16), basis Siap Dikirim, GMV saja (G1-07-PERSKU-PESANAN — nol kolom
// jumlah-pesanan per-SKU terverifikasi di shopee_parent_sku).
// ---------------------------------------------------------------------------
describeDb('commitUploadBatch (G1-09 sub-langkah 2b-i) — rekonsiliasi Shopee', () => {
  async function fixtureCocok(): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', '938284780'); // shop_id SUDAH terikat ⇒ identitas 'cocok', gerbang reconciliation terbuka
  }

  it('GMV per-SKU Σ = GMV shop-level (basis Siap Dikirim) ⇒ verified, reconcile_delta_pct = 0', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkas('shop-stats.xlsx', 1_000_000, 100),
      shopeeParentSkuBerkas('parent-sku.xlsx', 1_000_000),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('verified');
    expect(persiapan.reconcileDeltaPct).toBe(0);
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('verified');
    expect(Number(row.reconcile_delta_pct)).toBe(0);
    expect(row.retensi_alasan).toBe('default'); // 'verified' ikut baris DEFAULT Rule 45, bukan 'ditolak'
  });

  it('GMV per-SKU Σ menyimpang > 0,5% dari shop-level ⇒ ditolak, alasan menyebut selisih GMV', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkas('shop-stats.xlsx', 1_000_000, 100),
      shopeeParentSkuBerkas('parent-sku.xlsx', 500_000), // separuh — jauh > 0,5%
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(persiapan.alasanDitolak).toContain('selisih rekonsiliasi GMV');
    expect(persiapan.reconcileDeltaPct).toBeCloseTo(50, 0);
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('ditolak');
    expect(row.retensi_alasan).toBe('ditolak'); // rekonsiliasi-ditolak ikut baris +30 hari yang SAMA seperti identitas-ditolak
  });

  it('hanya shopee_shop_stats TANPA shopee_parent_sku (pasangan tidak lengkap) ⇒ tetap parsing, reconcile_delta_pct null', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkas('shop-stats.xlsx', 1_000_000, 100),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('parsing');
    expect(persiapan.reconcileDeltaPct).toBeNull();
  });

  it("identitas 'usulkan_ikat' (shop_id belum terikat) ⇒ rekonsiliasi TIDAK dicoba meski berkas lengkap (identitas gate lebih dulu)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null); // shop_id belum terikat
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkas('shop-stats.xlsx', 1_000_000, 100),
      shopeeParentSkuBerkas('parent-sku.xlsx', 1_000_000),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('identitas_belum_terikat');
    expect(persiapan.reconcileDeltaPct).toBeNull();
  });

  it('batch verified KEDUA untuk (toko, periode) yang sama ⇒ ValidationError BI (uq_pdt_upload_batch_verified, Rule 36), bukan 500 mentah', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkas('shop-stats.xlsx', 1_000_000, 100),
      shopeeParentSkuBerkas('parent-sku.xlsx', 1_000_000),
    ];
    const pertama = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(pertama.status).toBe('verified');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, berkas, [])).rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — retensi (Rule 45)', () => {
  it('status ditolak ⇒ retensi_sampai = +30 hari; status lain ⇒ +120 hari (dari `now` yang disuntik)', async () => {
    const now = new Date('2026-07-15T03:00:00Z');

    // Dua client TERPISAH — uq_client_platforms_active_platform mengizinkan hanya SATU
    // client_platform Shopee aktif per client, jadi dua batch tidak bisa berbagi satu client.
    const clientDitolak = nextClientId();
    await insertClient(clientDitolak, OWNER_AM);
    const cpDitolak = await insertClientPlatform(clientDitolak, 'Shopee', 'SHOP-LAMA');
    const ditolak = await commitUploadBatch(sql, ownerActor(), cpDitolak, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], [], now);
    expect(ymd((await loadBatch(ditolak.batchId)).retensi_sampai)).toBe('2026-08-14');

    const clientOk = nextClientId();
    await insertClient(clientOk, OWNER_AM);
    const cpOk = await insertClientPlatform(clientOk, 'Shopee', '938284780');
    const cocok = await commitUploadBatch(sql, ownerActor(), cpOk, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], [], now);
    expect(ymd((await loadBatch(cocok.batchId)).retensi_sampai)).toBe('2026-11-12');
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — baris pdt_file per status berkas', () => {
  async function fixture(): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', '938284780');
  }

  it("berkas 'ok' ⇒ satu baris pdt_file lengkap, deteksi_oleh='tanda_tangan'", async () => {
    const cpId = await fixture();
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], []);
    const files = await loadFiles(persiapan.batchId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      // `ID Toko`/`Periode` (preamble) ikut kolom_baru sejak sesi 19 — lihat catatan
      // fixture `shopeeAdsCpcBerkas`/docs/DECISIONS.md modul KEENAM.
      modul_kode: 'shopee_ads_cpc', nama_entri: 'a.xlsx', sha256: 'sha-cpc', bytes: '100',
      baris_header: 8, deteksi_oleh: 'tanda_tangan', kolom_dipanen: 9, kolom_baru: ['ID Toko', 'Periode'], parse_status: 'ok', parse_error: null,
    });
  });

  it("ditolakPagar/gagalEkstrak (sha256/bytes null di sumber) ⇒ NOL baris pdt_file — sha256/bytes NOT NULL di skema dan genuinely tidak diketahui", async () => {
    const cpId = await fixture();
    const persiapan = await commitUploadBatch(
      sql, ownerActor(), cpId,
      [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026'), ditolakPagarBerkas('b.zip', '[zip bersarang]'), decodeGagalBerkas('c.xlsx', 'gagal ekstrak')],
      [],
    );
    const files = await loadFiles(persiapan.batchId);
    expect(files).toHaveLength(1); // hanya a.xlsx — b.zip/c.xlsx (gagalEkstrak) tidak punya sha256/bytes
    expect(files[0].nama_entri).toBe('a.xlsx');
    expect(persiapan.berkas).toHaveLength(3); // tetap TERLIHAT di respons untuk request yang sama
  });

  it("perlu_pilih_modul TANPA override ⇒ baris ditulis dengan modul_kode NULL, baris_header sentinel 0, parse_status gagal", async () => {
    const cpId = await fixture();
    const ambigu: PdtPreviewBerkasInput = {
      nama: 'ambigu.xlsx', sha256: 's-amb', bytes: 5, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], sheets: null, modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
    };
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026'), ambigu], []);
    const files = await loadFiles(persiapan.batchId);
    const baris = files.find((f) => f.nama_entri === 'ambigu.xlsx')!;
    expect(baris).toMatchObject({ modul_kode: null, baris_header: 0, deteksi_oleh: 'tanda_tangan', kolom_dipanen: 0, kolom_baru: [], parse_status: 'gagal' });
    expect(baris.parse_error).toContain('shopee_diskon');
  });

  it("perlu_pilih_modul DENGAN override AM ⇒ diparse ulang dengan modul yang ditimpa, deteksi_oleh='override_am'", async () => {
    const cpId = await fixture();
    const ambigu: PdtPreviewBerkasInput = {
      nama: 'ambigu.xlsx', sha256: 's-amb', bytes: 5, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], sheets: null, modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
    };
    const overrides: PdtCommitOverride[] = [{ nama: 'ambigu.xlsx', modulKode: 'shopee_diskon' }];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026'), ambigu], overrides);
    const files = await loadFiles(persiapan.batchId);
    const baris = files.find((f) => f.nama_entri === 'ambigu.xlsx')!;
    expect(baris.modul_kode).toBe('shopee_diskon');
    expect(baris.deteksi_oleh).toBe('override_am');
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2a) — audit log (aturan rumah #3)', () => {
  it('menulis satu baris audit_log per commit, actor tercatat', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', '938284780');
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], []);
    const rows = await sql`select action, actor_employee_id from audit_log where entity_type = 'pdt_upload_batch' and entity_id = ${String(persiapan.batchId)}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('pdt_batch_committed');
    expect(rows[0].actor_employee_id).toBe(OWNER_AM);
  });
});

describeDb('markRawStored (G1-09 sub-langkah 2a) — mengisi raw_* setelah unggah Storage berhasil', () => {
  it('mengisi raw_path/raw_sha256/raw_bytes/raw_entri/raw_entri_dilewati', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', '938284780');
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')], []);
    expect((await loadBatch(persiapan.batchId)).raw_path).toBeNull();

    await markRawStored(sql, persiapan.batchId, persiapan.rawPath, { sha256: 'paket-sha', bytes: 12345, entri: 1, entriDilewati: 2 });
    const row = await loadBatch(persiapan.batchId);
    expect(row.raw_path).toBe(persiapan.rawPath);
    expect(row.raw_path).toBe(`${clientId}/${cpId}/2026-07-31/${persiapan.batchId}.zip`);
    expect(row.raw_sha256).toBe('paket-sha');
    expect(Number(row.raw_bytes)).toBe(12345);
    expect(row.raw_entri).toBe(1);
    expect(row.raw_entri_dilewati).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii) — baris fakta `shopee_ads_live`
// → `pdt_fact_ads` (modul PERTAMA dipetakan, lihat `fakta.ts` `@cdps/core`
// untuk kenapa modul ini, bukan `shopee_ads_cpc`/`shopee_ads_search`).
// ---------------------------------------------------------------------------
interface FactAdsRow {
  sumber: string;
  kampanye_id: string;
  platform_product_id: string | null;
  sku_id: number | null;
  content_id: number | null;
  periode: string | Date;
  batch_id: number;
  parser_versi: number;
  biaya: string;
  tayangan: number | null;
  klik: number | null;
  pesanan_sku: number | null;
  gmv: string | null;
  roas: string | null;
}

async function loadFactAds(clientPlatformId: number): Promise<FactAdsRow[]> {
  return sql<FactAdsRow[]>`select * from pdt_fact_ads where client_platform_id = ${clientPlatformId} order by kampanye_id`;
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii) — baris fakta shopee_ads_live → pdt_fact_ads', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per kampanye, periode = AWAL BULAN (Q-3), sku_id/content_id NULL (belum ada pdt_sku_master)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsLiveBerkas('ads-live.xlsx', '938284780', '05/07/2026 - 31/07/2026', [
      ['Live Pagi', 'AD-1', '1000', '20', '2000000', '150000'],
      ['Live Sore', 'AD-2', '500', '5', '400000', '50000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sumber: 'shopee_ads_live', kampanye_id: 'AD-1', sku_id: null, content_id: null,
      batch_id: persiapan.batchId, parser_versi: 1, tayangan: 1000, klik: null, pesanan_sku: 20,
    });
    expect(ymd(rows[0].periode)).toBe('2026-07-01'); // hari pertama BULAN (05/07 dibulatkan ke awal bulan), bukan tanggal preamble apa adanya
    expect(Number(rows[0].biaya)).toBe(150000);
    expect(Number(rows[0].gmv)).toBe(2000000);
    expect(Number(rows[0].roas)).toBe(10);
    expect(rows[1].kampanye_id).toBe('AD-2');
  });

  it('commit ULANG periode yang sama ⇒ baris LAMA diganti (replace-on-recommit), bukan menumpuk duplikat', async () => {
    const cpId = await fixture();
    const pertama = shopeeAdsLiveBerkas('ads-live.xlsx', '938284780', '01/07/2026 - 31/07/2026', [
      ['Live Pagi', 'AD-1', '1000', '20', '2000000', '150000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [pertama], []);
    expect(await loadFactAds(cpId)).toHaveLength(1);

    const kedua = shopeeAdsLiveBerkas('ads-live-revisi.xlsx', '938284780', '01/07/2026 - 31/07/2026', [
      ['Live Pagi (revisi)', 'AD-1', '1500', '25', '2500000', '175000'],
    ]);
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, [kedua], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — baris lama dihapus, bukan ditambah
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].biaya)).toBe(175000);
  });

  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ NOL baris fakta ditulis — data toko yang salah tidak boleh mengotori toko ini", async () => {
    const cpId = await fixture('SHOP-LAIN');
    const berkas = shopeeAdsLiveBerkas('ads-live.xlsx', '938284780', '01/07/2026 - 31/07/2026', [
      ['Live Pagi', 'AD-1', '1000', '20', '2000000', '150000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactAds(cpId)).toHaveLength(0);
  });

  it("identitas 'usulkan_ikat' (shop_id belum terikat) ⇒ baris fakta TETAP ditulis (bukan MISMATCH, hanya belum dikonfirmasi)", async () => {
    const cpId = await fixture(null);
    const berkas = shopeeAdsLiveBerkas('ads-live.xlsx', '938284780', '01/07/2026 - 31/07/2026', [
      ['Live Pagi', 'AD-1', '1000', '20', '2000000', '150000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    expect(persiapan.status).toBe('identitas_belum_terikat');
    expect(await loadFactAds(cpId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEENAM) — baris fakta
// shopee_ads_cpc → pdt_fact_ads (blocker grain G1-09-2BII-ADS-CPC, terbuka
// sejak sesi 13, akhirnya terjawab sesi ini lewat sample asli Fim Motor —
// lihat fakta.ts @cdps/core untuk detail).
// ---------------------------------------------------------------------------
describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEENAM) — baris fakta shopee_ads_cpc → pdt_fact_ads', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per iklan, klik TERISI (beda dari shopee_ads_live yang tidak punya kolom klik), sku_id/content_id NULL, platform_product_id dari Kode Produk (sesi 23)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan Produk A', 'PRD-1', '447740', '21428', '616', '105473414', '10628677'],
      ['Iklan Produk B', 'PRD-2', '1040984', '56287', '2185', '211897708', '23252704'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sumber: 'shopee_ads_cpc', kampanye_id: 'Iklan Produk A', platform_product_id: 'PRD-1', sku_id: null, content_id: null,
      batch_id: persiapan.batchId, parser_versi: 1, tayangan: 447740, klik: 21428, pesanan_sku: 616,
    });
    expect(Number(rows[0].biaya)).toBe(10628677);
    expect(Number(rows[0].gmv)).toBe(105473414);
  });

  it('baris iklan TOKO Kode Produk="-" (mis. "Shop GMV Max", sample Fim Motor asli) tetap ditulis — kampanye_id dari nama iklan, sku_id DAN platform_product_id NULL', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Shop GMV Max', '-', '608677', '29556', '1377', '146650117', '10500000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sumber: 'shopee_ads_cpc', kampanye_id: 'Shop GMV Max', platform_product_id: null, sku_id: null });
  });

  it('dua iklan untuk Kode Produk yang SAMA ⇒ platform_product_id SAMA di kedua baris (GMV per produk = Σ kedua baris ini)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan Manual', 'PRD-1', '1000', '100', '20', '2000000', '150000'],
      ['Iklan Otomatis', 'PRD-1', '500', '50', '5', '400000', '50000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows.map((r) => r.platform_product_id)).toEqual(['PRD-1', 'PRD-1']);
  });

  it('dua iklan untuk Kode Produk yang SAMA ⇒ dua baris terpisah (kampanye_id = nama iklan membedakan, bukan Kode Produk)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan Manual', 'PRD-1', '1000', '100', '20', '2000000', '150000'],
      ['Iklan Otomatis', 'PRD-1', '500', '50', '5', '400000', '50000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows.map((r) => r.kampanye_id)).toEqual(['Iklan Manual', 'Iklan Otomatis']);
  });

  it('commit ULANG periode yang sama ⇒ baris LAMA diganti (replace-on-recommit), sama pola shopee_ads_live', async () => {
    const cpId = await fixture();
    const pertama = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A', 'PRD-1', '1000', '100', '20', '2000000', '150000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [pertama], []);
    expect(await loadFactAds(cpId)).toHaveLength(1);

    const kedua = shopeeAdsCpcBerkasLengkap('ads-cpc-revisi.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A (revisi)', 'PRD-1', '1500', '150', '25', '2500000', '175000'],
    ]);
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, [kedua], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].biaya)).toBe(175000);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KETUJUH, sesi 22) — baris
// fakta shopee_ads_search → pdt_fact_ads (blocker G1-09-2BII-ADS-SEARCH
// ditutup sesi ini — lihat fakta.ts @cdps/core untuk detail kampanye_id
// KOMPOSIT).
// ---------------------------------------------------------------------------
describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KETUJUH) — baris fakta shopee_ads_search → pdt_fact_ads', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per keyword, kampanye_id KOMPOSIT (nama iklan :: kata pencarian), sku_id/content_id NULL', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsSearchBerkasLengkap('ads-search.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan toko by MEA', 'Semua', '3', '20677', '330', '32480316', '6200000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sumber: 'shopee_ads_search', kampanye_id: 'Iklan toko by MEA :: Semua', sku_id: null, content_id: null,
      batch_id: persiapan.batchId, parser_versi: 1, tayangan: 3, klik: 20677, pesanan_sku: 330,
    });
    expect(Number(rows[0].biaya)).toBe(6200000);
    expect(Number(rows[0].gmv)).toBe(32480316);
  });

  it('dua keyword untuk IKLAN yang SAMA ⇒ dua baris terpisah (kampanye_id komposit membedakan, bukan nama iklan saja)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsSearchBerkasLengkap('ads-search.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan Search A', 'sepatu wanita', '1000', '100', '20', '2000000', '150000'],
      ['Iklan Search A', 'sepatu pria', '500', '50', '5', '400000', '50000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactAds(cpId);
    // loadFactAds ORDER BY kampanye_id (alfabetis) — bukan urutan baris di berkas ('pria' < 'wanita').
    expect(rows.map((r) => r.kampanye_id)).toEqual(['Iklan Search A :: sepatu pria', 'Iklan Search A :: sepatu wanita']);
  });

  it('commit ULANG periode yang sama ⇒ baris LAMA diganti (replace-on-recommit), sama pola shopee_ads_cpc', async () => {
    const cpId = await fixture();
    const pertama = shopeeAdsSearchBerkasLengkap('ads-search.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A', 'Semua', '1000', '100', '20', '2000000', '150000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [pertama], []);
    expect(await loadFactAds(cpId)).toHaveLength(1);

    const kedua = shopeeAdsSearchBerkasLengkap('ads-search-revisi.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A (revisi)', 'Semua', '1500', '150', '25', '2500000', '175000'],
    ]);
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, [kedua], []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].biaya)).toBe(175000);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEDUA) — baris fakta
// tt_video → pdt_fact_content (lihat fakta.ts @cdps/core untuk kenapa modul
// ini pakai ON CONFLICT DO UPDATE sungguhan, beda dari shopee_ads_live).
// ---------------------------------------------------------------------------
interface FactContentRow {
  platform_content_id: string;
  batch_id: number;
  parser_versi: number;
  jenis: string;
  creator_platform_id: string | null;
  creator_handle: string | null;
  is_akun_toko: boolean;
  waktu_posting: Date | null;
  sku_id: number | null;
  vv: number | null;
  likes: number | null;
  komentar: number | null;
  dibagikan: number | null;
  klik_produk: number | null;
  gmv: string | null;
}

async function loadFactContent(clientPlatformId: number): Promise<FactContentRow[]> {
  return sql<FactContentRow[]>`select * from pdt_fact_content where client_platform_id = ${clientPlatformId} order by platform_content_id`;
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul kedua) — baris fakta tt_video → pdt_fact_content', () => {
  async function fixture(akunKontenToko: readonly string[] | null): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'TikTok Shop', null, akunKontenToko);
  }

  it('satu baris per ID Video, jenis=video, sku_id/waktu_posting NULL (belum ada pdt_sku_master/parser Waktu)', async () => {
    const cpId = await fixture(['KR-1']);
    const berkas = ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [
      ['KR-1', 'V1', '1000', '50', '5', '10', '2000000'],
      ['KR-1', 'V2', '500', '20', '2', '5', '400000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    expect(persiapan.status).toBe('parsing'); // identitas cocok, TikTok belum punya rekonsiliasi (G1-07-TIKTOK-REKONSILIASI)
    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform_content_id: 'V1', jenis: 'video', batch_id: persiapan.batchId, parser_versi: 1,
      creator_platform_id: 'KR-1', creator_handle: 'Kreator', is_akun_toko: true,
      waktu_posting: null, sku_id: null, vv: 1000, likes: 50, komentar: null, dibagikan: 5, klik_produk: 10,
    });
    expect(Number(rows[0].gmv)).toBe(2000000);
    expect(rows[1].platform_content_id).toBe('V2');
  });

  it('is_akun_toko false bila ID Kreator video tidak ada di akun_konten_toko klien', async () => {
    const cpId = await fixture(['KR-LAIN-YANG-TERIKAT', 'KR-1']); // 'KR-1' harus ada supaya identitas TIDAK tolak — video di sini dari kreator BERBEDA
    const berkas = ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [
      ['KR-1', 'V1', '1000', '50', '5', '10', '2000000'],
      ['KR-AFILIASI', 'V2', '500', '20', '2', '5', '400000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    const rows = await loadFactContent(cpId);
    expect(rows.find((r) => r.platform_content_id === 'V1')!.is_akun_toko).toBe(true);
    expect(rows.find((r) => r.platform_content_id === 'V2')!.is_akun_toko).toBe(false);
  });

  it('commit ULANG (ID Video sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const cpId = await fixture(['KR-1']);
    const pertama = ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [
      ['KR-1', 'V1', '1000', '50', '5', '10', '2000000'],
    ]);
    await commitUploadBatch(sql, ownerActor(), cpId, [pertama], []);
    expect(await loadFactContent(cpId)).toHaveLength(1);

    const kedua = ttVideoBerkasLengkap('video-revisi.xlsx', '01/07/2026 - 31/07/2026', [
      ['KR-1', 'V1', '1500', '80', '9', '20', '2500000'],
    ]);
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, [kedua], []);
    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE, bukan baris baru
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(rows[0].vv).toBe(1500);
    expect(Number(rows[0].gmv)).toBe(2500000);
  });

  it("identitas 'tolak' (ID Kreator video tidak terdaftar di akun_konten_toko) ⇒ NOL baris fakta ditulis", async () => {
    const cpId = await fixture(['KR-LAIN']);
    const berkas = ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [
      ['KR-1', 'V1', '1000', '50', '5', '10', '2000000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkas], []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactContent(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KETIGA) — `shopee_parent_sku`/
// `tt_orders` → `pdt_sku_master` (lihat fakta.ts @cdps/core untuk kenapa modul
// ini, bukan `shopee_live`/`shopee_video` seperti rekomendasi sesi lalu — dan
// kenapa `tt_orders` SENDIRIAN, bukan digabung `tt_transaction_product`).
// Beda dari dua modul di atas: tabel MASTER (Rule 19), UPSERT sungguhan.
// ---------------------------------------------------------------------------
interface SkuMasterRow {
  platform_product_id: string;
  platform_variation_id: string;
  seller_sku: string | null;
  nama_produk: string | null;
  nama_variasi: string | null;
  kategori_platform: string | null;
  harga_satuan_terakhir: string | null;
  status_listing: string;
  first_seen_at: Date;
  last_seen_at: Date;
}

async function loadSkuMaster(clientPlatformId: number): Promise<SkuMasterRow[]> {
  return sql<SkuMasterRow[]>`select * from pdt_sku_master where client_platform_id = ${clientPlatformId} order by platform_product_id, platform_variation_id`;
}

/** `shopee_parent_sku` TANPA preamble/periode sendiri (sama seperti bentuk asli — lihat `shopeeParentSkuBerkas` di atas), beberapa baris SKU sekaligus untuk uji upsert `pdt_sku_master`. */
function shopeeParentSkuBerkasMulti(nama: string, baris: readonly [string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_PARENT_SKU,
    ...baris.map(([kodeProduk, kodeVariasi, skuInduk]) => [kodeProduk, kodeVariasi, skuInduk, '0', '0', '0', '0', '0%', '0%', '0']),
  ];
  return {
    nama, sha256: 'sha-parentsku-multi', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'],
  };
}

const HEADER_TT_ORDERS = [
  'Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity',
  'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Status', 'Paid Time',
  'Product Category', 'Creator Handle',
];

/** `tt_orders` (Semua Pesanan) — tidak membawa 'ID Kreator'/periode sendiri (Rule 5 ayat 2: mewarisi dari berkas lain di batch yang sama, sama pola `ttOrdersBerkas` dipasangkan dengan `ttVideoBerkasLengkap` di tes di bawah). */
function ttOrdersBerkas(nama: string, baris: readonly [string, string, string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_TT_ORDERS,
    ...baris.map(([skuId, sellerSku, productName, variation, harga, kategori]) => [
      'ORD-1', skuId, sellerSku, productName, variation, '1', harga, harga, 'Completed', '01/07/2026', kategori, 'KR-1',
    ]),
  ];
  return {
    nama, sha256: 'sha-ttorders', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_orders', ambiguous: false, matches: ['tt_orders'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KETIGA) — shopee_parent_sku → pdt_sku_master', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per (Kode Produk, Kode Variasi), status_listing aktif, nama_produk/kategori/harga NULL (tidak ada di whitelist modul ini)', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'), // identitas+periode
      shopeeParentSkuBerkasMulti('parent-sku.xlsx', [
        ['P1', 'V1', 'SKU1'],
        ['P1', 'V2', 'SKU2'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadSkuMaster(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform_product_id: 'P1', platform_variation_id: 'V1', seller_sku: 'SKU1',
      nama_produk: null, nama_variasi: null, kategori_platform: null, harga_satuan_terakhir: null,
      status_listing: 'aktif',
    });
    expect(rows[1].platform_variation_id).toBe('V2');
  });

  it('commit ULANG (SKU sama) ⇒ UPSERT di tempat (last_seen_at maju), bukan baris baru', async () => {
    const cpId = await fixture();
    const t1 = new Date('2026-07-01T00:00:00Z');
    const t2 = new Date('2026-07-15T00:00:00Z');
    const pertama = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeParentSkuBerkasMulti('parent-sku.xlsx', [['P1', 'V1', 'SKU-LAMA']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, [], t1);
    const setelahPertama = await loadSkuMaster(cpId);
    expect(setelahPertama).toHaveLength(1);
    const firstSeenAsli = setelahPertama[0].first_seen_at;

    const kedua = [
      shopeeAdsCpcBerkas('ads-2.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeParentSkuBerkasMulti('parent-sku-2.xlsx', [['P1', 'V1', 'SKU-BARU']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, kedua, [], t2);
    const rows = await loadSkuMaster(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — UPSERT, bukan baris baru
    expect(rows[0].seller_sku).toBe('SKU-BARU'); // nilai TERBARU menang
    expect(new Date(rows[0].first_seen_at).getTime()).toBe(new Date(firstSeenAsli).getTime()); // first_seen_at TIDAK berubah
    expect(new Date(rows[0].last_seen_at).getTime()).toBe(t2.getTime()); // last_seen_at maju
  });

  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ NOL baris pdt_sku_master ditulis", async () => {
    const cpId = await fixture('SHOP-LAIN');
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeParentSkuBerkasMulti('parent-sku.xlsx', [['P1', 'V1', 'SKU1']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadSkuMaster(cpId)).toHaveLength(0);
  });
});

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KETIGA) — tt_orders → pdt_sku_master', () => {
  async function fixture(akunKontenToko: readonly string[] | null): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'TikTok Shop', null, akunKontenToko);
  }

  it('satu baris per SKU ID, mengisi seller_sku/nama_produk/nama_variasi/kategori_platform/harga sekaligus dari SATU berkas (platform_variation_id selalu string kosong)', async () => {
    const cpId = await fixture(['KR-1']);
    const berkas = [
      ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]), // identitas+periode
      ttOrdersBerkas('orders.xlsx', [
        ['SKU-1', 'SLR-1', 'Kaos Polos', 'Merah / L', '50.000', 'Fashion Pria'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadSkuMaster(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform_product_id: 'SKU-1', platform_variation_id: '', seller_sku: 'SLR-1',
      nama_produk: 'Kaos Polos', nama_variasi: 'Merah / L', kategori_platform: 'Fashion Pria',
      status_listing: 'aktif',
    });
    expect(Number(rows[0].harga_satuan_terakhir)).toBe(50000);
  });

  it('dua baris pesanan, SKU sama ⇒ dedup jadi SATU baris master (bukan satu per baris pesanan)', async () => {
    const cpId = await fixture(['KR-1']);
    const berkas = [
      ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]),
      ttOrdersBerkas('orders.xlsx', [
        ['SKU-1', 'SLR-1', 'Kaos Polos', 'Merah / L', '50.000', 'Fashion Pria'],
        ['SKU-1', 'SLR-1', 'Kaos Polos', 'Merah / L', '50.000', 'Fashion Pria'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(await loadSkuMaster(cpId)).toHaveLength(1);
  });

  it("identitas 'tolak' (ID Kreator tidak terdaftar) ⇒ NOL baris pdt_sku_master ditulis", async () => {
    const cpId = await fixture(['KR-LAIN']);
    const berkas = [
      ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]),
      ttOrdersBerkas('orders.xlsx', [['SKU-1', 'SLR-1', 'Kaos Polos', 'Merah / L', '50.000', 'Fashion Pria']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadSkuMaster(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEEMPAT) — tt_transaction_creator
// → pdt_fact_creator_period (lihat fakta.ts @cdps/core untuk kenapa modul ini —
// grain barisnya SUDAH per-kreator, nol ambiguitas kelas shopee_ads_cpc).
// ---------------------------------------------------------------------------
interface FactCreatorPeriodRow {
  creator_handle: string;
  periode: string | Date;
  batch_id: number;
  parser_versi: number;
  gmv: string | null;
  gmv_live: string | null;
  gmv_video: string | null;
  pesanan_teratribusi: number | null;
  aov: string | null;
  ctor: string | null;
  jumlah_live: number | null;
  jumlah_video: number | null;
  sampel_terkirim: number | null;
}

async function loadFactCreatorPeriod(clientPlatformId: number): Promise<FactCreatorPeriodRow[]> {
  return sql<FactCreatorPeriodRow[]>`select * from pdt_fact_creator_period where client_platform_id = ${clientPlatformId} order by creator_handle`;
}

const HEADER_TT_TRANSACTION_CREATOR = ['Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan komisi'];

/** `tt_transaction_creator` — tidak membawa 'ID Kreator'/periode sendiri (Rule 5 ayat 2: mewarisi dari berkas lain di batch yang sama, sama pola `ttOrdersBerkas`). */
function ttTransactionCreatorBerkas(nama: string, baris: readonly [string, string, string, string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_TT_TRANSACTION_CREATOR,
    ...baris.map(([namaKreator, gmv, aov, ctor, pesanan, video, live]) => [namaKreator, gmv, aov, ctor, pesanan, '0', video, live, '0']),
  ];
  return {
    nama, sha256: 'sha-ttcreator', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_transaction_creator', ambiguous: false, matches: ['tt_transaction_creator'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEEMPAT) — tt_transaction_creator → pdt_fact_creator_period', () => {
  async function fixture(akunKontenToko: readonly string[] | null): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'TikTok Shop', null, akunKontenToko);
  }

  it('satu baris per Creator name, periode = AWAL BULAN (Q-3), gmv_live/gmv_video/sampel_terkirim NULL (modul ini tidak membawanya)', async () => {
    const cpId = await fixture(['KR-1']);
    const berkas = [
      ttVideoBerkasLengkap('video.xlsx', '05/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]), // identitas+periode
      ttTransactionCreatorBerkas('creator.xlsx', [
        ['Kreator A', '2000000', '150000', '5%', '10', '3', '2'],
        ['Kreator B', '500000', '50000', '2%', '5', '1', '1'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactCreatorPeriod(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      creator_handle: 'Kreator A', batch_id: persiapan.batchId, parser_versi: 1,
      pesanan_teratribusi: 10, jumlah_live: 2, jumlah_video: 3,
      gmv_live: null, gmv_video: null, sampel_terkirim: null,
    });
    expect(ymd(rows[0].periode)).toBe('2026-07-01'); // hari pertama BULAN, bukan 05/07 apa adanya
    expect(Number(rows[0].gmv)).toBe(2000000);
    expect(Number(rows[0].aov)).toBe(150000);
    expect(Number(rows[0].ctor)).toBeCloseTo(0.05, 5);
    expect(rows[1].creator_handle).toBe('Kreator B');
  });

  it('commit ULANG (Creator name sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const cpId = await fixture(['KR-1']);
    const pertama = [
      ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]),
      ttTransactionCreatorBerkas('creator.xlsx', [['Kreator A', '1000000', '0', '0', '5', '0', '1']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactCreatorPeriod(cpId)).toHaveLength(1);

    const kedua = [
      ttVideoBerkasLengkap('video-2.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V2', '100', '10', '1', '5', '200000']]),
      ttTransactionCreatorBerkas('creator-revisi.xlsx', [['Kreator A', '1500000', '0', '0', '8', '0', '2']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactCreatorPeriod(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].gmv)).toBe(1500000);
    expect(rows[0].pesanan_teratribusi).toBe(8);
  });

  it("identitas 'tolak' (ID Kreator video tidak terdaftar di akun_konten_toko) ⇒ NOL baris fakta ditulis", async () => {
    const cpId = await fixture(['KR-LAIN']);
    const berkas = [
      ttVideoBerkasLengkap('video.xlsx', '01/07/2026 - 31/07/2026', [['KR-1', 'V1', '100', '10', '1', '5', '200000']]),
      ttTransactionCreatorBerkas('creator.xlsx', [['Kreator A', '1000000', '0', '0', '5', '0', '1']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactCreatorPeriod(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KELIMA) — shopee_ams_afiliasi
// → pdt_fact_creator_period (sisi Shopee, lihat fakta.ts @cdps/core untuk kenapa
// shopee_ams_produk saudaranya TIDAK dipetakan KE SINI — grain per PRODUK, bukan
// per-kreator — sampai `pdt_fact_sku_period` di bawah, modul KEDELAPAN sesi 23).
// ---------------------------------------------------------------------------
const HEADER_SHOPEE_AMS_AFILIASI = ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'];

/** `shopee_ams_afiliasi` — tidak membawa preamble/periode sendiri (sama pola `shopeeParentSkuBerkasMulti`, dipasangkan dengan `shopeeAdsCpcBerkas` di tes di bawah). */
function shopeeAmsAfiliasiBerkas(nama: string, baris: readonly [string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_SHOPEE_AMS_AFILIASI,
    ...baris.map(([username, omzet, pesanan]) => ['AFF-X', username, omzet, '0', pesanan, '0', '0']),
  ];
  return {
    nama, sha256: 'sha-amsafiliasi', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_ams_afiliasi', ambiguous: false, matches: ['shopee_ams_afiliasi'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KELIMA) — shopee_ams_afiliasi → pdt_fact_creator_period', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per Username, gmv/pesanan_teratribusi terisi, sisanya NULL (modul ini tidak membawanya)', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'), // identitas+periode
      shopeeAmsAfiliasiBerkas('ams-afiliasi.xlsx', [
        ['kreator_a', '2000000', '10'],
        ['kreator_b', '500000', '5'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactCreatorPeriod(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      creator_handle: 'kreator_a', batch_id: persiapan.batchId,
      pesanan_teratribusi: 10, gmv_live: null, gmv_video: null, aov: null, ctor: null, jumlah_live: null, jumlah_video: null, sampel_terkirim: null,
    });
    expect(Number(rows[0].gmv)).toBe(2000000);
    expect(rows[1].creator_handle).toBe('kreator_b');
  });

  it('commit ULANG (Username sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const cpId = await fixture();
    const pertama = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsAfiliasiBerkas('ams-afiliasi.xlsx', [['kreator_a', '1000000', '5']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactCreatorPeriod(cpId)).toHaveLength(1);

    const kedua = [
      shopeeAdsCpcBerkas('ads-2.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsAfiliasiBerkas('ams-afiliasi-revisi.xlsx', [['kreator_a', '1500000', '8']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactCreatorPeriod(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].gmv)).toBe(1500000);
    expect(rows[0].pesanan_teratribusi).toBe(8);
  });

  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ NOL baris fakta ditulis", async () => {
    const cpId = await fixture('SHOP-LAIN');
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsAfiliasiBerkas('ams-afiliasi.xlsx', [['kreator_a', '1000000', '5']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactCreatorPeriod(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEDELAPAN, sesi 23) —
// shopee_ams_produk → pdt_fact_sku_period. `G1-09-2BII-ADS-CPC-SKU` DITUTUP
// sesi ini membuka blocker `sku_id NOT NULL` yang menahan modul ini sejak
// lahir (HANDOFF_PDT_SESI21.md §1: "BLOCKED TOTAL") — lihat fakta.ts
// @cdps/core `ekstrakBarisShopeeAmsProduk` untuk kenapa `basis = 'dibayar'`
// literal (keputusan pemilik, bukan diturunkan dari kolom apa pun).
// ---------------------------------------------------------------------------
interface FactSkuPeriodRow {
  sku_id: number | null;
  client_platform_id: number;
  platform_product_id: string | null;
  periode: string | Date;
  basis: string;
  batch_id: number;
  parser_versi: number;
  gmv: string | null;
  produk_terjual: number | null;
  pesanan: number | null;
}

async function loadFactSkuPeriod(clientPlatformId: number): Promise<FactSkuPeriodRow[]> {
  return sql<
    FactSkuPeriodRow[]
  >`select * from pdt_fact_sku_period where client_platform_id = ${clientPlatformId} order by platform_product_id`;
}

const HEADER_SHOPEE_AMS_PRODUK = ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'];

/** `shopee_ams_produk` — tidak membawa preamble/periode sendiri (sama pola `shopeeAmsAfiliasiBerkas`, dipasangkan dengan `shopeeAdsCpcBerkas` di tes di bawah). */
function shopeeAmsProdukBerkas(nama: string, baris: readonly [string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_SHOPEE_AMS_PRODUK,
    ...baris.map(([kodeItem, namaItem, omzet, pesanan]) => [kodeItem, namaItem, omzet, '0', pesanan, '0', '0']),
  ];
  return {
    nama, sha256: 'sha-amsproduk', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_ams_produk', ambiguous: false, matches: ['shopee_ams_produk'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KEDELAPAN) — shopee_ams_produk → pdt_fact_sku_period', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per Kode Item, sku_id NULL, platform_product_id terisi, basis="dibayar"', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'), // identitas+periode
      shopeeAmsProdukBerkas('ams-produk.csv', [
        ['22571212550', 'Cover Body Vario 125', '54587884', '95'],
        ['PRD-2', 'Produk B', '1000000', '10'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactSkuPeriod(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sku_id: null, client_platform_id: cpId, platform_product_id: '22571212550', basis: 'dibayar',
      batch_id: persiapan.batchId, parser_versi: 1, produk_terjual: 0, pesanan: 95,
    });
    expect(Number(rows[0].gmv)).toBe(54587884);
    expect(rows[1].platform_product_id).toBe('PRD-2');
  });

  it('commit ULANG periode yang sama ⇒ baris LAMA diganti (replace-on-recommit) — produk yang hilang dari batch baru IKUT terhapus', async () => {
    const cpId = await fixture();
    const pertama = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsProdukBerkas('ams-produk.csv', [
        ['PRD-1', 'Produk A', '1000000', '5'],
        ['PRD-2', 'Produk B', '500000', '3'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactSkuPeriod(cpId)).toHaveLength(2);

    const kedua = [
      shopeeAdsCpcBerkas('ads-2.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsProdukBerkas('ams-produk-revisi.csv', [['PRD-1', 'Produk A', '1500000', '8']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactSkuPeriod(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — PRD-2 hilang dari batch baru, ikut terhapus
    expect(rows[0].platform_product_id).toBe('PRD-1');
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].gmv)).toBe(1500000);
  });

  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ NOL baris fakta ditulis (shopee_ams_produk)", async () => {
    const cpId = await fixture('SHOP-LAIN');
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeAmsProdukBerkas('ams-produk.csv', [['PRD-1', 'Produk A', '1000000', '5']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactSkuPeriod(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KESEMBILAN, sesi 24) —
// shopee_live → pdt_fact_content. `G1-09-2BII-SHOPEELIVE` DITUTUP sesi ini —
// lihat fakta.ts @cdps/core `ekstrakBarisShopeeLive` untuk kenapa identitas
// dari `Waktu Mulai` (digit mentah), bukan `Informasi Streaming`.
// ---------------------------------------------------------------------------
const HEADER_SHOPEE_LIVE = ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan (Pesanan Siap Dikirim)(Rp)'];

/** `shopee_live` — tidak membawa preamble/periode sendiri (sama pola `shopeeAmsAfiliasiBerkas`, dipasangkan dengan `shopeeAdsCpcBerkas` di tes di bawah). */
function shopeeLiveBerkas(nama: string, baris: readonly [string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [HEADER_SHOPEE_LIVE, ...baris];
  return {
    nama, sha256: 'sha-live', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'shopee_live', ambiguous: false, matches: ['shopee_live'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KESEMBILAN) — shopee_live → pdt_fact_content', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', shopId);
  }

  it('satu baris per sesi live, platform_content_id dari digit Waktu Mulai, jenis=live, is_akun_toko TRUE, sku_id/creator NULL', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'), // identitas+periode
      shopeeLiveBerkas('live.xlsx', [
        ['jual berbagai body motor', '03-07-2026 15:21', '1.234', '5.000.000'],
        ['sesi sore', '03-07-2026 20:00', '500', '2.000.000'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform_content_id: '202607031521', jenis: 'live', batch_id: persiapan.batchId, parser_versi: 1,
      creator_platform_id: null, creator_handle: null, is_akun_toko: true, sku_id: null, vv: 1234,
    });
    expect(rows[0].waktu_posting).not.toBeNull();
    expect(Number(rows[0].gmv)).toBe(5000000);
    expect(rows[1].platform_content_id).toBe('202607032000');
  });

  it('judul BERULANG (Informasi Streaming sama, Waktu Mulai beda) tetap dua baris terpisah', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkas('live.xlsx', [
        ['jual berbagai body motor', '03-07-2026 15:21', '100', '0'],
        ['jual berbagai body motor', '04-07-2026 11:11', '200', '0'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactContent(cpId);
    expect(rows.map((r) => r.platform_content_id)).toEqual(['202607031521', '202607041111']);
  });

  it('commit ULANG (Waktu Mulai sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const cpId = await fixture();
    const pertama = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkas('live.xlsx', [['Judul Lama', '03-07-2026 15:21', '100', '1.000.000']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactContent(cpId)).toHaveLength(1);

    const kedua = [
      shopeeAdsCpcBerkas('ads-2.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkas('live-revisi.xlsx', [['Judul Baru', '03-07-2026 15:21', '150', '1.500.000']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(rows[0].vv).toBe(150);
    expect(Number(rows[0].gmv)).toBe(1500000);
  });

  it('baris "Waktu Mulai" tidak valid dilewati — nol baris fakta untuk baris itu', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkas('live.xlsx', [['Judul', 'bukan tanggal', '0', '0']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(await loadFactContent(cpId)).toHaveLength(0);
  });

  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ NOL baris fakta ditulis (shopee_live)", async () => {
    const cpId = await fixture('SHOP-LAIN');
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkas('live.xlsx', [['Judul', '03-07-2026 15:21', '100', '0']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(await loadFactContent(cpId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// G1-09-SHEET-BUKAN-PERTAMA — override AM ke modul ber-`namaSheet` HARUS
// membaca sheet YANG DIMINTA modul itu (`input.sheets`), bukan `input.aoa`
// yang sudah kadung dipilih deteksi OTOMATIS (biasanya sheet pertama/salah).
// Cermin persis bug asli: workbook multi-sheet, deteksi otomatis gagal total
// (aoa = sheet pertama, sheet ringkasan tidak relevan) — AM memilih manual
// `shopee_live` dari dropdown `moduleOptions`, dan hasilnya HARUS berasal
// dari isi sheet "Daftar Streaming" yang sesungguhnya, bukan sheet ringkasan.
// ---------------------------------------------------------------------------
function shopeeLiveBerkasOverrideMultiSheet(
  nama: string,
  baris: readonly [string, string, string, string][],
): PdtPreviewBerkasInput {
  const aoaSheetRingkasan: unknown[][] = [['Ringkasan agregat — bukan Daftar Streaming, struktur beda total']];
  const aoaDaftarStreaming: unknown[][] = [HEADER_SHOPEE_LIVE, ...baris];
  return {
    nama, sha256: 'sha-live-multisheet', bytes: 100, ditolakPagar: null, decodeGagal: null,
    // Deteksi OTOMATIS gagal total (aoa = sheet ringkasan, matches kosong) —
    // sengaja meniru bug asli: pipeline lama SELALU membaca sheet pertama.
    aoa: aoaSheetRingkasan, modulTerdeteksi: null, ambiguous: false, matches: [],
    sheets: new Map([
      ['Tinjauan', aoaSheetRingkasan],
      ['Daftar Streaming', aoaDaftarStreaming],
    ]),
  };
}

describeDb('commitUploadBatch — override AM ke modul ber-namaSheet MEMBACA sheet yang benar (G1-09-SHEET-BUKAN-PERTAMA)', () => {
  it('override ke shopee_live pada berkas yang deteksi otomatisnya gagal ⇒ fakta ditulis dari sheet "Daftar Streaming", BUKAN dari aoa sheet pertama', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', '938284780');
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeLiveBerkasOverrideMultiSheet('live.xlsx', [['Live Juli', '03-07-2026 15:21', '1.234', '5.000.000']]),
    ];
    const overrides: PdtCommitOverride[] = [{ nama: 'live.xlsx', modulKode: 'shopee_live' }];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, overrides);

    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform_content_id: '202607031521', jenis: 'live', batch_id: persiapan.batchId, vv: 1234 });
    expect(Number(rows[0].gmv)).toBe(5000000);
  });
});

// ---------------------------------------------------------------------------
// G1-10 — job purge harian (`planPdtPurgeTick`/`finalizePdtPurgeTick`, Flow E
// Rule 45-49). DB nyata (di-skip tanpa DATABASE_URL) — menulis
// `pdt_upload_batch` LANGSUNG (bukan lewat `commitUploadBatch`): tick hanya
// peduli kolom retensi/legal_hold/raw_*, bukan pipeline parse. Bergantung
// pada `fileParallelism: false` (vitest.config.ts) + `afterEach` global di
// atas: tabel `pdt_upload_batch` kosong di awal SETIAP `it()` di sini (baris
// test sebelumnya, dalam file ini maupun file lain, sudah dibersihkan),
// jadi `totalObjekAktif` yang dibaca pagar 5% deterministik — murni dari
// baris yang di-insert test itu sendiri.
// ---------------------------------------------------------------------------
describeDb('planPdtPurgeTick / finalizePdtPurgeTick (G1-10 — Flow E, Rule 45-49)', () => {
  const PURGE_DIRECTOR = 'ZPDT-PURGE-DIR';
  let periodeSeq = 0;

  beforeAll(async () => {
    if (!sql) return;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${PURGE_DIRECTOR}, 'Direktur Uji Purge PDT', 'zpdt-purge-dir@mea.co.id', 'Account', 'Direktur', true, 'SYSTEM')
      on conflict (employee_id) do nothing`;
    await sql`
      insert into employee_layered_roles (employee_id, role, enabled, created_by)
      values (${PURGE_DIRECTOR}, 'director', true, 'SYSTEM')
      on conflict (employee_id, role) do update set enabled = true`;
  });

  afterAll(async () => {
    if (!sql) return;
    // `notifications` SENGAJA tidak dibersihkan — append-only (trigger menolak DELETE
    // juga, bukan cuma UPDATE, sama pola `audit_log` di afterEach global atas berkas ini).
    await sql`delete from employee_layered_roles where employee_id = ${PURGE_DIRECTOR}`;
    await sql`delete from employees where employee_id = ${PURGE_DIRECTOR}`;
  });

  /** Klien + toko baru — prefix `CLI-ZPDT-`/`ZZ-TEST`, dibersihkan `afterEach` global di atas. */
  async function purgeFixture(): Promise<{ clientId: string; cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    return { clientId, cpId };
  }

  /**
   * Insert `pdt_upload_batch` LANGSUNG, periode di-increment per panggilan
   * (`periodeSeq`) supaya banyak baris untuk `cpId` yang SAMA tidak pernah
   * bentrok `uq_pdt_upload_batch_verified` — status di sini sengaja `'parsing'`
   * (eligibilitas purge Flow E langkah 1 tidak melihat status sama sekali).
   */
  async function insertBatch(
    cpId: number,
    clientId: string,
    opts: { retensiSampai: string; legalHold?: boolean; rawDihapusPada?: Date | null; rawBytes?: number },
  ): Promise<number> {
    const bulan = 1 + (periodeSeq++ % 12);
    const periodeMulai = `2020-${String(bulan).padStart(2, '0')}-01`;
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
         parser_versi, retensi_sampai, retensi_alasan, raw_path, raw_bytes, legal_hold,
         raw_dihapus_pada, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', ${periodeMulai}::date, (${periodeMulai}::date + interval '1 month' - interval '1 day')::date,
         'parsing', 1, ${opts.retensiSampai}::date, 'default', ${`ZPDT-PURGE/${cpId}/${periodeSeq}.zip`},
         ${opts.rawBytes ?? 1000}, ${opts.legalHold ?? false}, ${opts.rawDihapusPada ?? null}, ${OWNER_AM})
      returning id`;
    return rows[0].id;
  }

  it('memilih batch retensi_sampai lewat + legal_hold=false + belum dihapus — melewati sisanya', async () => {
    const { clientId, cpId } = await purgeFixture();
    // 19 objek "aman" (retensi belum lewat) supaya totalObjekAktif cukup besar (20) — pada
    // total kecil, ambang 5% pembulatan-ke-bawah bisa jadi 0 dan memicu pagar (Rule 48) untuk
    // SATU kandidat pun; bukan itu yang diuji baris ini (pagarnya sendiri diuji terpisah).
    for (let i = 0; i < 19; i++) {
      await insertBatch(cpId, clientId, { retensiSampai: '2999-01-01' });
    }
    const lewat = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01' });
    await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01', legalHold: true }); // legal hold
    await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01', rawDihapusPada: new Date() }); // sudah dihapus

    const rencana = await planPdtPurgeTick(sql, '2026-06-01');
    expect(rencana.pagarTerlampaui).toBe(false);
    expect(rencana.kandidat.map((k) => k.batchId)).toEqual([lewat]);
  });

  it('pagar 5%/hari (Rule 48): kandidat > ambang ⇒ dikosongkan + notifikasi Director, nol batch tersentuh', async () => {
    const { clientId, cpId } = await purgeFixture();
    // 20 objek aktif total, ambang = floor(20*5/100) = 1 — DUA kandidat melebihi ambang.
    for (let i = 0; i < 18; i++) {
      await insertBatch(cpId, clientId, { retensiSampai: '2999-01-01' });
    }
    const kandidat1 = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01' });
    const kandidat2 = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01' });

    const rencana = await planPdtPurgeTick(sql, '2026-06-01');
    expect(rencana.totalObjekAktif).toBe(20);
    expect(rencana.ambangObjek).toBe(1);
    expect(rencana.pagarTerlampaui).toBe(true);
    expect(rencana.kandidat).toEqual([]);

    const notif = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where event_type = 'pdt.purge.guard_exceeded' and entity_id = '2026-06-01'`;
    expect(notif.map((n) => n.recipient_employee_id)).toContain(PURGE_DIRECTOR);

    // Route memanggil finalize dengan hasil KOSONG karena kandidat kosong — nol batch tersentuh.
    const rekap = await finalizePdtPurgeTick(sql, '2026-06-01', []);
    expect(rekap).toMatchObject({ dihapus: 0, gagal: 0, bytesDihapus: 0 });
    const masihAda = await sql<{ id: number }[]>`
      select id from pdt_upload_batch where id in (${kandidat1}, ${kandidat2}) and raw_dihapus_pada is null`;
    expect(masihAda).toHaveLength(2);
  });

  it('TIDAK memicu pagar tepat DI ambang (kandidat == ambang, bukan >)', async () => {
    const { clientId, cpId } = await purgeFixture();
    // 20 objek, ambang 1: SATU kandidat pas di ambang ⇒ tidak memicu pagar (Rule 48 "lebih dari 5%").
    for (let i = 0; i < 19; i++) {
      await insertBatch(cpId, clientId, { retensiSampai: '2999-01-01' });
    }
    const satuSatunya = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01' });

    const rencana = await planPdtPurgeTick(sql, '2026-06-01');
    expect(rencana.pagarTerlampaui).toBe(false);
    expect(rencana.kandidat.map((k) => k.batchId)).toEqual([satuSatunya]);
  });

  it('finalizePdtPurgeTick: hanya batch berhasil yang raw_dihapus_pada terisi — gagal tetap NULL untuk dicoba lagi (Rule 46)', async () => {
    const { clientId, cpId } = await purgeFixture();
    const berhasil = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01', rawBytes: 1000 });
    const gagal = await insertBatch(cpId, clientId, { retensiSampai: '2020-01-01', rawBytes: 2000 });

    const rekap = await finalizePdtPurgeTick(sql, '2026-06-02', [
      { batchId: berhasil, bytes: 1000, berhasil: true },
      { batchId: gagal, bytes: 2000, berhasil: false },
    ]);
    expect(rekap).toMatchObject({ dihapus: 1, gagal: 1, bytesDihapus: 1000 });

    const rows = await sql<{ id: number; raw_dihapus_pada: Date | null }[]>`
      select id, raw_dihapus_pada from pdt_upload_batch where id in (${berhasil}, ${gagal}) order by id`;
    expect(rows.find((r) => r.id === berhasil)?.raw_dihapus_pada).not.toBeNull();
    expect(rows.find((r) => r.id === gagal)?.raw_dihapus_pada).toBeNull();

    // Rule 47 — SATU entri audit_log per tick (bukan per objek), merekap jumlah + total byte.
    const audit = await sql<{ after_json: { jumlah_objek: number; total_bytes: number; batch_ids: number[] } }[]>`
      select after_json from audit_log
       where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-02' and action = 'pdt_raw_purged'
       order by id desc limit 1`;
    expect(audit[0]?.after_json).toMatchObject({ jumlah_objek: 1, total_bytes: 1000, batch_ids: [berhasil] });
  });

  it('finalizePdtPurgeTick dengan hasil kosong menulis NOL entri audit_log', async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-03'`;
    const rekap = await finalizePdtPurgeTick(sql, '2026-06-03', []);
    expect(rekap).toMatchObject({ dihapus: 0, gagal: 0, bytesDihapus: 0 });
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-03'`;
    expect(after[0].n).toBe(before[0].n);
  });

  it('planPdtPurgeTick menolak format tanggal tidak valid', async () => {
    await expect(planPdtPurgeTick(sql, '01-06-2026')).rejects.toThrow('[tanggal tick tidak valid]');
  });
});

// ---------------------------------------------------------------------------
// G1-10-ORPHAN-PASS — pass kedua Flow E (Rule 49, objek yatim > 7 hari).
// `planPdtOrphanPurgeTick` menerima daftar objek storage sebagai PARAMETER
// (fungsi murni baca DB + bandingkan, nol panggilan Storage — listing
// sungguhan `listPdtRawObjekRekursif` ada di `apps/api`, diuji terpisah di
// sana lewat fetch disuntik).
// ---------------------------------------------------------------------------
describeDb('planPdtOrphanPurgeTick / finalizePdtOrphanPurgeTick (G1-10 pass kedua — Rule 49)', () => {
  async function orphanFixture(): Promise<{ clientId: string; cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    return { clientId, cpId };
  }

  it('objek yang path-nya TIDAK dikenal pdt_upload_batch DAN umurnya > 7 hari ⇒ kandidat', async () => {
    const rencana = await planPdtOrphanPurgeTick(sql, '2026-06-10', [
      { path: '_staging/tak-dikenal/lama.zip', createdAt: '2026-06-01T00:00:00Z' }, // 9 hari
    ]);
    expect(rencana.kandidat).toEqual([{ path: '_staging/tak-dikenal/lama.zip' }]);
  });

  it('objek yang path-nya DIKENAL (ada baris pdt_upload_batch, walau sudah dihapus) TIDAK pernah kandidat', async () => {
    const { clientId, cpId } = await orphanFixture();
    const rawPath = `ZPDT-ORPHAN/${cpId}.zip`;
    await sql`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
         parser_versi, retensi_sampai, retensi_alasan, raw_path, raw_bytes, legal_hold,
         raw_dihapus_pada, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2020-01-01'::date, '2020-01-31'::date, 'parsing',
         1, '2020-01-01'::date, 'default', ${rawPath}, 1000, false, ${new Date('2020-01-01')}, ${OWNER_AM})`;

    const rencana = await planPdtOrphanPurgeTick(sql, '2026-06-10', [
      { path: rawPath, createdAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(rencana.kandidat).toEqual([]);
  });

  it('umur < 7 hari ⇒ belum jadi kandidat', async () => {
    const rencana = await planPdtOrphanPurgeTick(sql, '2026-06-10', [
      { path: '_staging/tak-dikenal/baru.zip', createdAt: '2026-06-05T00:00:00Z' }, // 5 hari
    ]);
    expect(rencana.kandidat).toEqual([]);
  });

  it('umur == tepat 7 hari ⇒ belum jadi kandidat (Rule 49 "setelah 7 hari", bukan "pada")', async () => {
    const rencana = await planPdtOrphanPurgeTick(sql, '2026-06-10', [
      { path: '_staging/tak-dikenal/pas.zip', createdAt: '2026-06-03T00:00:00Z' }, // pas 7×24 jam
    ]);
    expect(rencana.kandidat).toEqual([]);
  });

  it('createdAt tidak diketahui (null) ⇒ TIDAK PERNAH kandidat (pagar konservatif)', async () => {
    const rencana = await planPdtOrphanPurgeTick(sql, '2026-06-10', [
      { path: '_staging/tak-dikenal/entah.zip', createdAt: null },
    ]);
    expect(rencana.kandidat).toEqual([]);
  });

  it('planPdtOrphanPurgeTick menolak format tanggal tidak valid', async () => {
    await expect(planPdtOrphanPurgeTick(sql, '01-06-2026', [])).rejects.toThrow('[tanggal tick tidak valid]');
  });

  it('finalizePdtOrphanPurgeTick: SATU entri audit_log merekap paths yang berhasil, path gagal tidak masuk', async () => {
    const rekap = await finalizePdtOrphanPurgeTick(sql, '2026-06-11', [
      { path: '_staging/a/berhasil.zip', berhasil: true },
      { path: '_staging/a/gagal.zip', berhasil: false },
    ]);
    expect(rekap).toMatchObject({ dihapus: 1, gagal: 1 });

    const audit = await sql<{ after_json: { jumlah_objek: number; paths: string[] } }[]>`
      select after_json from audit_log
       where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-11' and action = 'pdt_raw_orphan_purged'
       order by id desc limit 1`;
    expect(audit[0]?.after_json).toMatchObject({ jumlah_objek: 1, paths: ['_staging/a/berhasil.zip'] });
  });

  it('finalizePdtOrphanPurgeTick dengan hasil kosong menulis NOL entri audit_log', async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-12'`;
    const rekap = await finalizePdtOrphanPurgeTick(sql, '2026-06-12', []);
    expect(rekap).toMatchObject({ dihapus: 0, gagal: 0 });
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_type = 'pdt_purge_tick' and entity_id = '2026-06-12'`;
    expect(after[0].n).toBe(before[0].n);
  });
});

// ---------------------------------------------------------------------------
// G1-11 — job reparse dari paket ZIP (Flow D). `reparsePdtBatch` menulis
// ULANG baris fakta batch yang SUDAH ADA (bukan membuat batch baru) — diuji
// lewat commit pertama (fixture "lama") lalu reparse dengan fixture "baru"
// (mensimulasikan parser yang sudah diperbaiki menghasilkan angka berbeda
// dari berkas ASLI yang sama), memverifikasi baris fakta BERUBAH dan
// `parser_versi` batch naik kembali ke `PDT_PARSER_VERSI` (setelah sengaja
// diturunkan manual — mensimulasikan batch "ketinggalan versi").
// ---------------------------------------------------------------------------
describeDb('reparsePdtBatch / planPdtReparseTick (G1-11 — Flow D)', () => {
  async function fixture(shopId: string | null = '938284780'): Promise<{ clientId: string; cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', shopId);
    return { clientId, cpId };
  }

  it('reparse menulis ULANG baris fakta dengan angka BARU dan menaikkan parser_versi batch + baris fakta — batch id, status TIDAK berubah', async () => {
    const { cpId } = await fixture();
    const lama = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A', 'PRD-1', '100', '10', '2', '2000000', '150000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [lama], []);

    // Simulasikan batch "ketinggalan versi" — parser_versi batch DAN baris fakta diturunkan
    // manual (di dunia nyata ini terjadi karena batch dikomit SEBELUM PDT_PARSER_VERSI naik).
    await sql`update pdt_upload_batch set parser_versi = 0 where id = ${persiapan.batchId}`;
    await sql`update pdt_fact_ads set parser_versi = 0 where batch_id = ${persiapan.batchId}`;

    const baru = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A', 'PRD-1', '100', '10', '2', '2500000', '175000'], // angka "diperbaiki"
    ]);
    const hasil = await reparsePdtBatch(sql, persiapan.batchId, [baru]);
    expect(hasil).toMatchObject({ batchId: persiapan.batchId, direparse: true, alasanDilewati: null });

    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — replace-on-recommit, bukan duplikat
    expect(Number(rows[0].gmv)).toBe(2500000);
    expect(Number(rows[0].biaya)).toBe(175000);
    expect(rows[0].parser_versi).toBe(1);
    expect(rows[0].batch_id).toBe(persiapan.batchId); // batch id SAMA — bukan batch baru

    const batchRow = await sql<{ parser_versi: number; status: string }[]>`
      select parser_versi, status from pdt_upload_batch where id = ${persiapan.batchId}`;
    expect(batchRow[0].parser_versi).toBe(1);
    expect(batchRow[0].status).toBe(persiapan.status); // status TIDAK disentuh reparse

    const audit = await sql<{ before_json: { parser_versi: number }; after_json: { parser_versi: number; jumlah_berkas_terparse: number } }[]>`
      select before_json, after_json from audit_log
       where entity_type = 'pdt_upload_batch' and entity_id = ${String(persiapan.batchId)} and action = 'pdt_reparse'
       order by id desc limit 1`;
    expect(audit[0]?.before_json).toMatchObject({ parser_versi: 0 });
    expect(audit[0]?.after_json).toMatchObject({ parser_versi: 1, jumlah_berkas_terparse: 1 });
  });

  it('AM override dari commit ASLI dipertahankan otomatis pada reparse (dibaca dari pdt_file, bukan parameter)', async () => {
    const { cpId } = await fixture();
    const berkasAmbigu: PdtPreviewBerkasInput = {
      nama: 'entri-ambigu.csv', sha256: 'sha-x', bytes: 100, ditolakPagar: null, decodeGagal: null,
      aoa: shopeeAdsCpcBerkasLengkap('x', '938284780', '01/07/2026 - 31/07/2026', [['Iklan A', 'PRD-1', '100', '10', '2', '2000000', '150000']]).aoa,
      sheets: null, modulTerdeteksi: null, ambiguous: true, matches: ['shopee_ads_cpc', 'shopee_ads_search'],
    };
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [berkasAmbigu], [{ nama: 'entri-ambigu.csv', modulKode: 'shopee_ads_cpc' }]);
    expect(await loadFactAds(cpId)).toHaveLength(1);

    await sql`update pdt_upload_batch set parser_versi = 0 where id = ${persiapan.batchId}`;

    // Reparse: berkas dikirim ULANG masih ambigu (modulTerdeteksi null) — TANPA override
    // eksplisit dari pemanggil. reparsePdtBatch membaca override 'entri-ambigu.csv' →
    // 'shopee_ads_cpc' dari pdt_file (deteksi_oleh='override_am') secara otomatis.
    const hasil = await reparsePdtBatch(sql, persiapan.batchId, [{ ...berkasAmbigu }]);
    expect(hasil.direparse).toBe(true);
    expect(await loadFactAds(cpId)).toHaveLength(1);
  });

  it('batch dengan paket sudah dipurge (raw_dihapus_pada terisi) TIDAK direparse — nol tulis, dilaporkan alasanDilewati', async () => {
    const { cpId } = await fixture();
    const lama = shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [
      ['Iklan A', 'PRD-1', '100', '10', '2', '2000000', '150000'],
    ]);
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, [lama], []);
    const purgedAt = new Date('2026-01-01T00:00:00Z');
    // ck_pdt_upload_batch_raw_purge — raw_dihapus_pada terisi mensyaratkan raw_path pernah ada.
    await sql`
      update pdt_upload_batch
         set parser_versi = 0, raw_path = 'CLI-1/1/2026-07-31/z.zip', raw_dihapus_pada = ${purgedAt}
       where id = ${persiapan.batchId}`;

    const hasil = await reparsePdtBatch(sql, persiapan.batchId, [lama]);
    expect(hasil).toMatchObject({ batchId: persiapan.batchId, direparse: false, alasanDilewati: 'paket_terpurge' });
    expect(hasil.rawDihapusPada).toBe(purgedAt.toISOString());

    const rows = await loadFactAds(cpId);
    expect(Number(rows[0].gmv)).toBe(2000000); // TIDAK berubah — nol tulis terjadi
    const batchRow = await sql<{ parser_versi: number }[]>`select parser_versi from pdt_upload_batch where id = ${persiapan.batchId}`;
    expect(batchRow[0].parser_versi).toBe(0); // TIDAK dinaikkan
  });

  it('batch tidak ditemukan ⇒ NotFoundError', async () => {
    await expect(reparsePdtBatch(sql, 999999999, [])).rejects.toThrow(NotFoundError);
  });

  it('planPdtReparseTick: memilih parser_versi < PDT_PARSER_VERSI + raw_path ada, memisah kandidat vs perlu_upload_ulang', async () => {
    const { cpId } = await fixture();

    const kandidatBatch = (await commitUploadBatch(sql, ownerActor(), cpId, [
      shopeeAdsCpcBerkasLengkap('ads-cpc.csv', '938284780', '01/07/2026 - 31/07/2026', [['Iklan A', 'PRD-1', '100', '10', '2', '2000000', '150000']]),
    ], [])).batchId;
    await sql`update pdt_upload_batch set parser_versi = 0, raw_path = 'CLI-1/1/2026-07-31/x.zip' where id = ${kandidatBatch}`;

    const purgedBatch = (await commitUploadBatch(sql, ownerActor(), cpId, [
      shopeeAdsCpcBerkasLengkap('ads-cpc2.csv', '938284780', '01/08/2026 - 31/08/2026', [['Iklan B', 'PRD-2', '1', '1', '1', '1', '1']]),
    ], [])).batchId;
    await sql`update pdt_upload_batch set parser_versi = 0, raw_path = 'CLI-1/1/2026-08-31/y.zip', raw_dihapus_pada = now() where id = ${purgedBatch}`;

    const takBerpaket = (await commitUploadBatch(sql, ownerActor(), cpId, [
      shopeeAdsCpcBerkasLengkap('ads-cpc3.csv', '938284780', '01/09/2026 - 30/09/2026', [['Iklan C', 'PRD-3', '1', '1', '1', '1', '1']]),
    ], [])).batchId;
    await sql`update pdt_upload_batch set parser_versi = 0 where id = ${takBerpaket}`; // raw_path tetap NULL (belum markRawStored)

    const rencana = await planPdtReparseTick(sql);
    expect(rencana.kandidat.map((k) => k.batchId)).toContain(kandidatBatch);
    expect(rencana.kandidat.map((k) => k.batchId)).not.toContain(purgedBatch);
    expect(rencana.kandidat.map((k) => k.batchId)).not.toContain(takBerpaket);
    expect(rencana.perluUploadUlang.map((s) => s.batchId)).toContain(purgedBatch);
    expect(rencana.perluUploadUlang.map((s) => s.batchId)).not.toContain(kandidatBatch);
  });
});
