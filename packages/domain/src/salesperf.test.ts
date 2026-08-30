/**
 * Tests for Kinerja Sales (M0 §7.1) — `salesperf.ts`.
 *
 * Pure permission predicates run everywhere; the aggregation + target admin
 * need a DB and skip unless DATABASE_URL is set, same convention as
 * `sales.test.ts`/`activity.test.ts`. Own actor prefix `ZSP-` (not the shared
 * `ZZ-`) — vitest runs suites in parallel against one database, and reusing
 * the seeded Alpha Digital employees (`EMP-0001` Sales staff / `EMP-0006`
 * Sales lead) would let another suite's fixture rows pollute this suite's
 * exact-count assertions. `role_mappings` for ('Sales','Sales Executive') /
 * ('Sales','Sales Head') already exist from seed — reused, not duplicated.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { register } from './leads';
import {
  close,
  markContacted,
  PAYMENT_SCHEME_LUNAS,
  submitNegotiation,
  submitQualifiedForm,
  type Actor,
} from './sales';
import {
  bySalesperson,
  byMonth,
  bySource,
  canViewSalesPerf,
  ForbiddenError as SalesPerfForbiddenError,
  levelSalesFor,
  listTargets,
  scopeFor,
  setTarget,
} from './salesperf';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const budi = (): Actor => ({
  employeeId: 'ZSP-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZSP-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZSP-LEAD', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const director = (): Actor => ({
  employeeId: 'ZSP-DIR',
  role: permission.makeRole({ director: true }),
});
const creativeStaff = (): Actor => ({
  employeeId: 'ZSP-CRE', divisi: 'Creative',
  role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Pure permission predicates — no DB.
// ---------------------------------------------------------------------------

describe('canViewSalesPerf / scopeFor', () => {
  it('grants Sales staff/lead, OD, and Director; denies every other division', () => {
    expect(canViewSalesPerf(budi())).toBe(true);
    expect(canViewSalesPerf(salesLead())).toBe(true);
    expect(canViewSalesPerf(director())).toBe(true);
    expect(canViewSalesPerf(creativeStaff())).toBe(false);
  });

  it('scopes Sales staff to own rows only; Sales lead/OD/Director see the whole division', () => {
    expect(scopeFor(budi())).toEqual({ ownOnly: true });
    expect(scopeFor(salesLead())).toEqual({ ownOnly: false });
    expect(scopeFor(director())).toEqual({ ownOnly: false });
    expect(scopeFor(creativeStaff())).toBeNull();
  });
});

describe('levelSalesFor', () => {
  it('maps a known jabatan to its §3a label and passes through an unknown one', () => {
    expect(levelSalesFor('SENIOR SALES JASA')).toBe('Senior');
    expect(levelSalesFor('SALES JASA')).toBe('Junior');
    expect(levelSalesFor(null)).toBe('—');
    expect(levelSalesFor('Some Future Title')).toBe('Some Future Title');
  });
});

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------

let seq = 0;
const uniquePhone = (): string => `0812${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

async function seedEmployees(): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) values
      ('ZSP-BUDI', 'ZSP Budi', 'zsp.budi@example.test', 'Sales', 'Sales Executive', true, 'SYSTEM'),
      ('ZSP-ANDI', 'ZSP Andi', 'zsp.andi@example.test', 'Sales', 'Sales Executive', true, 'SYSTEM'),
      ('ZSP-LEAD', 'ZSP Lead', 'zsp.lead@example.test', 'Sales', 'Sales Head',      true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
}

async function seedService(id: string, price = '9000000.00', rule = '10% of standard price'): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZSP-ADMIN') on conflict (id) do nothing`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, ${rule}, true, '2020-01-01', 'flat', 'ZSP-ADMIN')
    on conflict do nothing`;
  return id;
}

/** Register a lead with `source`, advance to Contacted, then Qualified, then Auto-Approved. */
async function closedSuccessAttempt(actor: Actor, svc: string, source: string): Promise<{ attemptId: string; clientId: string; transactionId: string }> {
  const { attempt } = await register(sql, actor, { leadName: 'ZSP Alpha', phoneNumber: uniquePhone(), source });
  await markContacted(sql, actor, attempt.id);
  await submitQualifiedForm(sql, actor, attempt.id, {
    namaPic: 'Ibu ZSP', toko: 'ZSP Toko', kota: 'Jakarta', linkToko: 'https://shopee/zsp',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  await submitNegotiation(sql, actor, attempt.id, [], true);
  const res = await close(sql, actor, attempt.id, {
    parties: { primarySalespersonId: actor.employeeId, allocations: [{ salespersonId: actor.employeeId, basisPoints: 10000 }] },
    paymentScheme: PAYMENT_SCHEME_LUNAS,
  });
  return { attemptId: attempt.id, clientId: res.clientId, transactionId: res.transactionId };
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from installments where created_by like 'ZSP-%'`;
  await sql`delete from transactions where created_by like 'ZSP-%'`;
  await sql`delete from services where created_by like 'ZSP-%'`;
  await sql`delete from client_platforms where created_by like 'ZSP-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZSP-%'`;
  await sql`delete from contracts where created_by like 'ZSP-%'`;
  await sql`delete from clients where created_by like 'ZSP-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZSP-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZSP-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZSP-%'`;
  await sql`delete from qualified_forms where created_by like 'ZSP-%'`;
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZSP-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZSP-%'`;
  await sql`delete from leads where created_by like 'ZSP-%'`;
  await sql`delete from sales_targets where salesperson_id like 'ZSP-%'`;
  await sql`delete from master_service_versions where created_by like 'ZSP-ADMIN'`;
  await sql`delete from master_services where created_by like 'ZSP-ADMIN'`;
});

describeDb('bySalesperson', () => {
  it('aggregates one closed deal: leads, funnel, closing rate, weighted klien/omzet/commission', async () => {
    await seedEmployees();
    const svc = await seedService('SVC-ZSP-CLOSE');
    await closedSuccessAttempt(budi(), svc, 'Scouting');

    const rows = await bySalesperson(sql, salesLead(), { period: null, salespersonId: 'ZSP-BUDI', source: null, campaignId: null });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.leadsRegistered).toBe(1);
    expect(r.leadsScouting).toBe(1);
    expect(r.contacted).toBe(1);
    expect(r.qualified).toBe(1);
    expect(r.nonQualified).toBe(0);
    expect(r.closedSuccess).toBe(1);
    expect(r.closedLost).toBe(0);
    expect(r.closingRatePct).toBe(100);
    expect(r.qualifiedRatePct).toBe(100);
    expect(r.avgDealCycleDays).not.toBeNull();
    expect(r.klienCount).toBe('1.0000');
    expect(r.klienBaru).toBe('1.0000'); // no contract row at all ⇒ 'baru' by elimination (R-01/R-02)
    expect(r.klienPerpanjangan).toBe('0.0000');
    expect(r.klienCrossSell).toBe('0.0000');
    expect(r.omzet).toBe(money.parse('9000000'));
    expect(r.komisiKontrak).toBe(money.parse('900000')); // 10% of 9,000,000
    expect(r.komisiDiakui).toBe(0n); // nothing verified by Finance yet (M0 §5)
  });

  it('renders division-by-zero as null (house rule #7) for a salesperson with no closes', async () => {
    await seedEmployees();
    const rows = await bySalesperson(sql, salesLead(), { period: null, salespersonId: 'ZSP-ANDI', source: null, campaignId: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].closingRatePct).toBeNull();
    expect(rows[0].qualifiedRatePct).toBeNull();
    expect(rows[0].avgDealCycleDays).toBeNull();
    expect(rows[0].omzet).toBe(0n);
  });

  it('scopes a Sales staff to their own row only, and refuses a filter naming someone else', async () => {
    await seedEmployees();
    const own = await bySalesperson(sql, andi(), { period: null, salespersonId: null, source: null, campaignId: null });
    expect(own).toHaveLength(1);
    expect(own[0].salespersonId).toBe('ZSP-ANDI');

    await expect(
      bySalesperson(sql, andi(), { period: null, salespersonId: 'ZSP-BUDI', source: null, campaignId: null }),
    ).rejects.toBeInstanceOf(SalesPerfForbiddenError);
  });

  it('lets a Sales lead see the whole division, and denies a foreign-division actor entirely', async () => {
    await seedEmployees();
    const svc = await seedService('SVC-ZSP-DIVWIDE');
    await closedSuccessAttempt(budi(), svc, 'Scouting');

    // Division-wide includes the whole Sales roster (the seeded Alpha Digital
    // Sales employees too) — assert the SUBSET this fixture cares about, not
    // an exact roster (that would make the test depend on seed contents).
    const divWide = await bySalesperson(sql, salesLead(), { period: null, salespersonId: null, source: null, campaignId: null });
    const ids = divWide.map((r) => r.salespersonId);
    expect(ids).toEqual(expect.arrayContaining(['ZSP-ANDI', 'ZSP-BUDI', 'ZSP-LEAD']));

    await expect(
      bySalesperson(sql, creativeStaff(), { period: null, salespersonId: null, source: null, campaignId: null }),
    ).rejects.toBeInstanceOf(SalesPerfForbiddenError);
  });
});

describeDb('byMonth + target/OKR (S-02)', () => {
  it('surfaces the closing in the current month bucket, and computes pencapaianPct against a set target', async () => {
    await seedEmployees();
    const svc = await seedService('SVC-ZSP-MONTH');
    await closedSuccessAttempt(budi(), svc, 'Scouting');

    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

    // A Sales staff cannot set targets.
    await expect(
      setTarget(sql, andi(), { salespersonId: 'ZSP-BUDI', periodStart: monthStart, periodKind: 'bulan', targetOmzet: '10000000' }),
    ).rejects.toBeInstanceOf(SalesPerfForbiddenError);

    // Sales lead can.
    await setTarget(sql, salesLead(), { salespersonId: 'ZSP-BUDI', periodStart: monthStart, periodKind: 'bulan', targetOmzet: '10000000' });
    const targets = await listTargets(sql, salesLead(), monthStart);
    expect(targets.find((t) => t.salespersonId === 'ZSP-BUDI')?.targetOmzet).toBe(money.parse('10000000'));

    const months = await byMonth(sql, salesLead(), { period: null, salespersonId: 'ZSP-BUDI', source: null, campaignId: null });
    expect(months).toHaveLength(1);
    expect(months[0].closedSuccess).toBe(1);
    expect(months[0].targetOmzet).toBe(money.parse('10000000'));
    expect(months[0].pencapaianPct).toBe(90); // 9,000,000 / 10,000,000
  });
});

describeDb('bySource', () => {
  it('groups leads by source, independent of salesperson scope width', async () => {
    await seedEmployees();
    const svc = await seedService('SVC-ZSP-SOURCE');
    await closedSuccessAttempt(budi(), svc, 'Scouting');

    const rows = await bySource(sql, salesLead(), { period: null, salespersonId: null, source: 'Scouting', campaignId: null });
    const scouting = rows.find((r) => r.source === 'Scouting');
    expect(scouting).toBeDefined();
    expect(scouting!.leads).toBeGreaterThanOrEqual(1);
    expect(scouting!.qualified).toBeGreaterThanOrEqual(1);
    expect(scouting!.closing).toBeGreaterThanOrEqual(1);
  });
});
