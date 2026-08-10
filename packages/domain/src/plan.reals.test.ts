/**
 * B-06 — the hybrid-actuals FROZEN INVARIANT under REAL RLS + trigger.
 *
 * Rule 10: an AM may enter a manual GMV but may NOT overwrite an auto metric;
 * they may only file a `Sengketa Angka` note against it. The PRD calls this
 * "UPDATE-blocked at the DB level for AM roles (belt and braces with RLS — the
 * TS predicate and RLS must not diverge)". This suite is the RLS half — the same
 * class as `reads_rls.test.ts`: it drives writes through `withClaims` (the role
 * switch + claim injection `apps/api` performs), so the RLS `WITH CHECK` and the
 * `trg_plan_actual_no_manual_auto` trigger actually run, and asserts:
 *
 *   1. the owning AM CAN write a manual GMV row (the block is not "deny all");
 *   2. the owning AM CANNOT insert an auto row nor overwrite an auto value…
 *   3. …but CAN move only the `sengketa` note on it (PE-6);
 *   4. an unrelated AM is scoped out entirely (RLS `jwt_can_write_plan`);
 *   5. the service-role/system path (no JWT actor) writes auto rows freely — the
 *      execution modules / B-09 job must not be caught by the AM block;
 *   6. `private.jwt_can_write_plan` ≡ the TS `canWritePlan` for the same actors
 *      (the "must not diverge" assertion, stated in code).
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZA-` and removed in
 * afterEach. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { canWritePlan } from './plan';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const OWNER_AM = 'ZZA-AM';
const OTHER_AM = 'ZZA-AM2';
const CLI = 'ZZA-CLI-0001';
const PLAN = 'ZZA-PLAN-0001';

/** Serializes the claim envelope exactly as apps/api `actorClaims` does. */
const claims = (o: { employeeId: string; division?: string; level?: string }): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId,
      division: o.division ?? '',
      level: o.level ?? '',
      od: false,
      director: false,
    },
  });

const actorRole = (division: string, level: string) => permission.makeRole({ division, level });

async function seed(): Promise<void> {
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${CLI}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZA-SALES', 'ZZA-SALES', ${OWNER_AM}, now(), ${OWNER_AM})
    on conflict (id) do nothing`;
  // A Plan Satuan period (lingkup='klien') needs only a client — no contract /
  // Strategi to stand up, which keeps this suite about the actuals guard alone.
  await sql`
    insert into plan
      (id, lingkup, contract_id, client_id, strategi_id, periode_no,
       tanggal_mulai, tanggal_akhir, jumlah_minggu, status, created_by)
    values (${PLAN}, 'klien', null, ${CLI}, null, 1,
            '2026-08-12', '2026-09-11', 5, 'Aktif', ${OWNER_AM})
    on conflict (id) do nothing`;
  // An auto metric already ingested by the system (what B-09 will do): the row
  // the AM may dispute but not rewrite.
  await sql`
    insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
    values (${PLAN}, 'Shopee', 'roas_min', 'otomatis', 4.6, 'SYSTEM')
    on conflict (plan_id, channel, metric) do nothing`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from plan_actual where plan_id = ${PLAN}`;
  await sql`delete from plan where id = ${PLAN}`;
  await sql`delete from clients where id = ${CLI}`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('hybrid actuals under RLS + trigger (B-06 frozen invariant)', () => {
  it('lets the owning AM write a manual GMV row (block is not deny-all)', async () => {
    await seed();
    await withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
      tx`insert into plan_actual (plan_id, channel, metric, sumber, nilai, file_bukti, tanggal_ambil, created_by)
         values (${PLAN}, 'Shopee', 'gmv', 'manual', 188000000, 'export.pdf', '2026-09-12', ${OWNER_AM})`,
    );
    const rows = await sql<{ nilai: string }[]>`
      select nilai from plan_actual where plan_id = ${PLAN} and metric = 'gmv'`;
    expect(Number(rows[0].nilai)).toBe(188000000);
  });

  it('forbids the AM from inserting an auto row (RLS WITH CHECK)', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
           values (${PLAN}, 'TikTok Shop', 'roas_min', 'otomatis', 3.1, ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('forbids the AM from overwriting an auto value (trigger)', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`update plan_actual set nilai = 9.9
            where plan_id = ${PLAN} and channel = 'Shopee' and metric = 'roas_min'`,
      ),
    ).rejects.toThrow();
    // the value is untouched
    const rows = await sql<{ nilai: string }[]>`
      select nilai from plan_actual where plan_id = ${PLAN} and metric = 'roas_min'`;
    expect(Number(rows[0].nilai)).toBe(4.6);
  });

  it('lets the AM move only the sengketa note on an auto row (PE-6)', async () => {
    await seed();
    await withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
      tx`update plan_actual set sengketa = 'angka ROAS tidak cocok dengan dashboard iklan'
          where plan_id = ${PLAN} and channel = 'Shopee' and metric = 'roas_min'`,
    );
    const rows = await sql<{ sengketa: string | null; nilai: string }[]>`
      select sengketa, nilai from plan_actual where plan_id = ${PLAN} and metric = 'roas_min'`;
    expect(rows[0].sengketa).toContain('tidak cocok');
    expect(Number(rows[0].nilai)).toBe(4.6);
  });

  it('scopes an unrelated AM out of the Plan entirely', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OTHER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`insert into plan_actual (plan_id, channel, metric, sumber, nilai, file_bukti, tanggal_ambil, created_by)
           values (${PLAN}, 'Shopee', 'gmv', 'manual', 1, 'x.pdf', '2026-09-12', ${OTHER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('lets the system (no JWT actor) write auto rows — the execution-module path', async () => {
    await seed();
    // No withClaims: the migration-owner connection has no request.jwt.claims,
    // which is exactly the service-role ingestion the guard must wave through.
    await sql`insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
              values (${PLAN}, 'TikTok Shop', 'jumlah_video', 'otomatis', 11, 'SYSTEM')`;
    await sql`update plan_actual set nilai = 12
               where plan_id = ${PLAN} and channel = 'TikTok Shop' and metric = 'jumlah_video'`;
    const rows = await sql<{ nilai: string }[]>`
      select nilai from plan_actual where plan_id = ${PLAN} and metric = 'jumlah_video'`;
    expect(Number(rows[0].nilai)).toBe(12);
  });

  it('keeps private.jwt_can_write_plan ≡ TS canWritePlan (must not diverge)', async () => {
    await seed();
    const owner = { employeeId: OWNER_AM, role: actorRole('Account', 'staff') };
    const lead = { employeeId: 'ZZA-LEAD', role: actorRole('Account', 'lead') };
    const outsider = { employeeId: OTHER_AM, role: actorRole('Account', 'staff') };

    for (const [who, expected] of [
      [owner, true],
      [lead, true],
      [outsider, false],
    ] as const) {
      const [{ can }] = await withClaims(
        sql,
        claims({ employeeId: who.employeeId, division: who.role.division, level: who.role.level }),
        (tx) => tx<{ can: boolean }[]>`select private.jwt_can_write_plan(${PLAN}) as can`,
      );
      expect(can, `RLS write scope for ${who.employeeId}`).toBe(expected);
      // The TS predicate the write path uses must agree. `ownerAm` here is the
      // client's assigned AM (OWNER_AM), matching how the domain resolves it.
      expect(canWritePlan(who, OWNER_AM), `TS write scope for ${who.employeeId}`).toBe(expected);
    }
  });
});
