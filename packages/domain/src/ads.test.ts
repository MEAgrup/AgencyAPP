/**
 * Tests for M8 Ads (ads.ts).
 *
 * - Unit: the §9.1 predicates + parseRoasTarget.
 * - Integration (skipped unless DATABASE_URL is set): campaign creation +
 *   validation, Creative-Asset linkage, the [Paused]/[Active]/[Ended] lifecycle
 *   with the launch dependency, the Optimization Log (budget >50% sign-off +
 *   creative swap), Metric Entries with derived ROAS + Attributed-GMV split
 *   (creative-swap-safe), the setup-Brief submit guard, and the reads.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canManageCampaign,
  canViewCampaign,
  computeAdsManagementEndDate,
  ConflictError,
  createCampaign,
  effectiveGmvBaseline,
  endCampaign,
  ForbiddenError,
  getCampaign,
  gmvTargetBelowStandard,
  hasBudgetSignOff,
  hasKpiSignOff,
  launchCampaign,
  linkAsset,
  listMetricEntries,
  listOptimizations,
  logMetricEntry,
  logOptimization,
  MSG_KPI_BELOW_STANDARD,
  NotFoundError,
  parseGmvTarget,
  parseRoasTarget,
  pauseCampaign,
  setAdditionalDays,
  unlinkAsset,
  ValidationError,
  canFileWeeklyReport,
  fileWeeklyReport,
  listWeeklyReports,
  type Actor,
  type CampaignInput,
} from './ads';
import { submitTask } from './task';

const adsStaff = (id = 'ZZ-ADV'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (id = 'ZZ-ADSLEAD'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const am = (id = 'ZZ-SINTA'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const creativeStaff = (): Actor => ({ employeeId: 'ZZ-C', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit.
// ---------------------------------------------------------------------------
describe('ads predicates', () => {
  it('canManageCampaign: Ads staff/lead or Director', () => {
    expect(canManageCampaign(adsStaff())).toBe(true);
    expect(canManageCampaign(adsLead())).toBe(true);
    expect(canManageCampaign(director())).toBe(true);
    expect(canManageCampaign(am())).toBe(false);
    expect(canManageCampaign(creativeStaff())).toBe(false);
  });
  it('canViewCampaign: OD/Director/Account-lead/owner-AM/Ads', () => {
    expect(canViewCampaign(od(), 'ZZ-SINTA')).toBe(true);
    expect(canViewCampaign(accountLead(), 'ZZ-SINTA')).toBe(true);
    expect(canViewCampaign(am(), 'ZZ-SINTA')).toBe(true);
    expect(canViewCampaign(adsStaff(), 'ZZ-SINTA')).toBe(true);
    expect(canViewCampaign(creativeStaff(), 'ZZ-SINTA')).toBe(false);
  });
  it('hasBudgetSignOff: Ads lead, owning AM, or Director (not a plain Advertiser)', () => {
    expect(hasBudgetSignOff(adsLead(), 'ZZ-SINTA')).toBe(true);
    expect(hasBudgetSignOff(am(), 'ZZ-SINTA')).toBe(true);
    expect(hasBudgetSignOff(director(), 'ZZ-SINTA')).toBe(true);
    expect(hasBudgetSignOff(adsStaff(), 'ZZ-SINTA')).toBe(false);
  });
  it('parseRoasTarget: numeric ROAS target only', () => {
    expect(parseRoasTarget('ROAS ≥ 4x')).toBe(4);
    expect(parseRoasTarget('ROAS 3.5')).toBe(3.5);
    expect(parseRoasTarget('GMV 10jt')).toBeNull();
    expect(parseRoasTarget('ROAS target')).toBeNull();
  });
  it('hasKpiSignOff (B4): same authority as budget sign-off — Ads lead, owning AM, Director', () => {
    expect(hasKpiSignOff(adsLead(), 'ZZ-SINTA')).toBe(true);
    expect(hasKpiSignOff(am(), 'ZZ-SINTA')).toBe(true);
    expect(hasKpiSignOff(director(), 'ZZ-SINTA')).toBe(true);
    expect(hasKpiSignOff(adsStaff(), 'ZZ-SINTA')).toBe(false);
  });
  it('parseGmvTarget (B4): whole-rupiah amount from a GMV-typed target, null otherwise', () => {
    expect(parseGmvTarget('GMV ≥ Rp 20.000.000')).toBe(2_000_000_000n); // 20jt in minor units
    expect(parseGmvTarget('GMV 12000000')).toBe(1_200_000_000n);
    expect(parseGmvTarget('ROAS ≥ 4x')).toBeNull(); // not GMV-typed
    expect(parseGmvTarget('GMV target naik')).toBeNull(); // no digits
  });
  it('gmvTargetBelowStandard (B4): ≥20%/quarter over gmv_baseline; non-GMV & no-baseline exempt', () => {
    const base = money.parse('10000000.00'); // baseline 10jt → floor = 12jt
    expect(gmvTargetBelowStandard('GMV ≥ Rp 10.000.000', base)).toBe(true); // 10jt < 12jt
    expect(gmvTargetBelowStandard('GMV ≥ Rp 12.000.000', base)).toBe(false); // exactly at floor
    expect(gmvTargetBelowStandard('GMV ≥ Rp 15.000.000', base)).toBe(false); // above floor
    expect(gmvTargetBelowStandard('ROAS ≥ 4x', base)).toBe(false); // not GMV-typed → exempt
    expect(gmvTargetBelowStandard('GMV naik banyak', base)).toBe(true); // GMV-typed, unparseable → gate
    expect(gmvTargetBelowStandard('GMV ≥ Rp 5.000.000', 0n)).toBe(false); // no baseline → unenforceable
  });
  it('effectiveGmvBaseline (B4-residual): the higher of the static onboarding baseline and the live run-rate', () => {
    expect(effectiveGmvBaseline(5_000_000_00n, 10_000_000_00n)).toBe(10_000_000_00n); // live > static → live
    expect(effectiveGmvBaseline(10_000_000_00n, 5_000_000_00n)).toBe(10_000_000_00n); // static > live → static
    expect(effectiveGmvBaseline(10_000_000_00n, 0n)).toBe(10_000_000_00n); // no report yet → static (status quo)
    expect(effectiveGmvBaseline(0n, 8_000_000_00n)).toBe(8_000_000_00n); // no baseline but live data → live
  });
});

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insertService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string, status: string): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', ${status}, ${division}, 'Campaign', 1, 'High', false, 'ZZ-TEST')`;
}
/** An [Approved] Creative Asset on a (new) Creative brief of clientId — linkable. */
async function approvedAsset(clientId: string): Promise<string> {
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  const assetId = uid('AST');
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, 'Creative', '[In Review]');
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, status, created_by)
    values (${assetId}, ${briefId}, 'Video', 1, '[Approved]', 'ZZ-TEST')`;
  return assetId;
}

/** A released client + Ads brief [In Progress]. Returns ids. */
async function adsBrief(): Promise<{ clientId: string; briefId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await insertClient(clientId, 'ZZ-SINTA');
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, 'Ads', '[In Progress]');
  return { clientId, briefId };
}

const goodInput = (): CampaignInput => ({
  platform: 'Shopee Ads', objective: 'Sales', budget: '8000000', startDate: '2026-07-01', endDate: '2026-08-31',
  targetKpi: 'ROAS ≥ 4x', tipeIklan: 'GMV Max Product',
});

const setBriefStatus = async (briefId: string, status: string): Promise<void> => {
  await sql`update briefs set status = ${status} where id = ${briefId}`;
};
const setTotalSales = async (clientId: string, decimal: string): Promise<void> => {
  await sql`update clients set total_sales = ${decimal} where id = ${clientId}`;
};
const campaignStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from ad_campaigns where id = ${id}`)[0].status;
const assetGmv = async (id: string): Promise<string | null> =>
  (await sql<{ attributed_gmv: string | null }[]>`select attributed_gmv from assets where id = ${id}`)[0].attributed_gmv;

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // ads_weekly_reports is append-only (no-delete guard) and FKs the briefs
  // deleted below, so it is TRUNCATEd — the guard itself is asserted directly in
  // its own test. Must run before the briefs delete.
  await sql`truncate table ads_weekly_reports`;
  await sql`delete from metric_entry_assets where metric_entry_id in (select id from metric_entries where created_by like 'ZZ-%')`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from optimization_logs where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaign_assets where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('createCampaign (§4 Rule 1)', () => {
  it('creates a campaign under an Ads Brief [In Progress], born [Setting] with IDR display', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    expect(c.status).toBe('[Setting]'); // M16 LT-40 — new birth status, not [Paused]
    expect(c.tipeIklan).toBe('GMV Max Product');
    expect(c.additionalDays).toBe(0);
    expect(c.budget).toBe(8000000);
    expect(c.budgetDisplay).toBe('Rp. 8.000.000,00');
    expect(c.roasDisplay).toBe('—'); // no spend yet
    expect(c.id).toMatch(/^ADC-\d{6}-\d{4}$/);
  });

  it('rejects an invalid Tipe Iklan (M16 LT-41)', async () => {
    const { briefId } = await adsBrief();
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), tipeIklan: 'Boost Post' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('gates: non-Ads brief, brief not in progress, permission, and field validation', async () => {
    const { briefId } = await adsBrief();
    await expect(createCampaign(sql, am(), briefId, goodInput())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), platform: 'Google Ads' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), budget: '0' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), startDate: '2026-09-01', endDate: '2026-07-01' })).rejects.toBeInstanceOf(ValidationError);
    // Non-Ads brief.
    const cl = uid('CLI');
    const svc = uid('SVC');
    const cr = uid('BRF');
    await insertClient(cl, 'ZZ-SINTA');
    await insertService(svc, cl);
    await insertBrief(cr, svc, 'Creative', '[In Progress]');
    await expect(createCampaign(sql, adsStaff(), cr, goodInput())).rejects.toBeInstanceOf(ConflictError);
    await expect(createCampaign(sql, adsStaff(), 'BRF-GHOST-0', goodInput())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('B4: an Advertiser cannot self-set a GMV Target KPI below the 20%/quarter-from-baseline floor', async () => {
    const { briefId } = await adsBrief(); // client gmv_baseline = 10jt → floor 12jt
    // Below the floor → blocked with the SPV-Ads sign-off message.
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'GMV ≥ Rp 10.000.000' }))
      .rejects.toThrow(MSG_KPI_BELOW_STANDARD);
    // GMV-typed but unparseable → cannot prove it clears the floor → also blocked.
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'GMV naik banyak' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    // At/above the floor → the Advertiser may self-set it.
    const ok = await createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'GMV ≥ Rp 15.000.000' });
    expect(ok.targetKpi).toBe('GMV ≥ Rp 15.000.000');
  });

  it('B4: SPV Ads (lead) / Director may sign off a below-standard GMV Target KPI', async () => {
    const { briefId } = await adsBrief();
    const belowStd = { ...goodInput(), targetKpi: 'GMV ≥ Rp 8.000.000' }; // < 12jt floor
    const c = await createCampaign(sql, adsLead(), briefId, belowStd);
    expect(c.targetKpi).toBe('GMV ≥ Rp 8.000.000');
    const { briefId: b2 } = await adsBrief();
    await createCampaign(sql, director(), b2, belowStd); // Director too
  });

  it('B4: a ROAS Target KPI is not subject to the growth floor (Advertiser self-sets)', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput()); // ROAS ≥ 4x
    expect(c.targetKpi).toBe('ROAS ≥ 4x');
  });

  it('B4-residual: a live run-rate above the static baseline raises the growth floor', async () => {
    const { clientId, briefId } = await adsBrief(); // static gmv_baseline = 10jt → old floor 12jt
    // The C1 report engine has since written a live monthly run-rate of 100jt.
    await setTotalSales(clientId, '100000000.00');
    // A 90jt GMV target clears the OLD static floor (12jt) but not the live floor
    // (100jt × 1.20 = 120jt) → an Advertiser can no longer self-set it.
    await expect(createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'GMV ≥ Rp 90.000.000' }))
      .rejects.toThrow(MSG_KPI_BELOW_STANDARD);
    // At/above the live floor → the Advertiser may self-set it.
    const ok = await createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'GMV ≥ Rp 120.000.000' });
    expect(ok.targetKpi).toBe('GMV ≥ Rp 120.000.000');
  });
});

describeDb('Creative-Asset linkage (§4 Rule 2)', () => {
  it('links an approved same-client asset; rejects wrong-client, not-approved, duplicate, not-linked', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const asset = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, asset);
    await expect(linkAsset(sql, adsStaff(), c.id, asset)).rejects.toBeInstanceOf(ConflictError); // duplicate
    // Wrong-client asset.
    const otherClient = uid('CLI');
    await insertClient(otherClient, 'ZZ-SINTA');
    const wrong = await approvedAsset(otherClient);
    await expect(linkAsset(sql, adsStaff(), c.id, wrong)).rejects.toBeInstanceOf(ConflictError);
    // Not-approved asset (same client).
    const svc = uid('SVC');
    const br = uid('BRF');
    const draft = uid('AST');
    await insertService(svc, clientId);
    await insertBrief(br, svc, 'Creative', '[In Progress]');
    await sql`insert into assets (id, brief_id, asset_type, sequence_no, status, created_by)
      values (${draft}, ${br}, 'Video', 1, '[In Progress]', 'ZZ-TEST')`;
    await expect(linkAsset(sql, adsStaff(), c.id, draft)).rejects.toBeInstanceOf(ConflictError);
    // Unlink then unlink again → not linked.
    await unlinkAsset(sql, adsStaff(), c.id, asset);
    await expect(unlinkAsset(sql, adsStaff(), c.id, asset)).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('lifecycle (§2 / §4 Flow 2)', () => {
  it('launch is gated on Brief [Approved] + all linked assets [Approved]; then pause/end', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    // No linked asset + brief not approved → launch blocked.
    await expect(launchCampaign(sql, adsStaff(), c.id)).rejects.toBeInstanceOf(ConflictError);
    const asset = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, asset);
    await expect(launchCampaign(sql, adsStaff(), c.id)).rejects.toBeInstanceOf(ConflictError); // brief not approved
    await setBriefStatus(briefId, '[Approved]');
    expect((await launchCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
    expect(await campaignStatus(c.id)).toBe('[Active]');
    expect((await pauseCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
    expect(await campaignStatus(c.id)).toBe('[Paused]');
    expect((await endCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
    expect(await campaignStatus(c.id)).toBe('[Ended]');
    // An [Ended] campaign rejects new Metric Entries.
    await expect(logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '4000000', entryMethod: 'Manual' }))
      .rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('metrics (§5) + attribution (§7) + ROAS', () => {
  it('derives Total Spend/GMV/ROAS and splits Attributed GMV across linked assets', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const a1 = await approvedAsset(clientId);
    const a2 = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, a1);
    await linkAsset(sql, adsStaff(), c.id, a2);
    // Log an entry: gmv 4,000,000 split equally across the 2 linked assets → 2,000,000 each.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '4000000', entryMethod: 'Manual' });
    expect(await assetGmv(a1)).toBe('2000000.00');
    expect(await assetGmv(a2)).toBe('2000000.00');
    // Derived campaign metrics.
    const got = await getCampaign(sql, adsStaff(), c.id);
    expect(got.totalSpend).toBe(1000000);
    expect(got.totalGmv).toBe(4000000);
    expect(got.roas).toBe(4);
    expect(got.roasDisplay).toBe('4x');
    expect(got.metricEntryCount).toBe(1);
    expect(got.linkedAssetIds.sort()).toEqual([a1, a2].sort());
    // validation of spend/gmv/method.
    await expect(logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '-1', gmv: '0', entryMethod: 'Manual' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1', gmv: '1', entryMethod: 'Telepathy' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('T-3: stores raw clicks/impressions/conversions; rejects a negative/fractional count', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const m = await logMetricEntry(sql, adsStaff(), c.id, {
      periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '4000000',
      clicks: 1000, impressions: 50000, conversions: 100, entryMethod: 'Manual',
    });
    const row = await sql<{ clicks: string | null; impressions: string | null; conversions: string | null }[]>`
      select clicks, impressions, conversions from metric_entries where id = ${m.id}`;
    expect(Number(row[0].clicks)).toBe(1000);
    expect(Number(row[0].impressions)).toBe(50000);
    expect(Number(row[0].conversions)).toBe(100);
    // Counts are optional — omitting them stores NULL.
    const m2 = await logMetricEntry(sql, adsStaff(), c.id, {
      periodStart: '2026-07-08', periodEnd: '2026-07-14', spend: '1', gmv: '1', entryMethod: 'Manual',
    });
    const row2 = await sql<{ clicks: string | null }[]>`select clicks from metric_entries where id = ${m2.id}`;
    expect(row2[0].clicks).toBeNull();
    // A negative or fractional count is rejected.
    await expect(logMetricEntry(sql, adsStaff(), c.id, {
      periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1', gmv: '1', clicks: -5, entryMethod: 'Manual',
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(logMetricEntry(sql, adsStaff(), c.id, {
      periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1', gmv: '1', impressions: 3.5, entryMethod: 'Manual',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('escalation streak: consecutive under-target ROAS periods flag (§8 Rule 4)', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput()); // target ROAS 4
    // Two under-target periods (ROAS 2, then 1) → streak 2, flagged.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '2000000', entryMethod: 'Manual' });
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-08', periodEnd: '2026-07-14', spend: '1000000', gmv: '1000000', entryMethod: 'Manual' });
    const got = await getCampaign(sql, adsStaff(), c.id);
    expect(got.underperformingStreak).toBe(2);
    expect(got.escalationFlagged).toBe(true);
  });

  it('C4: emits m8.ads.roas_underperforming once at the 2nd consecutive under-target period → owning AM + SPV Ads', async () => {
    // An active Ads lead ≠ the actor so `leadsOfDivision` resolves SPV Ads.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-ADSLEAD', 'Ads Lead', 'adslead@mea.id', 'Ads', 'ZZ-ADS-LEAD-JAB', true, 'ZZ-TEST')
      on conflict (employee_id) do nothing`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Ads', 'ZZ-ADS-LEAD-JAB', 'Ads', 'lead', 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;

    const { briefId } = await adsBrief(); // owner AM = ZZ-SINTA
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput()); // target ROAS 4
    const EVT = 'm8.ads.roas_underperforming';
    const recips = async (): Promise<string[]> =>
      (await sql<{ recipient_employee_id: string }[]>`
        select recipient_employee_id from notifications
         where entity_id = ${c.id} and event_type = ${EVT} order by id`).map((r) => r.recipient_employee_id);

    // P1 ROAS 2 (< 4): streak 1 — nothing fires yet.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '2000000', entryMethod: 'Manual' });
    expect(await recips()).toEqual([]);
    // P2 ROAS 1: streak 2 — fires ONCE, to the owning AM + SPV Ads.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-08', periodEnd: '2026-07-14', spend: '1000000', gmv: '1000000', entryMethod: 'Manual' });
    expect([...new Set(await recips())].sort()).toEqual(['ZZ-ADSLEAD', 'ZZ-SINTA']);
    const afterEpisode1 = (await recips()).length;
    expect(afterEpisode1).toBe(2);
    // P3 ROAS 1.5: streak 3 — does NOT re-emit (only the transition to exactly 2 fires).
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-15', periodEnd: '2026-07-21', spend: '1000000', gmv: '1500000', entryMethod: 'Manual' });
    expect((await recips()).length).toBe(2);
    // P4 ROAS 5 (>= 4): streak resets to 0 — still no new emit.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-22', periodEnd: '2026-07-28', spend: '1000000', gmv: '5000000', entryMethod: 'Manual' });
    expect((await recips()).length).toBe(2);
    // P5 ROAS 2: streak 1 again.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-29', periodEnd: '2026-08-04', spend: '1000000', gmv: '2000000', entryMethod: 'Manual' });
    expect((await recips()).length).toBe(2);
    // P6 ROAS 1: streak 2 again — a fresh episode re-fires.
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-08-05', periodEnd: '2026-08-11', spend: '1000000', gmv: '1000000', entryMethod: 'Manual' });
    expect((await recips()).length).toBe(4);
  });

  it('C4: a non-ROAS target never escalates (streak stays 0, no notification)', async () => {
    const { briefId } = await adsBrief();
    // Spend-cap target — parseRoasTarget returns null, so no ROAS streak is tracked.
    const c = await createCampaign(sql, adsStaff(), briefId, { ...goodInput(), targetKpi: 'Spend ≤ Rp 8.000.000' });
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '100000', entryMethod: 'Manual' });
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-08', periodEnd: '2026-07-14', spend: '1000000', gmv: '100000', entryMethod: 'Manual' });
    const n = await sql<{ n: string }[]>`
      select count(*) as n from notifications where entity_id = ${c.id} and event_type = 'm8.ads.roas_underperforming'`;
    expect(Number(n[0].n)).toBe(0);
  });
});

describeDb('optimization log (§6)', () => {
  it('logs an entry; a >50% budget change needs sign-off; a creative swap re-points linkage', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    // A small budget change: the Advertiser acts freely.
    await logOptimization(sql, adsStaff(), c.id, { changeType: 'Budget', beforeValue: '8000000', afterValue: '9000000', reason: 'scale up' });
    // A >50% change: a plain Advertiser is blocked, the Ads lead may.
    await expect(logOptimization(sql, adsStaff(), c.id, { changeType: 'Budget', beforeValue: '8000000', afterValue: '20000000', reason: 'aggressive' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    await logOptimization(sql, adsLead(), c.id, { changeType: 'Budget', beforeValue: '8000000', afterValue: '20000000', reason: 'aggressive' });
    // Creative swap: old→unlinked, new→linked.
    const a1 = await approvedAsset(clientId);
    const a2 = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, a1);
    await logOptimization(sql, adsStaff(), c.id, { changeType: 'Creative Swap', oldAssetId: a1, newAssetId: a2, reason: 'B beats A' });
    const got = await getCampaign(sql, adsStaff(), c.id);
    expect(got.linkedAssetIds).toEqual([a2]);
    expect((await listOptimizations(sql, adsStaff(), c.id)).length).toBe(3);
    await expect(logOptimization(sql, adsStaff(), c.id, { changeType: 'Nonsense', reason: 'x', beforeValue: 'a', afterValue: 'b' }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('submit guard (§4 Rule 3) + reads', () => {
  it('an Ads Brief cannot submit until a campaign with a linked asset exists', async () => {
    const { clientId, briefId } = await adsBrief();
    // Register the Advertiser as the brief PIC and drive the brief so submitTask is reachable.
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    // Brief is [In Progress]; submit blocked (ads.ConflictError from the M8 guard).
    await expect(submitTask(sql, adsStaff(), briefId)).rejects.toBeInstanceOf(ConflictError);
    // Create a campaign + link an asset → submit passes.
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const asset = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, asset);
    expect((await submitTask(sql, adsStaff(), briefId)).ok).toBe(true);
  });

  it('read gates + listMetricEntries', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const asset = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, asset);
    await logMetricEntry(sql, adsStaff(), c.id, { periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: '1000000', gmv: '4000000', entryMethod: 'Manual' });
    expect((await getCampaign(sql, am(), c.id)).id).toBe(c.id); // owning AM may read
    await expect(getCampaign(sql, creativeStaff(), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listMetricEntries(sql, adsStaff(), c.id)).length).toBe(1);
    await expect(getCampaign(sql, adsStaff(), 'ADC-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Laporan Mingguan Advertiser (follow-up PR #172, pemilik 2026-08-19) — realisasi-only.
// ---------------------------------------------------------------------------

describe('weekly-report predicate', () => {
  it('canFileWeeklyReport: the brief PIC, Ads lead, or Director', () => {
    expect(canFileWeeklyReport(adsStaff('ZZ-PIC'), 'ZZ-PIC')).toBe(true);
    expect(canFileWeeklyReport(adsStaff('ZZ-OTHER'), 'ZZ-PIC')).toBe(false);
    expect(canFileWeeklyReport(adsLead(), 'ZZ-PIC')).toBe(true);
    expect(canFileWeeklyReport(director(), 'ZZ-PIC')).toBe(true);
    expect(canFileWeeklyReport(creativeStaff(), 'ZZ-PIC')).toBe(false);
    // An unassigned brief must not make everyone its PIC.
    expect(canFileWeeklyReport(adsStaff('ZZ-ANY'), '')).toBe(false);
  });
});

/** Mark a brief as having entered [In Progress] at `at` (the M12 transition log). */
async function markStarted(briefId: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('brief', ${briefId}, 'ZZ-ADV', 'transition:[To Do]->[In Progress]', ${at}, 'ZZ-ADV')`;
}

/** One weekly Metric Entry on a campaign (raw platform counts included). */
async function metricWeek(
  campaignId: string,
  periodStart: string,
  periodEnd: string,
  spend: string,
  gmv: string,
  clicks: number,
  impressions: number,
  conversions: number,
): Promise<void> {
  await sql`
    insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv,
      clicks, impressions, conversions, entry_method, entered_by, created_by)
    values (${uid('MTR')}, ${campaignId}, ${periodStart}, ${periodEnd}, ${spend}, ${gmv},
      ${clicks}, ${impressions}, ${conversions}, 'Manual', 'ZZ-ADV', 'ZZ-ADV')`;
}

describeDb('listWeeklyReports / fileWeeklyReport', () => {
  it('a brief that never started has no weeks (no invented unfiled obligations)', async () => {
    const { briefId } = await adsBrief();
    const v = await listWeeklyReports(sql, adsStaff(), briefId);
    expect(v.minggu).toEqual([]);
    expect(v.belumDiisi).toBe(0);
  });

  it('recomputes each week from metric entries and marks finished weeks without a report', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    // Week A: Mon 2026-08-03 .. Sun 2026-08-09 (ISO 2026-W32).
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    await metricWeek(c.id, '2026-08-03', '2026-08-09', '2000000', '9500000', 2000, 100000, 100);
    // "now" inside week B, so week A is finished and week B is running.
    const now = new Date('2026-08-12T05:00:00Z');
    const v = await listWeeklyReports(sql, adsStaff(), briefId, now);

    expect(v.minggu.length).toBe(2);
    const a = v.minggu[0];
    expect([a.isoYear, a.isoWeek]).toEqual([2026, 32]);
    expect(a.mingguMulai).toBe('2026-08-03');
    expect(a.mingguAkhir).toBe('2026-08-09');
    const by = (k: string) => a.metrik.find((m) => m.key === k)!;
    expect(by('ads_spent').realisasiDisplay).toBe('Rp. 2.000.000,00');
    expect(by('gmv').realisasiDisplay).toBe('Rp. 9.500.000,00');
    expect(by('roas').realisasi).toBeCloseTo(4.75, 6);
    expect(by('view').realisasiDisplay).toBe('100.000');
    expect(by('ctr').realisasiDisplay).toBe('2,00%'); // 2000 / 100000
    expect(by('cvr').realisasiDisplay).toBe('5,00%'); // 100 / 2000
    expect(by('ads_spent').sifat).toBe('serapan');    // spend is consumed, not "achieved"
    // Week A is over and unreported; week B is still running, so it is not late.
    expect(a.terlambat).toBe(true);
    expect(v.minggu[1].berjalan).toBe(true);
    expect(v.minggu[1].terlambat).toBe(false);
    expect(v.belumDiisi).toBe(1);
    // A week with no metric entry at all renders "—", never 0 (house rule 7).
    const b = v.minggu[1].metrik.find((m) => m.key === 'roas')!;
    expect(b.realisasiDisplay).toBe('—');
    expect(b.realisasi).toBeNull();
  });

  it('the PIC files a week; it then reads back as terisi and no longer late', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    const now = new Date('2026-08-12T05:00:00Z');

    const r = await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, {
      mingguMulai: '2026-08-03',
      analisa: 'ROAS 4,75x di atas ekspektasi; spend terserap 50%.',
      saran: 'Naikkan budget di kampanye Shopee, matikan ad group CTR terendah.',
      kendala: 'Aset video baru belum turun.',
    }, now);
    expect([r.isoYear, r.isoWeek]).toEqual([2026, 32]);
    expect(r.terisi).toBe(true);

    const v = await listWeeklyReports(sql, adsStaff(), briefId, now);
    expect(v.minggu[0].terisi).toBe(true);
    expect(v.minggu[0].terlambat).toBe(false);
    expect(v.minggu[0].saran).toContain('Naikkan budget');
    expect(v.minggu[0].diisiOleh).toBe('ZZ-ADV');
    expect(v.belumDiisi).toBe(0);
  });

  it('gates: non-PIC, blank narrative, duplicate week, future week, week before work started', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    const now = new Date('2026-08-12T05:00:00Z');
    const ok = { mingguMulai: '2026-08-03', analisa: 'a', saran: 's' };

    await expect(fileWeeklyReport(sql, creativeStaff(), briefId, ok, now)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(fileWeeklyReport(sql, adsStaff('ZZ-OTHER'), briefId, ok, now)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, saran: '   ' }, now),
    ).rejects.toBeInstanceOf(ValidationError);
    // Not a Monday.
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, mingguMulai: '2026-08-05' }, now),
    ).rejects.toBeInstanceOf(ValidationError);
    // Not a date at all.
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, mingguMulai: 'minggu lalu' }, now),
    ).rejects.toBeInstanceOf(ValidationError);
    // A week that has not started yet.
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, mingguMulai: '2026-08-17' }, now),
    ).rejects.toBeInstanceOf(ValidationError);
    // A week before the brief was ever worked on.
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, mingguMulai: '2026-07-27' }, now),
    ).rejects.toBeInstanceOf(ConflictError);

    await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, ok, now);
    await expect(fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, ok, now)).rejects.toBeInstanceOf(ConflictError);
  });

  it('a filed report is append-only: UPDATE and DELETE are refused at the DB', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, {
      mingguMulai: '2026-08-03', analisa: 'a', saran: 's',
    }, new Date('2026-08-12T05:00:00Z'));

    await expect(
      sql`update ads_weekly_reports set saran = 'diubah' where brief_id = ${briefId}`,
    ).rejects.toThrow();
    await expect(
      sql`delete from ads_weekly_reports where brief_id = ${briefId}`,
    ).rejects.toThrow();
  });

  it('an Ads lead may file on the PIC own behalf; unrelated divisions cannot even read', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    const now = new Date('2026-08-12T05:00:00Z');
    await fileWeeklyReport(sql, adsLead(), briefId, { mingguMulai: '2026-08-03', analisa: 'a', saran: 's' }, now);
    expect((await listWeeklyReports(sql, adsLead(), briefId, now)).minggu[0].diisiOleh).toBe('ZZ-ADSLEAD');
    await expect(listWeeklyReports(sql, creativeStaff(), briefId, now)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('M16 LT-43: Mini/Monthly/Content Analysis coexist with Weekly for the SAME ISO week', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    const now = new Date('2026-08-12T05:00:00Z');
    const week = { mingguMulai: '2026-08-03', analisa: 'a', saran: 's' };

    await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, week, now); // Weekly (default)
    const monthly = await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...week, jenis: 'Monthly' }, now);
    expect(monthly.jenis).toBe('Monthly');
    // Same jenis, same week, twice → still append-only-once.
    await expect(fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...week, jenis: 'Monthly' }, now))
      .rejects.toBeInstanceOf(ConflictError);
    await expect(fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, week, now))
      .rejects.toBeInstanceOf(ConflictError); // Weekly already filed above
    await expect(fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...week, jenis: 'Kuartalan' }, now))
      .rejects.toBeInstanceOf(ValidationError);

    // Each jenis reads back independently — Weekly's list does not show the
    // Monthly row for the same week, and vice versa.
    const weeklyView = await listWeeklyReports(sql, adsStaff(), briefId, now);
    expect(weeklyView.minggu[0].jenis).toBe('Weekly');
    expect(weeklyView.minggu[0].terisi).toBe(true);
    const monthlyView = await listWeeklyReports(sql, adsStaff(), briefId, now, 'Monthly');
    expect(monthlyView.minggu[0].jenis).toBe('Monthly');
    expect(monthlyView.minggu[0].terisi).toBe(true);
  });
});

describeDb('M16 LT-40/LT-41: state [Setting] + Tipe Iklan', () => {
  it('rejects Setting -> Paused directly (no such edge) but allows Setting -> Ended (cancel before ever launching)', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    expect(c.status).toBe('[Setting]');
    // Preserves the [Paused]->[Ended] precedent for [Setting] too — a campaign
    // may be cancelled before ever launching.
    expect((await endCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
  });

  it('Setting -> Active still gated on Brief [Approved] + linked Assets [Approved] (same guard as Paused->Active)', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    await expect(launchCampaign(sql, adsStaff(), c.id)).rejects.toBeInstanceOf(ConflictError);
    const asset = await approvedAsset(clientId);
    await linkAsset(sql, adsStaff(), c.id, asset);
    await sql`update briefs set status = '[Approved]' where id = ${briefId}`;
    expect((await launchCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
    expect(await campaignStatus(c.id)).toBe('[Active]');
  });
});

describeDb('M16 LT-42: Ads Management Date (end_date turunan)', () => {
  // `commission_rule` is irrelevant to end_date, but it still has to be a real
  // rule: O73 put the O14 grammar behind a CHECK, and this fixture used to write
  // the placeholder 'flat' (which is a pricing_mode, not a rule).
  async function seedMasterService(durasiJasaHari: number | null): Promise<string> {
    const msvId = uid('MSV');
    await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-TEST')`;
    await sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, pricing_mode, durasi_jasa, effective_from, created_by)
      values (${msvId}, 1, 'Ads Management', '5000000', '10% of standard price', 'flat', ${durasiJasaHari}, '2026-01-01', 'ZZ-TEST')`;
    return msvId;
  }

  it('end_date = start_date + durasi_jasa + additional_days + total_hari_hold, none of it stored', async () => {
    const { briefId } = await adsBrief();
    const msvId = await seedMasterService(30);
    await sql`update services set master_service_id = ${msvId}, master_version_no = 1
              where id = (select service_id from briefs where id = ${briefId})`;
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput()); // startDate 2026-07-01

    let d = await computeAdsManagementEndDate(sql, adsStaff(), c.id);
    expect(d.startDate).toBe('2026-07-01');
    expect(d.durasiJasa).toBe(30);
    expect(d.additionalDays).toBe(0);
    expect(d.totalHariHold).toBe(0);
    expect(d.endDate).toBe('2026-07-31'); // + 30 days

    await setAdditionalDays(sql, adsStaff(), c.id, 5); // e.g. libur Lebaran
    d = await computeAdsManagementEndDate(sql, adsStaff(), c.id);
    expect(d.additionalDays).toBe(5);
    expect(d.endDate).toBe('2026-08-05'); // + 30 + 5

    // Hold 3 days then resume ⇒ end_date moves forward another 3 days. `audit_log`
    // is append-only (no UPDATE path — asserted elsewhere), so the hold history is
    // seeded directly as synthetic rows with controlled timestamps rather than by
    // driving real transitions and rewriting them; `computeTotalHariHold` only
    // ever reads this log, so this isolates the pairing math from the engine.
    await sql`
      insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
      values ('ad_campaign', ${c.id}, 'ZZ-ADV', 'transition:[Active]->[Paused]', '2026-08-10T00:00:00Z', 'ZZ-ADV'),
             ('ad_campaign', ${c.id}, 'ZZ-ADV', 'transition:[Paused]->[Active]', '2026-08-13T00:00:00Z', 'ZZ-ADV')`;
    d = await computeAdsManagementEndDate(sql, adsStaff(), c.id);
    expect(d.totalHariHold).toBe(3);
    expect(d.endDate).toBe('2026-08-08'); // + 30 + 5 + 3

    // A hold that has NOT yet resumed does not extend end_date yet (moves only
    // "setiap iklan di-resume" — at resume time, not while still held).
    await sql`
      insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
      values ('ad_campaign', ${c.id}, 'ZZ-ADV', 'transition:[Active]->[Paused]', '2026-08-20T00:00:00Z', 'ZZ-ADV')`;
    d = await computeAdsManagementEndDate(sql, adsStaff(), c.id);
    expect(d.totalHariHold).toBe(3); // unchanged — the second hold is still open
  });

  it('a NULL durasi_jasa reads as 0 (no MSL pin, or an unset durasi_jasa)', async () => {
    const { briefId } = await adsBrief(); // insertService pins a nonexistent MSV-X — no match
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    const d = await computeAdsManagementEndDate(sql, adsStaff(), c.id);
    expect(d.durasiJasa).toBe(0);
    expect(d.endDate).toBe(d.startDate);
  });

  it('setAdditionalDays rejects negative values and a non-Ads actor', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    await expect(setAdditionalDays(sql, adsStaff(), c.id, -1)).rejects.toBeInstanceOf(ValidationError);
    await expect(setAdditionalDays(sql, creativeStaff(), c.id, 3)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
