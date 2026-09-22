/**
 * GET /api/v1/account/pdt/laporan/kiriman/{id}/html — M20 B-03: route wiring
 * (auth, `id`/`mode`/`download` params, `pdt.bacaKirimanLaporanPdt` gerbang
 * izin, `pdtCore.renderLaporanHtml`/`namaBerkasLaporan`). Cakupan render
 * (R1/R2, paritas klien/internal) ada di `packages/core/src/pdt/render.test.ts`
 * — di sini cukup bukti route SUNGGUHAN menyambungkan seluruhnya, pola sama
 * `laporan/kiriman/route.test.ts`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';
import { POST as KIRIM } from '../../../kirim/route';

const SECRET = 'test-jwt-secret-pdt-laporan-html';
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

function reqGet(token: string, id: string | number, qs = ''): Request {
  return new Request(`http://localhost/api/v1/account/pdt/laporan/kiriman/${id}/html${qs ? `?${qs}` : ''}`, {
    headers: { authorization: `Bearer ${token}` },
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

const owner = sign({ employeeId: 'ZZ-PDTHTM-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTHTM-LAIN', division: 'Account', level: 'staff', od: false, director: false });
const odUser = sign({ employeeId: 'ZZ-PDTHTM-OD', division: 'Account', level: 'staff', od: true, director: false });

describe('GET /pdt/laporan/kiriman/{id}/html — gagal sebelum DB tersentuh', () => {
  it('id bukan integer positif ⇒ 400', async () => {
    const res = await GET(reqGet(owner, -1, 'mode=klien'), ctx(-1));
    expect(res.status).toBe(400);
  });

  it('mode hilang ⇒ 400', async () => {
    const res = await GET(reqGet(owner, 1), ctx(1));
    expect(res.status).toBe(400);
  });

  it("mode bukan 'klien'/'internal' ⇒ 400", async () => {
    const res = await GET(reqGet(owner, 1, 'mode=lain'), ctx(1));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — prefix 'ZZ-PDTHTM-'/
// 'CLI-PDTHTM-' (beda dari file tes PDT lain supaya tidak pernah bersinggungan).
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTHTM-${Date.now() % 100000}-${seq++}`;

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
    values ('ZZ-PDTHTM-AM', 'AM Uji Render Kiriman', 'zz-pdthtm-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTHTM-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // pdt_laporan_publikasi/pdt_laporan_insight (M20 Gelombang C) — FK ke pdt_laporan_kiriman.id
  // TANPA ON DELETE CASCADE, jadi harus dibersihkan SEBELUM pdt_laporan_kiriman di bawah.
  // pdt_laporan_insight menolak DELETE (append-only trigger) — nonaktifkan sementara, sama
  // pola `pdt.test.ts`/`dailyactivity.test.ts`.
  await sql`delete from pdt_laporan_publikasi where kiriman_id in (
    select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTHTM-%'))`;
  await sql`alter table pdt_laporan_insight disable trigger trg_pdt_laporan_insight_frozen`;
  try {
    await sql`delete from pdt_laporan_insight where kiriman_id in (
      select id from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTHTM-%'))`;
  } finally {
    await sql`alter table pdt_laporan_insight enable trigger trg_pdt_laporan_insight_frozen`;
  }
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTHTM-%')`;
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTHTM-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTHTM-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTHTM-%'`;
  await sql`delete from clients where id like 'CLI-PDTHTM-%'`;
});

describeDb('GET /pdt/laporan/kiriman/{id}/html — real DB', () => {
  it('404 pada kiriman id yang tidak ada', async () => {
    const res = await GET(reqGet(owner, 999_999_999, 'mode=klien'), ctx(999_999_999));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTHTM-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(otherAm, bodyKirim.id, 'mode=klien'), ctx(bodyKirim.id));
    expect(res.status).toBe(403);
  });

  it('OD boleh membaca mode internal (read-only, PRD M20 §5)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTHTM-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(odUser, bodyKirim.id, 'mode=internal'), ctx(bodyKirim.id));
    expect(res.status).toBe(200);
  });

  it('mode klien ⇒ 200 text/html, nol jejak blok internal', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTHTM-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(owner, bodyKirim.id, 'mode=klien'), ctx(bodyKirim.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-disposition')).toBeNull();
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('INTERNAL');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('mode internal ⇒ 200 text/html, blok internal hadir', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTHTM-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(owner, bodyKirim.id, 'mode=internal'), ctx(bodyKirim.id));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('INTERNAL');
  });

  it('download=1 ⇒ Content-Disposition attachment dengan nama berkas bermode', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTHTM-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const resKirim = await KIRIM(reqKirim(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const bodyKirim = await resKirim.json();

    const res = await GET(reqGet(owner, bodyKirim.id, 'mode=klien&download=1'), ctx(bodyKirim.id));
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('klien');
    expect(disposition).toContain('.html');
  });
});
