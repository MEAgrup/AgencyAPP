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
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { leadDetailView, leadsDatabase, poolBoard } from './leads';
import { listClients } from './client';
import { getBrief, getService, listDivisionQueue, listStrategies, serviceQueue, type Actor } from './account';
import { getAsset } from './creative';
import { staffLanding } from './portal';
import { financeQueue, reminderDashboard } from './finance';
import { allowedTransitions } from './engine';
import { getAttempt, listAttempts } from './sales';
import { getStageOverview } from './stage';

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

/**
 * The domain-side Actor matching a claim envelope. The read models gate on this
 * BEFORE RLS is reached, so both halves must describe the same person — passing
 * one actor with another's claims would prove nothing.
 */
const actor = (employeeId: string, division: string, level: string): Actor => ({
  employeeId,
  divisi: division,
  role: permission.makeRole({ division, level }),
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
      leadsDatabase(tx, {}).then((page) => page.rows),
    );
    expect(rows.some((r) => r.id === LEAD_ID)).toBe(false);
  });

  it('still shows the lead to its creator', async () => {
    await seed();
    const rows = await withClaims(sql, claims({ employeeId: OWNER, division: 'Marketing', level: 'staff' }), (tx) =>
      leadsDatabase(tx, {}).then((page) => page.rows),
    );
    expect(rows.some((r) => r.id === LEAD_ID)).toBe(true);
  });

  it('shows it to a Director (read-everywhere) but not via an empty claim set', async () => {
    await seed();
    const asDirector = await withClaims(sql, claims({ employeeId: 'ZZR-DIR', director: true }), (tx) =>
      leadsDatabase(tx, {}).then((page) => page.rows),
    );
    expect(asDirector.some((r) => r.id === LEAD_ID)).toBe(true);

    const anonymous = (await withClaims(sql, '{}', (tx) => leadsDatabase(tx, {}))).rows;
    expect(anonymous.some((r) => r.id === LEAD_ID)).toBe(false);
  });

  it('filters the Pool board by the caller, not by the connection', async () => {
    await seed();
    const outsider = await withClaims(sql, claims({ employeeId: OUTSIDER, division: 'Creative', level: 'staff' }), (tx) =>
      poolBoard(tx, OUTSIDER).then((p) => p.rows),
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

  /**
   * QA finance 2026-08-04. `clients_select` had no division arm at all, so every
   * M5 read that joins `clients` — the reminder dashboard and the "Outstanding, No
   * Due Date" list, both Finance's own per §8.1 — came back EMPTY for Finance and
   * only for Finance. Nothing errored; the page just had no rows, which is why it
   * outlived 20260729032805 (that migration fixed transactions / installments /
   * payment_verifications and stopped one table short).
   *
   * Asserted through the join, not on `clients` directly: a policy that lets
   * Finance read clients but leaves the dashboard empty for another reason would
   * still be a broken page.
   */
  it('lets Finance read the client behind a transaction — the M5 §6 join (QA 2026-08-04)', async () => {
    const CLI = 'CLI-ZZR-0001';
    const TRX = 'TRX-ZZR-0001';
    const INST = 'INST-ZZR-0001';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, payment_intent, created_by)
      values (${CLI}, 'RLS Finance Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzr',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, '[Termin]', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value,
                               payment_status, created_by)
      values (${TRX}, ${CLI}, '[Termin]', '9000000.00', '[Menunggu Verifikasi]', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
      values (${INST}, ${TRX}, 1, '9000000.00', current_date, '[Belum Jatuh Tempo]', ${OWNER})
      on conflict (id) do nothing`;

    try {
      const asFinance = await withClaims(
        sql,
        claims({ employeeId: 'ZZR-FIN', division: 'Finance', level: 'staff' }),
        (tx) => reminderDashboard(tx),
      );
      const seen = [...asFinance.overdue, ...asFinance.upcoming].some((r) => r.installmentId === INST);
      expect(seen, 'Finance must see the reminder row it is responsible for chasing').toBe(true);

      // Still scoped: an unrelated division sees neither the row nor the client.
      const asOutsider = await withClaims(
        sql,
        claims({ employeeId: OUTSIDER, division: 'Creative', level: 'staff' }),
        (tx) => reminderDashboard(tx),
      );
      expect([...asOutsider.overdue, ...asOutsider.upcoming].some((r) => r.installmentId === INST)).toBe(false);
    } finally {
      await sql`delete from installments where id = ${INST}`;
      await sql`delete from transactions where id = ${TRX}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * Feedback OD 2026-09-07, Finance #1: the approval queue showed `client_id`
   * only, and Finance does not memorise `CLI-…` ids. F-2 adds `join clients` to
   * `financeQueue` for `clients.toko`.
   *
   * That join is the O52 shape — a read model joining `clients` for one column —
   * and the ONLY reason it does not erase Finance's rows is the
   * `jwt_division() = 'Finance'` arm on `clients_select`. Nothing in TS says so,
   * so this test is where that dependency is written down: narrow the policy and
   * the queue silently empties instead of failing loudly, exactly the QA
   * 2026-08-04 defect one table over.
   *
   * `toko` is asserted by VALUE, not by presence: `join` + a null column would
   * satisfy `toHaveProperty` while the page still renders blank.
   */
  it('gives Finance the client NAME on the approval queue, not just the id (Finance #1)', async () => {
    const CLI = 'CLI-ZZR-0F02';
    const TRX = 'TRX-ZZR-0F02';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, payment_intent, created_by)
      values (${CLI}, 'Toko Antrean Finance', 'Ibu F2', 'Bandung', 'Fashion', 'https://shopee/zzrf2',
              '5000000.00', '9000000.00', ${OWNER}, ${OWNER}, '[Bayar Penuh]', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value,
                               payment_status, created_by)
      values (${TRX}, ${CLI}, '[Bayar Penuh]', '5000000.00', '[Menunggu Verifikasi]', ${OWNER})
      on conflict (id) do nothing`;

    try {
      const finActor = actor('ZZR-FIN', 'Finance', 'staff');
      const rows = await withClaims(
        sql,
        claims({ employeeId: 'ZZR-FIN', division: 'Finance', level: 'staff' }),
        (tx) => financeQueue(tx, finActor),
      );
      const mine = rows.find((r) => r.id === TRX);
      expect(mine, 'the join must not erase Finance’s own worklist row (O52 class)').toBeDefined();
      expect(mine!.toko).toBe('Toko Antrean Finance');

      // The premise, asserted rather than assumed: strip the Finance arm and this
      // is what the queue would look like. An execution division has no arm on
      // `clients_select`, so it reads zero client rows — which is precisely why
      // the equivalent Brief-side join uses `private.*` instead of a raw join.
      const cliVisibleToCreative = await withClaims(
        sql,
        claims({ employeeId: OUTSIDER, division: 'Creative', level: 'staff' }),
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from clients where id = ${CLI}`,
      );
      expect(
        cliVisibleToCreative[0].n,
        'premise broken: if any division can read clients, the O52 reasoning behind this join no longer holds',
      ).toBe(0);
    } finally {
      await sql`delete from transactions where id = ${TRX}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * QA account 2026-08-05. `20260805030100` opened `clients` for the Account lead
   * but stopped there, so the CHILDREN of those clients stayed invisible:
   * `services_select` and `strategy_plans_select` had ownership arms only. Two
   * consequences, both silent:
   *
   *   - the Service queue (§3 Rule 4) was empty for SPV/Head Account, and
   *   - a Plan the AM had just SUBMITTED has no `approved_by` yet — that is the
   *     column the approval fills — so the "Menunggu Persetujuan" inbox was
   *     ALWAYS empty and §4 Rule 4 could not be performed at all. Without
   *     [Strategy Approved] no plan-gated Service can ever be briefed (§5 Rule 5),
   *     so one policy stalled the whole chain.
   *
   * Asserted through the domain read models (not raw SELECTs): a policy that lets
   * the lead read the tables but leaves the queue empty for another reason would
   * still be a broken page.
   */
  it('lets the Account lead read the service queue and the Plan awaiting their approval (QA 2026-08-05)', async () => {
    const CLI = 'CLI-ZZR-0002';
    const SVC = 'SVC-ZZR-0002';
    const STR = 'STR-ZZR-0002';
    const AM = 'ZZR-AM';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'RLS Account Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzr2',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, requires_strategy_plan, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR', 1, 'TikTok Shop Full Management', '9000000.00', 'rule',
              '[Awaiting Onboarding]', true, ${OWNER})
      on conflict (id) do nothing`;
    // Created by the AM and submitted — approved_by is still NULL, which is the
    // whole point: this is the row the SPV must be able to see in order to act.
    await sql`
      insert into strategy_plans (id, service_id, objective, target_kpi, divisions_involved,
                                  planned_brief_outline, timeline_start, timeline_end, status, created_by)
      values (${STR}, ${SVC}, 'naik 30%', 'GMV +30%', 'Creative, Ads', '12 video',
              current_date, current_date + 30, '[Strategy Submitted for Approval]', ${AM})
      on conflict (id) do nothing`;

    const lead = claims({ employeeId: 'ZZR-ALEAD', division: 'Account', level: 'lead' });
    try {
      const queue = await withClaims(sql, lead, (tx) => serviceQueue(tx, actor('ZZR-ALEAD', 'Account', 'lead')));
      expect(
        queue.some((r) => r.serviceId === SVC),
        'SPV/Head Account must see the services of their division',
      ).toBe(true);

      const inbox = await withClaims(sql, lead, (tx) => listStrategies(tx, actor('ZZR-ALEAD', 'Account', 'lead')));
      expect(
        inbox.some((s) => s.id === STR),
        'the approval inbox must contain a Plan submitted by an AM (approved_by still NULL)',
      ).toBe(true);

      // The owning AM keeps their own scope — and is not the creator of anything
      // here except the Plan, so this also covers the inherited-client case.
      const amQueue = await withClaims(
        sql,
        claims({ employeeId: AM, division: 'Account', level: 'staff' }),
        (tx) => serviceQueue(tx, actor(AM, 'Account', 'staff')),
      );
      expect(amQueue.some((r) => r.serviceId === SVC)).toBe(true);

      // Still scoped: another division's lead sees neither.
      const outsider = claims({ employeeId: OUTSIDER, division: 'Creative', level: 'lead' });
      const seen = await withClaims(sql, outsider, (tx) =>
        tx<{ n: string }[]>`select count(*) as n from services where id = ${SVC}`,
      );
      expect(Number(seen[0].n)).toBe(0);
    } finally {
      await sql`delete from strategy_plans where id = ${STR}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * A-3 — the `strategi_*` columns on the Service queue, read UNDER RLS.
   *
   * `serviceQueueCols` gained two correlated subqueries over `strategi`, and
   * `strategi_select` is NARROWER than the policy governing `services`. A
   * subquery blocked by RLS does not raise and does not drop the row — it
   * quietly yields NULL. That failure mode is worse than the O52 404: the page
   * answers 200, the Service is listed, and `nextOnboardingStep` reads the null
   * as "no Strategi yet" and tells the AM to create one that already exists.
   * The exact bug A-3 was written to remove, reintroduced for whichever roles
   * the policy happens to exclude.
   *
   * Every role that can reach this read must therefore see the Strategi:
   * an Account-staff AM (`private.jwt_is_am_of_contract`), an Account lead
   * (`jwt_is_lead() AND jwt_division() = 'Account'`), OD and Director
   * (`jwt_can_read_all()`). `serviceQueue` forbids everyone else outright, so
   * that is the whole set — asserted here rather than reasoned about, because
   * reasoning from `rls_baseline.sql` is what nearly derailed F-2.
   */
  it('carries strategi_id/status to EVERY role that may read the queue (A-3)', async () => {
    const CLI = 'CLI-ZZR-0A3';
    const CTR = 'CTR-ZZR-0A3';
    const SVC = 'SVC-ZZR-0A3';
    const STG = 'STRG-ZZR-0A3';
    const AM = 'ZZR-AMA3';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'RLS A-3 Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzra3',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, created_by)
      values (${CTR}, ${CLI}, 6, '2026-09-01', '2027-03-01', 'baru', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, contract_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, requires_strategy_plan,
                            plan_tier, created_by)
      values (${SVC}, ${CLI}, ${CTR}, 'MSV-ZZR', 1, 'TikTok Shop Full Management', '9000000.00',
              'rule', '[Strategy Approved]', true, 'plan_wajib', ${OWNER})
      on conflict (id) do nothing`;
    // `created_by` is the AM, so the AM would also pass the creator arm — the
    // point is the OTHER three roles, who match neither creator nor approver.
    await sql`
      insert into strategi (id, client_id, contract_id, versi_no, status, created_by)
      values (${STG}, ${CLI}, ${CTR}, 1, 'Aktif', ${AM})
      on conflict (id) do nothing`;

    try {
      const readers: [string, Actor, string][] = [
        ['Account staff (owning AM)', actor(AM, 'Account', 'staff'),
         claims({ employeeId: AM, division: 'Account', level: 'staff' })],
        ['Account lead', actor('ZZR-ALEADA3', 'Account', 'lead'),
         claims({ employeeId: 'ZZR-ALEADA3', division: 'Account', level: 'lead' })],
        ['OD', { employeeId: 'ZZR-ODA3', role: permission.makeRole({ od: true }) },
         claims({ employeeId: 'ZZR-ODA3', od: true })],
        ['Director', { employeeId: 'ZZR-DIRA3', role: permission.makeRole({ director: true }) },
         claims({ employeeId: 'ZZR-DIRA3', director: true })],
      ];
      for (const [label, who, jwt] of readers) {
        const row = await withClaims(sql, jwt, (tx) => getService(tx, who, SVC));
        expect(row.strategiId, `${label} must see the Strategi id`).toBe(STG);
        expect(row.strategiStatus, `${label} must see the Strategi status`).toBe('Aktif');
        expect(row.contractId, `${label} must see the contract`).toBe(CTR);

        const queue = await withClaims(sql, jwt, (tx) => serviceQueue(tx, who));
        const inQueue = queue.find((r) => r.serviceId === SVC);
        expect(inQueue?.strategiId, `${label} queue row must carry the Strategi`).toBe(STG);
      }
    } finally {
      await sql`delete from strategi where id = ${STG}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where id = ${CTR}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * O52 (QA 2026-08-04, keputusan pemilik 2026-08-07 → pilihan (b)).
   *
   * `loadBrief`/`assetSelect` joined `services` + `clients` for one column —
   * `clients.assigned_am_id`. Neither policy has an execution-division arm, so
   * the join returned ZERO rows for the very division the Brief was assigned to
   * and the detail page answered **404 `[aset tidak ditemukan]`** — not 403.
   * `canSeeBrief` was saying yes the whole time; RLS on a JOINED table was
   * contradicting the domain gate.
   *
   * The premise is asserted first: if `services`/`clients` ever open up to
   * execution divisions, this test stops proving anything and someone must know.
   */
  it('lets the execution division open its own Brief and Asset — the O52 404', async () => {
    const CLI = 'CLI-ZZR-0052';
    const SVC = 'SVC-ZZR-0052';
    const BRF = 'BRF-ZZR-0052';
    const AST = 'AST-ZZR-0052';
    const AM = 'ZZR-AM52';
    const CRE = 'ZZR-CRE52';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'RLS O52 Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzr52',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR-0052', 1, 'rls o52 service', '9000000.00',
              '10% of standard price', 'Ongoing', ${AM})
      on conflict (id) do nothing`;
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values (${BRF}, ${SVC}, 'rls o52 brief', '[Draft]', 'Creative', ${AM})
      on conflict (id) do nothing`;
    // PIC and creator are STAFF, never the lead — so the lead's access can only
    // come from the division arm, not from ownership.
    await sql`
      insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
      values (${AST}, ${BRF}, 'Video', 1, ${CRE}, '[To Do]', ${CRE})
      on conflict (id) do nothing`;

    const leadClaims = claims({ employeeId: 'ZZR-CRELEAD', division: 'Creative', level: 'lead' });
    const leadActor = actor('ZZR-CRELEAD', 'Creative', 'lead');
    try {
      // Premise: the joined tables really are invisible to this actor.
      const invisible = await withClaims(sql, leadClaims, (tx) =>
        tx<{ svc: string; cli: string }[]>`
          select (select count(*) from services where id = ${SVC}) as svc,
                 (select count(*) from clients  where id = ${CLI}) as cli`,
      );
      expect(
        Number(invisible[0].svc) + Number(invisible[0].cli),
        'premise broken: if the execution division can read services/clients, O52 was silently decided as option (a)',
      ).toBe(0);

      const brief = await withClaims(sql, leadClaims, (tx) => getBrief(tx, leadActor, BRF));
      expect(brief.id).toBe(BRF);

      const asset = await withClaims(sql, leadClaims, (tx) => getAsset(tx, leadActor, AST));
      expect(asset.id).toBe(AST);

      // …and the AM the gate needs still arrives: a helper that returned NULL
      // would let the page render while quietly breaking every owner check.
      const ownerAm = await withClaims(sql, leadClaims, (tx) =>
        tx<{ am: string | null }[]>`select private.brief_owner_am(${BRF}) as am`,
      );
      expect(ownerAm[0].am).toBe(AM);
    } finally {
      await sql`delete from assets where id = ${AST}`;
      await sql`delete from briefs where id = ${BRF}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * Feedback OD 2026-09-07, Creative #3: a division leader opening their own
   * queue could not tell WHICH CLIENT a Brief belonged to — the column was the
   * bare `service_id` — nor who was holding it. F-2 puts the brand and the PIC
   * name on every Brief read.
   *
   * This is the same trap as O52 one table further out, so it is asserted the
   * same way: through the real read model, under real RLS, as the execution
   * division. A `join services join clients join employees` here would not blank
   * the columns — it would DELETE the rows, and the leader's queue would look
   * empty rather than wrong.
   *
   * Both names are asserted BY VALUE. `toBeDefined()` would pass on `''`, which
   * is exactly the bug being fixed. `employees` is asserted invisible too: the
   * PIC name cannot come from a join either, since `employees_select` is
   * self-or-creator only — a leader may not read their own staff's row.
   */
  /**
   * A-2 (feedback OD 2026-09-07, Finance #2). Ayam-telur, dan bentuknya sama
   * dengan O52 tapi jawabannya BERBEDA — jadi ia diuji, bukan diasumsikan.
   *
   * `kol.canProcessPaymentRequest` mengizinkan seluruh divisi Finance. Yang
   * membantahnya `creator_payment_requests_select`, yang hanya membuka baris ke
   * `(requested_by, paid_by, created_by)`: staf Finance yang belum pernah
   * menyentuh sebuah CPR tidak bisa MEMBUKA-nya, dan satu-satunya cara
   * menyentuhnya adalah membukanya lebih dulu.
   *
   * Di sini policy-nya memang DILEBARKAN (O52 opsi (a)), bukan diganti fungsi
   * `private.*`, karena yang Finance butuh adalah BARIS CPR-nya — seluruhnya,
   * untuk dinilai lalu dibayar. Tidak ada "satu kolom" yang bisa diberikan
   * sebagai gantinya. Yang dijaga tes ini adalah bahwa pelebaran itu tetap
   * SEMPIT: Finance masuk, divisi lain tidak, dan `creator_bookings` tidak ikut
   * terbuka hanya karena kebetulan bertetangga.
   */
  it('lets Finance read a CPR it has never touched — and nobody else (Finance #2)', async () => {
    const CLI = 'CLI-ZZR-0A2';
    const SVC = 'SVC-ZZR-0A2';
    const BRF = 'BRF-ZZR-0A2';
    const BKG = 'BKG-ZZR-0A2';
    const CPR = 'CPR-ZZR-0A2';
    const KOL = 'ZZR-KOLA2';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, created_by)
      values (${CLI}, 'RLS A2 Fixture', 'Ibu A2', 'Jakarta', 'Fashion', 'https://shopee/zzra2',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR-0A2', 1, 'a2 service', '9000000.00', 'rule', 'Ongoing', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values (${BRF}, ${SVC}, 'a2 brief', '[Draft]', 'KOL', ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate,
                                    status, created_by)
      values (${BKG}, ${BRF}, 'Creator A2', 'TikTok', 'MCN MEA Roster', '2500000.00',
              '[QC Passed]', ${KOL})
      on conflict (id) do nothing`;
    // requested_by / created_by keduanya KOL — jadi akses Finance di bawah
    // TIDAK bisa datang dari kepemilikan, hanya dari lengan divisinya.
    await sql`
      insert into creator_payment_requests (id, booking_id, amount, payment_details, status,
                                            requested_by, created_by)
      values (${CPR}, ${BKG}, '2500000.00', 'Bank A2 999', '[Requested]', ${KOL}, ${KOL})
      on conflict (id) do nothing`;

    const lihatCpr = (c: string) =>
      withClaims(sql, c, (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from creator_payment_requests where id = ${CPR}`,
      );

    try {
      // Staf Finance biasa — belum pernah menyentuh baris ini.
      const finStaff = await lihatCpr(claims({ employeeId: 'ZZR-FIN', division: 'Finance', level: 'staff' }));
      expect(finStaff[0].n, 'staf Finance harus bisa membuka CPR yang belum pernah ia sentuh').toBe(1);

      // Dan lead-nya juga — probe A-2 menunjukkan ia SAMA butanya sebelum ini,
      // jadi lengannya sengaja tidak dibatasi `jwt_is_lead()`.
      const finLead = await lihatCpr(claims({ employeeId: 'ZZR-FIN2', division: 'Finance', level: 'lead' }));
      expect(finLead[0].n).toBe(1);

      // Pengajunya tetap melihat miliknya (lengan lama tidak dicabut).
      const pengaju = await lihatCpr(claims({ employeeId: KOL, division: 'KOL', level: 'staff' }));
      expect(pengaju[0].n).toBe(1);

      // Yang TIDAK boleh ikut terbuka. Pelebaran policy tanpa batas yang diuji
      // adalah cara kebocoran masuk sebagai "perbaikan".
      for (const divisi of ['Creative', 'Ads', 'Sales', 'Account']) {
        const lain = await lihatCpr(claims({ employeeId: OUTSIDER, division: divisi, level: 'lead' }));
        expect(lain[0].n, `${divisi} tidak boleh membaca CPR`).toBe(0);
      }

      // `creator_bookings` sengaja TIDAK ikut dilebarkan: Finance tidak perlu
      // membaca papan booking KOL, dan nominal yang mereka butuh ada di CPR-nya.
      const bookingUntukFinance = await withClaims(
        sql,
        claims({ employeeId: 'ZZR-FIN', division: 'Finance', level: 'staff' }),
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from creator_bookings where id = ${BKG}`,
      );
      expect(bookingUntukFinance[0].n, 'pelebaran A-2 tidak boleh merembet ke creator_bookings').toBe(0);
    } finally {
      await sql`delete from creator_payment_requests where id = ${CPR}`;
      await sql`delete from creator_bookings where id = ${BKG}`;
      await sql`delete from briefs where id = ${BRF}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  it('names the brand and the PIC on a division’s Brief queue (Creative #3)', async () => {
    const CLI = 'CLI-ZZR-0F2B';
    const SVC = 'SVC-ZZR-0F2B';
    const BRF = 'BRF-ZZR-0F2B';
    const AM = 'ZZR-AMF2B';
    const PIC = 'ZZR-PICF2B';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'Brand Antrean Divisi', 'Ibu F2B', 'Surabaya', 'Fashion', 'https://shopee/zzrf2b',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR-0F2B', 1, 'f2b service', '9000000.00',
              '10% of standard price', 'Ongoing', ${AM})
      on conflict (id) do nothing`;
    // The PIC is a real employee row so the display name has something to find;
    // it is NOT the reader and NOT the creator, so RLS on `employees` denies it.
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, created_by)
      values (${PIC}, 'Rian PIC F2B', 'rian.f2b@zzr.test', 'Creative', 'Creative Designer', ${OWNER})
      on conflict (employee_id) do nothing`;
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, created_by)
      values (${BRF}, ${SVC}, 'f2b brief', '[Draft]', 'Creative', ${PIC}, ${AM})
      on conflict (id) do nothing`;

    const leadClaims = claims({ employeeId: 'ZZR-CRELEADF', division: 'Creative', level: 'lead' });
    const leadActor = actor('ZZR-CRELEADF', 'Creative', 'lead');
    try {
      // Premise: all three joined tables are invisible to this reader, so the
      // values below can only have arrived through `private.*`.
      const invisible = await withClaims(sql, leadClaims, (tx) =>
        tx<{ svc: string; cli: string; emp: string }[]>`
          select (select count(*) from services  where id = ${SVC}) as svc,
                 (select count(*) from clients   where id = ${CLI}) as cli,
                 (select count(*) from employees where employee_id = ${PIC}) as emp`,
      );
      expect(
        Number(invisible[0].svc) + Number(invisible[0].cli) + Number(invisible[0].emp),
        'premise broken: a join would work here, so this test no longer proves the private.* door is needed',
      ).toBe(0);

      const queue = await withClaims(sql, leadClaims, (tx) =>
        listDivisionQueue(tx, leadActor, 'Creative'),
      );
      const mine = queue.find((b) => b.id === BRF);
      expect(mine, 'the queue must still contain the Brief — a join would have erased it').toBeDefined();
      expect(mine!.clientId).toBe(CLI);
      expect(mine!.clientNama).toBe('Brand Antrean Divisi');
      expect(mine!.assignedPicNama).toBe('Rian PIC F2B');
    } finally {
      await sql`delete from briefs where id = ${BRF}`;
      await sql`delete from employees where employee_id = ${PIC}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * O51 (found 2026-08-03, keputusan pemilik 2026-08-07 → pilihan (a)).
   *
   * `performance.staffRoleType` joined `role_mappings` — a table the baseline
   * revokes from `authenticated` entirely — on a READ path, so `GET /portal/me`
   * raised 42501, `mapError` did not map it, and `/portal` answered 500 for
   * EVERY actor. `staffLanding` swallows only `performance.NotFoundError`, so
   * the Postgres error went straight through.
   *
   * Asserted as "resolves", not as a score: the landing page is allowed to have
   * no running score (no KPI Profile). What it is never allowed to do is throw a
   * privilege error.
   */
  it('renders the portal landing under RLS without hitting role_mappings — the O51 500', async () => {
    const STAFF = 'ZZR-PORTAL';
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${STAFF}, 'RLS Portal Fixture', 'zzr.portal@example.test', 'ACCOUNT', 'ZZR ACCOUNT EXEC', true, 'SYSTEM')
      on conflict (employee_id) do nothing`;
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ACCOUNT', 'ZZR ACCOUNT EXEC', 'Account', 'staff', 'SYSTEM')
      on conflict do nothing`;
    try {
      const landing = await withClaims(
        sql,
        claims({ employeeId: STAFF, division: 'Account', level: 'staff' }),
        (tx) => staffLanding(tx, actor(STAFF, 'Account', 'staff'), new Date()),
      );
      expect(landing.employeeId).toBe(STAFF);

      // The table itself stays shut — the fix opened the ANSWER, not the map of
      // who-can-do-what across the company.
      await expect(
        withClaims(sql, claims({ employeeId: STAFF, division: 'Account', level: 'staff' }), (tx) =>
          tx`select 1 from role_mappings limit 1`,
        ),
      ).rejects.toThrow();
    } finally {
      await sql`delete from role_mappings where divisi = 'ACCOUNT' and jabatan = 'ZZR ACCOUNT EXEC'`;
      await sql`delete from employees where employee_id = ${STAFF}`;
    }
  });

  it('introspects the transition engine under RLS — the sm_edges 500 (QA 2026-08-03)', async () => {
    // `sm_edges` sat in the baseline's "pure internal" group (SELECT revoked from
    // `authenticated`) because its only reader used to be `sm_transition`, a
    // SECURITY DEFINER. O37 moved every READ onto the `authenticated` role, and
    // this call — the one the attempt-detail page needs to know which action
    // buttons exist — started raising 42501 permission_denied, which `mapError`
    // does not map: the page rendered a bare "internal server error".
    // 20260803123327_rls_sm_edges_read_path.sql grants SELECT + a USING (true)
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

  /**
   * S-01 (Kinerja Sales, RENCANA_KINERJA_SALES.md §2/§5). Head Sales never got
   * the "Lead/SPV = division-wide" arm (CLAUDE.md #6) on the four tables its own
   * dashboard depends on — `prospect_attempts`, `clients`, `transactions`,
   * `installments` — so `salesperf.bySalesperson` would have silently shown a
   * Head/SPV Sales only their OWN rows, exactly the class of bug O37/O46/O48
   * already fixed for other divisions. Asserted on all four tables, for three
   * actors: a Sales lead reading a TEAMMATE's row (must see), the teammate's own
   * peer at STAFF level (must NOT — staff = own data only), and a lead of an
   * unrelated division (must NOT — division-wide is bounded by division).
   */
  it('lets a Sales lead read a teammate\'s attempt/client/transaction/installment — the S-01 fix', async () => {
    const OWNER_STAFF = 'ZZR-SLS-STAFF';
    const CLI = 'CLI-ZZR-S01';
    const TRX = 'TRX-ZZR-S01';
    const INST = 'INST-ZZR-S01';
    const LEAD = 'LEAD-ZZR-S01';
    const PRSP = 'PRSP-ZZR-S01';
    await sql`
      insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                         record_status, created_by)
      values (${LEAD}, 'RLS S-01 Fixture', '0899000222', '62899000222', 'Scouting', 'Sales',
              '[Closed-Success]', ${OWNER_STAFF})
      on conflict (id) do nothing`;
    await sql`
      insert into prospect_attempts (id, lead_id, owner_employee_id, status, claimed_at, created_by)
      values (${PRSP}, ${LEAD}, ${OWNER_STAFF}, 'Closed-Success', now(), ${OWNER_STAFF})
      on conflict (id) do nothing`;
    await sql`
      insert into clients (id, lead_id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
      values (${CLI}, ${LEAD}, 'RLS S-01 Toko', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzrs01',
              '5000000.00', '8000000.00', ${OWNER_STAFF}, ${OWNER_STAFF}, ${TRX}, ${OWNER_STAFF})
      on conflict (id) do nothing`;
    await sql`
      insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
      values (${TRX}, ${CLI}, '[Lunas]', '5000000.00', '[Menunggu Verifikasi]', ${OWNER_STAFF})
      on conflict (id) do nothing`;
    await sql`
      insert into installments (id, transaction_id, installment_no, amount, status, created_by)
      values (${INST}, ${TRX}, 1, '5000000.00', '[Belum Jatuh Tempo]', ${OWNER_STAFF})
      on conflict (id) do nothing`;

    try {
      const countRow = (n: unknown): number => Number((n as { n: string }[])[0].n);
      const readAll = async (empClaims: string) =>
        withClaims(sql, empClaims, (tx) =>
          tx<{ n: string }[]>`
            select (select count(*) from prospect_attempts where id = ${PRSP})
                 + (select count(*) from clients where id = ${CLI})
                 + (select count(*) from transactions where id = ${TRX})
                 + (select count(*) from installments where id = ${INST}) as n`,
        );

      const asLead = await readAll(claims({ employeeId: 'ZZR-SLS-LEAD', division: 'Sales', level: 'lead' }));
      expect(countRow(asLead), 'Sales lead must see all 4 rows of a teammate — the S-01 fix').toBe(4);

      const asPeerStaff = await readAll(claims({ employeeId: 'ZZR-SLS-PEER', division: 'Sales', level: 'staff' }));
      expect(countRow(asPeerStaff), 'Sales STAFF must not see a peer\'s rows — staff is own-data-only').toBe(0);

      const asOtherDivisionLead = await readAll(claims({ employeeId: 'ZZR-OTHERLEAD', division: 'Creative', level: 'lead' }));
      expect(countRow(asOtherDivisionLead), 'a lead of an UNRELATED division must see nothing').toBe(0);
    } finally {
      await sql`delete from installments where id = ${INST}`;
      await sql`delete from transactions where id = ${TRX}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
      await sql`delete from prospect_attempts where id = ${PRSP}`;
      await sql`delete from leads where id = ${LEAD}`;
    }
  });

  /**
   * `working_days_between` fix (2026-09-07, `20260907020000_fix_working_days_
   * between_security_definer.sql`). `GET /briefs/{id}/stage` (M16 Tahapan
   * Produksi) computes lead time through `readAsActor` — RLS role
   * `authenticated` — but `working_days_between` reads `hari_libur`, a table
   * deliberately locked to service-role-only access
   * (`20260813000000_kelola_klien_sla.sql`). Before the fix that function was
   * plain SECURITY INVOKER, so it ran with the CALLER's (authenticated)
   * privileges and 42501-ed — production symptom: "Tahapan Produksi" answered
   * a bare "internal server error" for every viewer, on every Brief. Same
   * empirical-probe shape as the O52/O51 tests above: prove the read model
   * resolves under a real RLS session, not just under the privileged pool.
   */
  it('computes Brief stage lead time under RLS without hitting hari_libur — the working_days_between 500', async () => {
    const CLI = 'CLI-ZZR-0907';
    const SVC = 'SVC-ZZR-0907';
    const BRF = 'BRF-ZZR-0907';
    const AM = 'ZZR-AM907';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'RLS 0907 Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzr907',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR-0907', 1, 'rls 0907 service', '9000000.00',
              '10% of standard price', 'Ongoing', ${AM})
      on conflict (id) do nothing`;
    // stage_pipeline_code/production_stage NULL on purpose — mirrors a Brief
    // created before M16 (or any division with no pipeline row, Rule 12), the
    // exact shape of the Brief that tripped this in production.
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values (${BRF}, ${SVC}, 'rls 0907 brief', '[In Progress]', 'Creative', ${AM})
      on conflict (id) do nothing`;

    const amClaims = claims({ employeeId: AM, division: 'Account', level: 'staff' });
    const amActor = actor(AM, 'Account', 'staff');
    try {
      const overview = await withClaims(sql, amClaims, (tx) => getStageOverview(tx, amActor, BRF));
      expect(overview.briefId).toBe(BRF);
      expect(overview.stagePipelineCode).toBeNull();
      // `intake.hariKerja` is the one field that always calls working_days_between,
      // pipeline or not (Rule 12) — a number (not a thrown 42501) is the assertion.
      expect(typeof overview.leadTime.intake.hariKerja).toBe('number');
    } finally {
      await sql`delete from briefs where id = ${BRF}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * The SECOND 500 on the same panel (QA live 2026-09-02, pelapor Yohan/Director)
   * — and the reason this case exists as its own test rather than a tweak to the
   * one above.
   *
   * That test pins `stage_pipeline_code`/`production_stage` to NULL on purpose
   * (Rule 12), which means `getStageOverview` returns `defs: []` and
   * `nextStages: []` WITHOUT ever calling `listNextStages`. So the entire
   * pipeline branch — the branch every real M16 Brief takes — went unexercised
   * under RLS. `listNextStages` → `pipelineByCode` was joining `sm_machines`,
   * a table in the RLS baseline's "pure internal" group (SELECT revoked from
   * `authenticated`, zero policies), and answered
   * `42501 permission denied for table sm_machines` → unmapped → 500 →
   * "internal server error" in the Tahapan Produksi panel of
   * `/creative/briefs/BRF-202609-0001`.
   *
   * So this Brief is deliberately the SHAPE THAT BROKE: a real pipeline code and
   * a real `production_stage`. `nextStages` non-empty is the assertion that
   * distinguishes "the read path resolved" from "the branch was skipped" — an
   * empty array is exactly what the un-exercised branch also returns, so
   * asserting merely "did not throw" would have passed on the buggy code too.
   */
  it('resolves nextStages under RLS without hitting sm_machines — the pipelineByCode 500', async () => {
    const CLI = 'CLI-ZZR-0902';
    const SVC = 'SVC-ZZR-0902';
    const BRF = 'BRF-ZZR-0902';
    const AM = 'ZZR-AM902';
    await sql`
      insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id,
                           released_to_account_at, created_by)
      values (${CLI}, 'RLS 0902 Fixture', 'Ibu RLS', 'Jakarta', 'Fashion', 'https://shopee/zzr902',
              '9000000.00', '12000000.00', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                            commission_rule, status, created_by)
      values (${SVC}, ${CLI}, 'MSV-ZZR-0902', 1, 'rls 0902 service', '9000000.00',
              '10% of standard price', 'Ongoing', ${AM})
      on conflict (id) do nothing`;
    // Read the pipeline + its opening stage from the seeded registry rather than
    // hardcoding 'CREATIVE_CONTENT'/'Cek Brief AM': the point of the test is the
    // RLS grant, and a renamed stage code must not turn this into a false green.
    const [pipe] = await sql<{ code: string; initial_state: string }[]>`
      select sp.code, sm.initial_state
        from stage_pipeline sp
        join sm_machines sm on sm.name = sp.machine_name
       where sp.division_code = 'CREATIVE' and sp.aktif = true
       order by (sp.deliverable_type is not null) desc
       limit 1`;
    expect(pipe, 'no active Creative stage_pipeline seeded').toBeDefined();
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division,
                          stage_pipeline_code, production_stage, created_by)
      values (${BRF}, ${SVC}, 'rls 0902 brief', '[To Do]', 'Creative',
              ${pipe.code}, ${pipe.initial_state}, ${AM})
      on conflict (id) do nothing`;

    const amClaims = claims({ employeeId: AM, division: 'Account', level: 'staff' });
    const amActor = actor(AM, 'Account', 'staff');
    try {
      const overview = await withClaims(sql, amClaims, (tx) => getStageOverview(tx, amActor, BRF));
      expect(overview.stagePipelineCode).toBe(pipe.code);
      expect(overview.productionStage).toBe(pipe.initial_state);
      // The branch actually ran: a forward edge out of the opening stage exists
      // (Cek Brief AM -> Script for Creative), and the return edge is filtered.
      expect(overview.nextStages.length).toBeGreaterThan(0);
      expect(overview.nextStages.map((n) => n.stageCode)).not.toContain('Brief Dikembalikan ke AM');
      // The pipeline's checkpoints came back too, i.e. listStageDefs resolved.
      expect(overview.leadTime.stages.length).toBeGreaterThan(0);
      // Every next stage is a REAL checkpoint of this pipeline, and carries a
      // label. (Deliberately not `label !== stageCode`: the seeded Creative
      // pipeline labels each stage with its own code, so that would fail on
      // correct data — the containment check is what actually proves the
      // stage_definition reads resolved under RLS.)
      const defCodes = overview.leadTime.stages.map((st) => st.stageCode);
      for (const n of overview.nextStages) {
        expect(defCodes).toContain(n.stageCode);
        expect(n.label.trim()).not.toBe('');
      }
    } finally {
      await sql`delete from briefs where id = ${BRF}`;
      await sql`delete from services where id = ${SVC}`;
      await sql`delete from contracts where client_id = ${CLI}`;
      await sql`delete from clients where id = ${CLI}`;
    }
  });

  /**
   * FEEDBACK SALES 2026-09-08 #2 — "Tampilan ownernya no id, buat supaya bisa
   * menjadi nama sales", dilaporkan dari layar Head Sales.
   *
   * Bukan query yang salah. `listAttempts` SUDAH menulis
   * `coalesce(e.nama, pa.owner_employee_id)` atas `left join employees` — tapi
   * ia dibaca lewat `readAsActor`, jadi `employees_select` yang berlaku
   * (`20260723064438_rls_baseline.sql`) berbunyi
   * `jwt_can_read_all() OR self OR created_by`.
   *
   * Seorang Head Sales BUKAN `jwt_can_read_all()` (itu OD/Director), jadi
   * join-nya mengembalikan NULL untuk setiap orang selain dirinya dan
   * `coalesce` jatuh ke ID. Itulah kenapa gejalanya HANYA terlihat di layar
   * Head Sales: kolom Owner memang cuma dirender untuk lead/OD/Director, dan
   * OD/Director melihat nama karena mereka lolos `jwt_can_read_all()`.
   *
   * Kelas cacatnya sama dengan `private.brief_jumlah_anak` (A-req-3) dan
   * `client_milestones`: join yang dipersempit RLS tidak melempar dan tidak
   * membuang barisnya — ia diam-diam mengembalikan nilai yang salah, dengan
   * halaman menjawab 200. Tes service-role di suite lain BUTA terhadapnya.
   *
   * Jawabannya `private.employee_display_name` (SECURITY DEFINER, sudah ada
   * sejak 20260724134427, fallback ke id) — bukan melebarkan `employees_select`.
   */
  describe('nama karyawan di bawah RLS (Feedback Sales #2)', () => {
    const S_LEAD = 'ZZR-SALESLEAD';
    const S_OWNER = 'ZZR-SALESOWNER';
    const S_OWNER_NAMA = 'Budi Prospek';
    const S_LEAD_ID = 'LEAD-ZZR-0002';
    const S_PRSP_ID = 'PRSP-ZZR-0002';

    async function seedSales(): Promise<void> {
      await sql`
        insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
        values (${S_OWNER}, ${S_OWNER_NAMA}, 'zzr-owner@example.test', 'Sales', 'Sales Executive', true, 'SYSTEM'),
               (${S_LEAD}, 'Head Sales ZZR', 'zzr-lead@example.test', 'Sales', 'Head Sales', true, 'SYSTEM')
        on conflict (employee_id) do nothing`;
      await sql`
        insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                           record_status, created_by)
        values (${S_LEAD_ID}, 'Toko Prospek Bersama', '0899000222', '62899000222', 'Scouting',
                'Sales', 'active', ${S_OWNER})
        on conflict (id) do nothing`;
      await sql`
        insert into prospect_attempts (id, lead_id, owner_employee_id, status, claimed_at, created_by)
        values (${S_PRSP_ID}, ${S_LEAD_ID}, ${S_OWNER}, 'New Lead', now(), ${S_OWNER})
        on conflict (id) do nothing`;
    }

    afterAll(async () => {
      if (!sql) return;
      await sql`delete from prospect_attempts where id = ${S_PRSP_ID}`;
      await sql`delete from leads where id = ${S_LEAD_ID}`;
      await sql`delete from employees where employee_id in (${S_OWNER}, ${S_LEAD})`;
    });

    it('listAttempts: Head Sales melihat NAMA sales lain, bukan EMP- id', async () => {
      await seedSales();
      const rows = await withClaims(
        sql,
        claims({ employeeId: S_LEAD, division: 'Sales', level: 'lead' }),
        (tx) => listAttempts(tx, {}).then((p) => p.rows),
      );
      const row = rows.find((r) => r.id === S_PRSP_ID);
      expect(row, 'Head Sales harus melihat attempt se-divisinya (arm S-01)').toBeDefined();
      expect(row?.ownerNama).toBe(S_OWNER_NAMA);
      // Dinyatakan terpisah supaya kegagalannya menyebut GEJALA yang dilaporkan,
      // bukan cuma "string tidak sama".
      expect(row?.ownerNama, 'owner tampil sebagai ID mentah — ini keluhan aslinya')
        .not.toBe(S_OWNER);
    });

    it('getAttempt: nama owner ikut benar di halaman detail', async () => {
      await seedSales();
      const detail = await withClaims(
        sql,
        claims({ employeeId: S_LEAD, division: 'Sales', level: 'lead' }),
        (tx) => getAttempt(tx, S_PRSP_ID),
      );
      expect(detail.attempt.ownerNama).toBe(S_OWNER_NAMA);
    });

    it('leadDetailView: tabel kontes menyebut nama tiap pemilik attempt', async () => {
      await seedSales();
      const view = await withClaims(
        sql,
        claims({ employeeId: S_LEAD, division: 'Sales', level: 'lead' }),
        (tx) => leadDetailView(tx, S_LEAD_ID),
      );
      expect(view.attempts.find((a) => a.id === S_PRSP_ID)?.ownerNama).toBe(S_OWNER_NAMA);
    });

    /**
     * FS-5. `contracts_select` sebelum migrasi 20260925010000 tidak punya
     * lengan Sales lead — `clients_select` punya sejak S-01, `contracts_select`
     * dilewati karena saat itu kontraknya belum punya UI mana pun. Akibatnya
     * Head Sales melihat KLIEN se-divisinya tapi tidak DURASI kontraknya.
     *
     * Diuji lewat RLS sungguhan meski route `GET /clients/{id}/contracts`
     * hari ini berjalan service-role: policy-nya adalah pernyataan resmi siapa
     * boleh melihat apa (CLAUDE.md — penegakan ada di DB), dan gate TS-nya
     * dibentuk sebagai cerminnya.
     */
    it('contracts: Head Sales membaca jendela kontrak se-divisinya (FS-5)', async () => {
      await seedSales();
      const CLI = 'CLI-ZZR-0003';
      const CTR = 'CTR-ZZR-0003';
      await sql`
        insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                             sales_pic_id, commission_payment_pic_id, payment_intent, created_by)
        values (${CLI}, 'Toko Kontrak', 'Ibu ZZR', 'Bandung', 'Fashion', 'https://shopee/zzr3',
                '1000000.00', '2000000.00', ${S_OWNER}, ${S_OWNER}, '[Termin]', ${S_OWNER})
        on conflict (id) do nothing`;
      await sql`
        insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir,
                               jenis, created_by)
        values (${CTR}, ${CLI}, 6, current_date, current_date + 180, 'baru', ${S_OWNER})
        on conflict (id) do nothing`;
      try {
        const asHead = await withClaims(
          sql,
          claims({ employeeId: S_LEAD, division: 'Sales', level: 'lead' }),
          (tx) => tx`select id, durasi_bulan, jenis from contracts where id = ${CTR}`,
        );
        expect(asHead.length, 'Head Sales harus melihat kontrak se-divisinya').toBe(1);
        expect(Number(asHead[0].durasi_bulan)).toBe(6);

        // Tetap ter-scope: divisi eksekusi tidak punya lengan apa pun di sini.
        const asCreative = await withClaims(
          sql,
          claims({ employeeId: 'ZZR-CRE', division: 'Creative', level: 'lead' }),
          (tx) => tx`select id from contracts where id = ${CTR}`,
        );
        expect(asCreative.length).toBe(0);
      } finally {
        await sql`delete from contracts where id = ${CTR}`;
        await sql`delete from clients where id = ${CLI}`;
      }
    });

    it('listClients: Head Sales melihat nama Sales PIC klien, bukan id', async () => {
      await seedSales();
      const CLI = 'CLI-ZZR-0002';
      await sql`
        insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                             sales_pic_id, commission_payment_pic_id, payment_intent, created_by)
        values (${CLI}, 'Toko Nama PIC', 'Ibu ZZR', 'Bandung', 'Fashion', 'https://shopee/zzr2',
                '1000000.00', '2000000.00', ${S_OWNER}, ${S_OWNER}, '[Termin]', ${S_OWNER})
        on conflict (id) do nothing`;
      try {
        const page = await withClaims(
          sql,
          claims({ employeeId: S_LEAD, division: 'Sales', level: 'lead' }),
          (tx) => listClients(tx),
        );
        expect(page.rows.find((r) => r.id === CLI)?.salesPicNama).toBe(S_OWNER_NAMA);
      } finally {
        await sql`delete from clients where id = ${CLI}`;
      }
    });
  });
});
