/**
 * POST /api/v1/account/pdt/batches (G1-09 sub-langkah 2a) — route wiring:
 * auth, `client_platform_id`/`storage_path`/`overrides`, unduh dari Storage
 * (service-role, `unduhPdtRawObjek`), pipeline G1-04/05/09 (`commitUploadBatch`
 * — MENULIS `pdt_upload_batch`/`pdt_file` sungguhan), lalu unggah paket ke
 * path final Rule 44 (`unggahPdtRawObjek`) + `markRawStored`. Cakupan per-
 * baris/status/identitas yang lebih dalam ada di
 * `packages/domain/src/pdt.test.ts` (`commitUploadBatch` langsung) — di sini
 * cukup bukti bahwa route SUNGGUHAN menyambungkan seluruhnya, pola sama
 * `preview/route.test.ts`.
 *
 * `globalThis.fetch` DISUNTIK untuk mensimulasikan Storage (GET unduh dari
 * `unduhPdtRawObjek` + POST unggah dari `unggahPdtRawObjek`) tanpa jaringan
 * sungguhan — beda dari `preview/route.test.ts` yang hanya perlu men-stub
 * SATU arah (GET).
 */
import { createHmac } from 'node:crypto';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  return new Request('http://localhost/api/v1/account/pdt/batches', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STORAGE_PATH = '_staging/CLI-PDTCM/1/abc.zip';

/** GET (unduh, `unduhPdtRawObjek`) → `buf`/`downloadStatus`; POST (unggah, `unggahPdtRawObjek`) → selalu 200 OK. */
function stubStorage(buf: Buffer | null, downloadStatus = 200): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(null, { status: 200 });
    return new Response((buf ?? undefined) as unknown as BodyInit, { status: downloadStatus });
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

const owner = sign({ employeeId: 'ZZ-PDTCM-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTCM-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches — gagal sebelum Storage/DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
  });

  it('storage_path hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 1 }));
    expect(res.status).toBe(400);
  });

  it('overrides bukan { nama, modul_kode } ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH, overrides: [{ nama: 'a.xlsx' }] }));
    expect(res.status).toBe(400);
  });
});

describe('POST /pdt/batches — gagal setelah unduh Storage', () => {
  it('objek Storage tidak ditemukan ⇒ 400 BI, bukan 500', async () => {
    stubStorage(null, 404);
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah tidak ditemukan di penyimpanan sementara, unggah ulang]');
  });

  it('badan objek bukan ZIP sama sekali ⇒ 400, bukan 500', async () => {
    stubStorage(Buffer.from('bukan zip sama sekali'));
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah bukan paket ZIP yang valid]');
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

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-PDTCM-AM', 'AM Uji Commit', 'zz-pdtcm-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTCM-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_file where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTCM-%')`;
  // pdt_fact_ads/pdt_fact_content (G1-09 sub-langkah 2b-ii) — FK ke pdt_upload_batch.batch_id,
  // dibersihkan SEBELUM pdt_upload_batch atau FK menolak DELETE (fixture ZIP nyata di berkas ini
  // bisa membawa shopee_ads_live/tt_video, yang sejak sub-langkah 2b-ii menulis baris fakta).
  await sql`delete from pdt_fact_ads where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTCM-%')`;
  await sql`delete from pdt_fact_content where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTCM-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTCM-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTCM-%'`;
  await sql`delete from clients where id like 'CLI-PDTCM-%'`;
});

// tt_video, BUKAN Shopee Ads — sengaja dihindari: header Shopee Ads CPC + preamble
// 'Username'/'Omzet' lolos deteksi tanda-tangan-di-mana-pun-dalam-sheet SEBAGAI
// shopee_ams_afiliasi juga (kedua tanda tangan sama-sama cocok), jadi ambiguous
// lewat pipeline deteksi SUNGGUHAN — beda dari fixture domain (pdt.test.ts) yang
// menyuntik modulTerdeteksi langsung, memotong detectPdtModule sama sekali. Bukan
// bug dari sub-langkah ini (G1-02 detect.ts, di luar cakupan) — dicatat di handoff.
// Periode dari PREAMBLE satu-sel `'Rentang Tanggal: ...'` sebelum header (`ekstrakPeriodePreambleTiktok`,
// DITUTUP via sample asli "Tiktok - Avitaskin.zip" — docs/DECISIONS.md G1-06-PERIODE-TIKTOK), BUKAN
// kolom header — tt_video sendiri tidak membawa periode.
function ttVideoXlsxAoa(idKreator: string, rentang: string): unknown[][] {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  return [
    [`Rentang Tanggal: ${rentang}`], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
  ];
}

describeDb('POST /pdt/batches — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    stubStorage(await zipkan([]));
    const res = await POST(req(owner, { client_platform_id: 999999999, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTCM-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    stubStorage(await zipkan([]));
    const res = await POST(req(otherAm, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(403);
  });

  it('200: ZIP TikTok sungguhan ⇒ pdt_upload_batch/pdt_file SUNGGUHAN ditulis, wire snake_case, raw_path terisi', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTCM-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    await sql`update client_platforms set akun_konten_toko = '["kreator-a"]'::jsonb where id = ${cpId}`;
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(ttVideoXlsxAoa('kreator-a', '01/07/2026 - 31/07/2026'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    stubStorage(await zipkan([{ nama: 'tt_video.xlsx', isi: xlsxBuf }]));

    const res = await POST(req(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      client_platform_id: cpId, platform: 'tiktok', status: 'parsing', alasan_ditolak: null,
      periode_mulai: '2026-07-01', periode_selesai: '2026-07-31', identitas: { status: 'cocok' },
    });
    expect(body.berkas).toHaveLength(1);
    expect(body.berkas[0]).toMatchObject({ nama: 'tt_video.xlsx', modul_kode: 'tt_video', status: 'ok', deteksi_oleh: 'tanda_tangan' });

    const rows = await sql<{ status: string; raw_path: string | null }[]>`select status, raw_path from pdt_upload_batch where id = ${body.batch_id}`;
    expect(rows[0].status).toBe('parsing');
    expect(rows[0].raw_path).toBe(`${clientId}/${cpId}/2026-07-31/${body.batch_id}.zip`);
    const files = await sql`select nama_entri from pdt_file where batch_id = ${body.batch_id}`;
    expect(files).toHaveLength(1);
  });
});
