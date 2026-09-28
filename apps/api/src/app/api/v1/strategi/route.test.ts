/**
 * S-01/S-05 — `GET /api/v1/strategi[?status=]` at the route level.
 *
 * `packages/domain/src/strategi.test.ts` already walks every permission
 * permutation of `listStrategiQueue` directly against the domain function —
 * this file does NOT repeat that. What is worth asserting here, the O43 class
 * of bug `shape-parity.test.ts`'s header describes, is that the ROUTE actually
 * wires the JWT actor and the `?status=` query param through to the domain
 * call, and that the wire translator emits the keys S-03's `/persetujuan`
 * card reads (`owner_am`/`owner_am_nama`), not that the underlying rules are
 * right (that's the domain suite's job).
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';

const SECRET = 'test-jwt-secret-strategi-queue';
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
  return new Request(`http://localhost/api/v1/strategi${qs}`, {
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

const am = sign({ employeeId: 'ZZ-RT-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-RT-AM2', division: 'Account', level: 'staff', od: false, director: false });
const spv = sign({ employeeId: 'ZZ-RT-SPV', division: 'Account', level: 'lead', od: false, director: false });
const odActor = sign({ employeeId: 'ZZ-RT-OD', division: 'Account', level: 'staff', od: true, director: false });
const director = sign({ employeeId: 'ZZ-RT-DIR', division: 'Account', level: 'staff', od: false, director: true });
const creativeLead = sign({ employeeId: 'ZZ-RT-CRV', division: 'Creative', level: 'lead', od: false, director: false });

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

describeDb('GET /strategi — status filter, scope, and wire shape', () => {
  const CLIENT_ID = 'ZZ-RT-CLI-STRGQ-1';
  const CONTRACT_ID = 'ZZ-RT-CTR-STRGQ-1';
  const CONTRACT_ID_2 = 'ZZ-RT-CTR-STRGQ-2';
  const STRG_DIAJUKAN = 'ZZ-RT-STRGQ-1';
  const STRG_AKTIF = 'ZZ-RT-STRGQ-2';

  afterEach(async () => {
    if (!sql) return;
    await sql`delete from strategi where id in (${STRG_DIAJUKAN}, ${STRG_AKTIF})`;
    await sql`delete from contracts where id in (${CONTRACT_ID}, ${CONTRACT_ID_2})`;
    await sql`delete from clients where id = ${CLIENT_ID}`;
  });
  afterAll(async () => {
    if (sql) await sql.end();
  });

  async function seed(): Promise<void> {
    await sql`
      insert into clients
        (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
         sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
      values (${CLIENT_ID}, 'Rani', 'RT Gadgets', 'Bandung', 'https://shopee.co.id/rt',
              'Elektronik', 0, 0, 0, 'ZZ-RT-SALES', 'ZZ-RT-SALES', 'ZZ-RT-AM', now(), 'ZZ-RT-AM')`;
    await sql`
      insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, created_by)
      values (${CONTRACT_ID}, ${CLIENT_ID}, 6, '2026-08-01', '2027-02-01', 'ZZ-RT-AM')`;
    await sql`
      insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, created_by)
      values (${CONTRACT_ID_2}, ${CLIENT_ID}, 6, '2026-08-01', '2027-02-01', 'ZZ-RT-AM')`;
    await sql`
      insert into strategi (id, client_id, contract_id, status, diajukan_pada, created_by)
      values (${STRG_DIAJUKAN}, ${CLIENT_ID}, ${CONTRACT_ID}, 'Diajukan', now(), 'ZZ-RT-AM')`;
    // A separate contract: `Aktif` and the in-flight statuses each have their
    // own partial-unique index PER CONTRACT (`uq_strategi_aktif_per_contract` /
    // `uq_strategi_inflight_per_contract`), so this could share CONTRACT_ID with
    // the `Diajukan` row above without tripping either one — a second contract
    // is used anyway so the two fixture rows stay obviously independent.
    await sql`
      insert into strategi (id, client_id, contract_id, status, created_by)
      values (${STRG_AKTIF}, ${CLIENT_ID}, ${CONTRACT_ID_2}, 'Aktif', 'ZZ-RT-AM')`;
  }

  it('AM owner + ?status=Diajukan sees only their own Diajukan row, with owner_am wired', async () => {
    await seed();
    const body = await (await GET(req(am, '?status=Diajukan'))).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([STRG_DIAJUKAN]);
    const row = body.data[0];
    expect(row.status).toBe('Diajukan');
    expect(row.owner_am).toBe('ZZ-RT-AM');
    expect(row.owner_am_nama).toEqual(expect.any(String));
    expect(row.owner_am_nama).not.toBe('');
    // wire shape: every key `strategiQueueRowToWire` declares, present even
    // when null — the O43 "missing key is worse than null" house rule.
    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'contract_id', 'client_id', 'client_toko', 'versi_no', 'status',
        'growth_thesis', 'tanggal_mulai_kontrak', 'tanggal_akhir_kontrak',
        'diajukan_pada', 'owner_am', 'owner_am_nama',
      ].sort(),
    );
  });

  it('?status=Diajukan excludes the Aktif row on the same client', async () => {
    await seed();
    const body = await (await GET(req(spv, '?status=Diajukan'))).json();
    expect(body.data.map((r: { id: string }) => r.id)).not.toContain(STRG_AKTIF);
  });

  it('no ?status= returns every status', async () => {
    await seed();
    const body = await (await GET(req(spv))).json();
    const ids = body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(STRG_DIAJUKAN);
    expect(ids).toContain(STRG_AKTIF);
  });

  it('a foreign AM sees nothing for this client', async () => {
    await seed();
    const body = await (await GET(req(otherAm, '?status=Diajukan'))).json();
    expect(body.data.map((r: { id: string }) => r.id)).not.toContain(STRG_DIAJUKAN);
  });

  it('Account lead / OD / Director all see it division-wide', async () => {
    await seed();
    for (const token of [spv, odActor, director]) {
      const body = await (await GET(req(token, '?status=Diajukan'))).json();
      expect(body.data.map((r: { id: string }) => r.id)).toContain(STRG_DIAJUKAN);
    }
  });

  it('an actor outside Account division is forbidden', async () => {
    const res = await GET(req(creativeLead, '?status=Diajukan'));
    expect(res.status).toBe(403);
  });
});
