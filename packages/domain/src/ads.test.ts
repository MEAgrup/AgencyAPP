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
  await sql`delete from metric_entry_assets where metric_entry_id in (select id from metric_entries where created_by like 'ZZ-%')`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from optimization_logs where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaign_assets where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
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
