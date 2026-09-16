/**
 * POST /api/v1/account/pdt/laporan/kirim (G2-01, Flow B langkah 4, "Kirim ke
 * klien") — route wiring: auth, body (`client_platform_id`/`periode`),
 * `pdt.kirimLaporanPdt` (gerbang `canKirimLaporan` lewat `bacaLaporanPdt` +
 * tulis `pdt_laporan_kiriman`), wire snake_case (`pdtLaporanKirimanToWire`).
 * Cakupan agregasi per-baris + immutability/audit ada di
 * `packages/domain/src/pdt.test.ts` (`kirimLaporanPdt` langsung) — di sini
 * cukup bukti route SUNGGUHAN menyambungkan seluruhnya, pola sama
 * `laporan/route.test.ts`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pdt as pdtCore } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const SECRET = 'test-jwt-secret-pdt-laporan-kirim';
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

function req(token: string, body: unknown): Request {
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

const owner = sign({ employeeId: 'ZZ-PDTKIR-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTKIR-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/laporan/kirim — gagal sebelum DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { periode: '2026-07-01' }));
    expect(res.status).toBe(400);
  });

  it('periode hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 1 }));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: -1, periode: '2026-07-01' }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// `laporan/route.test.ts`, prefix 'ZZ-PDTKIR-'/'CLI-PDTKIR-' (beda dari
// 'ZZ-PDTLAP-'/'CLI-PDTLAP-' supaya dua berkas tes tidak pernah bersinggungan).
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTKIR-${Date.now() % 100000}-${seq++}`;

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
    values ('ZZ-PDTKIR-AM', 'AM Uji Kirim Laporan', 'zz-pdtkir-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTKIR-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_laporan_kiriman where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTKIR-%')`;
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTKIR-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTKIR-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTKIR-%'`;
  await sql`delete from clients where id like 'CLI-PDTKIR-%'`;
});

describeDb('POST /pdt/laporan/kirim — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    const res = await POST(req(owner, { client_platform_id: 999999999, periode: '2026-07-01' }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await POST(req(otherAm, { client_platform_id: cpId, periode: '2026-07-01' }));
    expect(res.status).toBe(403);
  });

  it('periode tidak valid ⇒ 400 BI (bukan 500 mentah)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const res = await POST(req(owner, { client_platform_id: cpId, periode: '2026-07-15' }));
    expect(res.status).toBe(400);
  });

  it('200 TikTok: baris pdt_laporan_kiriman tertulis, benchmark_versi terisi, menggantikan_kiriman_id null', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const [{ id: batchId }] = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, 'ZZ-PDTKIR-AM')
      returning id`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 50_000, 40, 2_000)`;

    const res = await POST(req(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_platform_id).toBe(cpId);
    expect(body.periode_mulai).toBe('2026-07-01');
    expect(body.periode_selesai).toBe('2026-07-31');
    expect(body.parser_versi).toBe(pdtCore.PDT_PARSER_VERSI);
    expect(body.benchmark_versi).toBe(2); // versi 2 aktif tertinggi (G2-01-KUADRAN-SKU langkah 2, migrasi 20261104010000)
    expect(body.dikirim_oleh).toBe('ZZ-PDTKIR-AM');
    expect(body.menggantikan_kiriman_id).toBeNull();
    expect(body.laporan.schema).toBe('cdps.pdt.laporan.tiktok.v1');
    expect(body.laporan.kpi).toEqual({ gmv: 950_000, pesanan: 40, pengunjung: 2_000, cvr: 0.02 });

    const rows = await sql`select id from pdt_laporan_kiriman where id = ${body.id}`;
    expect(rows).toHaveLength(1);
  });

  it('200 dengan insight override: draf AM menggantikan insight mesin pada payload beku (G2-01-INSIGHT-EDIT)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const [{ id: batchId }] = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, 'ZZ-PDTKIR-AM')
      returning id`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 50_000, 40, 2_000)`;

    const res = await POST(req(owner, {
      client_platform_id: cpId,
      periode: '2026-07-01',
      insight: {
        ringkasan: 'Ringkasan AM.',
        poin: ['Poin AM.'],
        rekomendasi_tinggi: [],
        rekomendasi_sedang: [],
        outlook: 'Outlook AM.',
        indikator: [],
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.laporan.insight).toEqual({
      ringkasan: 'Ringkasan AM.',
      poin: ['Poin AM.'],
      rekomendasi_tinggi: [],
      rekomendasi_sedang: [],
      outlook: 'Outlook AM.',
      indikator: [],
    });
  });

  it('400 BI kalau insight override tidak lengkap (ringkasan kosong), nol baris ditulis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');

    const res = await POST(req(owner, {
      client_platform_id: cpId,
      periode: '2026-07-01',
      insight: { ringkasan: '', poin: ['Poin.'], outlook: 'Outlook.' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('[ringkasan eksekutif wajib diisi]');

    const rows = await sql`select id from pdt_laporan_kiriman where client_platform_id = ${cpId}`;
    expect(rows).toHaveLength(0);
  });

  it('200 Shopee: benchmark_versi null (kunci TETAP ada)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await POST(req(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect('benchmark_versi' in body).toBe(true);
    expect(body.benchmark_versi).toBeNull();
    expect(body.laporan.schema).toBe('cdps.pdt.laporan.shopee.v1');
  });

  it('kirim dua kali periode yang sama ⇒ kiriman kedua menunjuk yang pertama (Flow B langkah 5)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKIR-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');

    const res1 = await POST(req(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const body1 = await res1.json();
    const res2 = await POST(req(owner, { client_platform_id: cpId, periode: '2026-07-01' }));
    const body2 = await res2.json();

    expect(body1.menggantikan_kiriman_id).toBeNull();
    expect(body2.menggantikan_kiriman_id).toBe(body1.id);

    const rows = await sql`select id from pdt_laporan_kiriman where client_platform_id = ${cpId}`;
    expect(rows).toHaveLength(2);
  });
});
