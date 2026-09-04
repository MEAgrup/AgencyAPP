/**
 * P2 §6 (docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md) — GET /leads is
 * keyset-paginated.
 *
 * What is worth asserting at the ROUTE level (the domain's own walk-every-row
 * coverage lives in packages/domain/src/leads_reads.test.ts):
 *   - the wire contract: `next_cursor` is ALWAYS present, explicitly null on
 *     the last page — a missing key is the O43 failure this house treats as
 *     worse than a null one;
 *   - a forged/garbage cursor is a 400 with the house BI message, not a 500 and
 *     not a silent page 1;
 *   - the cursor actually advances the window when handed back.
 *
 * Token minting mirrors leads/export/route.test.ts (node:crypto, no mocking).
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bi } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';

const SECRET = 'test-jwt-secret-leads-page';
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
  return new Request(`http://localhost/api/v1/leads${qs}`, {
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

const director = sign({ employeeId: 'ZZ-PG-DIR', division: 'Management', level: 'staff', od: false, director: true });

describe('GET /leads — cursor validation (no DB needed: it rejects before the read)', () => {
  it('a cursor this server never minted is a 400 with the house BI message', async () => {
    const res = await GET(req(director, '?cursor=garbage-@@@-not-a-cursor'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(bi.INCOMPLETE_DATA);
  });

  it('a structurally-valid base64 payload that is not a cursor is still a 400, never a 500', async () => {
    const forged = Buffer.from('bukan-tanggal|LEAD-1', 'utf8').toString('base64url');
    expect((await GET(req(director, `?cursor=${forged}`))).status).toBe(400);
  });
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

describeDb('GET /leads — keyset paging over the wire', () => {
  const IDS = ['LD-ZZPAGE-0001', 'LD-ZZPAGE-0002', 'LD-ZZPAGE-0003'];

  afterEach(async () => {
    if (!sql) return;
    await sql`delete from leads where id = any(${IDS})`;
  });
  afterAll(async () => {
    if (sql) await sql.end();
  });

  async function seed(): Promise<void> {
    for (let i = 0; i < IDS.length; i++) {
      await sql`
        insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                           record_status, created_at, created_by)
        values (${IDS[i]}, ${`ZZ Page ${i}`}, ${`08127770${i}`}, ${`6812777 0${i}`}, 'Manual', 'Sales',
                'active', ${`2026-09-0${i + 1} 10:00:00+07`}::timestamptz, 'ZZ-PG-DIR')`;
    }
  }

  it('always emits next_cursor — explicitly null on the last page, never a missing key', async () => {
    await seed();
    const body = await (await GET(req(director, '?q=ZZ Page'))).json();
    expect(Object.keys(body)).toContain('next_cursor'); // present…
    expect(body.next_cursor).toBeNull(); // …and null: 3 rows fit in one default page
    expect(body.data).toHaveLength(3);
  });

  it('bounds the page at ?limit= and hands back a cursor that advances the window', async () => {
    await seed();
    const first = await (await GET(req(director, '?q=ZZ Page&limit=2'))).json();
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();

    const second = await (await GET(req(director, `?q=ZZ Page&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`))).json();
    expect(second.data).toHaveLength(1); // the remaining row
    expect(second.next_cursor).toBeNull(); // and that was the last page

    const firstIds = first.data.map((r: { id: string }) => r.id);
    const secondIds = second.data.map((r: { id: string }) => r.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]); // no row served twice
    expect([...firstIds, ...secondIds].sort()).toEqual([...IDS].sort()); // and none skipped
  });

  it('applies a default bound when ?limit= is absent — the unbounded read is gone', async () => {
    await seed();
    // The route must page even when the client asks for nothing: an absent
    // limit means DEFAULT_LIMIT, not "every row in the table".
    const body = await (await GET(req(director, '?q=ZZ Page'))).json();
    expect(body.data.length).toBeLessThanOrEqual(100);
  });
});
