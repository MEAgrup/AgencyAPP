/**
 * GET /api/v1/account/pdt/laporan/kiriman (G2-01, Flow B langkah 5, "riwayat
 * kiriman") — route wiring: auth, query (`client_platform_id`),
 * `pdt.riwayatKirimanPdt` (gerbang `canKirimLaporan`), wire snake_case
 * (`pdtKirimanRingkasToWire`, dibungkus `{ data: [...] }` pola sama
 * `intake`/`workload`). Cakupan urutan+isolasi per toko ada di
 * `packages/domain/src/pdt.test.ts` (`riwayatKirimanPdt` langsung) — di sini
 * cukup bukti route SUNGGUHAN menyambungkan seluruhnya, pola sama
 * `laporan/kirim/route.test.ts`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';
import { POST as KIRIM } from '../kirim/route';

const SECRET = 'test-jwt-secret-pdt-laporan-riwayat';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

interface Claims { employeeId: string; division: string; level: string; od: boolean; director: boolean }

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(c: Claims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: { employee_id: c.employeeId, division: c.division, level: c.level, od: c.od, director: c.director },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function reqGet(token: string, qs: string): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman?${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function reqKirim(token: string, body: unknown): Request {
  return new Request('http://localhost/api/v1/account/pdt/laporan/kirim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const owner = sign({ employeeId: 'ZZ-PDTRWY-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTRWY-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('GET /pdt/laporan/kiriman — gagal sebelum DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await GET(reqGet(owner, ''));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await GET(reqGet(owner, 'client_platform_id=-1'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — prefix 'ZZ-PDTRWY-'/
// 'CLI-PDTRWY-' (beda dari file tes PDT lain supaya tidak pernah bersinggungan).
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTRWY-${Date.now() % 100000}-${seq++}`;

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

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-PDTRWY-AM', 'AM Uji Riwayat Kiriman', 'zz-pdtrwy-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTRWY-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTRWY-%')`;
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTRWY-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTRWY-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTRWY-%'`;
  await sql`delete from clients where id like 'CLI-PDTRWY-%'`;
});

describeDb('GET /pdt/laporan/kiriman — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    const res = await GET(reqGet(owner, 'client_platform_id=999999999'));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRWY-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await GET(reqGet(otherAm, `client_platform_id=${cpId}`));
    expect(res.status).toBe(403);
  });

  it('toko belum pernah dikirimi laporan ⇒ 200 { data: [] }', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRWY-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await GET(reqGet(owner, `client_platform_id=${cpId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [] });
  });

  it('kirim lalu daftar ⇒ 200 satu baris, benchmark_versi/menggantikan_kiriman_id ikut wire, nol kunci `laporan`', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRWY-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');

    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    expect(resKirim.status).toBe(200);
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(owner, `client_platform_id=${cpId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    const [r] = body.data;
    expect(r.id).toBe(bodyKirim.id);
    expect(r.client_platform_id).toBe(cpId);
    expect(r.periode_mulai).toBe('2026-07-01');
    expect(r.benchmark_versi).toBe(1);
    expect(r.dikirim_oleh).toBe('ZZ-PDTRWY-AM');
    expect(r.menggantikan_kiriman_id).toBeNull();
    expect('laporan' in r).toBe(false);
  });

  it('kirim dua kali ⇒ 200 dua baris, terbaru dulu, kedua menunjuk pertama', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRWY-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');

    const resKirim1 = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim1 = await resKirim1.json();
    const resKirim2 = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim2 = await resKirim2.json();

    const res = await GET(reqGet(owner, `client_platform_id=${cpId}`));
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe(bodyKirim2.id);
    expect(body.data[0].menggantikan_kiriman_id).toBe(bodyKirim1.id);
    expect(body.data[1].id).toBe(bodyKirim1.id);
    expect(body.data[1].menggantikan_kiriman_id).toBeNull();
  });
});
