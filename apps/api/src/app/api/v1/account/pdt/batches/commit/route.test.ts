/**
 * POST /api/v1/account/pdt/batches/commit (G1-09 sub-langkah 2, Flow A
 * langkah 6-9) — route wiring: auth, `client_platform_id`/`storage_path`/
 * `module_overrides`/`konfirmasi_ikat_identitas`, unduh dari Storage
 * (`unduhPdtRawObjek`), pipeline G1-04/05/09, `pdt.commitUploadBatch`, DAN
 * pemindahan objek staging → path final (`pindahkanPdtRawObjek`) sesudah
 * baris batch ada. Cakupan per-baris/identitas/rekonsiliasi yang lebih dalam
 * ada di `packages/domain/src/pdt.test.ts` (`commitUploadBatch` langsung) —
 * di sini cukup bukti bahwa route SUNGGUHAN merangkai ketiganya (unduh →
 * tulis DB → pindah Storage), termasuk jalur kegagalan pemindahan.
 *
 * `globalThis.fetch` DISUNTIK (pola sama `preview/route.test.ts`) untuk
 * MENDUA: `unduhPdtRawObjek` adalah GET, `pindahkanPdtRawObjek` adalah POST
 * `/object/move` — `stubStorage` di bawah membedakan keduanya lewat method.
 *
 * Permission/400 (field hilang, pagar paket menolak) berjalan TANPA
 * `DATABASE_URL`. Jalur 200/403/404/commit sungguhan butuh Postgres nyata
 * (di-skip tanpa `DATABASE_URL`).
 */
import { createHmac } from 'node:crypto';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const SECRET = 'test-jwt-secret-pdt-commit';
const prevSecret = process.env.SUPABASE_JWT_SECRET;
const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prevServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const prevFetch = globalThis.fetch;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

interface Claims { employeeId: string; division: string; level: string; od: boolean; director: boolean }

function sign(c: Claims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: { employee_id: c.employeeId, division: c.division, level: c.level, od: c.od, director: c.director },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(token: string, body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/account/pdt/batches/commit', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STORAGE_PATH = '_staging/CLI-PDTCM/1/abc.zip';

/**
 * Menyuntik `globalThis.fetch` untuk KEDUA panggilan Storage route ini
 * lakukan: GET (unduh, `unduhPdtRawObjek`) dan POST `/object/move` (pindah,
 * `pindahkanPdtRawObjek`, HANYA dipanggil setelah commit menulis baris batch).
 * `moveOk=false` mensimulasikan kegagalan infra pemindahan (Flow A langkah 9).
 */
function stubStorage(zipBuf: Buffer, moveOk = true): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(zipBuf as unknown as BodyInit, { status: 200 });
    if (method === 'POST' && url.endsWith('/storage/v1/object/move')) {
      return moveOk
        ? new Response(JSON.stringify({ message: 'Successfully moved' }), { status: 200 })
        : new Response(JSON.stringify({ message: 'not_found' }), { status: 404 });
    }
    throw new Error(`stubStorage: panggilan fetch tak terduga: ${method} ${url}`);
  }) as typeof fetch;
}

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

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
  if (prevSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
  if (prevServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRoleKey;
});
beforeEach(() => { stubStorage(Buffer.from('')); });
afterEach(() => { globalThis.fetch = prevFetch; });

const OWNER_AM = 'ZZ-PDTCM-AM';
const owner = sign({ employeeId: OWNER_AM, division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTCM-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches/commit — gagal sebelum Storage/DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
  });

  it('storage_path hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 1 }));
    expect(res.status).toBe(400);
  });
});

describe('POST /pdt/batches/commit — gagal setelah unduh Storage', () => {
  it('objek Storage tidak ditemukan ⇒ 400 BI, bukan 500', async () => {
    stubStorage(Buffer.from(''), true);
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah tidak ditemukan di penyimpanan sementara, unggah ulang]');
  });

  it('paket ZIP > 40 entri ⇒ 400 Rule 42, sebelum satu entri pun dibaca', async () => {
    const entries = Array.from({ length: 41 }, (_, i) => ({ nama: `f${i}.xlsx`, isi: Buffer.from('x') }));
    stubStorage(await zipkan(entries));
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[paket ZIP berisi lebih dari 40 entri]');
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// dengan preview/route.test.ts, prefix 'ZZ-PDTCM-'/'CLI-PDTCM-'.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTCM-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(clientId: string, platform: string, shopId: string | null = null): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, created_by)
    values (${clientId}, ${platform}, true, ${shopId}, 'ZZ-TEST') returning id`;
  return Number(rows[0].id);
}

/** commitUploadBatch menulis pdt_upload_batch.dibuat_oleh (FK employees). */
async function ensureOwnerEmployee(): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${OWNER_AM}, 'AM Pemilik', ${OWNER_AM + '@mea.id'}, 'Account', 'ZZ-PDTCM-AM', true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

afterAll(async () => { if (sql) await sql.end(); });
afterEach(async () => {
  if (!sql) return;
  // pdt_upload_batch/pdt_file dulu (FK client_id → clients, dibuat_oleh → employees), lalu
  // client_platforms/clients/employees — prefix 'CLI-PDTCM-', bukan created_by (paralel antar-berkas).
  await sql`delete from pdt_file where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTCM-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTCM-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTCM-%'`;
  await sql`delete from clients where id like 'CLI-PDTCM-%'`;
  await sql`delete from employees where employee_id = ${OWNER_AM}`;
});

/** Satu berkas shopee_parent_sku LENGKAP + preamble-less — cukup untuk status 'ok', tapi TIDAK cukup untuk periode (dipakai bersama berkas ads di bawah). */
const PARENT_SKU_HEADER = [
  'Kode Produk', 'Kode Variasi', 'SKU Induk',
  'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
  'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
  'repeat order', 'Pengunjung Produk (Kunjungan)',
];

/** Berkas shopee_ads_cpc LENGKAP — cukup untuk identitas 'usulkan_ikat'/'cocok' + periode (preamble). */
function adsCpcXlsx(idToko: string, periode = '01/07/2026 - 31/07/2026'): Buffer {
  const header = [
    'ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
    'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)',
  ];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`], ['Username: tokoku'], ['Nama Toko: Toko Saya'], [`Periode: ${periode}`], [], [], [],
    header,
    ['P1', '01/07/2026', 'PRD-1', '100', '10', '2', '5000', 'Iklan A', '200000', '4x', '2,5'],
  ];
  return xlsxDariAoa(aoa);
}

describeDb('POST /pdt/batches/commit — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    stubStorage(await zipkan([]));
    const res = await POST(req(owner, { client_platform_id: 999999999, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    stubStorage(await zipkan([]));
    const res = await POST(req(otherAm, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(403);
  });

  it("200: identitas 'usulkan_ikat' TANPA konfirmasi ⇒ status identitas_belum_terikat, raw_path terisi path final Rule 44", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    stubStorage(await zipkan([{ nama: 'ads.xlsx', isi: adsCpcXlsx('938284780') }]));

    const res = await POST(req(owner, {
      client_platform_id: cpId, storage_path: STORAGE_PATH,
      module_overrides: { 'ads.xlsx': 'shopee_ads_cpc' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      client_platform_id: cpId, platform: 'shopee', status: 'identitas_belum_terikat', alasan_ditolak: null,
    });
    expect(typeof body.batch_id).toBe('number');
    expect(body.periode_selesai).toBe('2026-07-31');

    const batch = await sql`select raw_path, status from pdt_upload_batch where id = ${body.batch_id}`;
    expect(batch[0].raw_path).toBe(`${clientId}/${cpId}/2026-07-31/${body.batch_id}.zip`);
    expect(batch[0].status).toBe('identitas_belum_terikat');
  });

  it('200: konfirmasi_ikat_identitas=true ⇒ verified, client_platforms.shop_id terikat', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    stubStorage(await zipkan([{ nama: 'ads.xlsx', isi: adsCpcXlsx('938284780') }]));

    const res = await POST(req(owner, {
      client_platform_id: cpId, storage_path: STORAGE_PATH, konfirmasi_ikat_identitas: true,
      module_overrides: { 'ads.xlsx': 'shopee_ads_cpc' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('verified');
    const cp = await sql`select shop_id from client_platforms where id = ${cpId}`;
    expect(cp[0].shop_id).toBe('938284780');
  });

  it("identitas 'tolak' (shop_id berkas ≠ tersimpan) ⇒ 200 dengan status ditolak (TETAP tersimpan, bukan error HTTP)", async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-LAMA');
    stubStorage(await zipkan([{ nama: 'ads.xlsx', isi: adsCpcXlsx('938284780') }]));

    const res = await POST(req(owner, {
      client_platform_id: cpId, storage_path: STORAGE_PATH,
      module_overrides: { 'ads.xlsx': 'shopee_ads_cpc' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ditolak');
    expect(body.alasan_ditolak).toContain('938284780');
    expect(body.alasan_ditolak).toContain('SHOP-LAMA');

    const batch = await sql`select status, raw_path from pdt_upload_batch where id = ${body.batch_id}`;
    expect(batch[0].status).toBe('ditolak');
    expect(batch[0].raw_path).not.toBeNull(); // paket TETAP dipindah — Rule 45 "ditolak +30 hari, untuk diagnosa"
  });

  it('module_overrides menimpa berkas ambiguous ⇒ commit berhasil, deteksi_oleh=override_am', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const parentSkuAoa = [PARENT_SKU_HEADER, ['P1', 'V1', 'IND-1', '100000', '90000', '500', '50', '10%', '2', '400']];
    stubStorage(await zipkan([
      { nama: 'ads.xlsx', isi: adsCpcXlsx('938284780') },
      { nama: 'ambigu.xlsx', isi: xlsxDariAoa(parentSkuAoa) },
    ]));

    const res = await POST(req(owner, {
      client_platform_id: cpId, storage_path: STORAGE_PATH,
      module_overrides: { 'ambigu.xlsx': 'shopee_parent_sku', 'ads.xlsx': 'shopee_ads_cpc' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('identitas_belum_terikat'); // shop_id belum terikat, tanpa konfirmasi

    const files = await sql<{ nama_entri: string; modul_kode: string | null; deteksi_oleh: string }[]>`
      select nama_entri, modul_kode, deteksi_oleh from pdt_file where batch_id = ${body.batch_id} order by nama_entri`;
    // 'ambigu.xlsx' terdeteksi shopee_parent_sku SECARA TANDA TANGAN juga (kolomnya memang cocok
    // persis) — override di sini membuktikan JALUR KODE-nya jalan (deteksi_oleh berubah), bukan
    // membuktikan hasil modul berbeda dari tanda tangan (lihat pdt.test.ts domain untuk kasus itu).
    expect(files.find((f) => f.nama_entri === 'ambigu.xlsx')).toMatchObject({ modul_kode: 'shopee_parent_sku', deteksi_oleh: 'override_am' });
  });

  it('pindahkanPdtRawObjek GAGAL (infra) ⇒ 200 tetap, status dibalik ke ditolak (Flow A langkah 9), raw_path null', async () => {
    await ensureOwnerEmployee();
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    stubStorage(await zipkan([{ nama: 'ads.xlsx', isi: adsCpcXlsx('938284780') }]), false);

    const res = await POST(req(owner, {
      client_platform_id: cpId, storage_path: STORAGE_PATH, konfirmasi_ikat_identitas: true,
      module_overrides: { 'ads.xlsx': 'shopee_ads_cpc' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ditolak');
    expect(body.alasan_ditolak).toBe('[gagal memindahkan paket ke penyimpanan permanen, hubungi engineer]');

    const batch = await sql`select status, alasan_ditolak, raw_path from pdt_upload_batch where id = ${body.batch_id}`;
    expect(batch[0].status).toBe('ditolak');
    expect(batch[0].raw_path).toBeNull();
  });
});
