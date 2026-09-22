/**
 * GET/PUT /api/v1/account/pdt/laporan/kiriman/{id}/insight — M20 Gelombang C
 * (C-03). Cakupan bisnis (lazy-seed, append-only revisi, validasi tujuh
 * bidang) sudah dibuktikan `packages/domain/src/pdt.test.ts` (`describeDb('M20
 * Gelombang C`) — di sini cukup bukti route SUNGGUHAN menyambungkan auth,
 * parsing `id`/body, dan pemetaan status/`*ToWire`, pola sama
 * `laporan/kiriman/[id]/html/route.test.ts`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET, PUT } from './route';
import { POST as KIRIM } from '../../../kirim/route';

const SECRET = 'test-jwt-secret-pdt-insight';
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

function reqGet(token: string, id: string | number): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman/${id}/insight`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function reqPut(token: string, id: string | number, body: unknown): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman/${id}/insight`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctx(id: string | number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
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

const owner = sign({ employeeId: 'ZZ-M20CA-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-M20CA-LAIN', division: 'Account', level: 'staff', od: false, director: false });

const DRAFT = {
  ringkasan: 'Ringkasan suntingan AM',
  poin: ['Poin manual pertama'],
  rekomendasi_tinggi: [{ judul: 'J', target: 'T', dampak: 'D', timeline: 'TL' }],
  rekomendasi_sedang: [],
  outlook: 'Outlook suntingan AM',
  indikator: [{ nama: 'N', target: 'T' }],
  tahap_narasi: 'Fokus Agustus adalah menstabilkan ROAS',
};

describe('GET/PUT /pdt/laporan/kiriman/{id}/insight — gagal sebelum DB tersentuh', () => {
  it('GET id bukan integer positif ⇒ 400', async () => {
    const res = await GET(reqGet(owner, -1), ctx(-1));
    expect(res.status).toBe(400);
  });

  it('PUT id bukan integer positif ⇒ 400', async () => {
    const res = await PUT(reqPut(owner, 'abc', DRAFT), ctx('abc'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — prefix 'ZZ-M20CA-'/
// 'CLI-M20CA-' (beda dari file tes PDT lain supaya tidak pernah bersinggungan).
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-M20CA-${Date.now() % 100000}-${seq++}`;

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

async function fixtureKirimanId(token = owner): Promise<number> {
  const clientId = nextClientId();
  await insertClient(clientId, 'ZZ-M20CA-AM');
  const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
  const res = await KIRIM(reqKirim(token, { client_platform_id: cpId, periode: '2026-07-01' }));
  const body = await res.json();
  return Number(body.id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-M20CA-AM', 'AM Uji Insight Kiriman', 'zz-m20ca-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-M20CA-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_laporan_publikasi where kiriman_id in (
    select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CA-%'))`;
  // Trigger disable/enable adalah DDL global (bukan session-scoped) — dibungkus SATU
  // transaksi supaya ACCESS EXCLUSIVE lock ALTER TABLE menyerialisasi file tes lain
  // (insight/reset, terbitkan, terbitkan-ulang, cabut) yang menjalankan dansa yang
  // sama secara BERSAMAAN (Vitest menjalankan file paralel), bukan cuma try/finally
  // per koneksi yang bisa diselang file lain di tengah jalan.
  await sql.begin(async (tx) => {
    await tx`alter table pdt_laporan_insight disable trigger trg_pdt_laporan_insight_frozen`;
    await tx`delete from pdt_laporan_insight where kiriman_id in (
      select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CA-%'))`;
    await tx`alter table pdt_laporan_insight enable trigger trg_pdt_laporan_insight_frozen`;
  });
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CA-%')`;
  await sql`delete from client_platforms where client_id like 'CLI-M20CA-%'`;
  await sql`delete from clients where id like 'CLI-M20CA-%'`;
});

describeDb('GET /pdt/laporan/kiriman/{id}/insight — real DB', () => {
  it('200, lazy-seed revisi 0 mesin + publikasi [Draf], bentuk wire snake_case', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await GET(reqGet(owner, kirimanId), ctx(kirimanId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kiriman_id).toBe(kirimanId);
    expect(body.terbaru.revisi).toBe(0);
    expect(body.terbaru.sumber).toBe('mesin');
    expect(body.publikasi.status).toBe('[Draf]');
    expect(body.publikasi.insight_revisi).toBe(0);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await GET(reqGet(otherAm, kirimanId), ctx(kirimanId));
    expect(res.status).toBe(403);
  });
});

describeDb('PUT /pdt/laporan/kiriman/{id}/insight — real DB', () => {
  it('draf valid ⇒ 200, revisi baru (1)', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await PUT(reqPut(owner, kirimanId, DRAFT), ctx(kirimanId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revisi).toBe(1);
    expect(body.sumber).toBe('am');
    expect(body.ringkasan).toBe(DRAFT.ringkasan);
    expect(body.tahap_narasi).toBe(DRAFT.tahap_narasi);
  });

  it('ringkasan kosong ⇒ 400 [ringkasan eksekutif wajib diisi]', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await PUT(reqPut(owner, kirimanId, { ...DRAFT, ringkasan: '' }), ctx(kirimanId));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('[ringkasan eksekutif wajib diisi]');
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await PUT(reqPut(otherAm, kirimanId, DRAFT), ctx(kirimanId));
    expect(res.status).toBe(403);
  });
});
