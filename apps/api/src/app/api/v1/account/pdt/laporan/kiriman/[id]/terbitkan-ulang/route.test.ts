/**
 * POST /api/v1/account/pdt/laporan/kiriman/{id}/terbitkan-ulang — M20
 * Gelombang C (C-03). Cakupan bisnis ([Dicabut]→[Terbit], paku revisi
 * terbaru) dibuktikan `packages/domain/src/pdt.test.ts`; di sini cukup bukti
 * route SUNGGUHAN menyambungkan auth, parsing `id`, dan pemetaan status/wire.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';
import { POST as TERBITKAN } from '../terbitkan/route';
import { POST as CABUT } from '../cabut/route';
import { PUT } from '../insight/route';
import { POST as KIRIM } from '../../../kirim/route';

const SECRET = 'test-jwt-secret-pdt-terbitkan-ulang';
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

function reqPost(token: string, id: string | number, path: 'terbitkan-ulang' | 'terbitkan' = 'terbitkan-ulang'): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman/${id}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

function reqCabut(token: string, id: string | number, alasan: string): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman/${id}/cabut`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ alasan }),
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

const owner = sign({ employeeId: 'ZZ-M20CD-AM', division: 'Account', level: 'staff', od: false, director: false });

const DRAFT = {
  ringkasan: 'Ringkasan suntingan AM',
  poin: ['Poin manual pertama'],
  rekomendasi_tinggi: [{ judul: 'J', target: 'T', dampak: 'D', timeline: 'TL' }],
  rekomendasi_sedang: [],
  outlook: 'Outlook suntingan AM',
  indikator: [{ nama: 'N', target: 'T' }],
  tahap_narasi: 'Fokus Agustus adalah menstabilkan ROAS',
};

describe('POST /pdt/laporan/kiriman/{id}/terbitkan-ulang — gagal sebelum DB tersentuh', () => {
  it('id bukan integer positif ⇒ 400', async () => {
    const res = await POST(reqPost(owner, -1), ctx(-1));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — prefix 'ZZ-M20CD-'/
// 'CLI-M20CD-'.
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-M20CD-${Date.now() % 100000}-${seq++}`;

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

async function fixtureKirimanId(): Promise<number> {
  const clientId = nextClientId();
  await insertClient(clientId, 'ZZ-M20CD-AM');
  const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
  const res = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
  const body = await res.json();
  return Number(body.id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-M20CD-AM', 'AM Uji Insight Kiriman', 'zz-m20cd-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-M20CD-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_laporan_publikasi where kiriman_id in (
    select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CD-%'))`;
  // Trigger disable/enable adalah DDL global (bukan session-scoped) — dibungkus SATU
  // transaksi supaya ACCESS EXCLUSIVE lock ALTER TABLE menyerialisasi file tes lain
  // (insight, insight/reset, terbitkan, cabut) yang menjalankan dansa yang sama
  // secara BERSAMAAN (Vitest menjalankan file paralel), bukan cuma try/finally per
  // koneksi yang bisa diselang file lain di tengah jalan.
  await sql.begin(async (tx) => {
    await tx`alter table pdt_laporan_insight disable trigger trg_pdt_laporan_insight_frozen`;
    await tx`delete from pdt_laporan_insight where kiriman_id in (
      select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CD-%'))`;
    await tx`alter table pdt_laporan_insight enable trigger trg_pdt_laporan_insight_frozen`;
  });
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-M20CD-%')`;
  await sql`delete from client_platforms where client_id like 'CLI-M20CD-%'`;
  await sql`delete from clients where id like 'CLI-M20CD-%'`;
});

describeDb('POST /pdt/laporan/kiriman/{id}/terbitkan-ulang — real DB', () => {
  it('masih [Draf] (belum pernah terbit) ⇒ 409 [laporan belum diterbitkan]', async () => {
    const kirimanId = await fixtureKirimanId();
    const res = await POST(reqPost(owner, kirimanId), ctx(kirimanId));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('[laporan belum diterbitkan]');
  });

  it('terbitkan → cabut → suntingan baru → terbitkan-ulang ⇒ 200 [Terbit]', async () => {
    const kirimanId = await fixtureKirimanId();
    await TERBITKAN(reqPost(owner, kirimanId, 'terbitkan'), ctx(kirimanId));
    await CABUT(reqCabut(owner, kirimanId, 'perbaikan angka'), ctx(kirimanId));
    await PUT(reqPut(owner, kirimanId, DRAFT), ctx(kirimanId));

    const res = await POST(reqPost(owner, kirimanId), ctx(kirimanId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('[Terbit]');
    expect(body.insight_revisi).toBe(1);
  });
});
