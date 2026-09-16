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
import { pdt as pdtCore, permission, tz } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';

/** `date` datang dari driver sebagai string ATAU Date tergantung konfigurasi — pola sama `dailyops.ts` `ymd()`. */
function ymd(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  bacaBenchmarkAktifTiktok,
  canKelolaBenchmark,
  canKirimLaporan,
  canUploadBatch,
  commitUploadBatch,
  finalizePdtOrphanPurgeTick,
  finalizePdtPurgeTick,
  hitungSkorShopee,
  hitungSkorTiktok,
  markRawStored,
  planPdtOrphanPurgeTick,
  planPdtPurgeTick,
  planPdtReparseTick,
  platformKeVokabPdt,
  bacaLaporanPdt,
  kirimLaporanPdt,
  riwayatKirimanPdt,
  previewUploadBatch,
  rakitInputSkorShopee,
  rakitInputSkorTiktok,
  rakitLaporanShopee,
  rakitLaporanTiktok,
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
  // pdt_fact_shop_daily (sesi 34, riset G2-01, tt_shop_analytics) — sama alasan (FK ke
  // pdt_upload_batch TANPA ON DELETE CASCADE).
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
  // pdt_laporan_kiriman (kirimLaporanPdt, Flow B langkah 4) — FK ke client_platforms TANPA
  // ON DELETE CASCADE, sama alasan baris-baris di atas.
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where created_by like 'ZZ-%')`;
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
 * Sama seperti `ttVideoBerkas`, + PREAMBLE `'Rentang Tanggal: ...'` (Rule 5,
 * `ekstrakPeriodePreambleTiktok` — DITUTUP via sample asli "Tiktok -
 * Avitaskin.zip", `docs/DECISIONS.md` G1-06-PERIODE-TIKTOK) — `tt_video`
 * sendiri tidak membawa periode (`ttVideoBerkas` polos cukup untuk tes
 * identitas/status berkas yang tidak menyentuh commit, yang MEWAJIBKAN
 * periode batch sah).
 */
function ttVideoBerkasDenganPeriode(nama: string, idKreator: string, rentang: string): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [`Rentang Tanggal: ${rentang}`], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

/**
 * `tt_video` LENGKAP untuk uji `pdt_fact_content` (G1-09 sub-langkah 2b-ii,
 * modul kedua) — parametrized per baris video, + PREAMBLE `'Rentang
 * Tanggal: ...'` (sama seperti `ttVideoBerkasDenganPeriode`, tt_video
 * sendiri tidak membawa periode) supaya `commitUploadBatch` (yang
 * MEWAJIBKAN periode sah) bisa dipanggil dengan HANYA berkas ini.
 */
function ttVideoBerkasLengkap(
  nama: string,
  rentang: string,
  baris: readonly [string, string, string, string, string, string, string][],
): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [`Rentang Tanggal: ${rentang}`], [],
    header,
    ...baris.map(([idKreator, idVideo, vv, likes, dibagikan, klikProduk, gmv]) => [idKreator, idVideo, '01/07/2026', 'Produk A', vv, likes, dibagikan, klikProduk, 'Kreator', 'info', '1000', gmv]),
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

/** Bentuk sheet basis asli `shopee_shop_stats` (mis. 'Pesanan Siap Dikirim'): header + ringkasan periode penuh + baris kosong + header berulang + baris harian — sama pola `shopStatsBasisAoa` (`@cdps/core` `fakta.test.ts`). */
function shopStatsBasisAoaDomain(gmvTotal: number, pesananTotal: number, dailyRows: readonly (readonly string[])[]): (readonly unknown[])[] {
  const header = [
    'Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
    'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
    'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
    'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
  ];
  return [
    header,
    ['01-07-2026-31-07-2026', String(gmvTotal), String(pesananTotal), '0', '0', '0', '0%', '0', '0', '0', '0', '0', '0', '0', '0', '0%'],
    [],
    header,
    ...dailyRows,
  ];
}

/**
 * `shopee_shop_stats` DENGAN `sheets` TIGA BASIS (sesi 34 lanjutan,
 * G1-09-2BII-SHOPDAILY-SHOPEE) — beda dari `shopeeShopStatsBerkas` (di bawah,
 * hanya `aoa` satu basis untuk tes rekonsiliasi G1-07). `aoa` terkunci ke
 * 'Pesanan Siap Dikirim' (`namaSheet` modul, `modules.ts`), `sheets` membawa
 * ketiganya lewat `PdtModuleDef.sheetTambahan` — pola persis bentuk asli yang
 * `apps/api` `decodeSheetsRelevan` hasilkan dari workbook 12-sheet sungguhan.
 */
function shopeeShopStatsBerkasTigaBasis(
  nama: string,
  basisRows: { dibuat: readonly (readonly string[])[]; siapDikirim: readonly (readonly string[])[]; dibayar: readonly (readonly string[])[] },
): PdtPreviewBerkasInput {
  const aoaDibuat = shopStatsBasisAoaDomain(0, 0, basisRows.dibuat);
  const aoaSiapDikirim = shopStatsBasisAoaDomain(0, 0, basisRows.siapDikirim);
  const aoaDibayar = shopStatsBasisAoaDomain(0, 0, basisRows.dibayar);
  const sheets = new Map<string, readonly (readonly unknown[])[]>([
    ['Pesanan Dibuat', aoaDibuat],
    ['Pesanan Siap Dikirim', aoaSiapDikirim],
    ['Pesanan Dibayar', aoaDibayar],
  ]);
  return {
    nama, sha256: 'sha-shopstats-3basis', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa: aoaSiapDikirim, sheets, modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
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

  it("identitas 'cocok' TikTok ⇒ status parsing (batch tidak membawa tt_shop_analytics/tt_product_analytics untuk rekonsiliasi — lihat describeDb rekonsiliasi TikTok di bawah untuk jalur lengkapnya)", async () => {
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
    // dari PREAMBLE SETIAP berkas 'ok' (ekstrakPeriodePreambleTiktok, DITUTUP via sample asli
    // "Tiktok - Avitaskin.zip" — docs/DECISIONS.md G1-06-PERIODE-TIKTOK), independen dari
    // 'ID Kreator'. Bentuk preamble persis sample asli (Shop Analytics): baris 0 "Tanggal
    // analisis: ...", baris 1 "Ringkasan data", header di baris 2.
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const header = [
      'GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
      'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi',
      'GMV dari video akun tertaut',
    ];
    const dataRow = ['1000000', '10', '8', '12', '500', '2', '1000000', '0', '200000', '100000', '50000', '50000'];
    const berkas: PdtPreviewBerkasInput = {
      nama: 'shop-analytics.xlsx', sha256: 's-sa', bytes: 20, ditolakPagar: null, decodeGagal: null,
      aoa: [['Tanggal analisis: 01/07/2026-31/07/2026'], ['Ringkasan data'], header, dataRow],
      sheets: null, modulTerdeteksi: 'tt_shop_analytics', ambiguous: false, matches: ['tt_shop_analytics'],
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

// ---------------------------------------------------------------------------
// commitUploadBatch — rekonsiliasi TikTok (Rule 13-16). `G1-07-TIKTOK-
// REKONSILIASI` DITUTUP via sample asli "Tiktok - Avitaskin.zip" — BEDA dari
// Shopee, perbandingan pesanan TIDAK dilewati (Σ 'Pesanan SKU' per-SKU
// TERBUKTI sama dengan shop-level di sample asli juga, lihat docblock
// `parseTiktokShopAnalytics`, `@cdps/core` `pdt/rekonsiliasi.ts`).
// ---------------------------------------------------------------------------
// kolomDipanen PERSIS tt_shop_analytics (modules.ts) — Rule 9 memvalidasi SELURUH daftar,
// bukan sebagian, jadi fixture harus membawa keduabelasnya supaya parse_status='ok'.
// Sel pertama '' (kolom label baris, `'Total nilai'`/`'Perubahan persentase'`) — sama pola
// bentuk asli (Shop Analytics_Key metrics_*.xlsx) supaya indeks header==indeks nilai lurus.
const HEADER_TT_SHOP_ANALYTICS = [
  '', 'GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
  'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi',
  'GMV dari video akun tertaut',
];

/** `tt_shop_analytics` — preamble persis bentuk asli (`'Tanggal analisis: ...'` + `'Ringkasan data'` sebelum header, `'Total nilai'` tepat sesudahnya). */
function ttShopAnalyticsBerkas(nama: string, gmv: number, pesananSku: number): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    ['Tanggal analisis: 01/07/2026-31/07/2026'],
    ['Ringkasan data'],
    HEADER_TT_SHOP_ANALYTICS,
    ['Total nilai', String(gmv), '10', '8', String(pesananSku), '500', '2', '1000000', '0', '200000', '100000', '50000', '50000'],
  ];
  return {
    nama, sha256: 'sha-tt-shopanalytics', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_shop_analytics', ambiguous: false, matches: ['tt_shop_analytics'],
  };
}

// kolomDipanen PERSIS tt_product_analytics (modules.ts).
const HEADER_TT_PRODUCT_ANALYTICS = [
  'ID Produk', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual', 'Pesanan SKU',
  'AOV', 'CTR', 'CTOR', 'Impresi produk', 'Status daftar produk', 'Nama', 'Klik produk',
];

/** `tt_product_analytics` — tidak membawa preamble/periode sendiri (pola sama `shopeeParentSkuBerkas`). */
function ttProductAnalyticsBerkas(nama: string, gmvTotal: number, pesananSkuTotal: number): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_TT_PRODUCT_ANALYTICS,
    ['P1', String(gmvTotal), '0', '0', '0', String(pesananSkuTotal), '0', '0%', '0%', '0', 'Active', 'Produk A', '0'],
  ];
  return {
    nama, sha256: 'sha-tt-productanalytics', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_product_analytics', ambiguous: false, matches: ['tt_product_analytics'],
  };
}

describeDb('commitUploadBatch (G1-07-TIKTOK-REKONSILIASI DITUTUP) — rekonsiliasi TikTok', () => {
  async function fixtureCocok(): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']); // akun_konten_toko SUDAH terikat ⇒ identitas 'cocok'
  }

  it('GMV DAN Pesanan SKU per-SKU Σ = shop-level ⇒ verified, reconcile_delta_pct = 0', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 1_000_000, 100),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('verified');
    expect(persiapan.reconcileDeltaPct).toBe(0);
    const row = await loadBatch(persiapan.batchId);
    expect(row.status).toBe('verified');
    expect(Number(row.reconcile_delta_pct)).toBe(0);
  });

  it('GMV per-SKU Σ menyimpang > 0,5% dari shop-level ⇒ ditolak, alasan menyebut selisih GMV', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 500_000, 100), // GMV separuh — jauh > 0,5%
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(persiapan.alasanDitolak).toContain('selisih rekonsiliasi GMV');
    expect(persiapan.reconcileDeltaPct).toBeCloseTo(50, 0);
  });

  it('HANYA Pesanan SKU menyimpang (GMV cocok) ⇒ ditolak, alasan menyebut selisih pesanan — BEDA dari Shopee (pesanan tidak dilewati)', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 1_000_000, 50), // Pesanan SKU separuh — jauh > 0,5%
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('ditolak');
    expect(persiapan.alasanDitolak).toContain('selisih rekonsiliasi pesanan');
  });

  it('hanya tt_shop_analytics TANPA tt_product_analytics (pasangan tidak lengkap) ⇒ tetap parsing, reconcile_delta_pct null', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('parsing');
    expect(persiapan.reconcileDeltaPct).toBeNull();
  });

  it("identitas 'usulkan_ikat' (akun_konten_toko belum terikat) ⇒ rekonsiliasi TIDAK dicoba meski berkas lengkap (identitas gate lebih dulu)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null); // akun_konten_toko belum terikat
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 1_000_000, 100),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('identitas_belum_terikat');
    expect(persiapan.reconcileDeltaPct).toBeNull();
  });

  it('batch verified KEDUA untuk (toko, periode) yang sama ⇒ ValidationError BI (uq_pdt_upload_batch_verified, Rule 36), bukan 500 mentah', async () => {
    const cpId = await fixtureCocok();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 1_000_000, 100),
    ];
    const pertama = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(pertama.status).toBe('verified');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, berkas, [])).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// commitUploadBatch (sesi 34, riset G2-01) — tt_shop_analytics → pdt_fact_shop_daily.
// Celah ditemukan (bukan modul baru — G1-09 sudah "selesai" tanpa pernah menulis
// tabel ini): lihat docblock `ekstrakBarisShopDailyTiktok`, `@cdps/core` `pdt/fakta.ts`.
// ---------------------------------------------------------------------------
interface FactShopDailyRow {
  client_platform_id: number;
  tanggal: string | Date;
  basis: string;
  batch_id: number;
  parser_versi: number;
  gmv: string;
  pesanan: number;
  produk_terjual: number | null;
  pengunjung: number | null;
  produk_diklik: number | null;
  cr: string | null;
  pembeli: number | null;
  pembeli_baru: number | null;
  refund: string | null;
}

async function loadFactShopDaily(clientPlatformId: number): Promise<FactShopDailyRow[]> {
  return sql<FactShopDailyRow[]>`select * from pdt_fact_shop_daily where client_platform_id = ${clientPlatformId} order by tanggal`;
}

/** `tt_shop_analytics` DENGAN blok "Data harian" (bentuk asli lengkap, beda dari `ttShopAnalyticsBerkas` yang hanya membawa "Ringkasan data" untuk tes rekonsiliasi). */
function ttShopAnalyticsBerkasDenganHarian(
  nama: string,
  gmv: number,
  pesananSku: number,
  baris: readonly [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string][],
): PdtPreviewBerkasInput {
  const HEADER_HARIAN = [
    'Tanggal', 'GMV', 'Pesanan', 'Pembeli', 'Produk terjual', 'Pengembalian dana', 'Pesanan SKU',
    'Pendapatan bruto', 'Tayangan halaman', 'Pengunjung', 'Persentase konversi', 'Impresi produk',
    'Impresi produk unik', 'Klik produk', 'Klik unik', 'AOV',
  ];
  const aoa: unknown[][] = [
    ['Tanggal analisis: 01/07/2026-31/07/2026'],
    ['Ringkasan data'],
    HEADER_TT_SHOP_ANALYTICS,
    ['Total nilai', String(gmv), '10', '8', String(pesananSku), '500', '2', '1000000', '0', '200000', '100000', '50000', '50000'],
    [],
    [],
    ['Data harian'],
    HEADER_HARIAN,
    ...baris,
  ];
  return {
    nama, sha256: 'sha-tt-shopanalytics-harian', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_shop_analytics', ambiguous: false, matches: ['tt_shop_analytics'],
  };
}

describeDb('commitUploadBatch (sesi 34) — tt_shop_analytics → pdt_fact_shop_daily', () => {
  async function fixture(): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']); // akun_konten_toko terikat ⇒ identitas 'cocok'
  }

  it('satu baris per tanggal, basis="net", gmv/refund APA ADANYA (tidak di-net-kan)', async () => {
    const cpId = await fixture();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkasDenganHarian('shop-analytics.xlsx', 1_600_000, 15, [
        ['01/07/2026', '1000000', '10', '9', '10', '-', '10', '1050000', '100', '80', '0.1256', '500', '400', '50', '40', '100000'],
        ['02/07/2026', '600000', '5', '5', '5', '50000', '5', '650000', '60', '50', '0.1', '300', '250', '30', '25', '120000'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactShopDaily(cpId);
    expect(rows).toHaveLength(2);
    expect(ymd(rows[0].tanggal)).toBe('2026-07-01');
    expect(rows[0]).toMatchObject({ basis: 'net', batch_id: persiapan.batchId, pesanan: 10, produk_terjual: 10, pengunjung: 80, produk_diklik: 50, pembeli: 9 });
    expect(Number(rows[0].gmv)).toBe(1000000);
    expect(Number.isNaN(Number(rows[0].cr))).toBe(false);
    expect(Number(rows[0].cr)).toBeCloseTo(0.1256, 3);
    expect(ymd(rows[1].tanggal)).toBe('2026-07-02');
    expect(Number(rows[1].gmv)).toBe(600000); // GMV MENTAH, bukan 600000 - 50000
    expect(Number(rows[1].refund)).toBe(50000);
  });

  it('"Pengembalian dana"="-" ⇒ refund NaN tersimpan (Postgres numeric mendukung NaN), bukan 0', async () => {
    const cpId = await fixture();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkasDenganHarian('shop-analytics.xlsx', 1_000_000, 10, [
        ['01/07/2026', '1000000', '10', '9', '10', '-', '10', '1050000', '100', '80', '0.1256', '500', '400', '50', '40', '100000'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const [row] = await loadFactShopDaily(cpId);
    expect(Number.isNaN(Number(row.refund))).toBe(true);
  });

  it('commit ULANG (tanggal+basis sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const cpId = await fixture();
    const pertama = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkasDenganHarian('shop-analytics.xlsx', 1_000_000, 10, [
        ['01/07/2026', '1000000', '10', '9', '10', '-', '10', '1050000', '100', '80', '0.1256', '500', '400', '50', '40', '100000'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactShopDaily(cpId)).toHaveLength(1);

    const kedua = [
      ttVideoBerkasDenganPeriode('video-2.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkasDenganHarian('shop-analytics-revisi.xlsx', 2_000_000, 20, [
        ['01/07/2026', '2000000', '20', '18', '20', '-', '20', '2100000', '200', '160', '0.25', '1000', '800', '100', '80', '100000'],
      ]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactShopDaily(cpId);
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].gmv)).toBe(2000000);
    expect(rows[0].pesanan).toBe(20);
  });

  it("identitas 'usulkan_ikat' (akun_konten_toko belum terikat) ⇒ baris fakta TETAP ditulis (client_platform_id sudah diketahui — gate 'tolak' saja, pola sama modul lain)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null); // belum terikat
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkasDenganHarian('shop-analytics.xlsx', 1_000_000, 10, [
        ['01/07/2026', '1000000', '10', '9', '10', '-', '10', '1050000', '100', '80', '0.1256', '500', '400', '50', '40', '100000'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('identitas_belum_terikat');
    expect(await loadFactShopDaily(cpId)).toHaveLength(1);
  });

  it('berkas tanpa blok "Data harian" (mis. hanya Ringkasan) ⇒ nol baris fakta shop_daily, rekonsiliasi tetap jalan dari Ringkasan', async () => {
    const cpId = await fixture();
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'kreator-a', '01/07/2026 - 31/07/2026'),
      ttShopAnalyticsBerkas('shop-analytics.xlsx', 1_000_000, 100),
      ttProductAnalyticsBerkas('product-analytics.xlsx', 1_000_000, 100),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect(persiapan.status).toBe('verified'); // rekonsiliasi Rule 13-14 tidak bergantung pada blok harian
    expect(await loadFactShopDaily(cpId)).toHaveLength(0);
  });
});

describeDb('commitUploadBatch (sesi 34 lanjutan, G1-09-2BII-SHOPDAILY-SHOPEE) — shopee_shop_stats → pdt_fact_shop_daily, TIGA basis', () => {
  async function fixture(): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, 'Shopee', '938284780'); // shop_id sudah terikat ⇒ identitas 'cocok'
  }

  it('SATU berkas shopee_shop_stats ⇒ TIGA baris per tanggal (basis dibuat/siap_dikirim/dibayar), nol tercampur (Rule 16)', async () => {
    const cpId = await fixture();
    const berkas = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkasTigaBasis('shop-stats.xlsx', {
        dibuat: [['01-07-2026', '56385206', '459', '0', '16583', '15095', '2,77%', '75', '9540132', '8', '1648328', '411', '363', '48', '1661', '9,73%']],
        siapDikirim: [['01-07-2026', '53089166', '438', '0', '16583', '15095', '2,64%', '56', '6458732', '8', '1648328', '393', '347', '46', '1679', '9,41%']],
        dibayar: [['01-07-2026', '50278794', '400', '0', '16583', '15095', '2,41%', '9', '1274092', '7', '1002102', '379', '350', '29', '1693', '4,49%']],
      }),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactShopDaily(cpId);
    expect(rows).toHaveLength(3);
    const byBasis = new Map(rows.map((r) => [r.basis, r]));
    expect(Number(byBasis.get('dibuat')?.gmv)).toBe(56385206);
    expect(byBasis.get('dibuat')?.pesanan).toBe(459);
    expect(Number(byBasis.get('siap_dikirim')?.gmv)).toBe(53089166);
    expect(byBasis.get('siap_dikirim')?.pesanan).toBe(438);
    expect(Number(byBasis.get('dibayar')?.gmv)).toBe(50278794);
    expect(byBasis.get('dibayar')?.pesanan).toBe(400);
    // Kolom SAMA yang dipetakan TikTok — pengunjung/produk_diklik/cr/pembeli/pembeli_baru/refund.
    expect(byBasis.get('siap_dikirim')?.pengunjung).toBe(15095);
    expect(byBasis.get('siap_dikirim')?.produk_diklik).toBe(16583);
    expect(Number(byBasis.get('siap_dikirim')?.cr)).toBeCloseTo(0.0264, 3); // numeric(6,3) — presisi kolom, sama pola tes TikTok
    expect(byBasis.get('siap_dikirim')?.pembeli).toBe(393);
    expect(byBasis.get('siap_dikirim')?.pembeli_baru).toBe(347);
    expect(Number(byBasis.get('siap_dikirim')?.refund)).toBe(1648328);
  });

  it('commit ULANG (tanggal+basis sama) ⇒ ON CONFLICT DO UPDATE per basis — baris diperbarui, bukan digandakan', async () => {
    const cpId = await fixture();
    const pertama = [
      shopeeAdsCpcBerkas('ads.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkasTigaBasis('shop-stats.xlsx', {
        dibuat: [['01-07-2026', '100', '1', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
        siapDikirim: [['01-07-2026', '100', '1', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
        dibayar: [['01-07-2026', '100', '1', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
      }),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect(await loadFactShopDaily(cpId)).toHaveLength(3);

    const kedua = [
      shopeeAdsCpcBerkas('ads-2.xlsx', '938284780', '01/07/2026 - 31/07/2026'),
      shopeeShopStatsBerkasTigaBasis('shop-stats-revisi.xlsx', {
        dibuat: [['01-07-2026', '200', '2', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
        siapDikirim: [['01-07-2026', '200', '2', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
        dibayar: [['01-07-2026', '200', '2', '0', '1', '1', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%']],
      }),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = await loadFactShopDaily(cpId);
    expect(rows).toHaveLength(3); // BUKAN 6 — ON CONFLICT DO UPDATE per basis
    for (const r of rows) {
      expect(Number(r.gmv)).toBe(200);
      expect(r.pesanan).toBe(2);
    }
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
  periode: string | Date;
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
  durasi_detik: number | null;
}

async function loadFactContent(clientPlatformId: number): Promise<FactContentRow[]> {
  return sql<FactContentRow[]>`select * from pdt_fact_content where client_platform_id = ${clientPlatformId} order by platform_content_id`;
}

// ---------------------------------------------------------------------------
// commitUploadBatch (2026-09-16) — baris fakta `tt_ads_product`/`tt_ads_live`
// → `pdt_fact_ads`. Dibangun KONSERVATIF tanpa sample asli (lihat docblock
// `ekstrakBarisTtAdsProduct`/`ekstrakBarisTtAdsLive`, `@cdps/core`
// `pdt/fakta.ts`) — `roas` DITURUNKAN gmv÷biaya, `sku_id`/`content_id`
// SELALU null. Tidak membawa preamble/periode sendiri (sama pola `tt_live`),
// dipasangkan dengan `ttVideoBerkasDenganPeriode` untuk identitas+periode.
// ---------------------------------------------------------------------------
const HEADER_TT_ADS_PRODUCT = ['ID Campaign', 'Nama kampanye', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor'];

function ttAdsProductBerkas(nama: string, baris: readonly [string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_TT_ADS_PRODUCT,
    ...baris.map(([kampanyeId, biaya, pesananSku, gmv]) => [kampanyeId, 'Kampanye A', 'PRD-1', 'VID-1', 'akun', biaya, pesananSku, '0', gmv]),
  ];
  return { nama, sha256: 'sha-tt-ads-product', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_ads_product', ambiguous: false, matches: ['tt_ads_product'] };
}

const HEADER_TT_ADS_LIVE = ['Nama LIVE', 'ID Campaign', 'Nama kampanye', 'Biaya', 'Pesanan SKU', 'ROI', 'Pendapatan kotor'];

function ttAdsLiveBerkas(nama: string, baris: readonly [string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [
    HEADER_TT_ADS_LIVE,
    ...baris.map(([kampanyeId, biaya, pesananSku, gmv]) => ['LIVE A', kampanyeId, 'Kampanye Live A', biaya, pesananSku, '99', gmv]),
  ];
  return { nama, sha256: 'sha-tt-ads-live', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, sheets: null, modulTerdeteksi: 'tt_ads_live', ambiguous: false, matches: ['tt_ads_live'] };
}

describeDb('commitUploadBatch (2026-09-16) — baris fakta tt_ads_product → pdt_fact_ads', () => {
  it('satu baris per kampanye, sku_id/content_id NULL, roas DITURUNKAN gmv÷biaya', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttAdsProductBerkas('ads-product.xlsx', [['CAM-1', '100000', '5', '400000']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sumber: 'tt_ads_product', kampanye_id: 'CAM-1', platform_product_id: null, sku_id: null, content_id: null,
      batch_id: persiapan.batchId, parser_versi: 1, tayangan: null, klik: null, pesanan_sku: 5,
    });
    expect(Number(rows[0].biaya)).toBe(100000);
    expect(Number(rows[0].gmv)).toBe(400000);
    expect(Number(rows[0].roas)).toBe(4);
  });

  it('commit ULANG periode yang sama ⇒ replace-on-recommit, bukan menumpuk duplikat', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const pertama = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttAdsProductBerkas('ads-product.xlsx', [['CAM-1', '100000', '5', '400000']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect((await loadFactAds(cpId)).filter((r) => r.sumber === 'tt_ads_product')).toHaveLength(1);

    const kedua = [
      ttVideoBerkasDenganPeriode('video-2.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttAdsProductBerkas('ads-product-revisi.xlsx', [['CAM-1', '150000', '8', '600000']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = (await loadFactAds(cpId)).filter((r) => r.sumber === 'tt_ads_product');
    expect(rows).toHaveLength(1); // BUKAN 2
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(Number(rows[0].biaya)).toBe(150000);
  });
});

describeDb('commitUploadBatch (2026-09-16) — baris fakta tt_ads_live → pdt_fact_ads', () => {
  it('satu baris per kampanye, sku_id/content_id NULL, roas DITURUNKAN gmv÷biaya (kolom ROI mentah diabaikan)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttAdsLiveBerkas('ads-live.xlsx', [['CAM-2', '1000000', '10', '3160000']]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactAds(cpId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sumber: 'tt_ads_live', kampanye_id: 'CAM-2', sku_id: null, content_id: null,
      batch_id: persiapan.batchId, tayangan: null, klik: null, pesanan_sku: 10,
    });
    expect(Number(rows[0].biaya)).toBe(1000000);
    expect(Number(rows[0].gmv)).toBe(3160000);
    expect(Number(rows[0].roas)).toBe(3.16); // BUKAN 99 (kolom ROI mentah fixture, sengaja diabaikan)
  });

  it('dua sumber TikTok ads (product+live) periode sama ⇒ dua baris terpisah, tidak saling menimpa', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttAdsProductBerkas('ads-product.xlsx', [['CAM-1', '100000', '5', '400000']]),
      ttAdsLiveBerkas('ads-live.xlsx', [['CAM-2', '1000000', '10', '3160000']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactAds(cpId);
    expect(rows.map((r) => r.sumber).sort()).toEqual(['tt_ads_live', 'tt_ads_product']);
  });
});

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
// commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KESEPULUH) — tt_live →
// pdt_fact_content. `G1-09-2BII-TTLIVE` DITUTUP via sample asli "Tiktok -
// Avitaskin.zip" — lihat fakta.ts @cdps/core `ekstrakBarisTtLive` untuk bukti
// keunikan idKreator+Waktu Live (149 baris nyata, nol duplikat).
// ---------------------------------------------------------------------------
const HEADER_TT_LIVE = ['ID Kreator', 'Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR'];

/** `tt_live` — tidak membawa preamble/periode sendiri, dipasangkan dengan `ttVideoBerkasDenganPeriode` di tes di bawah (sama pola `shopeeLiveBerkas`+`shopeeAdsCpcBerkas`). */
function ttLiveBerkas(nama: string, baris: readonly [string, string, string, string, string, string, string, string][]): PdtPreviewBerkasInput {
  const aoa: unknown[][] = [HEADER_TT_LIVE, ...baris];
  return {
    nama, sha256: 'sha-tt-live', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, sheets: null, modulTerdeteksi: 'tt_live', ambiguous: false, matches: ['tt_live'],
  };
}

describeDb('commitUploadBatch (G1-09 sub-langkah 2b-ii, modul KESEPULUH) — tt_live → pdt_fact_content', () => {
  it('satu baris per sesi live, platform_content_id dari idKreator+digit Waktu Live, jenis=live, creator/is_akun_toko terisi', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['6916141288326202370']);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', '6916141288326202370', '01/07/2026 - 31/07/2026'), // identitas+periode
      ttLiveBerkas('live.xlsx', [
        ['6916141288326202370', 'bidanku.afita', '2026/07/31/ 19:06', '2h 53min', '556308', '2', '7048', '1.14%'],
        ['KR-LAIN', 'Afiliasi', '2026/07/31/ 17:29', '1h 35min', '0', '0', '2452', '0.00%'],
      ]),
    ];
    const persiapan = await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = await loadFactContent(cpId);
    expect(rows).toHaveLength(3); // 1 tt_video + 2 tt_live
    const live = rows.filter((r) => r.jenis === 'live');
    expect(live).toHaveLength(2);
    expect(live[0]).toMatchObject({
      platform_content_id: '6916141288326202370-202607311906', jenis: 'live', batch_id: persiapan.batchId,
      creator_platform_id: '6916141288326202370', creator_handle: 'bidanku.afita', is_akun_toko: true, sku_id: null,
      vv: 7048, durasi_detik: 2 * 3600 + 53 * 60,
    });
    expect(live[0].waktu_posting).toBeNull(); // zona waktu dashboard TikTok belum terverifikasi
    expect(Number(live[0].gmv)).toBe(556308);
    expect(live[1]).toMatchObject({ platform_content_id: 'KR-LAIN-202607311729', creator_platform_id: 'KR-LAIN', is_akun_toko: false });
  });

  it('dua kreator BERBEDA live di menit yang SAMA tetap dua baris terpisah (idKreator bagian identitas)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live.xlsx', [
        ['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '0', '0', '0', '0%'],
        ['KR-2', 'Afiliasi', '2026/07/31/ 19:06', '0h 5min', '0', '0', '0', '0%'],
      ]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    const rows = (await loadFactContent(cpId)).filter((r) => r.jenis === 'live');
    expect(rows.map((r) => r.platform_content_id)).toEqual(['KR-1-202607311906', 'KR-2-202607311906']);
  });

  it('commit ULANG (idKreator+Waktu Live sama) ⇒ ON CONFLICT DO UPDATE — baris diperbarui di tempat, bukan digandakan', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const pertama = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live.xlsx', [['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '100', '0', '10', '0%']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, pertama, []);
    expect((await loadFactContent(cpId)).filter((r) => r.jenis === 'live')).toHaveLength(1);

    const kedua = [
      ttVideoBerkasDenganPeriode('video-2.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live-revisi.xlsx', [['KR-1', 'Toko', '2026/07/31/ 19:06', '1h 0min', '1.500.000', '0', '99', '0%']]),
    ];
    const persiapanKedua = await commitUploadBatch(sql, ownerActor(), cpId, kedua, []);
    const rows = (await loadFactContent(cpId)).filter((r) => r.jenis === 'live');
    expect(rows).toHaveLength(1); // BUKAN 2 — ON CONFLICT DO UPDATE
    expect(rows[0].batch_id).toBe(persiapanKedua.batchId);
    expect(rows[0].vv).toBe(99);
    expect(rows[0].durasi_detik).toBe(3600);
    expect(Number(rows[0].gmv)).toBe(1500000);
  });

  it('sesi live yang SAMA muncul lagi di periode BERBEDA ⇒ DUA baris terpisah (bukan menimpa periode sebelumnya, migrasi sesi 34)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const juli = [
      ttVideoBerkasDenganPeriode('video-juli.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live-juli.xlsx', [['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '100', '0', '10', '0%']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, juli, []);

    const agustus = [
      ttVideoBerkasDenganPeriode('video-agustus.xlsx', 'KR-1', '01/08/2026 - 31/08/2026'),
      ttLiveBerkas('live-agustus.xlsx', [['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '9999', '0', '10', '0%']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, agustus, []);

    const rows = (await loadFactContent(cpId)).filter((r) => r.jenis === 'live');
    expect(rows).toHaveLength(2); // BUKAN 1 — periode berbeda, baris Juli TIDAK tertimpa Agustus
    const juliRow = rows.find((r) => ymd(r.periode) === '2026-07-01');
    const agustusRow = rows.find((r) => ymd(r.periode) === '2026-08-01');
    expect(Number(juliRow?.gmv)).toBe(100); // laporan Juli yang dihitung ULANG tetap benar
    expect(Number(agustusRow?.gmv)).toBe(9999);
  });

  it('baris "ID Kreator"/"Waktu Live" tidak valid dilewati — nol baris fakta untuk baris itu', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live.xlsx', [['', 'Toko', 'bukan tanggal', '0h 5min', '0', '0', '0', '0%']]),
    ];
    await commitUploadBatch(sql, ownerActor(), cpId, berkas, []);
    expect((await loadFactContent(cpId)).filter((r) => r.jenis === 'live')).toHaveLength(0);
  });

  it("identitas 'tolak' (ID Kreator tt_video tidak terdaftar) ⇒ NOL baris fakta ditulis (tt_live)", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['KR-LAIN-YANG-TERDAFTAR']);
    const berkas = [
      ttVideoBerkasDenganPeriode('video.xlsx', 'KR-1', '01/07/2026 - 31/07/2026'),
      ttLiveBerkas('live.xlsx', [['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '100', '0', '10', '0%']]),
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

// ---------------------------------------------------------------------------
// rakitInputSkorTiktok (sesi 34 — G2-01 lanjutan) — query murni-baca yang
// merakit `PdtSkorInputTiktok` dari fakta. Fixture di sini menulis LANGSUNG
// ke `pdt_fact_*` (bukan lewat commitUploadBatch) supaya bebas mengontrol
// tanggal/is_akun_toko/gmv per kasus — pola sama dengan file lain di repo
// yang menguji lapisan agregasi terpisah dari lapisan parser.
// ---------------------------------------------------------------------------
describeDb('rakitInputSkorTiktok (sesi 34) — agregasi pdt_fact_* → PdtSkorInputTiktok', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', 'SHOP-ZPDT-1');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function insertAds(
    batchId: number, cpId: number, sumber: string, kampanyeId: string,
    biaya: number, gmv: number | null, pesananSku: number | null,
  ): Promise<void> {
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv, pesanan_sku)
      values (${cpId}, ${sumber}, ${kampanyeId}, '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, ${biaya}, ${gmv}, ${pesananSku})`;
  }

  async function insertContent(
    batchId: number, cpId: number, jenis: 'video' | 'live', contentId: string,
    isAkunToko: boolean, gmv: number | null, extra: { vv?: number | null; durasiDetik?: number | null } = {},
  ): Promise<void> {
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv, durasi_detik)
      values (${cpId}, ${contentId}, '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, ${jenis}, ${isAkunToko}, ${gmv}, ${extra.vv ?? null}, ${extra.durasiDetik ?? null})`;
  }

  async function insertShopDaily(batchId: number, cpId: number, tanggal: string, gmv: number, pesanan: number, pengunjung: number | null): Promise<void> {
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, ${tanggal}::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, ${gmv}, ${pesanan}, ${pengunjung})`;
  }

  async function insertCreatorPeriod(batchId: number, cpId: number, handle: string, gmv: number | null): Promise<void> {
    await sql`
      insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv)
      values (${cpId}, ${handle}, '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, ${gmv})`;
  }

  it('seluruh enam dimensi null bila nol baris fakta di periode ini (toko baru, belum ada batch)', async () => {
    const { cpId } = await fixture();
    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil).toEqual({ ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null });
  });

  it('Ads: menjumlah tt_ads_product + tt_ads_live, burnSpend HANYA baris product ber-biaya>0&gmv<=0, biayaProduk = seluruh baris product', async () => {
    const { cpId, batchId } = await fixture();
    await insertAds(batchId, cpId, 'tt_ads_product', 'K1', 100_000, 500_000, 10); // untung
    await insertAds(batchId, cpId, 'tt_ads_product', 'K2', 50_000, 0, 0); // bakar — biaya tanpa hasil
    await insertAds(batchId, cpId, 'tt_ads_live', 'K3', 30_000, 90_000, 3);
    // sumber DI LUAR whitelist skor (mis. meta_ads bila pernah ada) harus DIABAIKAN — di sini pakai shopee_ads_cpc sebagai representasi "bukan TikTok".
    await insertAds(batchId, cpId, 'shopee_ads_cpc', 'K9', 999_999, 999_999, 999);

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.ads).toEqual({ biaya: 180_000, gmv: 590_000, pesanan: 13, burnSpend: 50_000, biayaProduk: 150_000 });
  });

  it('LIVE: HANYA baris is_akun_toko=true — LIVE afiliasi TIDAK ikut dimensi ini', async () => {
    const { cpId, batchId } = await fixture();
    await insertContent(batchId, cpId, 'live', 'L1', true, 400_000, { durasiDetik: 3600 * 2 });
    await insertContent(batchId, cpId, 'live', 'L2', true, 0, { durasiDetik: 3600 }); // sesi nol
    await insertContent(batchId, cpId, 'live', 'L3', false, 999_999_999, { durasiDetik: 3600 * 5 }); // afiliasi — HARUS diabaikan

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.live).toEqual({ gmv: 400_000, jamTotal: 3, sesi: 2, sesiNol: 1 });
  });

  it('Video: toko + afiliasi DIGABUNG (beda dari LIVE)', async () => {
    const { cpId, batchId } = await fixture();
    await insertContent(batchId, cpId, 'video', 'V1', true, 200_000, { vv: 10_000 });
    await insertContent(batchId, cpId, 'video', 'V2', false, 0, { vv: 5_000 }); // afiliasi, nol penjualan
    await insertContent(batchId, cpId, 'video', 'V3', false, 300_000, { vv: 20_000 }); // afiliasi, ada penjualan

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.video).toEqual({ total: 3, adaPenjualan: 2, gmv: 500_000, vv: 35_000 });
  });

  it('Kartu: gmvKartu = max(0, gmvTotalToko − Σ gmv SELURUH konten live+video, toko maupun afiliasi); cvr = Σpesanan/Σpengunjung', async () => {
    const { cpId, batchId } = await fixture();
    await insertShopDaily(batchId, cpId, '2026-07-05', 1_000_000, 40, 2_000);
    await insertShopDaily(batchId, cpId, '2026-07-20', 500_000, 20, 1_000);
    // di luar periode Juli — TIDAK boleh ikut terhitung
    await insertShopDaily(batchId, cpId, '2026-08-01', 999_999, 999, 999);
    await insertContent(batchId, cpId, 'live', 'L1', true, 300_000);
    await insertContent(batchId, cpId, 'video', 'V1', false, 200_000);

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    // gmvTotalToko = 1.500.000; kontenTotal = 500.000 ⇒ gmvKartu = 1.000.000
    expect(hasil.kartu).toEqual({ gmvKartu: 1_000_000, gmvTotal: 1_500_000, cvr: 60 / 3_000 });
  });

  it('Kartu: gmvKartu diklem ke 0 bila kontribusi konten MELEBIHI gmv toko (bukan negatif)', async () => {
    const { cpId, batchId } = await fixture();
    await insertShopDaily(batchId, cpId, '2026-07-05', 100_000, 5, 100);
    await insertContent(batchId, cpId, 'live', 'L1', true, 500_000);

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.kartu?.gmvKartu).toBe(0);
  });

  it('Affiliate: produktif = jumlah kreator ber-gmv>0; gmvKotorToko sumber SAMA dengan Kartu.gmvTotal', async () => {
    const { cpId, batchId } = await fixture();
    await insertShopDaily(batchId, cpId, '2026-07-05', 2_000_000, 50, 3_000);
    await insertCreatorPeriod(batchId, cpId, 'kreator1', 100_000);
    await insertCreatorPeriod(batchId, cpId, 'kreator2', 0);
    await insertCreatorPeriod(batchId, cpId, 'kreator3', null);

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.affiliate).toEqual({ produktif: 1, total: 3, gmv: 100_000, gmvKotorToko: 2_000_000 });
  });

  it('Portfolio Produk: SELALU null (kuadran belum punya penulis, Open G2-01-KUADRAN-SKU) — meski dimensi lain terisi penuh', async () => {
    const { cpId, batchId } = await fixture();
    await insertAds(batchId, cpId, 'tt_ads_product', 'K1', 10_000, 20_000, 1);

    const hasil = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.produk).toBeNull();
  });

  it('periode selain awal bulan (bukan YYYY-MM-01) ⇒ ValidationError', async () => {
    const { cpId } = await fixture();
    await expect(rakitInputSkorTiktok(sql, cpId, '2026-07-15')).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// bacaBenchmarkAktifTiktok + hitungSkorTiktok (sesi 34, G2-02 lanjutan) —
// `pdt_benchmark` diseed migrasi `20261030010000` (versi 1 TikTok, PORT
// REPORT_BENCH_V1 apa adanya) DAN append-only (trigger blokir UPDATE/DELETE)
// — tes di sini SENGAJA tidak menyisipkan/menghapus baris `pdt_benchmark`
// sendiri, mengandalkan seed migrasi persis seperti test suite `report.ts`
// mengandalkan seed `report_benchmark` (nol tes untuk "benchmark kosong",
// tidak bisa direproduksi tanpa menghapus seed yang di-frozen trigger).
// ---------------------------------------------------------------------------
describeDb('bacaBenchmarkAktifTiktok + hitungSkorTiktok (sesi 34) — benchmark aktif + jalur lengkap fakta→skor', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', 'SHOP-ZPDT-2');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('bacaBenchmarkAktifTiktok: mengembalikan versi 1 TikTok — PORT REPORT_BENCH_V1 apa adanya (delapan kunci)', async () => {
    const hasil = await bacaBenchmarkAktifTiktok(sql);
    expect(hasil).toEqual({
      versi: 1,
      bench: {
        roi_gmvmax: { good: 8, warn: 4 },
        cpa_ratio: { good: 0.1, warn: 0.2 },
        gmv_per_jam_live: { good: 300000, warn: 150000 },
        sesi_live: { good: 20, warn: 12 },
        gpm_video: { good: 30000, warn: 10000 },
        pct_video_sales: { good: 0.05, warn: 0.02 },
        cvr_toko: { good: 0.015, warn: 0.008 },
        pct_kreator_produktif: { good: 0.2, warn: 0.1 },
      },
    });
  });

  it('hitungSkorTiktok: merakit fakta + benchmark aktif + computeSkorTiktok — total & benchmarkVersi cocok hitungan langsung dari input yang SAMA', async () => {
    const { cpId, batchId } = await fixture();
    // Satu dimensi saja (Ads) supaya nilai yang diharapkan mudah dihitung ulang secara independen.
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv, pesanan_sku)
      values (${cpId}, 'tt_ads_product', 'K1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100000, 500000, 10)`;

    const { hasil, benchmarkVersi } = await hitungSkorTiktok(sql, cpId, '2026-07-01');
    expect(benchmarkVersi).toBe(1);

    const inputLangsung = await rakitInputSkorTiktok(sql, cpId, '2026-07-01');
    const { bench } = await bacaBenchmarkAktifTiktok(sql);
    const harapan = pdtCore.computeSkorTiktok(inputLangsung, bench);
    expect(hasil).toEqual(harapan);
    // Hanya dimensi Ads yang punya data ⇒ Rule 12 mengecualikan lima dimensi lain, bukan skor netral.
    expect(hasil.dimensi.filter((d) => d.disertakan)).toHaveLength(1);
    expect(hasil.dimensi.find((d) => d.kode === 'gmvmax')?.disertakan).toBe(true);
  });

  it('hitungSkorTiktok: nol baris fakta sama sekali ⇒ total & label null (Rule 12/aturan rumah #7 — bukan KRITIS palsu)', async () => {
    const { cpId } = await fixture();
    const { hasil } = await hitungSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.total).toBeNull();
    expect(hasil.label).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitInputSkorShopee + hitungSkorShopee (sesi 34 lanjutan, G2-01 Shopee) —
// padanan blok TikTok di atas. Pemetaan sumber pdt_fact_ads ↔ kategori mesin
// lama (dan pengecualian shopee_ads_live dari agregat CTR) diverifikasi dari
// `report/shopee/detect.ts`/`metrik.ts` — lihat docblock `rakitInputSkorShopee`
// (`pdt.ts`) dan `docs/DECISIONS.md` untuk rincian lengkap.
// ---------------------------------------------------------------------------
describeDb('rakitInputSkorShopee (sesi 34 lanjutan) — agregasi pdt_fact_* → PdtSkorInputShopee', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function insertAdsShopee(
    batchId: number, cpId: number, sumber: string, kampanyeId: string,
    biaya: number, gmv: number | null, klik: number | null, tayangan: number | null,
  ): Promise<void> {
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv, klik, tayangan)
      values (${cpId}, ${sumber}, ${kampanyeId}, '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, ${biaya}, ${gmv}, ${klik}, ${tayangan})`;
  }

  async function insertDibuat(batchId: number, cpId: number, tanggal: string, pesanan: number, pengunjung: number | null): Promise<void> {
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, ${tanggal}::date, 'dibuat', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 0, ${pesanan}, ${pengunjung})`;
  }

  async function insertLiveContent(batchId: number, cpId: number, contentId: string): Promise<void> {
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv)
      values (${cpId}, ${contentId}, '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 0)`;
  }

  async function insertPdtFile(batchId: number, modulKode: string): Promise<void> {
    await sql`
      insert into pdt_file (batch_id, modul_kode, nama_entri, sha256, bytes, baris_header, deteksi_oleh, kolom_dipanen, parse_status, baris_terparse)
      values (${batchId}, ${modulKode}, 'test.xlsx', 'deadbeef', 100, 1, 'tanda_tangan', 1, 'ok', 1)`;
  }

  it('seluruh lima input null bila nol baris fakta di periode ini (toko baru, belum ada batch)', async () => {
    const { cpId } = await fixture();
    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil).toEqual({ ads: null, dibuat: null, produk: null, live: null, kesehatan: null });
  });

  it('Ads: spend/omzet menjumlah SELURUH TIGA sumber (cpc+search+live), CTR HANYA dari cpc+search (live dikecualikan)', async () => {
    const { cpId, batchId } = await fixture();
    await insertAdsShopee(batchId, cpId, 'shopee_ads_cpc', 'K1', 100_000, 500_000, 200, 10_000);
    await insertAdsShopee(batchId, cpId, 'shopee_ads_search', 'K2', 50_000, 200_000, 50, 2_000);
    await insertAdsShopee(batchId, cpId, 'shopee_ads_live', 'K3', 30_000, 90_000, null, 5_000);
    // sumber DI LUAR whitelist Shopee (TikTok) harus DIABAIKAN.
    await insertAdsShopee(batchId, cpId, 'tt_ads_product', 'K9', 999_999, 999_999, 999, 999);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.ads?.spend).toBe(180_000);
    expect(hasil.ads?.omzet).toBe(790_000);
    // ctr = (200+50) / (10_000+2_000) — tayangan/klik shopee_ads_live (5_000, null) TIDAK ikut
    expect(hasil.ads?.ctr).toBeCloseTo(250 / 12_000, 10);
  });

  it('Ads: omzet null bila SEMUA baris omzet(gmv) tidak diketahui (bukan omzet 0 sungguhan)', async () => {
    const { cpId, batchId } = await fixture();
    await insertAdsShopee(batchId, cpId, 'shopee_ads_cpc', 'K1', 100_000, null, 200, 10_000);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.ads?.spend).toBe(100_000);
    expect(hasil.ads?.omzet).toBeNull();
  });

  it('Ads: ctr null bila tayangan cpc+search nol/tidak ada (hanya ada baris live)', async () => {
    const { cpId, batchId } = await fixture();
    await insertAdsShopee(batchId, cpId, 'shopee_ads_live', 'K1', 30_000, 90_000, null, 5_000);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.ads?.ctr).toBeNull();
  });

  it('dibuat: cr = Σpesanan/Σpengunjung, 0 bila pengunjung nol (data ADA, bukan data hilang)', async () => {
    const { cpId, batchId } = await fixture();
    await insertDibuat(batchId, cpId, '2026-07-05', 40, 2_000);
    await insertDibuat(batchId, cpId, '2026-07-20', 20, 1_000);
    // di luar periode Juli — TIDAK boleh ikut terhitung
    await insertDibuat(batchId, cpId, '2026-08-01', 999, 999);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.dibuat).toEqual({ cr: 60 / 3_000, repeatRate: null, cancelRate: null });
  });

  it('dibuat: pengunjung nol ⇒ cr 0 (bukan null)', async () => {
    const { cpId, batchId } = await fixture();
    await insertDibuat(batchId, cpId, '2026-07-05', 0, 0);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.dibuat?.cr).toBe(0);
  });

  it('produk: SELALU null (kuadran belum punya penulis, Open G2-01-KUADRAN-SKU)', async () => {
    const { cpId, batchId } = await fixture();
    await insertAdsShopee(batchId, cpId, 'shopee_ads_cpc', 'K1', 10_000, 20_000, 5, 100);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.produk).toBeNull();
  });

  it('kesehatan: SELALU null (modul shopee_kesehatan terdaftar, nol penulis fakta — Open G2-01-SHOPEE-KESEHATAN-WRITER)', async () => {
    const { cpId, batchId } = await fixture();
    await insertAdsShopee(batchId, cpId, 'shopee_ads_cpc', 'K1', 10_000, 20_000, 5, 100);

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.kesehatan).toBeNull();
  });

  it('live: modul shopee_live TIDAK PERNAH terdeteksi di batch manapun ⇒ null (meski ada baris pdt_fact_content)', async () => {
    const { cpId, batchId } = await fixture();
    await insertLiveContent(batchId, cpId, 'L1');

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.live).toBeNull();
  });

  it('live: modul shopee_live terdeteksi di batch yang periodenya mencakup periode ini ⇒ diunggah=true + sesi dihitung', async () => {
    const { cpId, batchId } = await fixture();
    await insertPdtFile(batchId, 'shopee_live');
    await insertLiveContent(batchId, cpId, 'L1');
    await insertLiveContent(batchId, cpId, 'L2');

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.live).toEqual({ diunggah: true, sesi: 2 });
  });

  it('live: diunggah=true tapi nol baris pdt_fact_content ⇒ sesi=0 (bukan null — beda dari "tidak pernah diunggah")', async () => {
    const { cpId, batchId } = await fixture();
    await insertPdtFile(batchId, 'shopee_live');

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.live).toEqual({ diunggah: true, sesi: 0 });
  });

  it('live: batch berstatus ditolak TIDAK dihitung sebagai diunggah', async () => {
    const { cpId, batchId } = await fixture();
    await sql`update pdt_upload_batch set status = 'ditolak', alasan_ditolak = 'tes' where id = ${batchId}`;
    await insertPdtFile(batchId, 'shopee_live');

    const hasil = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.live).toBeNull();
  });

  it('periode selain awal bulan (bukan YYYY-MM-01) ⇒ ValidationError', async () => {
    const { cpId } = await fixture();
    await expect(rakitInputSkorShopee(sql, cpId, '2026-07-15')).rejects.toThrow(ValidationError);
  });
});

describeDb('hitungSkorShopee (sesi 34 lanjutan) — jalur lengkap fakta→skor, nol benchmark (asimetri asli mesin produksi)', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('merakit fakta + computeSkorShopee — total cocok hitungan langsung dari input yang SAMA, nol benchmarkVersi dikembalikan', async () => {
    const { cpId, batchId } = await fixture();
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv, klik, tayangan)
      values (${cpId}, 'shopee_ads_cpc', 'K1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100000, 800000, 200, 10000)`;

    const hasilWrapper = await hitungSkorShopee(sql, cpId, '2026-07-01');
    expect('benchmarkVersi' in hasilWrapper).toBe(false);
    const { hasil } = hasilWrapper;

    const inputLangsung = await rakitInputSkorShopee(sql, cpId, '2026-07-01');
    const harapan = pdtCore.computeSkorShopee(inputLangsung);
    expect(hasil).toEqual(harapan);
    // Hanya dimensi ROAS & Channel + Traffic Quality yang punya data ads (dibuat masih kosong).
    expect(hasil.dimensi.find((d) => d.kode === 'roas_channel')?.disertakan).toBe(true);
  });

  it('nol baris fakta sama sekali ⇒ total & label null (Rule 12/aturan rumah #7)', async () => {
    const { cpId } = await fixture();
    const { hasil } = await hitungSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.total).toBeNull();
    expect(hasil.label).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok + rakitLaporanShopee (sesi 34 lanjutan, payload laporan
// v1) — basis KPI ringkas per platform DIVERIFIKASI dari PRD: TikTok = basis
// `'net'` GMV−refund (Rule 15), Shopee = basis `'siap_dikirim'` (Rule 16,
// "Basis default untuk laporan klien Shopee"). Lihat docblock
// `packages/core/src/pdt/laporan.ts` untuk cakupan v1 (KPI ringkas + skor
// SAJA — sebelas bagian mesin lama lainnya di luar cakupan, keputusan
// pemilik).
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok (sesi 34 lanjutan) — KPI basis net (Rule 15, GMV−refund) + hitungSkorTiktok', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', 'SHOP-ZPDT-3');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('KPI net = Σgmv − Σrefund basis net, cvr = Σpesanan/Σpengunjung; skor+benchmarkVersi dari hitungSkorTiktok', async () => {
    const { cpId, batchId } = await fixture();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 50_000, 40, 2_000)`;
    // basis lain (SIAP DIKIRIM tidak relevan TikTok) sengaja TIDAK disisipkan — hanya 'net' yang dibaca.

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.schema).toBe('cdps.pdt.laporan.tiktok.v1');
    expect(hasil.platform).toBe('tiktok');
    expect(hasil.clientPlatformId).toBe(cpId);
    expect(hasil.periodeAwalBulan).toBe('2026-07-01');
    expect(hasil.kpi).toEqual({ gmv: 950_000, pesanan: 40, pengunjung: 2_000, cvr: 0.02 });
    expect(hasil.benchmarkVersi).toBe(1);

    const skorLangsung = await hitungSkorTiktok(sql, cpId, '2026-07-01');
    expect(hasil.skor).toEqual(skorLangsung.hasil);
    // "insight" (nol query baru — dirangkai dari bagian yang sudah dibangun di atas + benchTiktok yang SAMA dipakai hitungSkorTiktok).
    expect(hasil.insight.ringkasan).toContain('GMV Rp. 950.000,00 dari 40 pesanan');
    expect(hasil.insight.indikator.some((i) => i.nama === 'Target ROAS Iklan (GMV Max)')).toBe(true);
  });

  it('nol baris basis net ⇒ kpi seluruhnya null (BUKAN 0), insight tetap terisi (ringkasan generik, poin kosong)', async () => {
    const { cpId } = await fixture();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
    expect(hasil.insight.ringkasan).toBe('Belum ada data GMV untuk periode ini.');
    expect(hasil.insight.poin).toEqual([]);
  });

  it('periode selain awal bulan ⇒ ValidationError', async () => {
    const { cpId } = await fixture();
    await expect(rakitLaporanTiktok(sql, cpId, '2026-07-15')).rejects.toThrow(ValidationError);
  });
});

describeDb('rakitLaporanShopee (sesi 34 lanjutan) — KPI basis siap_dikirim (Rule 16) + hitungSkorShopee', () => {
  async function fixture(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('KPI = Σgmv basis siap_dikirim TANPA net-refund (beda TikTok), cvr = Σpesanan/Σpengunjung; skor dari hitungSkorShopee, nol benchmarkVersi', async () => {
    const { cpId, batchId } = await fixture();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'siap_dikirim', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 800_000, 50_000, 20, 1_000)`;
    // basis 'dibuat' (dipakai rakitInputSkorShopee, BUKAN KPI laporan) disisipkan angka BEDA
    // untuk membuktikan KPI laporan tidak ikut membaca basis ini.
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'dibuat', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 999_999, 999, 999)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.schema).toBe('cdps.pdt.laporan.shopee.v1');
    expect(hasil.platform).toBe('shopee');
    // GMV TIDAK dikurangi refund (beda TikTok) — 800_000 apa adanya.
    expect(hasil.kpi).toEqual({ gmv: 800_000, pesanan: 20, pengunjung: 1_000, cvr: 0.02 });
    expect('benchmarkVersi' in hasil).toBe(false);

    const skorLangsung = await hitungSkorShopee(sql, cpId, '2026-07-01');
    expect(hasil.skor).toEqual(skorLangsung.hasil);
    // "insight" Shopee: nol benchTiktok (asimetri asli) ⇒ nol indikator ber-bench, ringkasan tetap terisi.
    expect(hasil.insight.ringkasan).toContain('GMV Rp. 800.000,00 dari 20 pesanan');
    expect(hasil.insight.indikator.some((i) => i.nama === 'Target ROAS Iklan (GMV Max)')).toBe(false);
  });

  it('nol baris basis siap_dikirim ⇒ kpi seluruhnya null (BUKAN 0), insight tetap terisi', async () => {
    const { cpId } = await fixture();
    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
    expect(hasil.insight.ringkasan).toBe('Belum ada data GMV untuk periode ini.');
  });

  it('periode selain awal bulan ⇒ ValidationError', async () => {
    const { cpId } = await fixture();
    await expect(rakitLaporanShopee(sql, cpId, '2026-07-15')).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "kanal" (G2-01 lanjutan, keputusan
// pemilik via `AskUserQuestion` 2026-09-16). TikTok penuh (Live/Video/Kartu
// dari pdt_fact_content + pdt_fact_shop_daily basis 'net'); Shopee SELALU
// `lengkap: false` (shopee_ads + affiliate saja, empat sumber legacy lain
// nol penulis fakta).
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "kanal" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function fixtureShopee(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: live+video dari pdt_fact_content (toko+afiliasi digabung), kartu = sisa dari gmv gross basis net', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 10_000_000, 100, 5_000)`;
    // live: satu baris toko (is_akun_toko=true) + satu baris afiliasi (is_akun_toko=false) — kanal menjumlah KEDUANYA.
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv)
      values (${cpId}, 'live-toko-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 3_000_000),
             (${cpId}, 'live-aff-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', false, 1_000_000),
             (${cpId}, 'video-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', true, 3_500_000)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.kanal).toEqual({
      gmvTotal: 10_000_000,
      items: [
        { kode: 'live', label: 'LIVE', gmv: 4_000_000, persen: 0.4 },
        { kode: 'video', label: 'Video', gmv: 3_500_000, persen: 0.35 },
        { kode: 'kartu', label: 'Kartu Produk / Shop Tab', gmv: 2_500_000, persen: 0.25 },
      ],
      lengkap: true,
    });
  });

  it('TikTok: nol baris pdt_fact_content ⇒ live/video/kartu semua null (tidak diketahui, BUKAN nol), gmvTotal tetap terisi', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 10_000_000, 100, 5_000)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.kanal.gmvTotal).toBe(10_000_000);
    expect(hasil.kanal.items.every((i) => i.gmv === null && i.persen === null)).toBe(true);
    expect(hasil.kanal.lengkap).toBe(true);
  });

  it('TikTok: nol baris basis net ⇒ kanal seluruhnya kosong (sama pola kpi null)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.kanal).toEqual({ gmvTotal: null, items: [], lengkap: true });
  });

  it('Shopee: shopee_ads (pdt_fact_ads) + affiliate (pdt_fact_creator_period), gmvTotal dari basis DIBUAT (bukan siap_dikirim), SELALU lengkap:false', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'dibuat', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 8_000_000, 80, 4_000)`;
    // basis 'siap_dikirim' (dipakai KPI laporan, BUKAN kanal) angka BEDA — membuktikan kanal tidak ikut membaca basis ini.
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'siap_dikirim', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 999_999, 999, 999)`;
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'shopee_ads_cpc', 'kmp-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100_000, 1_000_000),
             (${cpId}, 'shopee_ads_search', 'kmp-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 50_000, 600_000)`;
    await sql`
      insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv)
      values (${cpId}, 'kreator-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 800_000)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.kanal).toEqual({
      gmvTotal: 8_000_000,
      items: [
        { kode: 'shopee_ads', label: 'Shopee Ads', gmv: 1_600_000, persen: 0.2 },
        { kode: 'affiliate', label: 'Affiliate', gmv: 800_000, persen: 0.1 },
      ],
      lengkap: false,
    });
  });

  it('Shopee: nol baris pdt_fact_ads/pdt_fact_creator_period ⇒ kedua item null, lengkap TETAP false', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'dibuat', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 8_000_000, 80, 4_000)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.kanal.gmvTotal).toBe(8_000_000);
    expect(hasil.kanal.items.every((i) => i.gmv === null && i.persen === null)).toBe(true);
    expect(hasil.kanal.lengkap).toBe(false);
  });

  it('Shopee: nol baris basis dibuat ⇒ kanal seluruhnya kosong, lengkap TETAP false', async () => {
    const { cpId } = await fixtureShopee();
    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.kanal).toEqual({ gmvTotal: null, items: [], lengkap: false });
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "live" (G2-01 lanjutan, keputusan
// pemilik via `AskUserQuestion` 2026-09-16). SATU query dipakai kedua
// platform (`pdt.bacaLive` di domain) — nol asimetri platform, TAPI
// `jam` SELALU null untuk Shopee (kolom `durasi_detik` kosong permanen di
// penulis `shopee_live`, beda dari `tt_live` yang mengisinya).
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "live" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function fixtureShopee(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: durasi_detik terisi (tt_live) ⇒ sesi/gmv/vv/jam semua terhitung', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv, durasi_detik)
      values (${cpId}, 'live-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 2_000_000, 5_000, 14_400),
             (${cpId}, 'live-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 2_000_000, 5_000, 14_400)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.live).toEqual({ sesi: 2, gmv: 4_000_000, vv: 10_000, jam: 8, gmvPerSesi: 2_000_000, gmvPerJam: 500_000 });
  });

  it('Shopee: durasi_detik kosong permanen (shopee_live) ⇒ jam/gmvPerJam null, sesi/gmv/vv/gmvPerSesi TETAP terhitung', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv)
      values (${cpId}, 'live-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 2_000_000, 5_000),
             (${cpId}, 'live-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 2_000_000, 5_000)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.live).toEqual({ sesi: 2, gmv: 4_000_000, vv: 10_000, jam: null, gmvPerSesi: 2_000_000, gmvPerJam: null });
  });

  it('nol baris pdt_fact_content jenis live ⇒ live null (BUKAN sesi:0)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.live).toBeNull();
  });

  it('baris jenis video TIDAK ikut terhitung ke live', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv)
      values (${cpId}, 'video-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', true, 9_999_999, 9_999)`;
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.live).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "video" (G2-01 lanjutan, keputusan
// pemilik via `AskUserQuestion` 2026-09-16, KEEMPAT: TikTok-only). SATU
// query dipakai kedua platform (`pdt.bacaVideo` di domain) — platform-
// agnostic, TAPI Shopee di dunia nyata SELALU `null` karena `shopee_video`
// nol penulis fakta ke `pdt_fact_content` (bukan filter platform eksplisit
// di query). Tes Shopee di bawah insert baris MENTAH langsung (bypass
// `commitUploadBatch`, tidak ada jalur nyata yang menulisnya hari ini) —
// membuktikan query TIDAK diam-diam menyaring platform, murni nol baris
// di produksi yang membuat Shopee selalu kosong.
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "video" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function fixtureShopee(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: vv/likes/dibagikan/klik_produk/gmv terisi (tt_video, toko+afiliasi) ⇒ semua terhitung, gmvPerVideo+vvPerVideo terhitung', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv, likes, dibagikan, klik_produk)
      values (${cpId}, 'video-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', true, 3_000_000, 50_000, 2_000, 100, 400),
             (${cpId}, 'video-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', false, 2_000_000, 50_000, 2_000, 100, 400)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.video).toEqual({
      total: 2, gmv: 5_000_000, vv: 100_000, likes: 4_000, dibagikan: 200, klikProduk: 800,
      gmvPerVideo: 2_500_000, vvPerVideo: 50_000,
    });
  });

  it('nol baris pdt_fact_content jenis video ⇒ video null (BUKAN total:0) — cermin realita Shopee hari ini (shopee_video nol penulis)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.video).toBeNull();
  });

  it('Shopee: baris mentah (bypass writer, membuktikan query platform-agnostic) ⇒ tetap terhitung persis sama seperti TikTok', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv)
      values (${cpId}, 'video-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', true, 1_000_000, 20_000)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.video).toEqual({
      total: 1, gmv: 1_000_000, vv: 20_000, likes: null, dibagikan: null, klikProduk: null,
      gmvPerVideo: 1_000_000, vvPerVideo: 20_000,
    });
  });

  it('baris jenis live TIDAK ikut terhitung ke video', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv)
      values (${cpId}, 'live-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 9_999_999, 9_999)`;
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.video).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "iklan" (G2-01 lanjutan, keputusan
// pemilik via `AskUserQuestion` 2026-09-16, KELIMA — dibangun setelah PR
// #413 menutup gap `tt_ads_product`/`tt_ads_live`). KEDUA platform dibangun
// sekaligus, TAPI TIDAK simetris: TikTok SELALU `lengkap: true` (dua sumber
// asli, keduanya sudah punya penulis fakta), Shopee SELALU `lengkap: false`
// (`ads_banner` legacy tidak pernah punya modul PDT).
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "iklan" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function fixtureShopee(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: tt_ads_product+tt_ads_live keduanya terisi ⇒ dua item, total dijumlah, roas diturunkan, lengkap:true', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'tt_ads_product', 'CAM-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100_000, 400_000),
             (${cpId}, 'tt_ads_live', 'CAM-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 200_000, 1_000_000)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.iklan).toEqual({
      biaya: 300_000,
      gmv: 1_400_000,
      roas: 4.67,
      items: [
        { kode: 'tt_ads_product', label: 'Iklan Produk', biaya: 100_000, gmv: 400_000, roas: 4 },
        { kode: 'tt_ads_live', label: 'Iklan Live', biaya: 200_000, gmv: 1_000_000, roas: 5 },
      ],
      lengkap: true,
    });
  });

  it('TikTok: nol baris pdt_fact_ads sumber tt_ads_* ⇒ iklan null (BUKAN objek kosong)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.iklan).toBeNull();
  });

  it('TikTok: sumber shopee_ads_* di client_platform_id yang sama TIDAK ikut terhitung', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'shopee_ads_cpc', 'CAM-X', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 999_999, 999_999)`;
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.iklan).toBeNull();
  });

  it('Shopee: cpc+search+live terisi ⇒ tiga item, total dijumlah, SELALU lengkap:false', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'shopee_ads_cpc', 'kmp-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100_000, 300_000),
             (${cpId}, 'shopee_ads_search', 'kmp-2', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 50_000, 100_000),
             (${cpId}, 'shopee_ads_live', 'kmp-3', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 200_000, 1_000_000)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.iklan?.lengkap).toBe(false);
    expect(hasil.iklan?.biaya).toBe(350_000);
    expect(hasil.iklan?.gmv).toBe(1_400_000);
    expect(hasil.iklan?.items.map((i) => i.kode)).toEqual(['shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live']);
  });

  it('Shopee: nol baris pdt_fact_ads sumber shopee_ads_* ⇒ iklan null', async () => {
    const { cpId } = await fixtureShopee();
    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.iklan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "afiliasi" ringkasan (G2-01 lanjutan,
// keputusan pemilik via `AskUserQuestion` 2026-09-16, KEENAM). SATU query
// platform-agnostic (pola sama "live"/"video") — `jumlahLive`/`jumlahVideo`
// otomatis `null` untuk Shopee karena `shopee_ams_afiliasi` tidak pernah
// menulis kolom itu, BUKAN filter platform eksplisit.
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "afiliasi" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  async function fixtureShopee(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: dua kreator (satu produktif, satu nol gmv) ⇒ agregat penuh termasuk jumlahLive/jumlahVideo, aov diturunkan', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_creator_period
        (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, pesanan_teratribusi, aov, ctor, jumlah_live, jumlah_video)
      values
        (${cpId}, 'creator-a', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 25, 999_999, 0.5, 5, 8),
        (${cpId}, 'creator-b', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 0, 0, 0, 0, 1, 2)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.afiliasi).toEqual({
      totalKreator: 2, produktif: 1, gmv: 1_000_000, pesanan: 25, aov: 40_000, jumlahLive: 6, jumlahVideo: 10,
    });
  });

  it('TikTok: nol baris pdt_fact_creator_period ⇒ afiliasi null (BUKAN objek kosong)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.afiliasi).toBeNull();
  });

  it('Shopee: satu kreator produktif, jumlahLive/jumlahVideo null (shopee_ams_afiliasi tidak pernah menulisnya)', async () => {
    const { cpId, batchId } = await fixtureShopee();
    await sql`
      insert into pdt_fact_creator_period
        (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, pesanan_teratribusi)
      values (${cpId}, 'creator-shp', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 150_000, 3)`;

    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.afiliasi).toEqual({
      totalKreator: 1, produktif: 1, gmv: 150_000, pesanan: 3, aov: 50_000, jumlahLive: null, jumlahVideo: null,
    });
  });

  it('Shopee: nol baris pdt_fact_creator_period ⇒ afiliasi null', async () => {
    const { cpId } = await fixtureShopee();
    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.afiliasi).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rakitLaporanTiktok/Shopee — bagian "tahap" (G2-01 lanjutan, keputusan
// pemilik via `AskUserQuestion` 2026-09-16, KETUJUH, dua ronde). TikTok-ONLY
// — Shopee SELALU `tahap: null` (mesin lama Shopee tidak punya konsep
// buyer-journey sama sekali, bukan gap data).
// ---------------------------------------------------------------------------
describeDb('rakitLaporanTiktok/Shopee — bagian "tahap" (2026-09-16)', () => {
  async function fixtureTiktok(): Promise<{ cpId: number; batchId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const rows = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values
        (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    return { cpId, batchId: rows[0].id };
  }

  it('TikTok: kpi+klik+cpa+aff_posting+tahap_fokus semuanya terisi ⇒ funnel+blok penuh sesuai yang buildable', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`update client_platforms set tahap_fokus = 'conversion' where id = ${cpId}`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung, produk_diklik)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 10_000_000, 100, 5_000, 2_500)`;
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, pesanan_sku, gmv)
      values (${cpId}, 'tt_ads_product', 'CAM-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 300_000, 15, 1_500_000)`;
    await sql`
      insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, pesanan_teratribusi, jumlah_live, jumlah_video)
      values (${cpId}, 'creator-a', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 500_000, 10, 2, 0),
             (${cpId}, 'creator-b', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 0, 0, 0, 0)`;

    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.tahap?.fokus).toBe('conversion');
    expect(hasil.tahap?.blok.find((b) => b.kode === 'conversion')?.fokus).toBe(true);
    const klik = hasil.tahap?.funnel.find((f) => f.kode === 'klik');
    expect(klik?.nilai).toBe(2_500);
    const conv = hasil.tahap?.blok.find((b) => b.kode === 'conversion')?.metrik ?? [];
    expect(conv.find((m) => m.kode === 'roi')?.nilai).toBe(5);
    expect(conv.find((m) => m.kode === 'cpa')?.nilai).toBe(20_000);
    expect(conv.find((m) => m.kode === 'aff_produktif')?.nilai).toBe(1);
    const cons = hasil.tahap?.blok.find((b) => b.kode === 'consideration')?.metrik ?? [];
    expect(cons.find((m) => m.kode === 'aff_total')?.nilai).toBe(2);
    expect(cons.find((m) => m.kode === 'aff_posting')?.nilai).toBe(1);
  });

  it('TikTok: tahap_fokus belum diset (null) ⇒ fokus null, seluruh blok fokus:false', async () => {
    const { cpId, batchId } = await fixtureTiktok();
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 10, 500)`;
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.tahap?.fokus).toBeNull();
    expect(hasil.tahap?.blok.every((b) => !b.fokus)).toBe(true);
  });

  it('TikTok: nol baris pdt_fact_shop_daily basis net ⇒ tahap null (whole object, BUKAN objek ber-field null)', async () => {
    const { cpId } = await fixtureTiktok();
    const hasil = await rakitLaporanTiktok(sql, cpId, '2026-07-01');
    expect(hasil.tahap).toBeNull();
  });

  it('Shopee: SELALU tahap null, meski kpi/iklan/afiliasi terisi penuh (mesin lama tidak punya konsep buyer-journey)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const [{ id: batchId }] = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, ${OWNER_AM})
      returning id`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung, produk_diklik)
      values (${cpId}, '2026-07-05'::date, 'siap_dikirim', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 8_000_000, 80, 4_000, 2_000)`;
    const hasil = await rakitLaporanShopee(sql, cpId, '2026-07-01');
    expect(hasil.tahap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bacaLaporanPdt (sesi 34 lanjutan, Flow B langkah 1) — gerbang izin
// `canKirimLaporan` + pemilihan platform dari `client_platforms.platform`
// (bukan parameter caller), pola sama `previewUploadBatch`/`commitUploadBatch`.
// ---------------------------------------------------------------------------
describeDb('bacaLaporanPdt (sesi 34 lanjutan) — gerbang izin + pemilihan platform', () => {
  async function fixture(platform: 'TikTok Shop' | 'Shopee', ownerAm: string | null = OWNER): Promise<{ cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, ownerAm);
    const cpId = await insertClientPlatform(clientId, platform);
    return { cpId };
  }

  it('client_platform_id tidak ada ⇒ NotFoundError', async () => {
    await expect(bacaLaporanPdt(sql, am(), 999_999_999, '2026-07-01')).rejects.toThrow(NotFoundError);
  });

  it('AM bukan pemilik ⇒ ForbiddenError', async () => {
    const { cpId } = await fixture('Shopee');
    await expect(bacaLaporanPdt(sql, am('ZPDT-LAIN'), cpId, '2026-07-01')).rejects.toThrow(ForbiddenError);
  });

  it('AM pemilik, lead Account, atau Director ⇒ diizinkan (delegasi ke rakitLaporanTiktok/Shopee)', async () => {
    const { cpId: cpTiktok } = await fixture('TikTok Shop');
    await expect(bacaLaporanPdt(sql, am(), cpTiktok, '2026-07-01')).resolves.toHaveProperty('platform', 'tiktok');
    await expect(bacaLaporanPdt(sql, accountLead(), cpTiktok, '2026-07-01')).resolves.toHaveProperty('platform', 'tiktok');
    await expect(bacaLaporanPdt(sql, director(), cpTiktok, '2026-07-01')).resolves.toHaveProperty('platform', 'tiktok');
  });

  it('platform TikTok Shop ⇒ merakit via rakitLaporanTiktok (benchmarkVersi terisi)', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const hasil = await bacaLaporanPdt(sql, am(), cpId, '2026-07-01');
    expect(hasil.schema).toBe('cdps.pdt.laporan.tiktok.v1');
    expect((hasil as { benchmarkVersi: number }).benchmarkVersi).toBe(1);
  });

  it('platform Shopee ⇒ merakit via rakitLaporanShopee (nol field benchmarkVersi)', async () => {
    const { cpId } = await fixture('Shopee');
    const hasil = await bacaLaporanPdt(sql, am(), cpId, '2026-07-01');
    expect(hasil.schema).toBe('cdps.pdt.laporan.shopee.v1');
    expect('benchmarkVersi' in hasil).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kirimLaporanPdt (Flow B langkah 4, "Kirim ke klien") — membekukan hasil
// bacaLaporanPdt ke pdt_laporan_kiriman (Rule 22). Gerbang izin didelegasikan
// SELURUHNYA ke bacaLaporanPdt (nol duplikasi) — pola pengujian di sini hanya
// membuktikan delegasi itu bekerja (satu kasus Forbidden, satu NotFound),
// bukan mengulang seluruh matriks peran yang sudah dibuktikan di atas.
//
// `dikirim_oleh` ber-FK ke `employees` (beda dari `clients.assigned_am_id`/
// `client_platforms.created_by` yang tidak) — actor pengirim WAJIB `ownerActor()`
// (baris employees sungguhan, `beforeAll` di atas), bukan `am()`/OWNER murni.
// ---------------------------------------------------------------------------
describeDb('kirimLaporanPdt (Flow B langkah 4) — bekukan snapshot ke pdt_laporan_kiriman', () => {
  async function fixture(platform: 'TikTok Shop' | 'Shopee'): Promise<{ cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, platform);
    return { cpId };
  }

  it('client_platform_id tidak ada ⇒ NotFoundError, nol baris ditulis', async () => {
    await expect(kirimLaporanPdt(sql, ownerActor(), 999_999_999, '2026-07-01')).rejects.toThrow(NotFoundError);
  });

  it('AM bukan pemilik ⇒ ForbiddenError, nol baris ditulis', async () => {
    const { cpId } = await fixture('Shopee');
    await expect(kirimLaporanPdt(sql, otherAm(), cpId, '2026-07-01')).rejects.toThrow(ForbiddenError);
    const rows = await sql`select id from pdt_laporan_kiriman where client_platform_id = ${cpId}`;
    expect(rows).toHaveLength(0);
  });

  it('TikTok: benchmark_versi terisi (Rule 23), parser_versi = PDT_PARSER_VERSI, payload = hasil bacaLaporanPdt persis, kiriman pertama menggantikan_kiriman_id null', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const now = new Date('2026-08-01T09:00:00.000Z');
    const dilihat = await bacaLaporanPdt(sql, ownerActor(), cpId, '2026-07-01', now);

    const hasil = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01', now);
    expect(hasil.clientPlatformId).toBe(cpId);
    expect(hasil.periodeMulai).toBe('2026-07-01');
    expect(hasil.periodeSelesai).toBe('2026-07-31');
    expect(hasil.parserVersi).toBe(pdtCore.PDT_PARSER_VERSI);
    expect(hasil.benchmarkVersi).toBe(1);
    expect(hasil.dikirimOleh).toBe(OWNER_AM);
    expect(hasil.menggantikanKirimanId).toBeNull();
    expect(hasil.laporan).toEqual(dilihat);

    const [row] = await sql<{ payload: unknown; benchmark_versi: number | null }[]>`
      select payload, benchmark_versi from pdt_laporan_kiriman where id = ${hasil.id}`;
    expect(row.benchmark_versi).toBe(1);
    expect(row.payload).toEqual(JSON.parse(JSON.stringify(dilihat)));
  });

  it('Shopee: benchmark_versi NULL (migrasi 20261031010000 — nol pdt_benchmark dibaca Shopee)', async () => {
    const { cpId } = await fixture('Shopee');
    const hasil = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');
    expect(hasil.benchmarkVersi).toBeNull();

    const [row] = await sql<{ benchmark_versi: number | null }[]>`
      select benchmark_versi from pdt_laporan_kiriman where id = ${hasil.id}`;
    expect(row.benchmark_versi).toBeNull();
  });

  it('kirim ulang periode yang sama (Flow B langkah 5) ⇒ baris baru menunjuk kiriman sebelumnya, TIDAK menimpa', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const pertama = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');
    const kedua = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');

    expect(pertama.menggantikanKirimanId).toBeNull();
    expect(kedua.menggantikanKirimanId).toBe(pertama.id);
    expect(kedua.id).not.toBe(pertama.id);

    const rows = await sql`select id from pdt_laporan_kiriman where client_platform_id = ${cpId}`;
    expect(rows).toHaveLength(2); // append-only — kiriman pertama TIDAK dihapus/ditimpa.
  });

  it('kiriman untuk toko/periode BERBEDA tidak saling menggantikan', async () => {
    const { cpId: cpA } = await fixture('TikTok Shop');
    const { cpId: cpB } = await fixture('TikTok Shop');
    const a = await kirimLaporanPdt(sql, ownerActor(), cpA, '2026-07-01');
    const bBedaToko = await kirimLaporanPdt(sql, ownerActor(), cpB, '2026-07-01');
    const bBedaPeriode = await kirimLaporanPdt(sql, ownerActor(), cpA, '2026-08-01');

    expect(bBedaToko.menggantikanKirimanId).toBeNull();
    expect(bBedaPeriode.menggantikanKirimanId).toBeNull();
    expect(a.id).not.toBe(bBedaToko.id);
  });

  it('baris tertulis immutable — UPDATE mentah ditolak trigger (Rule 22, aturan rumah #3)', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const hasil = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');
    await expect(sql`update pdt_laporan_kiriman set benchmark_versi = null where id = ${hasil.id}`)
      .rejects.toThrow(/immutable/);
  });

  it('mencatat audit_log (aturan rumah #3 — riwayat pengiriman tidak boleh senyap)', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const hasil = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');
    const rows = await sql<{ action: string; actor_employee_id: string }[]>`
      select action, actor_employee_id from audit_log
       where entity_type = 'pdt_laporan_kiriman' and entity_id = ${String(hasil.id)}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('pdt_laporan_dikirim');
    expect(rows[0].actor_employee_id).toBe(OWNER_AM);
  });

  it('periode selain awal bulan ⇒ ValidationError (delegasi ke rakitLaporanTiktok/Shopee)', async () => {
    const { cpId } = await fixture('TikTok Shop');
    await expect(kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-15')).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// riwayatKirimanPdt (Flow B langkah 5) — daftar pdt_laporan_kiriman satu
// toko, terbaru dulu. Gerbang izin sama persis `canKirimLaporan`
// (loadClientPlatformUntukPdt langsung, BUKAN delegasi lewat bacaLaporanPdt/
// kirimLaporanPdt) — pola pengujian sama seperti describe di atas: satu
// Forbidden, satu NotFound, sisanya membuktikan bentuk+urutan daftar.
// ---------------------------------------------------------------------------
describeDb('riwayatKirimanPdt (Flow B langkah 5) — daftar kiriman satu toko, terbaru dulu', () => {
  async function fixture(platform: 'TikTok Shop' | 'Shopee'): Promise<{ cpId: number }> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, platform);
    return { cpId };
  }

  it('client_platform_id tidak ada ⇒ NotFoundError', async () => {
    await expect(riwayatKirimanPdt(sql, ownerActor(), 999_999_999)).rejects.toThrow(NotFoundError);
  });

  it('AM bukan pemilik ⇒ ForbiddenError', async () => {
    const { cpId } = await fixture('Shopee');
    await expect(riwayatKirimanPdt(sql, otherAm(), cpId)).rejects.toThrow(ForbiddenError);
  });

  it('toko yang belum pernah dikirimi laporan ⇒ daftar kosong (BUKAN error)', async () => {
    const { cpId } = await fixture('TikTok Shop');
    await expect(riwayatKirimanPdt(sql, ownerActor(), cpId)).resolves.toEqual([]);
  });

  it('satu kiriman ⇒ satu baris, bentuk sama PdtLaporanKirimanHasil MINUS payload/laporan', async () => {
    const { cpId } = await fixture('TikTok Shop');
    const dikirim = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');

    const riwayat = await riwayatKirimanPdt(sql, ownerActor(), cpId);
    expect(riwayat).toHaveLength(1);
    const [r] = riwayat;
    expect(r).toEqual({
      id: dikirim.id,
      clientPlatformId: cpId,
      periodeMulai: '2026-07-01',
      periodeSelesai: '2026-07-31',
      parserVersi: dikirim.parserVersi,
      benchmarkVersi: 1,
      dikirimPada: dikirim.dikirimPada,
      dikirimOleh: OWNER_AM,
      menggantikanKirimanId: null,
    });
    expect('laporan' in r).toBe(false);
  });

  it('kirim ulang periode yang sama ⇒ terbaru dulu, menggantikan_kiriman_id menunjuk yang lama', async () => {
    const { cpId } = await fixture('Shopee');
    const pertama = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');
    const kedua = await kirimLaporanPdt(sql, ownerActor(), cpId, '2026-07-01');

    const riwayat = await riwayatKirimanPdt(sql, ownerActor(), cpId);
    expect(riwayat).toHaveLength(2);
    expect(riwayat[0].id).toBe(kedua.id);
    expect(riwayat[0].menggantikanKirimanId).toBe(pertama.id);
    expect(riwayat[0].benchmarkVersi).toBeNull(); // Shopee — migrasi 20261031010000.
    expect(riwayat[1].id).toBe(pertama.id);
    expect(riwayat[1].menggantikanKirimanId).toBeNull();
  });

  it('kiriman toko LAIN tidak ikut tercampur (isolasi per client_platform_id)', async () => {
    const { cpId: cpA } = await fixture('TikTok Shop');
    const { cpId: cpB } = await fixture('TikTok Shop');
    await kirimLaporanPdt(sql, ownerActor(), cpA, '2026-07-01');
    await kirimLaporanPdt(sql, ownerActor(), cpB, '2026-07-01');
    await kirimLaporanPdt(sql, ownerActor(), cpB, '2026-08-01');

    const riwayatA = await riwayatKirimanPdt(sql, ownerActor(), cpA);
    const riwayatB = await riwayatKirimanPdt(sql, ownerActor(), cpB);
    expect(riwayatA).toHaveLength(1);
    expect(riwayatB).toHaveLength(2);
    expect(riwayatA.every((r) => r.clientPlatformId === cpA)).toBe(true);
    expect(riwayatB.every((r) => r.clientPlatformId === cpB)).toBe(true);
  });
});
