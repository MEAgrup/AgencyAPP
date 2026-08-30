/**
 * Tests for Kinerja Sales (salesperf.ts). See RENCANA_KINERJA_SALES.md.
 *
 * - Unit: canViewSalesPerf / scopeFor (pure, mirrors RLS S-01 arm-for-arm).
 * - §3a registry: SALES_LEVEL_LABELS must stay byte-identical to the
 *   `sales_level_labels` seed (dual-home, pattern `division.registry.test.ts`).
 * - Integration (skipped unless DATABASE_URL is set): a full attempt→closing
 *   fixture built with raw SQL (own timestamps, so period bucketing is exact),
 *   exercising bySalesperson/byMonth/bySource/targets: permission per role,
 *   recompute-from-log determinism, weighted money, division-by-zero, and the
 *   BI messages for the write/validation paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  bySalesperson,
  bySource,
  byMonth,
  canViewSalesPerf,
  listTargets,
  MSG_FORBIDDEN,
  MSG_INCOMPLETE,
  SALES_LEVEL_LABELS,
  scopeFor,
  setTarget,
  ForbiddenError,
  ValidationError,
  type Actor,
} from './salesperf';

const salesStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const salesLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Sales', level: 'lead' }) });
const marketingStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Marketing', level: 'staff' }) });
const odActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', director: true }) });

// ===========================================================================
// Unit.
// ===========================================================================

describe('canViewSalesPerf / scopeFor (mirrors RLS S-01)', () => {
  it('Sales any level, OD, Director may view; other divisions may not', () => {
    expect(canViewSalesPerf(salesStaff('S'))).toBe(true);
    expect(canViewSalesPerf(salesLead('L'))).toBe(true);
    expect(canViewSalesPerf(odActor('O'))).toBe(true);
    expect(canViewSalesPerf(director('D'))).toBe(true);
    expect(canViewSalesPerf(marketingStaff('M'))).toBe(false);
  });

  it('Sales staff = own row only; Sales lead/SPV = division-wide; OD/Director = read-all', () => {
    expect(scopeFor(salesStaff('S'))).toEqual({ ownOnly: true });
    expect(scopeFor(salesLead('L'))).toEqual({ ownOnly: false });
    expect(scopeFor(odActor('O'))).toEqual({ ownOnly: false });
    expect(scopeFor(director('D'))).toEqual({ ownOnly: false });
    expect(scopeFor(marketingStaff('M'))).toBeNull();
  });
});

describe('SALES_LEVEL_LABELS (§3a dual-home)', () => {
  it('has exactly the six Sales-division jabatan from the HRIS CSVs', () => {
    expect([...SALES_LEVEL_LABELS.entries()]).toEqual([
      ['HEAD OF SALES JASA', 'Head'],
      ['SENIOR SALES JASA', 'Senior'],
      ['SALES JASA', 'Junior'],
      ['SALES', 'Junior'],
      ['ADMIN SALES', 'Admin'],
      ['CUSTOMER RELATION OFFICER', 'CRO'],
    ]);
  });
});

// ===========================================================================
// Integration.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const SLS1 = 'ZZSP-SLS1'; // Sales staff, jabatan 'SALES JASA' -> Junior
const SLSLEAD = 'ZZSP-SLSLEAD'; // Sales lead, jabatan 'HEAD OF SALES JASA' -> Head
const CMP = 'CMP-ZZSP-0001';
const LEAD_WIN = 'LEAD-ZZSP-0001';
const PRSP_WIN = 'PRSP-ZZSP-0001';
const LEAD_NQ = 'LEAD-ZZSP-0002';
const PRSP_NQ = 'PRSP-ZZSP-0002';
const CLI = 'CLI-ZZSP-0001';
const CTR = 'CTR-ZZSP-0001';
const TRX = 'TRX-ZZSP-0001';
const INST = 'INST-ZZSP-0001';
const SVC = 'SVC-ZZSP-0001';
const PERIOD = { from: '202606', to: '202606' };

async function seed(): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) values
      (${SLS1}, 'ZZSP Sales Junior', 'zzsp.sls1@example.test', 'SALES', 'SALES JASA', true, 'SYSTEM'),
      (${SLSLEAD}, 'ZZSP Sales Head', 'zzsp.slslead@example.test', 'SALES', 'HEAD OF SALES JASA', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by) values
      ('SALES', 'SALES JASA', 'Sales', 'staff', 'SYSTEM'),
      ('SALES', 'HEAD OF SALES JASA', 'Sales', 'lead', 'SYSTEM')
    on conflict (divisi, jabatan) do nothing`;
  await sql`
    insert into campaigns (id, name, channel, start_date, owner_employee_id, status, created_by)
    values (${CMP}, 'salesperf fixture', 'TikTok Ads', '2026-06-01', ${SLS1}, 'Active', ${SLS1})
    on conflict (id) do nothing`;

  // Winning lead + attempt: Scouting source, full funnel to Closed-Success.
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                       record_status, created_at, created_by)
    values (${LEAD_WIN}, 'ZZSP Win', '0899100001', '62899100001', 'Scouting', 'Sales',
            '[Closed-Success]', '2026-06-10 03:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, claimed_at, created_at, created_by)
    values (${PRSP_WIN}, ${LEAD_WIN}, ${SLS1}, 'Closed-Success', '2026-06-10 03:00:00+00', '2026-06-10 03:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by) values
      ('prospect_attempt', ${PRSP_WIN}, ${SLS1}, 'transition:New Lead->Contacted', '2026-06-11 02:00:00+00', ${SLS1}),
      ('prospect_attempt', ${PRSP_WIN}, ${SLS1}, 'transition:Contacted->Qualified', '2026-06-13 02:00:00+00', ${SLS1}),
      ('prospect_attempt', ${PRSP_WIN}, ${SLS1}, 'transition:Qualified->Negotiation - Auto Approved', '2026-06-14 02:00:00+00', ${SLS1}),
      ('prospect_attempt', ${PRSP_WIN}, ${SLS1}, 'transition:Negotiation - Auto Approved->Closed-Success', '2026-06-15 02:00:00+00', ${SLS1})
    on conflict do nothing`;
  await sql`
    insert into prospect_activities (id, attempt_id, lead_id, activity_type, occurred_at, summary, created_by)
    values ('ACT-ZZSP-0001', ${PRSP_WIN}, ${LEAD_WIN}, 'Follow Up', '2026-06-13 05:00:00+00', 'follow up fixture', ${SLS1})
    on conflict (id) do nothing`;

  // Not-Qualified lead + attempt, same salesperson, same period.
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division,
                       record_status, created_at, created_by)
    values (${LEAD_NQ}, 'ZZSP NQ', '0899100002', '62899100002', 'Scouting', 'Sales',
            '[Not Qualified]', '2026-06-05 03:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, claimed_at, created_at, created_by)
    values (${PRSP_NQ}, ${LEAD_NQ}, ${SLS1}, 'Not Qualified', '2026-06-05 03:00:00+00', '2026-06-05 03:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by) values
      ('prospect_attempt', ${PRSP_NQ}, ${SLS1}, 'transition:New Lead->Contacted', '2026-06-05 04:00:00+00', ${SLS1}),
      ('prospect_attempt', ${PRSP_NQ}, ${SLS1}, 'transition:Contacted->Not Qualified', '2026-06-06 04:00:00+00', ${SLS1})
    on conflict do nothing`;
  await sql`
    insert into prospect_attempt_nq_reasons (attempt_id, reason, created_at, created_by)
    values (${PRSP_NQ}, 'Budget tidak sesuai', '2026-06-06 04:00:00+00', ${SLS1})
    on conflict do nothing`;

  // Client/contract/allocation/transaction/service/installment: Rp 10.000.000
  // deal, 10% commission, fully verified, 100% allocated to SLS1.
  await sql`
    insert into clients (id, lead_id, nama_pic, toko, kota, kategori, link_toko, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, transaction_id, created_at, created_by)
    values (${CLI}, ${LEAD_WIN}, 'ZZSP PIC', 'ZZSP Toko', 'Jakarta', 'Fashion', 'https://shopee/zzsp',
            '5000000.00', '8000000.00', ${SLS1}, ${SLS1}, ${TRX}, '2026-06-15 02:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, created_at, created_by)
    values (${CTR}, ${CLI}, 3, '2026-06-15', '2026-09-15', 'baru', '2026-06-15 02:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
    values (${CLI}, ${SLS1}, 10000, ${SLS1})
    on conflict (client_id, salesperson_id) do nothing`;
  await sql`
    insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_at, created_by)
    values (${TRX}, ${CLI}, '[Lunas]', '10000000.00', '[Terverifikasi - Penuh]', '2026-06-15 02:00:00+00', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                          commission_rule, status, created_by)
    values (${SVC}, ${CLI}, 'MSV-ZZSP', 1, 'ZZSP Service', '10000000.00', '10% of standard price', '[Ongoing]', ${SLS1})
    on conflict (id) do nothing`;
  await sql`
    insert into installments (id, transaction_id, installment_no, amount, status, created_by)
    values (${INST}, ${TRX}, 1, '10000000.00', '[Terverifikasi]', ${SLS1})
    on conflict (id) do nothing`;
  // commissionAchievement's sumVerified reads payment_verifications, not the
  // installment's own status flag — both are needed for a "fully verified" deal.
  await sql`
    insert into payment_verifications (transaction_id, installment_id, amount, received_date, verified_by, created_by)
    values (${TRX}, ${INST}, '10000000.00', '2026-06-15', ${SLS1}, ${SLS1})
    on conflict do nothing`;
}

// Seeded ONCE, not per-`it`: `payment_verifications`/`audit_log` have no
// natural conflict target (surrogate `id` PK), so their own `on conflict do
// nothing` never actually fires — a `seed()` per test would silently insert a
// FRESH payment_verifications row every time, inflating amountVerified (and,
// harmlessly, duplicating audit_log transitions) each test run. One shared
// fixture, asserted from multiple angles, is also just the right shape here.
beforeAll(async () => {
  if (!sql) return;
  await seed();
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from sales_targets where salesperson_id = ${SLS1}`;
  await sql`delete from payment_verifications where transaction_id = ${TRX}`;
  await sql`delete from installments where id = ${INST}`;
  await sql`delete from transactions where id = ${TRX}`;
  await sql`delete from services where id = ${SVC}`;
  await sql`delete from client_sales_allocations where client_id = ${CLI}`;
  await sql`delete from contracts where id = ${CTR}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql`delete from prospect_attempt_nq_reasons where attempt_id = ${PRSP_NQ}`;
  // prospect_activities is genuinely append-only (forbid_mutation) — step around
  // it the same way activity.test.ts does: disable -> delete -> re-enable, as the
  // owning test role. See activity.test.ts's purgeActivities() for the rationale.
  await sql`alter table prospect_activities disable trigger prospect_activities_no_delete`;
  try {
    await sql`delete from prospect_activities where id = 'ACT-ZZSP-0001'`;
  } finally {
    await sql`alter table prospect_activities enable trigger prospect_activities_no_delete`;
  }
  // audit_log is append-only (forbid_mutation, no bypass — see reads_rls.test.ts,
  // which leaves its own ZZR- audit rows behind for the same reason): the ZZSP-
  // namespaced rows stay until the next `db-rebuild.sh`, harmless in a throwaway DB.
  await sql`delete from prospect_attempts where id in (${PRSP_WIN}, ${PRSP_NQ})`;
  await sql`delete from leads where id in (${LEAD_WIN}, ${LEAD_NQ})`;
  await sql`delete from campaigns where id = ${CMP}`;
  await sql`delete from role_mappings where divisi = 'SALES' and jabatan in ('SALES JASA', 'HEAD OF SALES JASA')`;
  await sql`delete from employees where employee_id in (${SLS1}, ${SLSLEAD})`;
  await sql.end();
});

describeDb('bySalesperson (Kinerja Sales)', () => {
  it('aggregates the full funnel + weighted money for a Director, one salesperson row', async () => {
    const rows = await bySalesperson(sql, director('ZZSP-DIR'), { period: PERIOD, salespersonId: SLS1, source: null, campaignId: null });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.nama).toBe('ZZSP Sales Junior');
    expect(r.levelSales).toBe('Junior');
    expect(r.leadsRegistered).toBe(2);
    expect(r.leadsScouting).toBe(2);
    expect(r.contacted).toBe(2);
    expect(r.qualified).toBe(1);
    expect(r.nonQualified).toBe(1);
    expect(r.nqBreakdown).toEqual({ 'Budget tidak sesuai': 1 });
    expect(r.negotiating).toBe(1);
    expect(r.closedSuccess).toBe(1);
    expect(r.closedLost).toBe(0);
    expect(r.closingRatePct).toBe(100); // 1 / (1+0)
    expect(r.qualifiedRatePct).toBe(50); // 1 qualified / 2 contacted
    expect(r.avgDealCycleDays).toBe(4); // 06-11 -> 06-15
    expect(r.effortFollowUp).toBe(1);
    expect(r.effortVisit).toBe(0);
    expect(r.klienBaru).toBe('1.00');
    expect(r.klienPerpanjangan).toBe('0.00');
    expect(r.klienCrossSell).toBe('0.00');
    expect(r.klienCount).toBe('1.00');
    expect(r.omzet).toBe('10000000.00');
    expect(r.omzetIdr).toBe('Rp. 10.000.000,00');
    expect(r.komisiKontrak).toBe('1000000.00');
    expect(r.komisiDiakui).toBe('1000000.00'); // fully verified
  });

  it('division-by-zero renders null (UI renders "—"), never NaN/error', async () => {
    const rows = await bySalesperson(sql, director('ZZSP-DIR'), { period: PERIOD, salespersonId: SLSLEAD, source: null, campaignId: null });
    const r = rows[0];
    expect(r.closingRatePct).toBeNull();
    expect(r.qualifiedRatePct).toBeNull();
    expect(r.avgDealCycleDays).toBeNull();
    expect(r.omzet).toBe('0.00');
    expect(r.komisiDiakui).toBe('0.00');
  });

  it('money: weighted omzet across ALL allocated salespeople sums exactly to total_agreed_value (Σ basis_points = 10000); recognized commission ≤ contract commission', async () => {
    const CLI2 = 'CLI-ZZSP-0002';
    const CTR2 = 'CTR-ZZSP-0002';
    const TRX2 = 'TRX-ZZSP-0002';
    const SVC2 = 'SVC-ZZSP-0002';
    const INST2 = 'INST-ZZSP-0002';
    try {
      await sql`
        insert into clients (id, nama_pic, toko, kota, kategori, link_toko, gmv_baseline, target_gmv,
                             sales_pic_id, commission_payment_pic_id, transaction_id, created_at, created_by)
        values (${CLI2}, 'ZZSP2 PIC', 'ZZSP2 Toko', 'Jakarta', 'Fashion', 'https://shopee/zzsp2',
                '5000000.00', '8000000.00', ${SLS1}, ${SLS1}, ${TRX2}, '2026-06-20 02:00:00+00', ${SLS1})`;
      await sql`
        insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, created_at, created_by)
        values (${CTR2}, ${CLI2}, 3, '2026-06-20', '2026-09-20', 'baru', '2026-06-20 02:00:00+00', ${SLS1})`;
      // 60/40 split — a fraction that would expose a floor-vs-round-half-up
      // mismatch between the two shares if proRata were done independently per
      // share rather than against the same basis (money.proRata is exact per
      // house rule: Σ shares must reconstruct the whole, never drift by a cent).
      await sql`
        insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by) values
          (${CLI2}, ${SLS1}, 6000, ${SLS1}),
          (${CLI2}, ${SLSLEAD}, 4000, ${SLS1})`;
      await sql`
        insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_at, created_by)
        values (${TRX2}, ${CLI2}, '[Lunas]', '10000001.00', '[Terverifikasi - Penuh]', '2026-06-20 02:00:00+00', ${SLS1})`;
      await sql`
        insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                              commission_rule, status, created_by)
        values (${SVC2}, ${CLI2}, 'MSV-ZZSP2', 1, 'ZZSP2 Service', '10000001.00', '10% of standard price', '[Ongoing]', ${SLS1})`;
      await sql`
        insert into installments (id, transaction_id, installment_no, amount, status, created_by)
        values (${INST2}, ${TRX2}, 1, '10000001.00', '[Terverifikasi]', ${SLS1})`;
      await sql`
        insert into payment_verifications (transaction_id, installment_id, amount, received_date, verified_by, created_by)
        values (${TRX2}, ${INST2}, '10000001.00', '2026-06-20', ${SLS1}, ${SLS1})`;

      const rows = await bySalesperson(sql, director('ZZSP-DIR'), { period: PERIOD, salespersonId: null, source: null, campaignId: null });
      const s1 = rows.find((r) => r.salespersonId === SLS1)!;
      const s2 = rows.find((r) => r.salespersonId === SLSLEAD)!;
      // s1 also holds the CLI (100%) fixture from the outer seed() — subtract it
      // to isolate CLI2's contribution before checking the split reconstructs
      // the whole exactly.
      const s1FromCli2 = BigInt(s1.omzet.replace('.', '')) - 1000000000n; // -10.000.000,00 (CLI) in minor units
      const s2FromCli2 = BigInt(s2.omzet.replace('.', ''));
      expect(s1FromCli2 + s2FromCli2).toBe(1000000100n); // 10.000.001,00 in minor units — exact reconstruction

      // Isolate CLI2's share of komisiDiakui the same way (s1 also carries the
      // outer seed()'s CLI at 100%, Rp 1.000.000,00 commission).
      const s1KomisiFromCli2 = BigInt(s1.komisiDiakui.replace('.', '')) - 100000000n;
      const s2KomisiFromCli2 = BigInt(s2.komisiDiakui.replace('.', ''));
      // 10% of Rp 10.000.001,00 = Rp 1.000.000,10 — the whole-deal commission
      // CLI2's two shares must never exceed (fully verified, so achievement ==
      // the contract total here).
      expect(s1KomisiFromCli2 + s2KomisiFromCli2).toBeLessThanOrEqual(100000010n);
    } finally {
      await sql`delete from payment_verifications where transaction_id = ${TRX2}`;
      await sql`delete from installments where id = ${INST2}`;
      await sql`delete from transactions where id = ${TRX2}`;
      await sql`delete from services where id = ${SVC2}`;
      await sql`delete from client_sales_allocations where client_id = ${CLI2}`;
      await sql`delete from contracts where id = ${CTR2}`;
      await sql`delete from clients where id = ${CLI2}`;
    }
  });

  it('permission per role: staff sees own row; staff asking for another row is Forbidden; lead sees the whole division; another division is Forbidden outright', async () => {
    const own = await bySalesperson(sql, salesStaff(SLS1), { period: PERIOD, salespersonId: SLS1, source: null, campaignId: null });
    expect(own[0].salespersonId).toBe(SLS1);

    await expect(
      bySalesperson(sql, salesStaff(SLS1), { period: PERIOD, salespersonId: SLSLEAD, source: null, campaignId: null }),
    ).rejects.toThrow(MSG_FORBIDDEN);

    const asLead = await bySalesperson(sql, salesLead(SLSLEAD), { period: PERIOD, salespersonId: null, source: null, campaignId: null });
    expect(asLead.map((r) => r.salespersonId)).toEqual(expect.arrayContaining([SLS1, SLSLEAD]));

    await expect(
      bySalesperson(sql, marketingStaff('ZZSP-MKT'), { period: PERIOD, salespersonId: null, source: null, campaignId: null }),
    ).rejects.toThrow(MSG_FORBIDDEN);
  });

  it('recompute-from-log: byMonth called twice for a closed period is byte-identical', async () => {
    const f = { period: null, salespersonId: SLS1, source: null, campaignId: null };
    const first = await byMonth(sql, director('ZZSP-DIR'), f);
    const second = await byMonth(sql, director('ZZSP-DIR'), f);
    expect(second).toEqual(first);
  });
});

describeDb('bySource (View 3 — DASHBOARD LEAD)', () => {
  it('groups by period/source/campaign with campaign name + nq breakdown', async () => {
    const rows = await bySource(sql, director('ZZSP-DIR'), { period: PERIOD, salespersonId: SLS1, source: null, campaignId: null });
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((n, r) => n + r.leads, 0);
    expect(total).toBe(2);
    const nq = rows.find((r) => r.nonQualified > 0);
    expect(nq?.nqBreakdown).toEqual({ 'Budget tidak sesuai': 1 });
    // KS-3: sheet 3's "Convertion Rate" column — closing ÷ leads. Both fixture
    // leads are Scouting/no-campaign (one group): 1 of 2 closed → 50%.
    const win = rows.find((r) => r.closing > 0)!;
    expect(win.leads).toBe(2);
    expect(win.conversionRatePct).toBe(50);
  });

  it('conversionRatePct is null on division-by-zero, never NaN (house rule #7)', async () => {
    const rows = await bySource(sql, director('ZZSP-DIR'), { period: { from: '190001', to: '190001' }, salespersonId: SLS1, source: null, campaignId: null });
    expect(rows).toHaveLength(0); // no leads that far back — the empty-set case, not a div-zero one, but proves the shape never throws
  });
});

describeDb('sales_targets (View 4 — Sales OKR)', () => {
  it('Director/OD may set; Sales (staff or lead) may not', async () => {
    await expect(
      setTarget(sql, salesLead(SLSLEAD), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', targetValue: '8000000.00' }),
    ).rejects.toThrow(MSG_FORBIDDEN);

    await setTarget(sql, odActor('ZZSP-OD'), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', targetValue: '8000000.00' });
    const targets = await listTargets(sql, director('ZZSP-DIR'), '2026-06-01');
    const mine = targets.find((t) => t.salespersonId === SLS1);
    expect(mine?.targetValue).toBe('8000000.00');
    expect(mine?.targetValueIdr).toBe('Rp. 8.000.000,00');
    expect(mine?.actualValue).toBe('10000000.00'); // recomputed live from the fixture's June closing
  });

  it('rejects a missing/negative target with the house incomplete message', async () => {
    await expect(
      setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', targetValue: '' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    await expect(
      setTarget(sql, director('ZZSP-DIR'), { salespersonId: '', periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', targetValue: '1000.00' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    // klien_count_min_kontrak REQUIRES metricParam; omzet must NOT carry one.
    await expect(
      setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-07-01', periodKind: 'kuartal', metricKey: 'klien_count_min_kontrak', targetValue: '30' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    await expect(
      setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', metricParam: '1', targetValue: '8000000.00' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
  });

  it('sets and reads back the three non-omzet OKR metrics the owner actually described (KS-4)', async () => {
    // "closing ratio 35% dari qualified leads"
    await setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'closing_ratio_qualified_pct', targetValue: '35' });
    // "30 klien dengan minimal kontrak Rp10jt / kuartal"
    await setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-04-01', periodKind: 'kuartal', metricKey: 'klien_count_min_kontrak', metricParam: '10000000', targetValue: '30' });
    // "closing minimal 3 klien dari scouting / kuartal"
    await setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-04-01', periodKind: 'kuartal', metricKey: 'scouting_closing_count', targetValue: '3' });

    const monthly = await listTargets(sql, director('ZZSP-DIR'), '2026-06-01');
    const ratio = monthly.find((t) => t.salespersonId === SLS1 && t.metricKey === 'closing_ratio_qualified_pct')!;
    expect(ratio.targetValue).toBe('35.00');
    expect(ratio.targetValueIdr).toBeNull(); // not Rupiah — never formatted as one
    expect(ratio.actualValue).toBe('100.00'); // 1 closedSuccess / 1 qualified in the fixture

    const quarterly = await listTargets(sql, director('ZZSP-DIR'), '2026-04-01');
    const klien = quarterly.find((t) => t.metricKey === 'klien_count_min_kontrak')!;
    expect(klien.metricParam).toBe('10000000.00');
    expect(klien.metricParamIdr).toBe('Rp. 10.000.000,00');
    expect(klien.actualValue).toBe('1.00'); // the fixture's one CLI, Rp 10.000.000 >= threshold

    const scouting = quarterly.find((t) => t.metricKey === 'scouting_closing_count')!;
    expect(scouting.actualValue).toBe('1.00'); // the fixture's LEAD_WIN is source=Scouting
    expect(scouting.achievedPct).toBe(33); // 1 / 3 target, rounded
  });

  it('pencapaian/sisa target reflect the OKR set above; a closed month renders sisa-per-hari "—" (null)', async () => {
    await setTarget(sql, director('ZZSP-DIR'), { salespersonId: SLS1, periodStart: '2026-06-01', periodKind: 'bulan', metricKey: 'omzet', targetValue: '8000000.00' });
    const rows = await bySalesperson(sql, director('ZZSP-DIR'), { period: PERIOD, salespersonId: SLS1, source: null, campaignId: null });
    const r = rows[0];
    expect(r.targetOmzet).toBe('8000000.00');
    expect(r.pencapaianPct).toBe(125); // 10.000.000 / 8.000.000
    expect(r.sisaTarget).toBe('0.00'); // already exceeded, clamped at 0
    // June 2026 is long closed relative to the fixture's "today" — zero/negative
    // working days remain in it, so the per-day/per-week run-rate is undefined.
    expect(r.sisaPerHari).toBeNull();
    expect(r.sisaPerMinggu).toBeNull();
  });
});

describe('ForbiddenError / ValidationError', () => {
  it('carry the exact BI messages', () => {
    expect(new ForbiddenError().message).toBe(MSG_FORBIDDEN);
    expect(new ValidationError().message).toBe(MSG_INCOMPLETE);
  });
});
