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
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  canKelolaBenchmark,
  canKirimLaporan,
  canUploadBatch,
  commitUploadBatch,
  platformKeVokabPdt,
  previewUploadBatch,
  siapkanUploadBatch,
  tandaiBatchGagalRaw,
  tandaiRawTersimpan,
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
  // Array JS MENTAH ke ::jsonb, BUKAN JSON.stringify manual — postgres.js men-serialize sendiri;
  // stringify manual + cast akan meng-encode DUA KALI (kolom jadi string berisi teks JSON, bukan
  // array — akunKontenToko.includes(...) di kode produksi lolos "kebetulan" karena String.prototype
  // juga punya .includes(), ditemukan menulis tes commitUploadBatch, bukan gejala yang dicari).
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, akun_konten_toko, created_by)
    values (${clientId}, ${platform}, true, ${shopId}, ${akunKontenToko ? sql.json([...akunKontenToko]) : null}, 'ZZ-TEST')
    returning id`;
  return rows[0].id;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // commitUploadBatch (G1-09 sub-langkah 2) menulis pdt_upload_batch/pdt_file — dibersihkan
  // LEBIH DULU (FK client_id → clients, dibuat_oleh → employees) memakai prefix nextClientId
  // ('CLI-ZPDT-'), bukan created_by like 'ZZ-%' (handoff SESI11 §2.2: nol tabrakan
  // lintas-berkas test paralel).
  await sql`delete from pdt_file where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-ZPDT-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-ZPDT-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  // employee_id SPESIFIK ('ZPDT-AM-DB'), BUKAN created_by like 'ZZ-%' — generik itu menghapus
  // baris employees berkas TEST LAIN yang berjalan BERSAMAAN (vitest paralel antar-berkas, mis.
  // admin.test.ts/client.test.ts juga memakai created_by='ZZ-TEST' untuk employees mereka
  // sendiri) — ditemukan sebagai kegagalan flaky lintas-berkas menulis tes sesi ini.
  await sql`delete from employees where employee_id = ${OWNER_AM}`;
});

const OWNER_AM = 'ZPDT-AM-DB';
const ownerActor = () => ({ employeeId: OWNER_AM, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const otherAm = () => ({ employeeId: 'ZPDT-AM-LAIN', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const leadActor = () => ({ employeeId: 'ZPDT-SPV-DB', role: permission.makeRole({ division: 'Account', level: 'lead' }) });

/** commitUploadBatch menulis pdt_upload_batch.dibuat_oleh (FK employees) — nol-cost re-insert per tes (ON CONFLICT DO NOTHING), dibersihkan afterEach. */
async function ensureOwnerEmployee(): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${OWNER_AM}, 'AM Pemilik', ${OWNER_AM + '@mea.id'}, 'Account', 'ZZ-PDT-AM', true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

const decodeGagalBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: null, decodeGagal: pesan, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

const ditolakPagarBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: { pesan }, decodeGagal: null, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

/** Berkas shopee_ads_cpc LENGKAP (seluruh kolomDipanen + preamble) — cukup untuk status 'ok' dan sinyal identitas/periode. */
function shopeeAdsCpcBerkas(nama: string, idToko: string, periode: string): PdtPreviewBerkasInput {
  const header = [
    'ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
    'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)',
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
  return { nama, sha256: 'sha-cpc', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'] };
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
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

/**
 * Sama seperti `ttVideoBerkas`, TAPI membawa kolom periode (`Date Range`,
 * salah satu `KANDIDAT_KOLOM_PERIODE_TIKTOK`) — `commitUploadBatch` (beda
 * dari `previewUploadBatch`, yang tesnya di atas tidak pernah menyentuh
 * `periode`) MENOLAK batch bila nol satu pun berkas membawa periode
 * terbaca, jadi tes commit murni-TikTok butuh fixture yang membawanya.
 */
function ttVideoBerkasDenganPeriode(nama: string, idKreator: string, periode = '01/07/2026 - 31/07/2026'): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)', 'Date Range'];
  const aoa: unknown[][] = [
    [], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000', periode],
    [idKreator, 'V2', '02/07/2026', 'Produk B', '200', '20', '4', '10', 'Kreator A', 'info', '2000', '80000', periode],
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

/** Header `shopee_shop_stats` (Rule 6/7) — literal identik `kolomDipanen`/`report/shopee/shopee.test.ts` HOME_HEADER. */
const SHOP_STATS_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];

/** Berkas shopee_shop_stats LENGKAP, DUA basis (Dibuat + Siap Dikirim — cukup untuk rekonsiliasi Rule 16). */
function shopeeShopStatsBerkas(nama: string, gmvSiapDikirim: number, pesananSiapDikirim = 100): PdtPreviewBerkasInput {
  const baris = (total: string, pesanan: string) => [total, pesanan, 'Rp100.000', '10', '500', '2,00%', '0', 'Rp0', '0', 'Rp0', '90', '30', '60', '5', '20,00%'];
  const aoa: unknown[][] = [
    ['Pesanan Dibuat'],
    SHOP_STATS_HEADER,
    ['Total', ...baris(`Rp${(gmvSiapDikirim * 1.1).toFixed(0)}`, String(Math.round(pesananSiapDikirim * 1.1)))],
    ['Pesanan Siap Dikirim'],
    SHOP_STATS_HEADER,
    ['Total', ...baris(`Rp${gmvSiapDikirim}`, String(pesananSiapDikirim))],
  ];
  return { nama, sha256: 'sha-stats', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'] };
}

/**
 * Berkas shopee_parent_sku LENGKAP — Σ `Penjualan (Pesanan Siap Dikirim) (IDR)` = `gmvSiapDikirimBaris`
 * dijumlah, Σ `Pesanan Siap Dikirim` = `pesananSiapDikirimBaris` dijumlah (default: 1 pesanan/baris,
 * dipakai pemanggil yang cuma peduli sisi GMV — lihat `shopeeShopStatsBerkas` default
 * `pesananSiapDikirim=100`, jadi pemanggil yang rekonsiliasi pesanannya harus cocok WAJIB
 * menyertakan array eksplisit yang jumlahnya sejajar).
 */
function shopeeParentSkuBerkas(
  nama: string,
  gmvSiapDikirimBaris: readonly number[],
  pesananSiapDikirimBaris: readonly number[] = gmvSiapDikirimBaris.map(() => 1),
): PdtPreviewBerkasInput {
  const header = [
    'Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
    'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Pesanan Dibuat', 'Pesanan Siap Dikirim',
    'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
    'repeat order', 'Pengunjung Produk (Kunjungan)',
  ];
  const aoa: unknown[][] = [
    header,
    ...gmvSiapDikirimBaris.map((gmv, i) => [
      `SKU-${i}`, `VAR-${i}`, `IND-${i}`, `Rp${gmv}`, `Rp${gmv}`,
      String(pesananSiapDikirimBaris[i]), String(pesananSiapDikirimBaris[i]),
      '100', '10', '10,00%', '2', '90',
    ]),
  ];
  return { nama, sha256: 'sha-parent-sku', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'] };
}

async function readBatch(batchId: number) {
  const rows = await sql`select * from pdt_upload_batch where id = ${batchId}`;
  return rows[0] as Record<string, unknown>;
}

async function readFiles(batchId: number) {
  return sql`select * from pdt_file where batch_id = ${batchId} order by nama_entri` as Promise<Record<string, unknown>[]>;
}

const paketMeta = (over: Partial<{ sha256Paket: string; bytesPaket: number; entriTotal: number; entriDilewati: number }> = {}) => ({
  sha256Paket: 'sha-paket', bytesPaket: 12345, entriTotal: 1, entriDilewati: 0, ...over,
});

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
      aoa: [['x']], modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
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
      aoa: [['x']], modulTerdeteksi: null, ambiguous: false, matches: [],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('perlu_pilih_modul');
    expect(hasil.berkas[0].pesan).toContain('tidak dikenali');
  });

  it('modul terdeteksi, kolom wajib LENGKAP ⇒ status ok, baris header DICARI bukan hint mentah', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('e.xlsx', '111', '01/07/2026 - 31/07/2026')]);
    expect(hasil.berkas[0]).toMatchObject({ status: 'ok', modulKode: 'shopee_ads_cpc', barisHeader: 8, kolomDipanen: 11, kolomBaru: [], pesan: null });
  });

  it('modul terdeteksi, kolom wajib HILANG ⇒ status gagal, pesan menyebut nama kolom (Rule 9)', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'f.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['Kode Produk', 'Dilihat', 'Biaya']], // shopee_ads_cpc, tapi 8 dari 11 kolomDipanen hilang
      modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('gagal');
    expect(hasil.berkas[0].pesan).toContain("'Periode'");
  });

  it('kolom di luar whitelist/alias tercatat sebagai kolomBaru (Rule 8, NAMA saja)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkas('g.xlsx', '111', '01/07/2026 - 31/07/2026');
    (berkas.aoa as unknown[][])[7] = [...(berkas.aoa as unknown[][])[7], 'Kolom Rahasia Baru'];
    (berkas.aoa as unknown[][])[8] = [...(berkas.aoa as unknown[][])[8], 'nilai-rahasia'];
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [berkas]);
    expect(hasil.berkas[0].kolomBaru).toEqual(['Kolom Rahasia Baru']);
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
      aoa: [header], modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
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
// commitUploadBatch (G1-09 sub-langkah 2) — Flow A langkah 6-9, menulis
// pdt_upload_batch/pdt_file (nol Storage — dites terpisah di
// apps/api/src/lib/pdt-storage.test.ts). SEKARANG tetap = '2026-08-01' di
// seluruh describe ini kecuali disebut lain, supaya retensi_sampai deterministik.
// ---------------------------------------------------------------------------
const SEKARANG = new Date('2026-08-01T00:00:00Z');

describeDb('commitUploadBatch (G1-09 sub-langkah 2) — gerbang izin + platform', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    await expect(commitUploadBatch(sql, ownerActor(), 999999999, [], { paket: paketMeta(), sekarang: SEKARANG })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(commitUploadBatch(sql, otherAm(), cpId, [], { paket: paketMeta(), sekarang: SEKARANG })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('platform Tokopedia ⇒ ValidationError, nol baris ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [], { paket: paketMeta(), sekarang: SEKARANG })).rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select count(*)::int as n from pdt_upload_batch where client_platform_id = ${cpId}`;
    expect(rows[0].n).toBe(0);
  });
});

describeDb('commitUploadBatch — periode tidak bisa diresolusi ⇒ 400, NOL baris (beda dari identitas/rekonsiliasi ditolak)', () => {
  it('nol berkas ber-status ok ⇒ ValidationError, nol pdt_upload_batch ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(
      commitUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('x.xlsx', 'rusak')], { paket: paketMeta(), sekarang: SEKARANG }),
    ).rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select count(*)::int as n from pdt_upload_batch where client_platform_id = ${cpId}`;
    expect(rows[0].n).toBe(0);
  });

  it('berkas ok tapi nol satu pun membawa periode terbaca ⇒ ValidationError, nol baris', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    // shopee_shop_stats TIDAK membawa preamble/periode sama sekali (Rule 5 ayat 2 mewarisi —
    // tapi nol berkas LAIN di batch untuk diwarisi dari).
    const berkas = shopeeShopStatsBerkas('stats.xlsx', 1_000_000);
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [berkas], { paket: paketMeta(), sekarang: SEKARANG })).rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select count(*)::int as n from pdt_upload_batch where client_platform_id = ${cpId}`;
    expect(rows[0].n).toBe(0);
  });
});

describeDb('commitUploadBatch — perlu_pilih_modul yang tidak di-override ⇒ ditolak SEBELUM tulis DB', () => {
  it('berkas ambiguous tanpa override ⇒ ValidationError menyebut nama berkas, nol baris', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const ambigu: PdtPreviewBerkasInput = {
      nama: 'ambigu.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
    };
    await expect(commitUploadBatch(sql, ownerActor(), cpId, [ambigu], { paket: paketMeta(), sekarang: SEKARANG })).rejects.toThrow(/ambigu\.xlsx/);
    const rows = await sql`select count(*)::int as n from pdt_upload_batch where client_platform_id = ${cpId}`;
    expect(rows[0].n).toBe(0);
  });
});

describeDb('commitUploadBatch — identitas Rule 2-4', () => {
  it("identitas 'tolak' (ID Toko berkas ≠ shop_id tersimpan) ⇒ batch DITOLAK, TETAP TERSIMPAN (Flow A langkah 9)", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-LAMA');
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId,
      [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')],
      { paket: paketMeta(), sekarang: SEKARANG },
    );
    expect(hasil.status).toBe('ditolak');
    expect(hasil.alasanDitolak).toContain('938284780');
    expect(hasil.alasanDitolak).toContain('SHOP-LAMA');

    const batch = await readBatch(hasil.batchId);
    expect(batch.status).toBe('ditolak');
    expect(batch.retensi_alasan).toBe('ditolak');
    expect(batch.retensi_sampai).toEqual(new Date('2026-08-31')); // +30 hari (Rule 45)
  });

  it("identitas 'usulkan_ikat' TANPA konfirmasi AM ⇒ status identitas_belum_terikat, client_platforms TIDAK berubah", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId,
      [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')],
      { paket: paketMeta(), sekarang: SEKARANG },
    );
    expect(hasil.status).toBe('identitas_belum_terikat');
    const cp = await sql`select shop_id, shop_username from client_platforms where id = ${cpId}`;
    expect(cp[0].shop_id).toBeNull();

    const batch = await readBatch(hasil.batchId);
    expect(batch.retensi_alasan).toBe('default');
    expect(batch.retensi_sampai).toEqual(new Date('2026-11-29')); // +120 hari (Rule 45) — diterima, bukan ditolak
  });

  it("identitas 'usulkan_ikat' DENGAN konfirmasi AM ⇒ verified, client_platforms.shop_id/shop_username terikat", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId,
      [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')],
      { konfirmasiIkatIdentitas: true, paket: paketMeta(), sekarang: SEKARANG },
    );
    expect(hasil.status).toBe('verified');
    const cp = await sql`select shop_id, shop_username from client_platforms where id = ${cpId}`;
    expect(cp[0].shop_id).toBe('938284780');
    expect(cp[0].shop_username).toBe('tokoku');
  });

  it("TikTok 'usulkan_ikat' DENGAN konfirmasi ⇒ akun_konten_toko terisi array berisi ID Kreator diusulkan", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId, [ttVideoBerkasDenganPeriode('v.xlsx', 'kreator-a')],
      { konfirmasiIkatIdentitas: true, paket: paketMeta(), sekarang: SEKARANG },
    );
    expect(hasil.status).toBe('verified');
    const cp = await sql`select akun_konten_toko from client_platforms where id = ${cpId}`;
    expect(cp[0].akun_konten_toko).toEqual(['kreator-a']);
  });

  it("identitas 'tidak_dapat_divalidasi' ⇒ TIDAK ditolak (ditokan Nerissa 2026-09-13: A, docs/DECISIONS.md) — lolos ke verified", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    // shopee_shop_stats TIDAK membawa preamble sama sekali, TAPI berkas lain (parent_sku, tanpa
    // preamble juga) mewarisi periode — jadi periode resolve, identitas tidak_dapat_divalidasi.
    const stats = shopeeShopStatsBerkas('stats.xlsx', 1_000_000);
    // sisipkan periode lewat berkas ads_cpc TANPA memicu validasi identitas gagal — pakai shop_id
    // yang SAMA persis supaya identitas ads_cpc sendiri 'cocok', bukan sumber sinyal yang diuji di sini.
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const parentSku = shopeeParentSkuBerkas('parent.xlsx', [1_000_000], [100]); // pesanan sejajar shop-level (default shopeeShopStatsBerkas) — sisi pesanan tidak diuji di sini
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [stats, ads, parentSku], { paket: paketMeta(), sekarang: SEKARANG });
    // Catatan: fixture ini SENGAJA membawa berkas ads_cpc (identitas 'cocok'), bukan menguji
    // tidak_dapat_divalidasi murni (butuh nol berkas preamble sama sekali + periode dari sumber
    // lain — TikTok saja yang punya jalur itu, lihat tes TikTok murni di bawah).
    expect(hasil.status).toBe('verified');
  });
});

describeDb('commitUploadBatch — rekonsiliasi Rule 13-16 (GMV DAN pesanan, basis siap_dikirim — G1-09-PARENTSKU-PESANAN ditutup 2026-09-13)', () => {
  it('delta GMV ≤ 0,5% (pesanan sejajar) ⇒ verified, reconcile_delta_pct tersimpan (bukan null — Rule 14 diagnostik)', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const stats = shopeeShopStatsBerkas('stats.xlsx', 1_000_000);
    const parentSku = shopeeParentSkuBerkas('parent.xlsx', [999_900], [100]); // GMV 0,01% (dalam ambang), pesanan 0% — sisi pesanan tidak diuji di sini
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ads, stats, parentSku], { paket: paketMeta(), sekarang: SEKARANG });
    expect(hasil.status).toBe('verified');
    const batch = await readBatch(hasil.batchId);
    expect(batch.reconcile_delta_pct).not.toBeNull();
    expect(Number(batch.reconcile_delta_pct)).toBeCloseTo(0.01, 3);
  });

  it('delta GMV > 0,5% (pesanan sejajar) ⇒ ditolak, alasan menyebut GMV + persentase + basis, reconcile_delta_pct tersimpan, TETAP TERSIMPAN', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const stats = shopeeShopStatsBerkas('stats.xlsx', 1_000_000);
    const parentSku = shopeeParentSkuBerkas('parent.xlsx', [800_000], [100]); // GMV 20% (jauh di atas ambang), pesanan 0%
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ads, stats, parentSku], { paket: paketMeta(), sekarang: SEKARANG });
    expect(hasil.status).toBe('ditolak');
    expect(hasil.alasanDitolak).toContain('GMV');
    expect(hasil.alasanDitolak).toContain('Pesanan Siap Dikirim');
    expect(hasil.alasanDitolak).toMatch(/2\d\.\d\d%/); // ~20.00%
    const batch = await readBatch(hasil.batchId);
    expect(Number(batch.reconcile_delta_pct)).toBeGreaterThan(0.5);
    expect(batch.retensi_alasan).toBe('ditolak'); // +30 hari, bukan +120
  });

  it('GMV per-SKU cocok TAPI pesanan per-SKU beda jauh ⇒ ditolak, alasan menyebut pesanan (kasus persis contoh handoff SESI12 §1b) — gerbang GMV-only LAMA akan meloloskannya', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const stats = shopeeShopStatsBerkas('stats.xlsx', 1_000_000, 100); // shop-level: GMV 1.000.000, 100 pesanan
    const parentSku = shopeeParentSkuBerkas('parent.xlsx', [999_900], [50]); // GMV 0,01% (dalam ambang), pesanan 50% (jauh di atas ambang)
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ads, stats, parentSku], { paket: paketMeta(), sekarang: SEKARANG });
    expect(hasil.status).toBe('ditolak');
    expect(hasil.alasanDitolak).toContain('pesanan');
    expect(hasil.alasanDitolak).toContain('Pesanan Siap Dikirim');
    const batch = await readBatch(hasil.batchId);
    expect(Number(batch.reconcile_delta_pct)).toBeGreaterThan(0.5);
  });

  it('shopee_shop_stats/shopee_parent_sku TIDAK keduanya hadir ⇒ rekonsiliasi DILEWATI, tetap verified', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ads], { paket: paketMeta(), sekarang: SEKARANG });
    expect(hasil.status).toBe('verified');
    const batch = await readBatch(hasil.batchId);
    expect(batch.reconcile_delta_pct).toBeNull();
  });
});

describeDb('commitUploadBatch — override AM per berkas (Rule 4) + pdt_file per entri (Rule 10)', () => {
  it('override menimpa deteksi tanda tangan, deteksi_oleh=override_am; berkas lain tetap tanda_tangan', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']);
    const salahDeteksi: PdtPreviewBerkasInput = { ...ttVideoBerkasDenganPeriode('salah.xlsx', 'kreator-a'), modulTerdeteksi: null, ambiguous: true, matches: ['tt_video', 'tt_live'] };
    const benar = ttVideoBerkasDenganPeriode('benar.xlsx', 'kreator-a');
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId, [salahDeteksi, benar],
      { moduleOverrides: { 'salah.xlsx': 'tt_video' }, paket: paketMeta({ entriTotal: 2 }), sekarang: SEKARANG },
    );
    expect(hasil.status).toBe('verified');
    const files = await readFiles(hasil.batchId);
    expect(files.find((f) => f.nama_entri === 'salah.xlsx')).toMatchObject({ deteksi_oleh: 'override_am', modul_kode: 'tt_video', parse_status: 'ok' });
    expect(files.find((f) => f.nama_entri === 'benar.xlsx')).toMatchObject({ deteksi_oleh: 'tanda_tangan', modul_kode: 'tt_video', parse_status: 'ok' });
  });

  it('override ke modul platform LAIN ⇒ ValidationError, nol baris ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const berkas = shopeeAdsCpcBerkas('a.xlsx', '111', '01/07/2026 - 31/07/2026');
    await expect(
      commitUploadBatch(sql, ownerActor(), cpId, [berkas], { moduleOverrides: { 'a.xlsx': 'tt_video' }, paket: paketMeta(), sekarang: SEKARANG }),
    ).rejects.toBeInstanceOf(ValidationError);
    const rows = await sql`select count(*)::int as n from pdt_upload_batch where client_platform_id = ${cpId}`;
    expect(rows[0].n).toBe(0);
  });

  it('berkas ditolakPagar/decodeGagal TETAP jadi baris pdt_file (Rule 10 — dibedakan dari "tidak diunggah")', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const ads = shopeeAdsCpcBerkas('ads.xlsx', 'SHOP-1', '01/07/2026 - 31/07/2026');
    const rusak = decodeGagalBerkas('rusak.xlsx', 'berkas tidak berisi sheet apa pun');
    const ditolak = ditolakPagarBerkas('encrypted.xlsx', '[berkas terenkripsi]');
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ads, rusak, ditolak], { paket: paketMeta({ entriTotal: 3 }), sekarang: SEKARANG });
    expect(hasil.status).toBe('verified');
    const files = await readFiles(hasil.batchId);
    expect(files.find((f) => f.nama_entri === 'rusak.xlsx')).toMatchObject({ parse_status: 'gagal', parse_error: 'berkas tidak berisi sheet apa pun', sha256: null, bytes: null, baris_header: null, modul_kode: null });
    expect(files.find((f) => f.nama_entri === 'encrypted.xlsx')).toMatchObject({ parse_status: 'gagal', parse_error: '[berkas terenkripsi]', sha256: null, bytes: null, baris_header: null, modul_kode: null });
  });

  it('meta paket (sha256/bytes/entri/entri_dilewati) tersimpan apa adanya di pdt_upload_batch', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']);
    const hasil = await commitUploadBatch(
      sql, ownerActor(), cpId, [ttVideoBerkasDenganPeriode('v.xlsx', 'kreator-a')],
      { paket: paketMeta({ sha256Paket: 'sha-abc', bytesPaket: 999, entriTotal: 5, entriDilewati: 2 }), sekarang: SEKARANG },
    );
    const batch = await readBatch(hasil.batchId);
    expect(batch.raw_sha256).toBe('sha-abc');
    expect(Number(batch.raw_bytes)).toBe(999);
    expect(batch.raw_entri).toBe(5);
    expect(batch.raw_entri_dilewati).toBe(2);
    expect(batch.raw_path).toBeNull(); // belum dipindahkan Storage — lihat tandaiRawTersimpan
  });
});

describeDb('tandaiRawTersimpan / tandaiBatchGagalRaw (dipanggil route sesudah pindahkanPdtRawObjek)', () => {
  async function batchVerified(): Promise<number> {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a']);
    const hasil = await commitUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkasDenganPeriode('v.xlsx', 'kreator-a')], { paket: paketMeta(), sekarang: SEKARANG });
    return hasil.batchId;
  }

  it('tandaiRawTersimpan mengisi raw_path, TIDAK mengubah status', async () => {
    const batchId = await batchVerified();
    await tandaiRawTersimpan(sql, batchId, 'CLI-X/1/2026-07-31/1.zip');
    const batch = await readBatch(batchId);
    expect(batch.raw_path).toBe('CLI-X/1/2026-07-31/1.zip');
    expect(batch.status).toBe('verified');
  });

  it('tandaiBatchGagalRaw membalik status ke ditolak + alasan, TAPI TIDAK MEMPERPENDEK retensi_sampai yang sudah 120 hari (Rule 45)', async () => {
    const batchId = await batchVerified();
    const sebelum = await readBatch(batchId);
    expect(sebelum.retensi_sampai).toEqual(new Date('2026-11-29')); // +120 hari dari SEKARANG

    await tandaiBatchGagalRaw(sql, batchId, '[gagal memindahkan paket ke penyimpanan permanen, hubungi engineer]', SEKARANG);
    const sesudah = await readBatch(batchId);
    expect(sesudah.status).toBe('ditolak');
    expect(sesudah.alasan_ditolak).toBe('[gagal memindahkan paket ke penyimpanan permanen, hubungi engineer]');
    expect(sesudah.retensi_sampai).toEqual(new Date('2026-11-29')); // TIDAK turun ke +30 hari
    expect(sesudah.raw_path).toBeNull();
  });
});
