/**
 * Adopsi Sistem (pemilik 2026-09-10, Bagian 1) — `GET /adopsi` dan
 * `POST /adopsi/page-view`.
 *
 * Matriks izin berjalan TANPA `DATABASE_URL`: kedua gerbang diperiksa sebelum
 * basis data disentuh.
 *
 * Yang dijaga di sini dan tidak bisa dijaga di lapisan domain: bahwa rute
 * perekam **mengabaikan `employee_id` di badan permintaan** — inilah
 * satu-satunya alasan angka laporan ini bisa dipercaya sama sekali.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';
import { POST } from './page-view/route';

const SECRET = 'test-jwt-secret-adopsi';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(c: { employeeId: string; division: string; level: string; od?: boolean; director?: boolean }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: {
      employee_id: c.employeeId, division: c.division, level: c.level,
      od: c.od ?? false, director: c.director ?? false,
    },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const get = (token: string, qs = ''): Request =>
  new Request(`http://localhost/api/v1/adopsi${qs}`, { headers: { authorization: `Bearer ${token}` } });

const post = (token: string, body: unknown): Request =>
  new Request('http://localhost/api/v1/adopsi/page-view', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const salesStaff = sign({ employeeId: 'EMP-0001', division: 'Sales', level: 'staff' });
const salesLead = sign({ employeeId: 'ZZAD-LEAD', division: 'Sales', level: 'lead' });
const hrLead = sign({ employeeId: 'ZZAD-HR', division: 'HR', level: 'lead' });
const od = sign({ employeeId: 'ZZAD-OD', division: 'Management', level: 'staff', od: true });
const director = sign({ employeeId: 'ZZAD-DIR', division: 'Management', level: 'staff', director: true });

describe('GET /adopsi — matriks izin (tanpa DB)', () => {
  it('lead divisi -> 403, termasuk lead HR', async () => {
    // Sempit dengan SENGAJA. Pemilik: "indikator adaptasi tim ke sistem baru —
    // BUKAN komponen reward". Lead HR ikut ditolak walau ia mengelola roster:
    // mengelola siapa yang bekerja bukan hal yang sama dengan melihat berapa
    // jam tiap orang membuka aplikasi.
    expect((await GET(get(salesLead))).status).toBe(403);
    expect((await GET(get(hrLead))).status).toBe(403);
  });

  it('staff -> 403', async () => {
    expect((await GET(get(salesStaff))).status).toBe(403);
  });

  it('tanpa token -> 401, bukan 403', async () => {
    expect((await GET(new Request('http://localhost/api/v1/adopsi'))).status).toBe(401);
    expect((await POST(new Request('http://localhost/api/v1/adopsi/page-view', { method: 'POST' }))).status).toBe(401);
  });
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

describeDb('POST /adopsi/page-view + GET /adopsi — DB sungguhan', () => {
  afterAll(async () => {
    if (!sql) return;
    await sql`alter table page_views disable trigger trg_page_views_no_delete`;
    try {
      await sql`delete from page_views`;
    } finally {
      await sql`alter table page_views enable trigger trg_page_views_no_delete`;
    }
    await sql.end();
  });

  it('`employee_id` di badan permintaan DIABAIKAN — jejaknya selalu milik aktornya', async () => {
    // Kalau ini memerah, siapa pun bisa mengarang pemakaian atas nama orang
    // lain, dan seluruh laporan berhenti berarti.
    const res = await POST(post(salesStaff, {
      path: '/sales/kinerja?x=1',
      nav_href: '/sales/kinerja',
      nav_total: 9,
      employee_id: 'EMP-0002',
    }));
    expect(res.status).toBe(201);
    const rows = await sql<{ employee_id: string; path: string }[]>`
      select employee_id, path from page_views order by id desc limit 1`;
    expect(rows[0].employee_id).toBe('EMP-0001');
    expect(rows[0].employee_id).not.toBe('EMP-0002');
    expect(rows[0].path).toBe('/sales/kinerja');
  });

  it('badan permintaan yang cacat tetap 201 — log tidak boleh merusak halaman yang memanggilnya', async () => {
    const res = await POST(post(salesStaff, { path: 42, nav_href: [], nav_total: 'banyak' }));
    expect(res.status).toBe(201);
    const rows = await sql<{ path: string; nav_href: string | null; nav_total: number }[]>`
      select path, nav_href, nav_total from page_views order by id desc limit 1`;
    expect(rows[0].path).toBe('/');
    expect(rows[0].nav_href).toBeNull();
    expect(rows[0].nav_total).toBe(0);
  });

  it('OD dan Director membaca laporannya', async () => {
    for (const token of [od, director]) {
      const res = await GET(get(token));
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { rows: unknown[]; mulai_tercatat: string | null } };
      expect(Array.isArray(body.data.rows)).toBe(true);
      // Batas yang WAJIB sampai ke layar: sejak kapan pencatatan ada.
      expect(body.data.mulai_tercatat).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
