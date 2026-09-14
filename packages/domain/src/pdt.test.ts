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
  markRawStored,
  platformKeVokabPdt,
  previewUploadBatch,
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
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, akun_konten_toko, created_by)
    values (${clientId}, ${platform}, true, ${shopId}, ${akunKontenToko ? JSON.stringify(akunKontenToko) : null}::jsonb, 'ZZ-TEST')
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
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

// ---------------------------------------------------------------------------
// Fixture rekonsiliasi Shopee (G1-09 sub-langkah 2b-i) — shopee_shop_stats
// BUKAN satu header, tapi DUA struktur berbeda dalam satu sheet: (a) baris
// 15-metrik DATAR (HEADER_SHOP_STATS_15) yang divalidasi validasiKolomWajib
// (Rule 9, `kolomDipanen`); (b) mini-tabel PER BASIS (marker 'Pesanan Siap
// Dikirim' → header 'Periode Waktu'/'Total Penjualan (IDR)'/'Total Pesanan'
// → baris Total) yang dibaca `parseShopeeShopStatsPerBasis` (G1-07) —
// terpisah dari (a), lihat rekonsiliasi.test.ts FIM_MOTOR_SHOP_STATS untuk
// bentuk aslinya. Detection (`detectPdtModule`) TIDAK disentuh di sini
// (fixture domain-level menyuntik `modulTerdeteksi` langsung), jadi hanya
// (a)+(b) yang perlu benar, bukan `tandaTanganKolom`.
// ---------------------------------------------------------------------------
const HEADER_SHOP_STATS_15 = [
  'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
  'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
  'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];

function shopeeShopStatsBerkas(nama: string, gmvSiapKirim: number, pesananSiapKirim: number): PdtPreviewBerkasInput {
  const dataRow15 = [String(gmvSiapKirim), String(pesananSiapKirim), '0', '0', '500', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
  const aoa: unknown[][] = [
    HEADER_SHOP_STATS_15,
    dataRow15,
    [],
    ['Pesanan Siap Dikirim'],
    ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan'],
    ['Total', String(gmvSiapKirim), String(pesananSiapKirim)],
  ];
  return {
    nama, sha256: 'sha-shopstats', bytes: 100, ditolakPagar: null, decodeGagal: null,
    aoa, modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
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
    aoa, modulTerdeteksi: 'shopee_parent_sku', ambiguous: false, matches: ['shopee_parent_sku'],
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
      aoa: [header, dataRow], modulTerdeteksi: 'tt_shop_analytics', ambiguous: false, matches: ['tt_shop_analytics'],
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
      modul_kode: 'shopee_ads_cpc', nama_entri: 'a.xlsx', sha256: 'sha-cpc', bytes: '100',
      baris_header: 8, deteksi_oleh: 'tanda_tangan', kolom_dipanen: 11, kolom_baru: [], parse_status: 'ok', parse_error: null,
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
      aoa: [['x']], modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
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
      aoa: [['x']], modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
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
