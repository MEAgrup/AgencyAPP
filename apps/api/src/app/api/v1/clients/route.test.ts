/**
 * GET /clients — filter Direktori Klien (feedback OD 27-10-2026): rentang
 * tanggal closing, status rilis, urutan. Cakupan walk-every-row ada di domain
 * (`packages/domain/src/client.test.ts`); di sini kontrak wire-nya:
 *   - parameter tidak valid = 400 pesan BI baku, sebelum membuka DB;
 *   - query string benar-benar sampai ke domain (filter + urut + kursor);
 *   - `tanggal_closing` / `lama_menunggu_hari` selalu ada (null eksplisit).
 *
 * Token minting mirrors leads/route.test.ts (node:crypto, no mocking).
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bi } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';

const SECRET = 'test-jwt-secret-clients-filter';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(c: { employeeId: string; division: string; level: string; od: boolean; director: boolean }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: {
      employee_id: c.employeeId, division: c.division, level: c.level, od: c.od, director: c.director,
    },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(token: string, qs = ''): Request {
  return new Request(`http://localhost/api/v1/clients${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const director = sign({ employeeId: 'ZZ-CF-DIR', division: 'Management', level: 'staff', od: false, director: true });

describe('GET /clients — validasi filter (tanpa DB: ditolak sebelum membaca)', () => {
  for (const qs of [
    '?closing_dari=27-10-2026',
    '?closing_sampai=2026-02-30',
    '?status_rilis=released',
    '?urut=asc',
  ]) {
    it(`${qs} = 400 dengan pesan BI baku`, async () => {
      const res = await GET(req(director, qs));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(bi.INCOMPLETE_DATA);
    });
  }
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

describeDb('GET /clients — filter tanggal closing & status rilis lewat wire', () => {
  const TAG = 'ZZCFTOKO';
  // [id, closing WIB, dirilis?]
  const SEED: [string, string, boolean][] = [
    ['CLI-ZZCF-0001', '2026-09-05 10:00:00+07', true],
    ['CLI-ZZCF-0002', '2026-09-20 10:00:00+07', false],
    ['CLI-ZZCF-0003', '2026-10-05 10:00:00+07', false],
  ];
  const IDS = SEED.map(([id]) => id);

  afterEach(async () => {
    if (!sql) return;
    await sql`delete from clients where id = any(${IDS})`;
  });
  afterAll(async () => {
    if (sql) await sql.end();
  });

  async function seed(): Promise<void> {
    for (const [id, at, released] of SEED) {
      await sql`
        insert into clients (id, winning_attempt_id, nama_pic, toko, kota, link_toko, kategori,
                             gmv_baseline, target_gmv, sales_pic_id, commission_payment_pic_id,
                             released_to_account_at, created_at, created_by)
        values (${id}, ${`ATT-${id}`}, 'ZZ PIC', ${`${TAG} ${id}`}, 'Bandung', 'https://x', 'Fashion',
                0, 0, 'ZZ-CF-DIR', 'ZZ-CF-DIR',
                ${released ? '2026-10-01 10:00:00+07' : null}::timestamptz, ${at}::timestamptz, 'ZZ-CF-DIR')`;
    }
  }
  const ids = (body: { data: { id: string }[] }): string[] => body.data.map((r) => r.id);

  it('rentang tanggal closing + status rilis Menunggu Finance', async () => {
    await seed();
    const body = await (await GET(req(director,
      `?q=${TAG}&closing_dari=2026-09-01&closing_sampai=2026-09-30&status_rilis=menunggu_finance`))).json();
    expect(ids(body)).toEqual(['CLI-ZZCF-0002']);
    expect(body.data[0].tanggal_closing).toBe(new Date('2026-09-20T03:00:00Z').toISOString());
    expect(typeof body.data[0].lama_menunggu_hari).toBe('number');
  });

  it('status rilis Dirilis: lama_menunggu_hari null eksplisit, tanggal_closing tetap terisi', async () => {
    await seed();
    const body = await (await GET(req(director, `?q=${TAG}&status_rilis=dirilis`))).json();
    expect(ids(body)).toEqual(['CLI-ZZCF-0001']);
    expect(body.data[0]).toHaveProperty('lama_menunggu_hari', null);
    expect(body.data[0].tanggal_closing).not.toBeNull();
  });

  it('urut=terlama dipaginasi: paling lama menunggu dulu, kursor melanjutkan', async () => {
    await seed();
    const first = await (await GET(req(director, `?q=${TAG}&status_rilis=menunggu_finance&urut=terlama&limit=1`))).json();
    expect(ids(first)).toEqual(['CLI-ZZCF-0002']);
    expect(first.next_cursor).not.toBeNull();
    const second = await (await GET(req(director,
      `?q=${TAG}&status_rilis=menunggu_finance&urut=terlama&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`))).json();
    expect(ids(second)).toEqual(['CLI-ZZCF-0003']);
    expect(second.next_cursor).toBeNull();
  });
});
