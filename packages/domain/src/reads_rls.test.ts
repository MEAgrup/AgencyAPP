/**
 * O37 — the read models under REAL RLS enforcement.
 *
 * Every other integration suite talks to Postgres as the migration owner, which
 * is BYPASSRLS: it proves the SQL is right but says nothing about what a logged
 * -in employee may see. That gap is exactly how O37 survived — `apps/api` read
 * through the same privileged connection, so the policies in
 * 20260723064438_rls_baseline.sql never ran and any authenticated caller could
 * read every lead, client and transaction.
 *
 * These tests run the read models through `withClaims` — the identical role
 * switch + claim injection `apps/api`'s `readAsActor` performs — and assert:
 *   1. a cross-scope actor gets NOTHING back (the leak is closed);
 *   2. the owner still gets their row (the fix is not just "deny everything");
 *   3. `authenticated` actually holds the privileges the read models need, i.e.
 *      no read path trips over a locked internal table.
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZR-` and removed in
 * afterAll.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { leadsDatabase, poolBoard } from './leads';
import { listClients } from './client';
import { reminderDashboard } from './finance';
import { allowedTransitions } from './engine';
import { getAttempt } from './sales';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

/** Serializes the claim envelope exactly as apps/api `actorClaims` does. */
const claims = (o: {
  employeeId: string;
  division?: string;
  level?: string;
  od?: boolean;
  director?: boolean;
}): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId,
      division: o.division ?? '',
      level: o.level ?? '',
      od: o.od ?? false,
      director: o.director ?? false,
    },
  });

const LEAD_ID = 'LEAD-ZZR-0001';
const CMP_ID = 'CMP-ZZR-0001';
const PRSP_ID = 'PRSP-ZZR-0001';
const OWNER = 'ZZR-OWNER';
const OUTSIDER = 'ZZR-OUTSIDER';

async function seed(): Promise<void> {
  await sql`
    insert into campaigns (id, name, channel, start_date, owner_employee_id, status, created_by)
    values (${CMP_ID}, 'rls read fixture', 'TikTok Ads', current_date, ${OWNER}, 'Active', ${OWNER})
    on conflict (id) do nothing`;
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                       origin_campaign_id, record_status, created_by)
    values (${LEAD_ID}, 'RLS Read Fixture', '0899000111', '62899000111', 'Leads - Iklan',
            'Marketing', ${CMP_ID}, '[Pool]', ${OWNER})
    on conflict (id) do nothing`;
  // An attempt on that lead: `getAttempt` is the read model that tripped over
  // `sm_edges` (2026-08-03), so the guard below needs a real row to read.
  await sql`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, claimed_at, created_by)
    values (${PRSP_ID}, ${LEAD_ID}, ${OWNER}, 'New Lead', now(), ${OWNER})
    on conflict (id) do nothing`;
}

afterAll(async () => {
  if (!sql) return;
  await sql`delete from prospect_attempts where id = ${PRSP_ID}`;
  await sql`delete from leads where id = ${LEAD_ID}`;
  await sql`delete from campaigns where id = ${CMP_ID}`;
  await sql.end();
});

describeDb('read models under RLS (O37)', () => {
  it('hides a lead from an unrelated division — the leak O37 described', async () => {
    await seed();
    const rows = await withClaims(sql, claims({ employeeId: OUTSIDER, division: 'Creative', level: 'staff' }), (tx) =>
      leadsDatabase(tx, {}),
    );
    expect(rows.some((r) => r.id === LEAD_ID)).toBe(false);
  });

  it('still shows the lead to its creator', async () => {
    await seed();
    const rows = await withClaims(sql, claims({ employeeId: OWNER, division: 'Marketing', level: 'staff' }), (tx) =>
      leadsDatabase(tx, {}),
    );
    expect(rows.some((r) => r.id === LEAD_ID)).toBe(true);
  });

  it('shows it to a Director (read-everywhere) but not via an empty claim set', async () => {
    await seed();
    const asDirector = await withClaims(sql, claims({ employeeId: 'ZZR-DIR', director: true }), (tx) =>
      leadsDatabase(tx, {}),
    );
    expect(asDirector.some((r) => r.id === LEAD_ID)).toBe(true);

    const anonymous = await withClaims(sql, '{}', (tx) => leadsDatabase(tx, {}));
    expect(anonymous.some((r) => r.id === LEAD_ID)).toBe(false);
  });

  it('filters the Pool board by the caller, not by the connection', async () => {
    await seed();
    const outsider = await withClaims(sql, claims({ employeeId: OUTSIDER, division: 'Creative', level: 'staff' }), (tx) =>
      poolBoard(tx, OUTSIDER),
    );
    expect(outsider.some((r) => r.id === LEAD_ID)).toBe(false);
  });

  it('runs the client and finance read models without hitting a locked table', async () => {
    // Regression guard for the privilege half of the change: `authenticated`
    // is denied sessions / employee_credentials / id_sequences / sm_machines /
    // sm_terminal_states / notif_events / role_mappings entirely, so a read model
    // touching one would raise insufficient_privilege here even though it passes
    // as the BYPASSRLS owner elsewhere in the suite.
    const c = claims({ employeeId: 'ZZR-DIR', director: true });
    await expect(withClaims(sql, c, (tx) => listClients(tx))).resolves.toBeDefined();
    await expect(withClaims(sql, c, (tx) => reminderDashboard(tx))).resolves.toBeDefined();
  });

  it('introspects the transition engine under RLS — the sm_edges 500 (QA 2026-08-03)', async () => {
    // `sm_edges` sat in the baseline's "pure internal" group (SELECT revoked from
    // `authenticated`) because its only reader used to be `sm_transition`, a
    // SECURITY DEFINER. O37 moved every READ onto the `authenticated` role, and
    // this call — the one the attempt-detail page needs to know which action
    // buttons exist — started raising 42501 permission_denied, which `mapError`
    // does not map: the page rendered a bare "internal server error".
    // 20260803120000_rls_sm_edges_read_path.sql grants SELECT + a USING (true)
    // policy. Both halves are asserted: a grant without the policy would return
    // an EMPTY list here (a dead page with no buttons), not an error.
    const moves = await withClaims(sql, claims({ employeeId: 'ZZR-DIR', director: true }), (tx) =>
      allowedTransitions(tx, 'prospect_attempt', 'New Lead'),
    );
    expect(moves).toContain('Contacted');
  });

  it('reads the whole attempt detail under RLS — the exact route path that 500-ed', async () => {
    await seed();
    const detail = await withClaims(sql, claims({ employeeId: 'ZZR-DIR', director: true }), (tx) =>
      getAttempt(tx, PRSP_ID),
    );
    expect(detail.attempt.id).toBe(PRSP_ID);
    expect(detail.lead.id).toBe(LEAD_ID);
    // The field the page reads to render its action buttons at all.
    expect(detail.allowedTransitions.length).toBeGreaterThan(0);
  });
});
