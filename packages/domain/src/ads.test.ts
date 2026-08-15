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
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canManageCampaign,
  canViewCampaign,
  ConflictError,
  createCampaign,
  endCampaign,
  ForbiddenError,
  getCampaign,
  hasBudgetSignOff,
  launchCampaign,
  linkAsset,
  listMetricEntries,
  listOptimizations,
  logMetricEntry,
  logOptimization,
  NotFoundError,
  parseRoasTarget,
  pauseCampaign,
  unlinkAsset,
  ValidationError,
  canFileWeeklyReport,
  canSetBriefTargets,
  fileWeeklyReport,
  getBriefTargets,
  listWeeklyReports,
  setBriefTargets,
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
  targetKpi: 'ROAS ≥ 4x',
});

const setBriefStatus = async (briefId: string, status: string): Promise<void> => {
  await sql`update briefs set status = ${status} where id = ${briefId}`;
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
  // Both FK the briefs deleted below. `ads_weekly_reports` is append-only (a
  // no-delete guard), so it is TRUNCATEd — the same bypass recap.close.test.ts
  // uses for wrr_catatan_divisi; the guard is asserted directly further down.
  await sql`truncate table ads_weekly_reports`;
  await sql`delete from ads_brief_targets where brief_id in (select id from briefs where created_by like 'ZZ-%')`;
  await sql`delete from metric_entry_assets where metric_entry_id in (select id from metric_entries where created_by like 'ZZ-%')`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from optimization_logs where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaign_assets where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from strategy_plans where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('createCampaign (§4 Rule 1)', () => {
  it('creates a campaign under an Ads Brief [In Progress], born [Paused] with IDR display', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, goodInput());
    expect(c.status).toBe('[Paused]');
    expect(c.budget).toBe(8000000);
    expect(c.budgetDisplay).toBe('Rp. 8.000.000,00');
    expect(c.roasDisplay).toBe('—'); // no spend yet
    expect(c.id).toMatch(/^ADC-\d{6}-\d{4}$/);
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
// Target metrik per Brief-as-task + Laporan Mingguan (keputusan pemilik 2026-08-14)
// ---------------------------------------------------------------------------

describe('ads brief-target / weekly-report predicates', () => {
  it('canSetBriefTargets: SPV/Lead Ads or Director — never the Advertiser (M8-OA-4)', () => {
    expect(canSetBriefTargets(adsLead())).toBe(true);
    expect(canSetBriefTargets(director())).toBe(true);
    expect(canSetBriefTargets(adsStaff())).toBe(false);
    expect(canSetBriefTargets(am())).toBe(false);
    expect(canSetBriefTargets(od())).toBe(false);
  });
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

describeDb('setBriefTargets / getBriefTargets (M8-OA-4)', () => {
  it('SPV/Lead Ads sets the six targets; the Advertiser cannot set their own', async () => {
    const { briefId } = await adsBrief();
    await expect(
      setBriefTargets(sql, adsStaff(), briefId, { targetSpend: '30000000' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const t = await setBriefTargets(sql, adsLead(), briefId, {
      targetSpend: '30000000', targetGmv: '120000000', targetRoas: '4',
      targetView: '1000000', targetCtr: '1.5', targetCvr: '2.25', catatan: 'kuartal 3',
    });
    expect(t.ditetapkan).toBe(true);
    expect(t.targetSpendDisplay).toBe('Rp. 30.000.000,00');
    expect(t.targetGmvDisplay).toBe('Rp. 120.000.000,00');
    expect(t.targetRoasDisplay).toBe('4x');
    expect(t.targetViewDisplay).toBe('1.000.000');
    expect(t.targetCtrDisplay).toBe('1,50%');
    expect(t.targetCvrDisplay).toBe('2,25%');
    expect(t.catatan).toBe('kuartal 3');
  });

  it('an unset brief reads as belum ditetapkan with every display "—" (house rule 7)', async () => {
    const { briefId } = await adsBrief();
    const { targets } = await getBriefTargets(sql, adsStaff(), briefId);
    expect(targets.ditetapkan).toBe(false);
    expect(targets.targetSpendDisplay).toBe('—');
    expect(targets.targetRoasDisplay).toBe('—');
    expect(targets.targetCvrDisplay).toBe('—');
  });

  it('validates: all-empty, non-numeric, negative, and CTR/CVR above 100', async () => {
    const { briefId } = await adsBrief();
    await expect(setBriefTargets(sql, adsLead(), briefId, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(setBriefTargets(sql, adsLead(), briefId, { targetRoas: 'empat' })).rejects.toBeInstanceOf(ValidationError);
    await expect(setBriefTargets(sql, adsLead(), briefId, { targetRoas: '-1' })).rejects.toBeInstanceOf(ValidationError);
    await expect(setBriefTargets(sql, adsLead(), briefId, { targetView: '1.5' })).rejects.toBeInstanceOf(ValidationError);
    await expect(setBriefTargets(sql, adsLead(), briefId, { targetCtr: '150' })).rejects.toBeInstanceOf(ValidationError);
    // Nothing was written by any of the rejected calls.
    expect((await getBriefTargets(sql, adsLead(), briefId)).targets.ditetapkan).toBe(false);
  });

  it('rejects a non-Ads brief and an unknown brief', async () => {
    const svcId = uid('SVC');
    const clientId = uid('CLI');
    const briefId = uid('BRF');
    await insertClient(clientId, 'ZZ-SINTA');
    await insertService(svcId, clientId);
    await insertBrief(briefId, svcId, 'Creative', '[In Progress]');
    await expect(setBriefTargets(sql, adsLead(), briefId, { targetRoas: '4' })).rejects.toBeInstanceOf(ConflictError);
    await expect(getBriefTargets(sql, adsLead(), 'BRF-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rewrites keep an audit before→after trail (house rule 3 — no second history table)', async () => {
    const { briefId } = await adsBrief();
    await setBriefTargets(sql, adsLead(), briefId, { targetRoas: '4' });
    const t = await setBriefTargets(sql, adsLead(), briefId, { targetRoas: '3' });
    expect(t.targetRoas).toBe(3);
    const rows = await sql<{ action: string; before_json: { target_roas: number } | null; after_json: { target_roas: number } }[]>`
      select action, before_json, after_json from audit_log
       where entity_type = 'brief' and entity_id = ${briefId} and action like 'ads_target%' order by id`;
    expect(rows.map((r) => r.action)).toEqual(['ads_target_set', 'ads_target_update']);
    expect(rows[0].before_json).toBeNull();
    expect(Number(rows[1].before_json?.target_roas)).toBe(4);
    expect(Number(rows[1].after_json.target_roas)).toBe(3);
  });

  it('suggests targets from the brief Quantity Target + the Strategy KPI, without saving them', async () => {
    const clientId = uid('CLI');
    const svcId = uid('SVC');
    const strId = uid('STRG');
    const briefId = uid('BRF');
    await insertClient(clientId, 'ZZ-SINTA');
    await insertService(svcId, clientId);
    await sql`
      insert into strategy_plans (id, service_id, objective, divisions_involved, planned_brief_outline,
        timeline_start, timeline_end, status, target_gmv, target_roas, target_ctr, target_cvr, created_by)
      values (${strId}, ${svcId}, 'obj', 'Ads', 'outline', '2026-08-01', '2026-10-31', 'Approved',
        '120000000.00', '4.00', '1.500', '2.250', 'ZZ-TEST')`;
    await sql`
      insert into briefs (id, service_id, strategy_id, title, status, assigned_division, deliverable_type,
        quantity_target, priority, recurring, created_by)
      values (${briefId}, ${svcId}, ${strId}, 'Ads — Ads spent (Rp)', '[In Progress]', 'Ads', 'Ads spent (Rp)',
        30000000, 'Medium', false, 'ZZ-TEST')`;

    const { targets, saran } = await getBriefTargets(sql, adsLead(), briefId);
    expect(targets.ditetapkan).toBe(false); // suggestion is never auto-saved (M8-OA-4)
    expect(saran.targetSpend).toBe(30000000);
    expect(saran.targetGmv).toBe(120000000);
    expect(saran.targetRoas).toBe(4);
    expect(saran.targetCtr).toBe(1.5);
    expect(saran.targetCvr).toBe(2.25);
    expect(saran.targetView).toBeNull(); // M6 never modelled it — typed by hand
    expect(saran.sumber).toContain('Target Kuantitas brief');
    expect(saran.sumber).toContain(strId);
  });
});

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
    await setBriefTargets(sql, adsLead(), briefId, {
      targetSpend: '4000000', targetGmv: '20000000', targetRoas: '4',
      targetView: '200000', targetCtr: '2', targetCvr: '5',
    });
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
    expect(by('roas').rasioDisplay).toBe('118.75%');
    // Week A is over and unreported; week B is still running, so it is not late.
    expect(a.terlambat).toBe(true);
    expect(v.minggu[1].berjalan).toBe(true);
    expect(v.minggu[1].terlambat).toBe(false);
    expect(v.belumDiisi).toBe(1);
    // A week with no metric entry at all renders "—", never 0 (house rule 7).
    const b = v.minggu[1].metrik.find((m) => m.key === 'roas')!;
    expect(b.realisasiDisplay).toBe('—');
    expect(b.rasioDisplay).toBe('—');
  });

  it('the PIC files a week; it then reads back as terisi and no longer late', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await markStarted(briefId, new Date('2026-08-03T02:00:00Z'));
    const now = new Date('2026-08-12T05:00:00Z');

    const r = await fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, {
      mingguMulai: '2026-08-03',
      analisa: 'ROAS 4,75x di atas target; spend terserap 50%.',
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
    // Not a Monday / not a date at all.
    await expect(
      fileWeeklyReport(sql, adsStaff('ZZ-ADV'), briefId, { ...ok, mingguMulai: '2026-08-05' }, now),
    ).rejects.toBeInstanceOf(ValidationError);
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
});
