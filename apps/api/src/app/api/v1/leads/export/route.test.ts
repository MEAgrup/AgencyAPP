/**
 * E1 (docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md) — GET /leads/export.
 *
 * Permission matrix runs with NO DATABASE_URL required: the Director gate is
 * checked before `readAsActor` ever runs, so staff/lead/OD all reject before
 * touching the database — same shape as `auth.test.ts` (tokens minted with
 * node:crypto, no mocking of the verify path). The Director/200 case needs a
 * real Postgres (skipped without DATABASE_URL, same convention as the
 * *.reals/RLS suites in packages/domain).
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';

const SECRET = 'test-jwt-secret-leads-export';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

interface Claims {
  employeeId: string;
  division: string;
  level: string;
  od: boolean;
  director: boolean;
}

function sign(c: Claims): string {
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
  return new Request(`http://localhost/api/v1/leads/export${qs}`, {
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

const staff = sign({ employeeId: 'ZZ-EXP-STAFF', division: 'Sales', level: 'staff', od: false, director: false });
const lead = sign({ employeeId: 'ZZ-EXP-LEAD', division: 'Sales', level: 'lead', od: false, director: false });
// OD is read-only EVERYWHERE else in CDPS, which makes it the case most likely
// to be guessed wrong here — read-only-everywhere is not the same permission
// as "may extract the whole database to a file" (E1 §2.1).
const od = sign({ employeeId: 'ZZ-EXP-OD', division: 'Management', level: 'staff', od: true, director: false });
const director = sign({ employeeId: 'ZZ-EXP-DIR', division: 'Management', level: 'staff', od: false, director: true });

describe('GET /leads/export — permission matrix', () => {
  it('Sales staff -> 403', async () => {
    expect((await GET(req(staff))).status).toBe(403);
  });
  it('Sales lead -> 403', async () => {
    expect((await GET(req(lead))).status).toBe(403);
  });
  it('OD -> 403', async () => {
    expect((await GET(req(od))).status).toBe(403);
  });
  it('no token at all -> 401 (not 403 — a different failure mode)', async () => {
    expect((await GET(new Request('http://localhost/api/v1/leads/export'))).status).toBe(401);
  });
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

describeDb('GET /leads/export — Director, real DB', () => {
  const LEAD_ID = 'LD-ZZEXPORT-0001';

  afterEach(async () => {
    if (!sql) return;
    await sql`delete from leads where id = ${LEAD_ID}`;
  });
  afterAll(async () => {
    if (sql) await sql.end();
  });

  it('returns 200 text/csv with BOM, ;-delimited header, and the row', async () => {
    await sql`
      insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                         record_status, created_at, created_by)
      values (${LEAD_ID}, 'ZZ Export Toko; Aneh', '0812999', '62812999', 'Manual', 'Sales',
              'active', '2026-09-01 10:00:00+07', 'ZZ-EXP-DIR')`;

    const res = await GET(req(director));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="leads-database-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    // `.text()` decodes UTF-8 and, per the WHATWG spec, silently STRIPS a
    // leading BOM — so the BOM has to be checked on the raw bytes, not the
    // decoded string (a `.text()`-based check would pass even if the route
    // forgot the BOM entirely, which is the one thing this assertion exists
    // to catch).
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = await res.text();
    const lines = body.split('\r\n'); // BOM already stripped by .text()
    expect(lines[0]).toBe(
      'id;lead_name;phone_number;email;source;origin_division;origin_campaign_id;last_touch_campaign_id;record_status;winning_attempt_id;created_at;open_attempt_count',
    );
    const row = lines.find((l) => l.startsWith(LEAD_ID));
    expect(row).toBeDefined();
    // The name's embedded ';' forces quoting — proves csv.ts is actually wired
    // in, not just present in the repo.
    expect(row).toContain('"ZZ Export Toko; Aneh"');
    // 2026-09-01 10:00:00+07 is 2026-09-01 10:00:00 WIB — no UTC shift.
    expect(row).toContain('2026-09-01 10:00:00');
  });

  it('honors the same status/q/source filters as GET /leads', async () => {
    await sql`
      insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                         record_status, created_at, created_by)
      values (${LEAD_ID}, 'ZZ Export Filtered', '0812998', '62812998', 'Manual', 'Sales',
              'active', now(), 'ZZ-EXP-DIR')`;

    const matched = await (await GET(req(director, '?q=Filtered'))).text();
    expect(matched).toContain(LEAD_ID);

    const unmatched = await (await GET(req(director, '?q=Tidak-Ada-Yang-Cocok'))).text();
    expect(unmatched).not.toContain(LEAD_ID);
  });
});
