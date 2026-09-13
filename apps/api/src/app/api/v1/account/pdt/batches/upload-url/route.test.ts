/**
 * POST /api/v1/account/pdt/batches/upload-url (G1-09-BODY-BESAR,
 * `docs/DECISIONS.md` 2026-09-13) — route wiring: auth, `client_platform_id`,
 * gerbang izin (`pdt.siapkanUploadBatch`), dan bentuk wire. Cakupan gerbang
 * izin/path staging yang lebih dalam ada di `packages/domain/src/pdt.test.ts`
 * (`siapkanUploadBatch` langsung) — di sini cukup bukti bahwa route
 * SUNGGUHAN menyambungkannya + memanggil Storage untuk signed upload URL.
 *
 * `globalThis.fetch` DISUNTIK (pola sama `preview/route.test.ts`) untuk
 * mensimulasikan respons `POST .../object/upload/sign/...` tanpa jaringan
 * sungguhan.
 *
 * Permission/400 (client_platform_id hilang) berjalan TANPA `DATABASE_URL`.
 * Jalur 200/403/404 butuh Postgres nyata (di-skip tanpa `DATABASE_URL`).
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const SECRET = 'test-jwt-secret-pdt-upload-url';
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

function req(token: string, body: { client_platform_id?: unknown }): Request {
  return new Request('http://localhost/api/v1/account/pdt/batches/upload-url', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Menyuntik `globalThis.fetch` supaya `buatPdtRawSignedUploadUrl` (dipanggil route) mengembalikan URL bertoken tanpa jaringan sungguhan. */
function stubSignedUploadUrl(): void {
  globalThis.fetch = (async (url: string) => {
    const path = url.replace('https://proj.supabase.co/storage/v1/object/upload/sign/pdt-raw/', '');
    return new Response(JSON.stringify({ url: `/object/upload/sign/pdt-raw/${path}?token=stub-token` }), { status: 200 });
  }) as typeof fetch;
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
beforeEach(() => { stubSignedUploadUrl(); });
afterEach(() => { globalThis.fetch = prevFetch; });

const owner = sign({ employeeId: 'ZZ-PDTUU-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTUU-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches/upload-url — gagal sebelum DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, {}));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 'abc' }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// dengan preview/route.test.ts, prefix 'ZZ-PDTUU-'.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTUU-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(clientId: string, platform: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, ${platform}, true, 'ZZ-TEST') returning id`;
  return Number(rows[0].id);
}

afterAll(async () => { if (sql) await sql.end(); });
afterEach(async () => {
  if (!sql) return;
  // Prefix client_id ('CLI-PDTUU-'), BUKAN created_by ('ZZ-TEST' generik) —
  // preview/route.test.ts memakai literal created_by yang SAMA dan berjalan
  // BERSAMAAN (vitest paralel antar-berkas), jadi cleanup ber-created_by bisa
  // menghapus baris berkas lain yang sedang dipakai (FK violation).
  await sql`delete from client_platforms where client_id like 'CLI-PDTUU-%'`;
  await sql`delete from clients where id like 'CLI-PDTUU-%'`;
});

describeDb('POST /pdt/batches/upload-url — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    const res = await POST(req(owner, { client_platform_id: 999999999 }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTUU-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await POST(req(otherAm, { client_platform_id: cpId }));
    expect(res.status).toBe(403);
  });

  it('platform Tokopedia ⇒ 400 (PDT-22, manual saja) — SEBELUM Storage dipanggil', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTUU-AM');
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    const res = await POST(req(owner, { client_platform_id: cpId }));
    expect(res.status).toBe(400);
  });

  it('200: AM pemilik ⇒ wire snake_case, storage_path staging + upload_url bertoken', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTUU-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await POST(req(owner, { client_platform_id: cpId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client_platform_id: number; storage_path: string; upload_url: string };
    expect(body.client_platform_id).toBe(cpId);
    expect(body.storage_path).toMatch(new RegExp(`^_staging/${clientId}/${cpId}/[0-9a-f-]{36}\\.zip$`));
    expect(body.upload_url).toBe(`https://proj.supabase.co/storage/v1/object/upload/sign/pdt-raw/${body.storage_path}?token=stub-token`);
  });
});
