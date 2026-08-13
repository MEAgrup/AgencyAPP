/**
 * D-03 — the M6D auto-metric UPDATE-block FROZEN INVARIANT under REAL RLS +
 * trigger. The M6D twin of `plan.reals.test.ts` (M6B B-06).
 *
 * §4 Rule 5 / §9: an AM may enter a manual fallback metric but may NOT overwrite
 * an `otomatis` figure; they may only file a `Sengketa Angka` note against it.
 * The PRD calls this "UPDATE-blocked at the DB level for JWT (AM) roles, mirrored
 * in RLS WITH CHECK — TS predicate and RLS must not diverge". This suite is the
 * RLS half — it drives writes through `withClaims` (the role switch + claim
 * injection `apps/api` performs) so the RLS `WITH CHECK` and the
 * `guard_wrr_*_no_manual_auto` triggers actually run, and asserts:
 *
 *   1. the owning AM CAN write a manual wrr_metrik row (the block is not deny-all);
 *   2. the owning AM CANNOT insert an auto row nor overwrite an auto value…
 *   3. …but CAN move only the `sengketa` note on it (RM-C);
 *   4. an unrelated AM is scoped out entirely (RLS `jwt_can_write_recap`);
 *   5. the service-role/system path (no JWT actor) writes auto rows freely — the
 *      D-03 aggregation / D-06 job must not be caught by the AM block;
 *   6. `wrr_divisi` production rows are system-only: an AM cannot insert one and
 *      may move only its `sengketa` note (RM-B6);
 *   7. `private.jwt_can_write_recap` ≡ the TS `canWriteRecap` for the same actors
 *      (the "must not diverge" assertion, stated in code).
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZW-` and removed in
 * afterEach. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { canWriteRecap } from './recap';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const OWNER_AM = 'ZZW-AM';
const OTHER_AM = 'ZZW-AM2';
const CLI = 'ZZW-CLI-0001';
const RECAP = 'ZZW-WRR-0001';

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
            'Home Living', 0, 0, 0, 'ZZW-SALES', 'ZZW-SALES', ${OWNER_AM}, now(), ${OWNER_AM})
    on conflict (id) do nothing`;
  // A no-Plan recap (plan_id null) keeps this suite about the auto-block alone —
  // no Plan/Strategi to stand up. Status `Terbuka` = auto figures still accrue.
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${RECAP}, ${CLI}, null, 2026, 35, '2026-08-24', '2026-08-30', 'Terbuka', 'SYSTEM')
    on conflict (id) do nothing`;
  // Auto figures already aggregated by the system (what D-03/D-06 do): the rows
  // the AM may dispute but not rewrite.
  await sql`
    insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
    values (${RECAP}, 'roas_ads', 'otomatis', 4.6, 'SYSTEM')
    on conflict (recap_id, metrik) do nothing`;
  await sql`
    insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
    values (${RECAP}, 'Creative', 4, '{"video":4}'::jsonb, 'SYSTEM')
    on conflict (recap_id, divisi) do nothing`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from wrr_metrik where recap_id = ${RECAP}`;
  await sql`delete from wrr_divisi where recap_id = ${RECAP}`;
  await sql`delete from weekly_result_recap where id = ${RECAP}`;
  await sql`delete from clients where id = ${CLI}`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('M6D auto-metric block under RLS + trigger (D-03 frozen invariant)', () => {
  it('lets the owning AM write a manual fallback metric (block is not deny-all)', async () => {
    await seed();
    await withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
      tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, file_bukti, tanggal_ambil, created_by)
         values (${RECAP}, 'total_view', 'manual', 92000, 'export.pdf', '2026-08-31', ${OWNER_AM})`,
    );
    const rows = await sql<{ nilai: string }[]>`
      select nilai from wrr_metrik where recap_id = ${RECAP} and metrik = 'total_view'`;
    expect(Number(rows[0].nilai)).toBe(92000);
  });

  it('forbids the AM from inserting an auto metric (RLS WITH CHECK)', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
           values (${RECAP}, 'ctr', 'otomatis', 1.8, ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('forbids the AM from overwriting an auto value (trigger)', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`update wrr_metrik set nilai = 9.9 where recap_id = ${RECAP} and metrik = 'roas_ads'`,
      ),
    ).rejects.toThrow();
    const rows = await sql<{ nilai: string }[]>`
      select nilai from wrr_metrik where recap_id = ${RECAP} and metrik = 'roas_ads'`;
    expect(Number(rows[0].nilai)).toBe(4.6);
  });

  it('lets the AM move only the sengketa note on an auto metric (RM-C)', async () => {
    await seed();
    await withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
      tx`update wrr_metrik set sengketa = 'angka ROAS tidak cocok dengan dashboard iklan'
          where recap_id = ${RECAP} and metrik = 'roas_ads'`,
    );
    const rows = await sql<{ sengketa: string | null; nilai: string }[]>`
      select sengketa, nilai from wrr_metrik where recap_id = ${RECAP} and metrik = 'roas_ads'`;
    expect(rows[0].sengketa).toContain('tidak cocok');
    expect(Number(rows[0].nilai)).toBe(4.6);
  });

  it('scopes an unrelated AM out of the recap entirely', async () => {
    await seed();
    await expect(
      withClaims(sql, claims({ employeeId: OTHER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, file_bukti, tanggal_ambil, created_by)
           values (${RECAP}, 'total_view', 'manual', 1, 'x.pdf', '2026-08-31', ${OTHER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('lets the system (no JWT actor) write auto metrics — the aggregation path', async () => {
    await seed();
    // No withClaims: the migration-owner connection has no request.jwt.claims,
    // which is exactly the service-role aggregation the guard must wave through.
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${RECAP}, 'ad_spend', 'otomatis', 6100000, 'SYSTEM')`;
    await sql`update wrr_metrik set nilai = 6200000
               where recap_id = ${RECAP} and metrik = 'ad_spend'`;
    const rows = await sql<{ nilai: string }[]>`
      select nilai from wrr_metrik where recap_id = ${RECAP} and metrik = 'ad_spend'`;
    expect(Number(rows[0].nilai)).toBe(6200000);
  });

  it('keeps wrr_divisi production rows system-only (no AM insert; only sengketa moves)', async () => {
    await seed();
    // AM cannot conjure a production row.
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, created_by)
           values (${RECAP}, 'Ads', 3, ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
    // AM cannot overwrite the count.
    await expect(
      withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
        tx`update wrr_divisi set jumlah_produksi = 99 where recap_id = ${RECAP} and divisi = 'Creative'`,
      ),
    ).rejects.toThrow();
    // AM CAN dispute it (RM-B6).
    await withClaims(sql, claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' }), (tx) =>
      tx`update wrr_divisi set sengketa = 'harusnya 5 video, 1 belum tercatat'
          where recap_id = ${RECAP} and divisi = 'Creative'`,
    );
    const rows = await sql<{ sengketa: string | null; jumlah_produksi: number }[]>`
      select sengketa, jumlah_produksi from wrr_divisi where recap_id = ${RECAP} and divisi = 'Creative'`;
    expect(rows[0].sengketa).toContain('belum tercatat');
    expect(Number(rows[0].jumlah_produksi)).toBe(4);
  });

  it('keeps private.jwt_can_write_recap ≡ TS canWriteRecap (must not diverge)', async () => {
    await seed();
    const owner = { employeeId: OWNER_AM, role: actorRole('Account', 'staff') };
    const lead = { employeeId: 'ZZW-LEAD', role: actorRole('Account', 'lead') };
    const outsider = { employeeId: OTHER_AM, role: actorRole('Account', 'staff') };

    for (const [who, expected] of [
      [owner, true],
      [lead, true],
      [outsider, false],
    ] as const) {
      const [{ can }] = await withClaims(
        sql,
        claims({ employeeId: who.employeeId, division: who.role.division, level: who.role.level }),
        (tx) => tx<{ can: boolean }[]>`select private.jwt_can_write_recap(${RECAP}) as can`,
      );
      expect(can, `RLS write scope for ${who.employeeId}`).toBe(expected);
      // The TS predicate the write path uses must agree. `ownerAm` here is the
      // client's assigned AM (OWNER_AM), matching how the domain resolves it.
      expect(canWriteRecap(who, OWNER_AM), `TS write scope for ${who.employeeId}`).toBe(expected);
    }
  });
});
