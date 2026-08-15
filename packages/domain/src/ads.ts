/**
 * Ads domain service (M8). Ported from Go's `internal/module8_ads/*`.
 *
 * Introduces the Ad Campaign (ADC-), the CLIENT's ongoing paid-media record
 * (M8 §2). The setup Brief (a Brief-as-task, driven by M12/M6) closes once Ads
 * proves the campaign launched correctly — a one-time phase whose Speed KPI is
 * M12's. The Ad Campaign keeps LIVING after: periodic Metric Entries (MTR-, §5),
 * an Optimization Log (OPT-, §6), and attribution feedback writing Attributed GMV
 * back onto the Creative Asset that drove it (§7), closing the loop from M7 §8.
 *
 * This module owns the ADC entity + its child rows and their rules. The setup
 * Brief's lifecycle stays in M6 (review) + M12 (execution); M8 only adds a submit
 * GUARD (§4 Rule 3, `validateBriefSubmit`) that M12 calls so an Ads Brief cannot
 * be submitted before its Ad Campaign is complete.
 *
 * House rules honoured: ADC-/MTR-/OPT- ids minted only after validation (rule 1);
 * birth status [Paused] set at INSERT, every later move through the engine
 * (rule 2); Total Spend / Total GMV / ROAS and each Asset's Attributed GMV are
 * DERIVED from immutable Metric-Entry rows + the per-entry linked-Asset snapshot,
 * never stored as mutable running columns (rules 3/4); div-by-zero ROAS renders
 * "—", money "Rp. X.XXX.XXX,00" (rule 7).
 *
 * Reference: backend/internal/module8_ads/{ads,lifecycle,linkage,optimization,metrics,read}.go.
 */

import { bi, money, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const ADS_DIVISION = 'Ads';
export const ACCOUNT_DIVISION = 'Account';

// Ad Campaign statuses — the ad_campaign machine (STATE_MACHINES §14).
export const STATUS_PAUSED = '[Paused]';
export const STATUS_ACTIVE = '[Active]';
export const STATUS_ENDED = '[Ended]';

const BRIEF_STATUS_IN_PROGRESS = '[In Progress]';
const BRIEF_STATUS_APPROVED = '[Approved]';
// The void-cascade terminal (STATE_MACHINES §7 / M4-OA-5) — a cancelled brief
// owes neither a target nor a weekly report, so the discipline read skips it.
const BRIEF_STATUS_CANCELLED = '[Cancelled — Service Voided]';
const ASSET_STATUS_APPROVED = '[Approved]';
const MACHINE_AD_CAMPAIGN = 'ad_campaign';

const VALID_PLATFORMS = new Set(['Shopee Ads', 'TikTok Shop Ads', 'Social Ads']);
const VALID_ENTRY_METHODS = new Set(['Manual', 'File Export']);
const VALID_CHANGE_TYPES = new Set(['Budget', 'Targeting', 'Creative Swap', 'Schedule', 'Other']);
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Verbatim BI messages (M8). Each mirrors a Go sentinel 1:1. ---

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_CAMPAIGN_NOT_FOUND = '[kampanye iklan tidak ditemukan]';
export const MSG_CAMPAIGN_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke kampanye iklan ini]';
export const MSG_CAMPAIGN_MANAGE_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola kampanye iklan ini]';
export const MSG_NOT_ADS_BRIEF = '[brief ini bukan brief divisi Ads]';
export const MSG_BRIEF_NOT_IN_PROGRESS = '[kampanye iklan hanya dapat dibuat saat brief berstatus In Progress]';
export const MSG_INVALID_PLATFORM = '[platform tidak valid]';
export const MSG_INVALID_CAMPAIGN_DATES = '[tanggal mulai dan selesai kampanye tidak valid]';
export const MSG_ASSET_NOT_FOUND = '[aset kreatif tidak ditemukan]';
export const MSG_ASSET_NOT_APPROVED = '[aset kreatif harus disetujui sebelum ditautkan]';
export const MSG_ASSET_WRONG_CLIENT = '[aset kreatif bukan milik klien layanan ini]';
export const MSG_ASSET_ALREADY_LINKED = '[aset kreatif sudah ditautkan ke kampanye ini]';
export const MSG_ASSET_NOT_LINKED = '[aset kreatif tidak tertaut ke kampanye ini]';
export const MSG_CAMPAIGN_INCOMPLETE_FOR_SUBMIT =
  '[campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]';
export const MSG_LAUNCH_BRIEF_NOT_APPROVED = '[kampanye belum dapat diluncurkan, brief setup belum disetujui]';
export const MSG_LAUNCH_ASSETS_NOT_APPROVED =
  '[kampanye belum dapat diluncurkan, aset kreatif tertaut harus disetujui]';
export const MSG_INVALID_ENTRY_METHOD = '[metode input tidak valid]';
export const MSG_NEGATIVE_AMOUNT = '[nilai spend dan GMV tidak boleh negatif]';
export const MSG_INVALID_PERIOD = '[periode metrik tidak valid]';
export const MSG_CAMPAIGN_ENDED = '[ad campaign sudah berakhir, metric entry tidak bisa dicatat]';
export const MSG_INVALID_CHANGE_TYPE = '[jenis perubahan tidak valid]';
export const MSG_BUDGET_APPROVAL_REQUIRED = '[penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads]';
export const MSG_BAD_AMOUNT = '[nilai uang tidak valid]';
export const MSG_BAD_COUNT = '[nilai clicks/impressions/conversions harus bilangan bulat ≥ 0]';

// --- Errors (ads-scoped; mapped in apps/api http.ts). ---

/** Bad/missing input (→ 400): incomplete, invalid platform/dates/method/period/change-type/amount. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403), incl. budget sign-off. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsForbiddenError';
  }
}
/** The referenced brief / campaign / asset does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_CAMPAIGN_NOT_FOUND) {
    super(message);
    this.name = 'AdsNotFoundError';
  }
}
/** A lifecycle / linkage conflict (→ 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsConflictError';
  }
}

// --- Authorization ---

/** canManageCampaign is the §9.1 write gate: Ads staff/lead (Advertiser/Team Leader) or Director. */
export function canManageCampaign(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === ADS_DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/** canViewCampaign is the §9.1 read predicate: OD/Director, Account lead, owning AM, Ads staff/lead. */
export function canViewCampaign(actor: Actor, ownerAm: string): boolean {
  if (permission.canReadAll(actor)) {
    return true;
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true;
  }
  if (actor.employeeId === ownerAm) {
    return true;
  }
  return actor.role.division === ADS_DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/** hasBudgetSignOff (M8-OA-3): a >50% budget change needs the Ads lead, owning AM, or Director. */
export function hasBudgetSignOff(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.employeeId === ownerAm) {
    return true;
  }
  return actor.role.division === ADS_DIVISION && actor.role.level === permission.LevelLead;
}

// --- Types ---

/** The caller-supplied §9.3 campaign fields (client + status are inherited/born). */
export interface CampaignInput {
  platform: string;
  objective: string;
  budget: string; // decimal string
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  targetKpi: string;
}

/** One Ad Campaign (ADC-) with its derived performance view (§9.3 + §5). */
export interface Campaign {
  id: string;
  briefId: string;
  clientId: string;
  platform: string;
  objective: string;
  budget: number;
  budgetDisplay: string;
  startDate: string;
  endDate: string;
  targetKpi: string;
  status: string;
  totalSpend: number;
  totalSpendDisplay: string;
  totalGmv: number;
  totalGmvDisplay: string;
  roas: number | null;
  roasDisplay: string; // "3.875x" | "—"
  linkedAssetIds: string[];
  metricEntryCount: number;
  optimizationCount: number;
  underperformingStreak: number;
  escalationFlagged: boolean;
  createdBy: string;
  createdAt: Date;
}

/** A §9.4 Metric Entry input. */
export interface MetricInput {
  periodStart: string;
  periodEnd: string;
  spend: string;
  gmv: string;
  ctr?: number | null;
  cvr?: number | null;
  // T-3: raw counts from the platform report (optional). The blended
  // CTR/CVR/CPC/CPM the weekly recap shows are Σ-derived from these, so entering
  // them lets the recap compute the ratios instead of falling to `—`.
  clicks?: number | null;
  impressions?: number | null;
  conversions?: number | null;
  entryMethod: string;
}

/** One recorded §9.4 Metric Entry. */
export interface MetricEntry {
  id: string;
  campaignId: string;
  periodStart: string;
  periodEnd: string;
  spend: number;
  gmv: number;
  entryMethod: string;
  enteredBy: string;
  createdAt: Date;
}

/** A §9.5 Optimization Log entry input. */
export interface OptimizationInput {
  changeType: string;
  beforeValue?: string;
  afterValue?: string;
  reason: string;
  oldAssetId?: string; // Creative Swap only
  newAssetId?: string; // Creative Swap only
}

/** One recorded OPT- entry. */
export interface Optimization {
  id: string;
  campaignId: string;
  changeType: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
  actor: string;
  createdAt: Date;
}

// --- Create ---

/**
 * createCampaign creates an Ad Campaign under an Ads Brief (§4 Rule 1). Creatable
 * while the parent Brief is [In Progress], by Ads staff/lead or Director. Born
 * [Paused] (held, no real spend until launched). One Brief can spawn multiple.
 */
export async function createCampaign(sql: Sql, actor: Actor, briefId: string, input: CampaignInput): Promise<Campaign> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const briefRows = await tx<{ assigned_division: string; status: string; client_id: string }[]>`
      select b.assigned_division, b.status, sv.client_id
        from briefs b join services sv on sv.id = b.service_id
       where b.id = ${briefId} for update`;
    if (briefRows.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    const brief = briefRows[0];
    if (brief.assigned_division !== ADS_DIVISION) {
      throw new ConflictError(MSG_NOT_ADS_BRIEF);
    }
    if (brief.status !== BRIEF_STATUS_IN_PROGRESS) {
      throw new ConflictError(MSG_BRIEF_NOT_IN_PROGRESS);
    }
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    const platform = (input.platform ?? '').trim();
    const objective = (input.objective ?? '').trim();
    const targetKpi = (input.targetKpi ?? '').trim();
    if (platform === '' || objective === '' || targetKpi === '' ||
      (input.budget ?? '').trim() === '' || (input.startDate ?? '').trim() === '' || (input.endDate ?? '').trim() === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!VALID_PLATFORMS.has(platform)) {
      throw new ValidationError(MSG_INVALID_PLATFORM);
    }
    let budget: money.Money;
    try {
      budget = money.parse(input.budget);
    } catch {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (budget <= 0n) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    const [start, end] = parseDateRange(input.startDate, input.endDate);

    const id = await ex.ident.identNext('ADC', now);
    await tx`
      insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
      values (${id}, ${briefId}, ${brief.client_id}, ${platform}, ${objective}, ${money.decimal(budget)}, ${start}, ${end}, ${targetKpi}, ${STATUS_PAUSED}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'ad_campaign', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: { status: STATUS_PAUSED, brief_id: briefId, client_id: brief.client_id, platform, budget: money.decimal(budget) },
      createdBy: actor.employeeId,
    });
    return {
      id, briefId, clientId: brief.client_id, platform, objective, budget: Number(budget) / 100,
      budgetDisplay: money.format(budget), startDate: start, endDate: end, targetKpi, status: STATUS_PAUSED,
      totalSpend: 0, totalSpendDisplay: money.format(0n), totalGmv: 0, totalGmvDisplay: money.format(0n),
      roas: null, roasDisplay: '—', linkedAssetIds: [], metricEntryCount: 0, optimizationCount: 0,
      underperformingStreak: 0, escalationFlagged: false, createdBy: actor.employeeId, createdAt: now,
    };
  });
}

// --- Lifecycle (§2 / STATE_MACHINES §14) ---

/** launchCampaign drives [Paused] → [Active], beginning real spend (§4 Flow 2). Guarded. */
export function launchCampaign(sql: Sql, actor: Actor, campaignId: string): Promise<statemachine.TransitionResult> {
  return activate(sql, actor, campaignId);
}

/** resumeCampaign drives a paused campaign back to [Active] (§6 Rule 1). Same guard as launch. */
export function resumeCampaign(sql: Sql, actor: Actor, campaignId: string): Promise<statemachine.TransitionResult> {
  return activate(sql, actor, campaignId);
}

async function activate(sql: Sql, actor: Actor, campaignId: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    const briefStatus = (await tx<{ status: string }[]>`select status from briefs where id = ${r.briefId}`)[0]?.status;
    if (briefStatus !== BRIEF_STATUS_APPROVED) {
      throw new ConflictError(MSG_LAUNCH_BRIEF_NOT_APPROVED);
    }
    if (!(await allLinkedAssetsApproved(tx, r.id))) {
      throw new ConflictError(MSG_LAUNCH_ASSETS_NOT_APPROVED);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_AD_CAMPAIGN, entityType: 'ad_campaign', table: 'ad_campaigns', entityId: campaignId, to: STATUS_ACTIVE, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    return res;
  });
}

/** pauseCampaign drives [Active] → [Paused]. Ads staff/lead or Director. */
export function pauseCampaign(sql: Sql, actor: Actor, campaignId: string): Promise<statemachine.TransitionResult> {
  return driveLifecycle(sql, actor, campaignId, STATUS_PAUSED);
}

/** endCampaign drives a campaign to [Ended] (terminal, from [Active] or [Paused]). */
export function endCampaign(sql: Sql, actor: Actor, campaignId: string): Promise<statemachine.TransitionResult> {
  return driveLifecycle(sql, actor, campaignId, STATUS_ENDED);
}

async function driveLifecycle(sql: Sql, actor: Actor, campaignId: string, to: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_AD_CAMPAIGN, entityType: 'ad_campaign', table: 'ad_campaigns', entityId: campaignId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    return res;
  });
}

/** allLinkedAssetsApproved: at least one currently-linked Asset AND all approved (§4 Rule 2 / §12). */
async function allLinkedAssetsApproved(tx: Queryable, campaignId: string): Promise<boolean> {
  const rows = await tx<{ total: string; approved: string }[]>`
    select count(*) as total,
           coalesce(sum(case when a.status = ${ASSET_STATUS_APPROVED} then 1 else 0 end), 0) as approved
      from ad_campaign_assets aca
      join assets a on a.id = aca.asset_id
     where aca.campaign_id = ${campaignId} and aca.unlinked_at is null`;
  const total = Number(rows[0].total);
  return total > 0 && total === Number(rows[0].approved);
}

// --- Creative Asset linkage (§4 Rule 2) ---

/** linkAsset links an approved Creative Asset of the same client to an Ad Campaign (§4 Rule 2). */
export async function linkAsset(sql: Sql, actor: Actor, campaignId: string, assetId: string): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const r = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    await linkAssetTx(tx, actor, r, assetId);
  });
}

async function linkAssetTx(tx: Queryable, actor: Actor, r: CampaignRow, assetId: string): Promise<void> {
  const { clientId, status } = await assetClientAndStatus(tx, assetId);
  if (clientId !== r.clientId) {
    throw new ConflictError(MSG_ASSET_WRONG_CLIENT);
  }
  if (status !== ASSET_STATUS_APPROVED) {
    throw new ConflictError(MSG_ASSET_NOT_APPROVED);
  }
  const existing = await tx<{ n: string }[]>`
    select count(*) as n from ad_campaign_assets where campaign_id = ${r.id} and asset_id = ${assetId} and unlinked_at is null`;
  if (Number(existing[0].n) > 0) {
    throw new ConflictError(MSG_ASSET_ALREADY_LINKED);
  }
  await tx`insert into ad_campaign_assets (campaign_id, asset_id, created_by) values (${r.id}, ${assetId}, ${actor.employeeId})`;
  await executors(tx).audit.insertAudit({
    entityType: 'ad_campaign', entityId: r.id, actorEmployeeId: actor.employeeId, action: 'asset_linked',
    beforeJson: null, afterJson: { asset_id: assetId }, createdBy: actor.employeeId,
  });
}

/** unlinkAsset removes a currently-linked Asset (sets unlinked_at, never deletes — rule 3). */
export async function unlinkAsset(sql: Sql, actor: Actor, campaignId: string, assetId: string): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const r = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    await unlinkAssetTx(tx, actor, r, assetId);
  });
}

async function unlinkAssetTx(tx: Queryable, actor: Actor, r: CampaignRow, assetId: string): Promise<void> {
  const res = await tx`
    update ad_campaign_assets set unlinked_at = now()
     where campaign_id = ${r.id} and asset_id = ${assetId} and unlinked_at is null`;
  if (res.count === 0) {
    throw new ConflictError(MSG_ASSET_NOT_LINKED);
  }
  await executors(tx).audit.insertAudit({
    entityType: 'ad_campaign', entityId: r.id, actorEmployeeId: actor.employeeId, action: 'asset_unlinked',
    beforeJson: null, afterJson: { asset_id: assetId }, createdBy: actor.employeeId,
  });
}

/** assetClientAndStatus returns the Client an Asset belongs to (via Brief→Service) + its status. */
async function assetClientAndStatus(tx: Queryable, assetId: string): Promise<{ clientId: string; status: string }> {
  const rows = await tx<{ client_id: string; status: string }[]>`
    select sv.client_id, a.status
      from assets a join briefs b on b.id = a.brief_id join services sv on sv.id = b.service_id
     where a.id = ${assetId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_ASSET_NOT_FOUND);
  }
  return { clientId: rows[0].client_id, status: rows[0].status };
}

/** currentlyLinkedAssets returns the Asset IDs currently linked (unlinked_at IS NULL), ordered. */
async function currentlyLinkedAssets(sql: Queryable, campaignId: string): Promise<string[]> {
  const rows = await sql<{ asset_id: string }[]>`
    select asset_id from ad_campaign_assets where campaign_id = ${campaignId} and unlinked_at is null order by asset_id`;
  return rows.map((r) => r.asset_id);
}

// --- Optimization Log (§6) ---

/**
 * logOptimization records one Optimization entry (§6). Ads staff/lead or Director;
 * the owning AM may also record one. A >50% Budget change requires AM/SPV-Ads
 * authority (M8-OA-3); a Creative Swap atomically re-points the Asset linkage.
 */
export async function logOptimization(sql: Sql, actor: Actor, campaignId: string, input: OptimizationInput): Promise<Optimization> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor) && actor.employeeId !== r.ownerAm) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    const changeType = (input.changeType ?? '').trim();
    if (changeType === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!VALID_CHANGE_TYPES.has(changeType)) {
      throw new ValidationError(MSG_INVALID_CHANGE_TYPE);
    }
    let before = (input.beforeValue ?? '').trim();
    let after = (input.afterValue ?? '').trim();
    const oldAsset = (input.oldAssetId ?? '').trim();
    const newAsset = (input.newAssetId ?? '').trim();
    if (changeType === 'Creative Swap') {
      if (oldAsset === '' || newAsset === '') {
        throw new ValidationError(bi.INCOMPLETE_DATA);
      }
      if (before === '') before = oldAsset;
      if (after === '') after = newAsset;
    }
    if (before === '' || after === '' || (input.reason ?? '').trim() === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    // §6 Rule 3 / M8-OA-3: a >50% Budget change needs sign-off authority.
    if (changeType === 'Budget' && budgetChangeOver50(before, after) && !hasBudgetSignOff(actor, r.ownerAm)) {
      throw new ForbiddenError(MSG_BUDGET_APPROVAL_REQUIRED);
    }
    if (changeType === 'Creative Swap') {
      await unlinkAssetTx(tx, actor, r, oldAsset);
      await linkAssetTx(tx, actor, r, newAsset);
    }

    const id = await ex.ident.identNext('OPT', now);
    const reason = input.reason.trim();
    await tx`
      insert into optimization_logs (id, campaign_id, change_type, before_value, after_value, reason, actor, created_by)
      values (${id}, ${campaignId}, ${changeType}, ${before}, ${after}, ${reason}, ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'ad_campaign', entityId: campaignId, actorEmployeeId: actor.employeeId, action: 'optimization_logged',
      beforeJson: null, afterJson: { optimization_id: id, change_type: changeType, before, after }, createdBy: actor.employeeId,
    });
    return { id, campaignId, changeType, beforeValue: before, afterValue: after, reason, actor: actor.employeeId, createdAt: now };
  });
}

/** budgetChangeOver50 reports whether |after-before| exceeds 50% of before (unparseable/≤0 before → true). */
function budgetChangeOver50(before: string, after: string): boolean {
  let b: money.Money;
  try {
    b = money.parse(before);
  } catch {
    return true; // unparseable "before" → cannot verify below threshold → gate
  }
  let a: money.Money;
  try {
    a = money.parse(after);
  } catch {
    throw new ValidationError(MSG_BAD_AMOUNT);
  }
  if (b <= 0n) {
    return true;
  }
  let diff = a - b;
  if (diff < 0n) {
    diff = -diff;
  }
  return 2n * diff > b; // |after-before| / before > 0.5
}

// --- Metric Entries (§5) + attribution feedback (§7) ---

/**
 * logMetricEntry records one periodic Metric Entry (§5 Flow 1) and refreshes the
 * Attributed GMV of every Asset the entry touched (§7 Flow 1). Ads staff/lead or
 * Director. Spend/GMV are additive raw inputs; running totals + ROAS derive on read.
 */
export async function logMetricEntry(sql: Sql, actor: Actor, campaignId: string, input: MetricInput): Promise<MetricEntry> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor)) {
      throw new ForbiddenError(MSG_CAMPAIGN_MANAGE_FORBIDDEN);
    }
    if (r.status === STATUS_ENDED) {
      throw new ConflictError(MSG_CAMPAIGN_ENDED);
    }
    const method = (input.entryMethod ?? '').trim();
    if ((input.periodStart ?? '').trim() === '' || (input.periodEnd ?? '').trim() === '' ||
      (input.spend ?? '').trim() === '' || (input.gmv ?? '').trim() === '' || method === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!VALID_ENTRY_METHODS.has(method)) {
      throw new ValidationError(MSG_INVALID_ENTRY_METHOD);
    }
    let spend: money.Money;
    let gmv: money.Money;
    try {
      spend = money.parse(input.spend);
      gmv = money.parse(input.gmv);
    } catch {
      throw new ValidationError(MSG_BAD_AMOUNT);
    }
    if (spend < 0n || gmv < 0n) {
      throw new ValidationError(MSG_NEGATIVE_AMOUNT);
    }
    // T-3: raw platform counts are optional but, when present, must be
    // non-negative whole numbers (they are Σ-summed into blended CTR/CVR/CPC/CPM).
    const clicks = validCount(input.clicks);
    const impressions = validCount(input.impressions);
    const conversions = validCount(input.conversions);
    const [pStart, pEnd] = parsePeriod(input.periodStart, input.periodEnd);

    const id = await ex.ident.identNext('MTR', now);
    await tx`
      insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, ctr, cvr,
        clicks, impressions, conversions, entry_method, entered_by, created_by)
      values (${id}, ${campaignId}, ${pStart}, ${pEnd}, ${money.decimal(spend)}, ${money.decimal(gmv)},
        ${input.ctr ?? null}, ${input.cvr ?? null},
        ${clicks}, ${impressions}, ${conversions}, ${method}, ${actor.employeeId}, ${actor.employeeId})`;
    // §7 Flow 1: snapshot the linked Assets at this moment (Creative-Swap-safe basis).
    const linked = await currentlyLinkedAssets(tx, campaignId);
    for (const assetId of linked) {
      await tx`insert into metric_entry_assets (metric_entry_id, asset_id) values (${id}, ${assetId})`;
    }
    await ex.audit.insertAudit({
      entityType: 'ad_campaign', entityId: campaignId, actorEmployeeId: actor.employeeId, action: 'metric_entry_logged',
      beforeJson: null, afterJson: { metric_entry_id: id, spend: money.decimal(spend), gmv: money.decimal(gmv), linked_assets: linked },
      createdBy: actor.employeeId,
    });
    // §7 Flow 1: recompute Attributed GMV for each Asset this entry touched.
    for (const assetId of linked) {
      await recomputeAssetAttribution(tx, assetId);
    }
    return {
      id, campaignId, periodStart: pStart, periodEnd: pEnd, spend: Number(spend) / 100, gmv: Number(gmv) / 100,
      entryMethod: method, enteredBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * recomputeAssetAttribution rebuilds one Asset's Attributed GMV from scratch (§7)
 * over every Metric Entry that snapshotted it, across all campaigns: each entry
 * contributes entry.gmv ÷ (Assets in that entry's snapshot). A full recompute over
 * immutable rows — idempotent, recomputable (rule 4). Minor-unit floor drops
 * sub-rupiah remainders (never surfaced in IDR display, rule 7).
 */
async function recomputeAssetAttribution(tx: Queryable, assetId: string): Promise<void> {
  const rows = await tx<{ gmv: string; n: string }[]>`
    select me.gmv, cnt.n
      from metric_entry_assets mea
      join metric_entries me on me.id = mea.metric_entry_id
      join (select metric_entry_id, count(*) as n from metric_entry_assets group by metric_entry_id) cnt
        on cnt.metric_entry_id = mea.metric_entry_id
     where mea.asset_id = ${assetId}`;
  let total = 0n;
  for (const row of rows) {
    const gmv = money.parse(row.gmv);
    const n = BigInt(row.n);
    if (n > 0n) {
      total += gmv / n; // equal split, minor-unit floor
    }
  }
  await tx`update assets set attributed_gmv = ${money.decimal(total)} where id = ${assetId}`;
}

// --- Reads (§5 derived) ---

/** getCampaign returns an Ad Campaign with its derived metrics, if the actor may view it (§9.1). */
export async function getCampaign(sql: Queryable, actor: Actor, campaignId: string): Promise<Campaign> {
  const rows = await sql<
    { id: string; brief_id: string; client_id: string; platform: string; objective: string; budget: string;
      start_date: string | Date; end_date: string | Date; target_kpi: string; status: string; created_by: string;
      created_at: Date; assigned_am_id: string | null }[]
  >`
    select c.id, c.brief_id, c.client_id, c.platform, c.objective, c.budget, c.start_date, c.end_date,
           c.target_kpi, c.status, c.created_by, c.created_at, cl.assigned_am_id
      from ad_campaigns c join clients cl on cl.id = c.client_id where c.id = ${campaignId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CAMPAIGN_NOT_FOUND);
  }
  const row = rows[0];
  if (!canViewCampaign(actor, row.assigned_am_id ?? '')) {
    throw new ForbiddenError(MSG_CAMPAIGN_VIEW_FORBIDDEN);
  }
  const budget = money.parse(row.budget);
  const derived = await fillDerived(sql, campaignId, row.target_kpi);
  return {
    id: row.id, briefId: row.brief_id, clientId: row.client_id, platform: row.platform, objective: row.objective,
    budget: Number(budget) / 100, budgetDisplay: money.format(budget), startDate: dateStr(row.start_date),
    endDate: dateStr(row.end_date), targetKpi: row.target_kpi, status: row.status, createdBy: row.created_by,
    createdAt: row.created_at, ...derived,
  };
}

/** listMetricEntries returns a campaign's Metric Entries in period order (§5), view-gated. */
export async function listMetricEntries(sql: Queryable, actor: Actor, campaignId: string): Promise<MetricEntry[]> {
  await campaignViewGate(sql, actor, campaignId);
  const rows = await sql<
    { id: string; campaign_id: string; period_start: string | Date; period_end: string | Date; spend: string; gmv: string; entry_method: string; entered_by: string; created_at: Date }[]
  >`
    select id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_at
      from metric_entries where campaign_id = ${campaignId} order by period_start, id`;
  return rows.map((m) => ({
    id: m.id, campaignId: m.campaign_id, periodStart: dateStr(m.period_start), periodEnd: dateStr(m.period_end),
    spend: Number(money.parse(m.spend)) / 100, gmv: Number(money.parse(m.gmv)) / 100,
    entryMethod: m.entry_method, enteredBy: m.entered_by, createdAt: m.created_at,
  }));
}

/** listOptimizations returns a campaign's Optimization Log in id order (§6), view-gated. */
export async function listOptimizations(sql: Queryable, actor: Actor, campaignId: string): Promise<Optimization[]> {
  await campaignViewGate(sql, actor, campaignId);
  const rows = await sql<
    { id: string; campaign_id: string; change_type: string; before_value: string; after_value: string; reason: string; actor: string; created_at: Date }[]
  >`
    select id, campaign_id, change_type, before_value, after_value, reason, actor, created_at
      from optimization_logs where campaign_id = ${campaignId} order by id`;
  return rows.map((o) => ({
    id: o.id, campaignId: o.campaign_id, changeType: o.change_type, beforeValue: o.before_value,
    afterValue: o.after_value, reason: o.reason, actor: o.actor, createdAt: o.created_at,
  }));
}

/** The derived §5 metrics + §8 signals computed from immutable rows. */
type DerivedMetrics = Pick<
  Campaign,
  'totalSpend' | 'totalSpendDisplay' | 'totalGmv' | 'totalGmvDisplay' | 'roas' | 'roasDisplay' |
  'linkedAssetIds' | 'metricEntryCount' | 'optimizationCount' | 'underperformingStreak' | 'escalationFlagged'
>;

async function fillDerived(sql: Queryable, campaignId: string, targetKpi: string): Promise<DerivedMetrics> {
  const entries = await sql<{ spend: string; gmv: string }[]>`
    select spend, gmv from metric_entries where campaign_id = ${campaignId} order by period_start, id`;
  let totalSpend = 0n;
  let totalGmv = 0n;
  const series: number[] = [];
  for (const e of entries) {
    const spend = money.parse(e.spend);
    const gmv = money.parse(e.gmv);
    totalSpend += spend;
    totalGmv += gmv;
    series.push(spend === 0n ? 0 : Number(gmv) / Number(spend));
  }
  let roas: number | null = null;
  let roasDisplay = '—';
  if (totalSpend !== 0n) {
    roas = Number(totalGmv) / Number(totalSpend);
    roasDisplay = formatRoas(roas);
  }
  let underperformingStreak = 0;
  const target = parseRoasTarget(targetKpi);
  if (target !== null) {
    underperformingStreak = trailingUnderTarget(series, target);
  }
  const linkedAssetIds = await currentlyLinkedAssets(sql, campaignId);
  const optCount = Number(
    (await sql<{ n: string }[]>`select count(*) as n from optimization_logs where campaign_id = ${campaignId}`)[0].n,
  );
  return {
    totalSpend: Number(totalSpend) / 100, totalSpendDisplay: money.format(totalSpend),
    totalGmv: Number(totalGmv) / 100, totalGmvDisplay: money.format(totalGmv), roas, roasDisplay,
    linkedAssetIds, metricEntryCount: entries.length, optimizationCount: optCount,
    underperformingStreak, escalationFlagged: underperformingStreak >= 2,
  };
}

/** trailingUnderTarget counts the most-recent consecutive periods with ROAS below target (§8 Rule 4). */
function trailingUnderTarget(series: number[], target: number): number {
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] < target) {
      n++;
    } else {
      break;
    }
  }
  return n;
}

/**
 * parseRoasTarget extracts a numeric ROAS target from a Target KPI string like
 * "ROAS ≥ 4x". Returns null when the target is not ROAS-typed or carries no number.
 */
export function parseRoasTarget(target: string): number | null {
  const low = target.toLowerCase();
  if (!low.includes('roas')) {
    return null;
  }
  let s = '';
  let started = false;
  for (const ch of low) {
    if ((ch >= '0' && ch <= '9') || (ch === '.' && started)) {
      s += ch;
      started = true;
    } else if (started) {
      break;
    }
  }
  if (s === '') {
    return null;
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** formatRoas renders a ROAS ratio as "N.NNNx" (shortest round-trip, trailing zeros trimmed). */
function formatRoas(v: number): string {
  return `${v}x`;
}

// --- Submit guard (§4 Rule 3) — called by M12 for Ads brief submits. ---

/**
 * validateBriefSubmit is the §4 Rule 3 gate M12 calls before an Ads Brief-as-task
 * enters [Submitted]: at least one Ad Campaign must exist for the Brief WITH a
 * currently-linked Creative Asset. A non-Ads division is a no-op. Throws
 * ConflictError with the verbatim PRD string when incomplete.
 */
export async function validateBriefSubmit(tx: Queryable, briefId: string, division: string): Promise<void> {
  if (division !== ADS_DIVISION) {
    return;
  }
  const rows = await tx<{ n: string }[]>`
    select count(*) as n
      from ad_campaigns c
      join ad_campaign_assets a on a.campaign_id = c.id and a.unlinked_at is null
     where c.brief_id = ${briefId}`;
  if (Number(rows[0].n) === 0) {
    throw new ConflictError(MSG_CAMPAIGN_INCOMPLETE_FOR_SUBMIT);
  }
}

// --- Helpers ---

interface CampaignRow {
  id: string;
  briefId: string;
  clientId: string;
  status: string;
  targetKpi: string;
  ownerAm: string;
}

async function lockCampaign(tx: Queryable, id: string): Promise<CampaignRow> {
  const rows = await tx<{ id: string; brief_id: string; client_id: string; status: string; target_kpi: string; assigned_am_id: string | null }[]>`
    select c.id, c.brief_id, c.client_id, c.status, c.target_kpi, cl.assigned_am_id
      from ad_campaigns c join clients cl on cl.id = c.client_id where c.id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CAMPAIGN_NOT_FOUND);
  }
  const r = rows[0];
  return { id: r.id, briefId: r.brief_id, clientId: r.client_id, status: r.status, targetKpi: r.target_kpi, ownerAm: r.assigned_am_id ?? '' };
}

async function campaignViewGate(sql: Queryable, actor: Actor, campaignId: string): Promise<void> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select cl.assigned_am_id from ad_campaigns c join clients cl on cl.id = c.client_id where c.id = ${campaignId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CAMPAIGN_NOT_FOUND);
  }
  if (!canViewCampaign(actor, rows[0].assigned_am_id ?? '')) {
    throw new ForbiddenError(MSG_CAMPAIGN_VIEW_FORBIDDEN);
  }
}

/** dateStr normalizes a postgres date value (string or Date) to YYYY-MM-DD. */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** parseDateRange validates two YYYY-MM-DD dates with end >= start (→ InvalidCampaignDates). */
function parseDateRange(startStr: string, endStr: string): [string, string] {
  const start = (startStr ?? '').trim();
  const end = (endStr ?? '').trim();
  if (!RE_DATE.test(start) || !RE_DATE.test(end)) {
    throw new ValidationError(MSG_INVALID_CAMPAIGN_DATES);
  }
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) {
    throw new ValidationError(MSG_INVALID_CAMPAIGN_DATES);
  }
  return [start, end];
}

/** parsePeriod validates a metric period (YYYY-MM-DD each) with end >= start (→ InvalidPeriod). */
/**
 * validCount normalises an optional raw platform count (clicks/impressions/
 * conversions, T-3). undefined/null → null (absent). A present value must be a
 * finite non-negative integer, else MSG_BAD_COUNT.
 */
function validCount(v: number | null | undefined): number | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new ValidationError(MSG_BAD_COUNT);
  }
  return v;
}

function parsePeriod(startStr: string, endStr: string): [string, string] {
  const start = (startStr ?? '').trim();
  const end = (endStr ?? '').trim();
  if (!RE_DATE.test(start) || !RE_DATE.test(end)) {
    throw new ValidationError(MSG_INVALID_PERIOD);
  }
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) {
    throw new ValidationError(MSG_INVALID_PERIOD);
  }
  return [start, end];
}

/** transitionError maps a rejected engine transition to the ads taxonomy (403 role / 409 else). */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

// ===========================================================================
// Target metrik per Brief-as-task + Laporan Mingguan Advertiser
// (keputusan pemilik 2026-08-14 — DECISIONS.md, migrasi 20260814100000)
// ---------------------------------------------------------------------------
// Laporan pemilik dari /tasks/BRF-202608-0002: saat SPV/Lead menetapkan PIC
// sebuah brief Ads, tak ada satu pun target metrik yang bisa dipilih (ads spent,
// GMV, ROAS, view, CTR, CVR), dan tak ada tempat bagi Advertiser melaporkan
// performa + saran perbaikan tiap minggu.
//
// Dua hal yang dibangun di sini, dan satu hal yang SENGAJA TIDAK:
//   * target: enam angka pada BRIEF (bukan pada kampanye — `ad_campaigns.
//     target_kpi` tetap milik kampanye dan tak disentuh), ditulis SPV/Lead Ads
//     (M8-OA-4: Advertiser tak pernah menetapkan targetnya sendiri);
//   * laporan mingguan: narasi per brief per minggu ISO oleh PIC — analisa
//     performa dan saran perbaikan, dua hal yang tak bisa dihitung dari data;
//   * TIDAK ada angka realisasi yang disimpan. Realisasi mingguan dihitung ulang
//     dari `metric_entries` setiap kali dibaca (aturan rumah #3/#4), jadi ia
//     selalu cocok dengan sumbernya dan tak pernah jadi ledger kedua.
// ===========================================================================

/** Actor is not SPV/Lead Ads (nor Director) — M8-OA-4 forbids self-set targets. */
export const MSG_TARGET_FORBIDDEN = '[anda tidak memiliki akses untuk menetapkan target brief ini]';
/** Every one of the six target fields was left empty. */
export const MSG_TARGET_KOSONG = '[target metrik belum diisi, isi minimal satu target]';
/** A target value is not a finite non-negative number. */
export const MSG_TARGET_INVALID = '[nilai target tidak valid]';
/** CTR/CVR are percentages — above 100 is a typo, not an achievement. */
export const MSG_TARGET_PERSEN = '[CTR dan CVR adalah persentase, nilainya tidak boleh lebih dari 100]';
/** Actor is neither the brief's PIC nor SPV/Lead Ads/Director. */
export const MSG_LAPORAN_FORBIDDEN = '[laporan mingguan hanya dapat diisi oleh PIC brief ini atau SPV/Lead Ads]';
/** Analisa/saran left blank — the two fields the report exists for. */
export const MSG_LAPORAN_NARASI_WAJIB = '[analisa performa dan saran perbaikan wajib diisi]';
/** One report per brief per ISO week (append-only — no rewrite path). */
export const MSG_LAPORAN_SUDAH_ADA = '[laporan mingguan untuk minggu ini sudah diisi]';
/** The supplied Monday is not a Monday / not a parseable WIB date. */
export const MSG_LAPORAN_MINGGU_INVALID = '[minggu laporan tidak valid]';
/** Reporting on a week that has not started yet. */
export const MSG_LAPORAN_MINGGU_DEPAN = '[laporan mingguan hanya dapat diisi untuk minggu yang sudah berjalan]';
/** Reporting on a week before the brief was ever worked on. */
export const MSG_LAPORAN_SEBELUM_MULAI = '[laporan mingguan baru dapat diisi setelah brief mulai dikerjakan]';

/**
 * The six metric keys the owner named, in display order. `sifat` says how the
 * ratio to target reads: `serapan` = budget consumed (ads spend — 100% means the
 * budget was spent, not that anyone excelled), `pencapaian` = performance
 * achieved (everything else — higher is better). The FE labels the column from
 * this instead of calling an over-spend a "120% achievement".
 */
export const ADS_TARGET_METRICS = [
  { key: 'ads_spent', label: 'Ads spent (Rp)', sifat: 'serapan' },
  { key: 'gmv', label: 'GMV dari Ads (Rp)', sifat: 'pencapaian' },
  { key: 'roas', label: 'ROAS', sifat: 'pencapaian' },
  { key: 'view', label: 'View / Impresi', sifat: 'pencapaian' },
  { key: 'ctr', label: 'CTR (%)', sifat: 'pencapaian' },
  { key: 'cvr', label: 'CVR (%)', sifat: 'pencapaian' },
] as const;

/** Raw caller input — every field a string so an empty string means "no target". */
export interface BriefTargetInput {
  targetSpend?: string;
  targetGmv?: string;
  targetRoas?: string;
  targetView?: string;
  targetCtr?: string;
  targetCvr?: string;
  catatan?: string;
}

/** The six targets of one Ads Brief, with house-rule-7 display strings. */
export interface BriefTargets {
  briefId: string;
  /** false = no target row yet (every field null) — the FE's "belum ditetapkan". */
  ditetapkan: boolean;
  targetSpend: number | null;
  targetSpendDisplay: string;
  targetGmv: number | null;
  targetGmvDisplay: string;
  targetRoas: number | null;
  targetRoasDisplay: string;
  targetView: number | null;
  targetViewDisplay: string;
  targetCtr: number | null;
  targetCtrDisplay: string;
  targetCvr: number | null;
  targetCvrDisplay: string;
  catatan: string;
  updatedBy: string;
  updatedAt: Date | null;
}

/**
 * What the system already knows, offered as a starting point for the SPV/Lead —
 * never written on its own (M8-OA-4). `sumber` names where each figure came from
 * so the person signing it off can see what they are accepting.
 */
export interface BriefTargetSuggestion {
  targetSpend: number | null;
  targetGmv: number | null;
  targetRoas: number | null;
  targetView: number | null;
  targetCtr: number | null;
  targetCvr: number | null;
  sumber: string;
}

/** getBriefTargets' payload: the saved targets plus the suggestion for the form. */
export interface BriefTargetsView {
  targets: BriefTargets;
  saran: BriefTargetSuggestion;
}

/** One metric's target vs. what actually happened that week. */
export interface WeeklyMetricRow {
  key: string;
  label: string;
  sifat: string; // 'serapan' | 'pencapaian'
  target: number | null;
  targetDisplay: string;
  realisasi: number | null;
  realisasiDisplay: string;
  /** realisasi ÷ target × 100, or null when either side is absent / target = 0. */
  rasio: number | null;
  rasioDisplay: string;
}

/** One ISO week of a brief: the numbers (derived) + the Advertiser's narrative. */
export interface WeeklyReportRow {
  briefId: string;
  isoYear: number;
  isoWeek: number;
  mingguMulai: string;
  mingguAkhir: string;
  metrik: WeeklyMetricRow[];
  /** true for the week that contains "now" — owed but not yet late. */
  berjalan: boolean;
  terisi: boolean;
  /** A finished week with no report: the discipline signal the owner asked for. */
  terlambat: boolean;
  analisa: string;
  saran: string;
  kendala: string;
  diisiOleh: string;
  diisiPada: Date | null;
}

/** listWeeklyReports' payload. */
export interface WeeklyReportView {
  briefId: string;
  targets: BriefTargets;
  minggu: WeeklyReportRow[];
  /** Finished weeks still without a report. */
  belumDiisi: number;
  /** true when older weeks were trimmed to the MAX_MINGGU window (never silent). */
  dipotong: boolean;
}

/** The narrative the Advertiser files. Numbers are never accepted here. */
export interface WeeklyReportInput {
  /** Monday (YYYY-MM-DD, WIB) of the reported week. Empty = the current week. */
  mingguMulai?: string;
  analisa: string;
  saran: string;
  kendala?: string;
}

/**
 * How many trailing ISO weeks a brief's report table shows. A brief that has run
 * for half a year does not need its first weeks re-rendered on every page load;
 * `dipotong` tells the reader older weeks exist, so the window is never silent.
 */
const MAX_MINGGU = 26;

/**
 * One Ads Brief-as-task's discipline summary for the /ads workspace — the
 * two-list nudge the owner asked for: which briefs still lack a metric target,
 * and which are behind on their weekly report. Derived, never stored.
 */
export interface AdsBriefDiscipline {
  briefId: string;
  title: string;
  status: string;
  assignedPic: string;
  dueDate: string | null;
  priority: string;
  /** false → no `ads_brief_targets` row: the "brief tanpa target" list. */
  hasTargets: boolean;
  /** false → the brief never entered [In Progress] (nothing owed yet). */
  started: boolean;
  /** Finished ISO weeks with no filed report — the "laporan telat" list. */
  overdueWeeks: number;
  /** Monday (YYYY-MM-DD) of the most recent filed report, or null. */
  latestReportedWeek: string | null;
}

/**
 * canSetBriefTargets — M8-OA-4 write gate: SPV/Lead Ads or Director. Deliberately
 * NOT the Advertiser: "Advertisers never self-set targets from platform
 * benchmarks alone" (M8 §4 Rule 1). Mirrored by the RLS policy
 * ads_brief_targets_insert/update.
 */
export function canSetBriefTargets(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === ADS_DIVISION && actor.role.level === permission.LevelLead;
}

/**
 * canFileWeeklyReport — the PIC of the brief writes their own week (that IS the
 * obligation), with SPV/Lead Ads and Director able to file as an override.
 * Mirrored by the RLS policy ads_weekly_reports_insert.
 */
export function canFileWeeklyReport(actor: Actor, assignedPic: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (assignedPic !== '' && actor.employeeId === assignedPic) {
    return true;
  }
  return actor.role.division === ADS_DIVISION && actor.role.level === permission.LevelLead;
}

/** The parent-brief facts every function in this section needs. */
interface AdsBriefRow {
  division: string;
  status: string;
  assignedPic: string;
  strategyId: string | null;
  quantityTarget: number;
  ownerAm: string;
  createdAt: Date;
}

async function loadAdsBrief(sql: Queryable, briefId: string): Promise<AdsBriefRow> {
  const rows = await sql<
    { assigned_division: string; status: string; assigned_pic: string | null; strategy_id: string | null;
      quantity_target: number | string; created_at: Date; assigned_am_id: string | null }[]
  >`
    select b.assigned_division, b.status, b.assigned_pic, b.strategy_id, b.quantity_target, b.created_at,
           cl.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients cl on cl.id = sv.client_id
     where b.id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  const r = rows[0];
  if (r.assigned_division !== ADS_DIVISION) {
    throw new ConflictError(MSG_NOT_ADS_BRIEF);
  }
  return {
    division: r.assigned_division, status: r.status, assignedPic: r.assigned_pic ?? '',
    strategyId: r.strategy_id, quantityTarget: Number(r.quantity_target), ownerAm: r.assigned_am_id ?? '',
    createdAt: r.created_at,
  };
}

/**
 * getBriefTargets returns an Ads Brief's six targets plus the suggestion the form
 * pre-fills from (Strategy KPI + the brief's own Quantity Target). Read gate =
 * the M8 §9.1 read predicate, same as the campaign reads.
 */
export async function getBriefTargets(sql: Queryable, actor: Actor, briefId: string): Promise<BriefTargetsView> {
  const brief = await loadAdsBrief(sql, briefId);
  if (!canViewCampaign(actor, brief.ownerAm)) {
    throw new ForbiddenError(MSG_CAMPAIGN_VIEW_FORBIDDEN);
  }
  const targets = await readTargets(sql, briefId);
  const saran = await suggestBriefTargets(sql, brief);
  return { targets, saran };
}

async function readTargets(sql: Queryable, briefId: string): Promise<BriefTargets> {
  const rows = await sql<
    { target_spend: string | null; target_gmv: string | null; target_roas: string | null;
      target_view: string | number | null; target_ctr: string | null; target_cvr: string | null;
      catatan: string | null; updated_by: string; updated_at: Date }[]
  >`
    select target_spend, target_gmv, target_roas, target_view, target_ctr, target_cvr,
           catatan, updated_by, updated_at
      from ads_brief_targets where brief_id = ${briefId}`;
  if (rows.length === 0) {
    return emptyTargets(briefId);
  }
  const r = rows[0];
  const spend = r.target_spend === null ? null : money.parse(r.target_spend);
  const gmv = r.target_gmv === null ? null : money.parse(r.target_gmv);
  const roas = numOrNull(r.target_roas);
  const view = numOrNull(r.target_view);
  const ctr = numOrNull(r.target_ctr);
  const cvr = numOrNull(r.target_cvr);
  return {
    briefId, ditetapkan: true,
    targetSpend: spend === null ? null : Number(spend) / 100,
    targetSpendDisplay: spend === null ? '—' : money.format(spend),
    targetGmv: gmv === null ? null : Number(gmv) / 100,
    targetGmvDisplay: gmv === null ? '—' : money.format(gmv),
    targetRoas: roas, targetRoasDisplay: roas === null ? '—' : formatRoas(roas),
    targetView: view, targetViewDisplay: view === null ? '—' : formatCount(view),
    targetCtr: ctr, targetCtrDisplay: ctr === null ? '—' : formatPercent(ctr),
    targetCvr: cvr, targetCvrDisplay: cvr === null ? '—' : formatPercent(cvr),
    catatan: r.catatan ?? '', updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
}

function emptyTargets(briefId: string): BriefTargets {
  return {
    briefId, ditetapkan: false,
    targetSpend: null, targetSpendDisplay: '—', targetGmv: null, targetGmvDisplay: '—',
    targetRoas: null, targetRoasDisplay: '—', targetView: null, targetViewDisplay: '—',
    targetCtr: null, targetCtrDisplay: '—', targetCvr: null, targetCvrDisplay: '—',
    catatan: '', updatedBy: '', updatedAt: null,
  };
}

/**
 * suggestBriefTargets reads the numbers the system ALREADY holds: the Strategy's
 * structured KPI (target_gmv/roas/ctr/cvr, migrasi 20260812090000) and the brief's
 * own Quantity Target — which for an Ads brief IS the planned Ads spend
 * (TASK_CATALOG `ads_spent`, "Ads spent (Rp)", M6B). View has no upstream source
 * (M6 never modelled it), so it stays null and is typed by hand.
 *
 * Nothing here is saved. It is a suggestion the SPV/Lead must confirm.
 */
async function suggestBriefTargets(sql: Queryable, brief: AdsBriefRow): Promise<BriefTargetSuggestion> {
  const spend = brief.quantityTarget > 0 ? brief.quantityTarget : null;
  let gmv: number | null = null;
  let roas: number | null = null;
  let ctr: number | null = null;
  let cvr: number | null = null;
  let sumber = spend === null ? '' : 'Target Kuantitas brief (Ads spent)';
  if (brief.strategyId !== null && brief.strategyId !== '') {
    const rows = await sql<
      { target_gmv: string | null; target_roas: string | null; target_ctr: string | null; target_cvr: string | null }[]
    >`
      select target_gmv, target_roas, target_ctr, target_cvr
        from strategy_plans where id = ${brief.strategyId}`;
    if (rows.length > 0) {
      gmv = numOrNull(rows[0].target_gmv);
      roas = numOrNull(rows[0].target_roas);
      ctr = numOrNull(rows[0].target_ctr);
      cvr = numOrNull(rows[0].target_cvr);
      if (gmv !== null || roas !== null || ctr !== null || cvr !== null) {
        sumber = sumber === ''
          ? `Target KPI Strategy ${brief.strategyId}`
          : `${sumber} + Target KPI Strategy ${brief.strategyId}`;
      }
    }
  }
  return { targetSpend: spend, targetGmv: gmv, targetRoas: roas, targetView: null, targetCtr: ctr, targetCvr: cvr, sumber };
}

/**
 * setBriefTargets writes (or rewrites) an Ads Brief's six targets. SPV/Lead Ads
 * or Director only (M8-OA-4). The row is a single current-value row, but every
 * write appends an audit_log before→after entry, so "who lowered the ROAS target
 * from 4 to 3, and when" stays answerable without a second history table
 * (aturan rumah #3).
 */
export async function setBriefTargets(
  sql: Sql,
  actor: Actor,
  briefId: string,
  input: BriefTargetInput,
): Promise<BriefTargets> {
  return withTransaction(sql, async (tx) => {
    const brief = await loadAdsBrief(tx, briefId);
    if (!canSetBriefTargets(actor)) {
      throw new ForbiddenError(MSG_TARGET_FORBIDDEN);
    }
    const spend = parseTargetMoney(input.targetSpend);
    const gmv = parseTargetMoney(input.targetGmv);
    const roas = parseTargetNumber(input.targetRoas);
    const view = parseTargetInteger(input.targetView);
    const ctr = parsePercentTarget(input.targetCtr);
    const cvr = parsePercentTarget(input.targetCvr);
    if (spend === null && gmv === null && roas === null && view === null && ctr === null && cvr === null) {
      throw new ValidationError(MSG_TARGET_KOSONG);
    }
    const catatan = (input.catatan ?? '').trim();
    const before = await readTargets(tx, briefId);

    await tx`
      insert into ads_brief_targets
        (brief_id, target_spend, target_gmv, target_roas, target_view, target_ctr, target_cvr,
         catatan, created_by, updated_by)
      values
        (${briefId}, ${spend === null ? null : money.decimal(spend)}, ${gmv === null ? null : money.decimal(gmv)},
         ${roas}, ${view}, ${ctr}, ${cvr}, ${catatan === '' ? null : catatan},
         ${actor.employeeId}, ${actor.employeeId})
      on conflict (brief_id) do update set
        target_spend = excluded.target_spend, target_gmv = excluded.target_gmv,
        target_roas = excluded.target_roas, target_view = excluded.target_view,
        target_ctr = excluded.target_ctr, target_cvr = excluded.target_cvr,
        catatan = excluded.catatan, updated_by = excluded.updated_by`;

    const after = await readTargets(tx, briefId);
    await executors(tx).audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId,
      action: before.ditetapkan ? 'ads_target_update' : 'ads_target_set',
      beforeJson: before.ditetapkan ? auditTargets(before) : null,
      afterJson: { ...auditTargets(after), pic: brief.assignedPic },
      createdBy: actor.employeeId,
    });
    return after;
  });
}

function auditTargets(t: BriefTargets): Record<string, unknown> {
  return {
    target_spend: t.targetSpend, target_gmv: t.targetGmv, target_roas: t.targetRoas,
    target_view: t.targetView, target_ctr: t.targetCtr, target_cvr: t.targetCvr, catatan: t.catatan,
  };
}

/**
 * listWeeklyReports returns every ISO week from the week the brief first entered
 * [In Progress] up to the current week, each carrying:
 *   - the six metrics' target vs. realisasi, realisasi RECOMPUTED from
 *     `metric_entries` (never stored — aturan rumah #4);
 *   - the Advertiser's narrative for that week, or the "belum diisi" gap.
 *
 * A brief that never started has no weeks at all: there is nothing to report on
 * yet, and inventing empty rows would read as unfiled obligations.
 */
export async function listWeeklyReports(
  sql: Queryable,
  actor: Actor,
  briefId: string,
  now: Date = new Date(),
): Promise<WeeklyReportView> {
  const brief = await loadAdsBrief(sql, briefId);
  if (!canViewCampaign(actor, brief.ownerAm)) {
    throw new ForbiddenError(MSG_CAMPAIGN_VIEW_FORBIDDEN);
  }
  const targets = await readTargets(sql, briefId);
  const start = await firstInProgressAt(sql, briefId);
  if (start === null) {
    return { briefId, targets, minggu: [], belumDiisi: 0, dipotong: false };
  }

  const weeks = weeksBetween(start, now);
  const dipotong = weeks.length > MAX_MINGGU;
  const shown = dipotong ? weeks.slice(weeks.length - MAX_MINGGU) : weeks;

  const realisasi = await weeklyRealisasi(sql, briefId);
  const filed = await readFiledReports(sql, briefId);
  const thisWeek = tz.isoWeekOf(now);
  const today = tz.dateString(now);

  const minggu = shown.map((w) => {
    const key = weekKey(w.isoYear, w.isoWeek);
    const r = realisasi.get(key) ?? emptyRealisasi();
    const f = filed.get(key) ?? null;
    const berjalan = w.isoYear === thisWeek.isoYear && w.isoWeek === thisWeek.isoWeek;
    const selesai = w.sundayDate < today;
    const terlambat = selesai && f === null;
    return {
      briefId, isoYear: w.isoYear, isoWeek: w.isoWeek, mingguMulai: w.mondayDate, mingguAkhir: w.sundayDate,
      metrik: metricRows(targets, r),
      berjalan, terisi: f !== null, terlambat,
      analisa: f?.analisa ?? '', saran: f?.saran ?? '', kendala: f?.kendala ?? '',
      diisiOleh: f?.createdBy ?? '', diisiPada: f?.createdAt ?? null,
    };
  });
  // belumDiisi counts EVERY finished-but-unreported week, not just the ones the
  // MAX_MINGGU window renders — so a brief with overdue weeks older than the
  // window still reports the true backlog (the /ads discipline list reads the
  // identical count via the same helper, so the two surfaces never disagree).
  const belumDiisi = countOverdueWeeks(start, now, new Set(filed.keys()));
  return { briefId, targets, minggu, belumDiisi, dipotong };
}

/**
 * adsBriefDiscipline returns the discipline summary for every Ads Brief-as-task
 * the actor may see — the data behind the /ads workspace's two nudge lists
 * ("brief tanpa target", "laporan telat"). One row per non-cancelled Ads brief:
 * whether it has a metric target, and how many finished weeks are missing a
 * report.
 *
 * Visibility mirrors `canViewCampaign` set-wise (the per-brief gate the reads
 * use), evaluated as one SQL predicate so a LIST cannot leak a brief a
 * per-id GET would refuse: OD/Director + Account-lead + any Ads staff/lead see
 * the whole division; an owning AM sees only their own clients' briefs. Runs on
 * the service-role connection (like the other M8 reads) — the audit-log start
 * anchor and the child rows are read in full, avoiding the audit_log RLS
 * under-count a per-actor connection would hit for a lead viewing a staff's
 * brief.
 *
 * Batched, not N+1: one query for the briefs, one for every start timestamp, one
 * for every filed report (P-1).
 */
export async function adsBriefDiscipline(
  sql: Queryable,
  actor: Actor,
  now: Date = new Date(),
): Promise<AdsBriefDiscipline[]> {
  const broad =
    permission.canReadAll(actor) ||
    permission.canReadDivision(actor, ACCOUNT_DIVISION) ||
    (actor.role.division === ADS_DIVISION &&
      (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead));

  const briefs = await sql<
    { id: string; title: string; status: string; assigned_pic: string | null;
      due_date: string | Date | null; priority: string; has_targets: boolean }[]
  >`
    select b.id, b.title, b.status, b.assigned_pic, b.due_date, b.priority,
           (t.brief_id is not null) as has_targets
      from briefs b
      join services sv on sv.id = b.service_id
      join clients cl on cl.id = sv.client_id
      left join ads_brief_targets t on t.brief_id = b.id
     where b.assigned_division = ${ADS_DIVISION}
       and b.status <> ${BRIEF_STATUS_CANCELLED}
       and (${broad} or cl.assigned_am_id = ${actor.employeeId})
     order by b.created_at`;
  if (briefs.length === 0) {
    return [];
  }
  const ids = briefs.map((b) => b.id);

  // First [In Progress] per brief — the report-obligation start anchor, from the
  // same immutable transition log M12's turnaround derives from.
  const starts = await sql<{ entity_id: string; started_at: Date }[]>`
    select entity_id, min(created_at) as started_at
      from audit_log
     where entity_type = 'brief' and entity_id = any(${ids})
       and action like ${`transition:%->${BRIEF_STATUS_IN_PROGRESS}`}
     group by entity_id`;
  const startMap = new Map(starts.map((s) => [s.entity_id, s.started_at]));

  // Every filed report week per brief (for the overdue count + the latest date).
  const reports = await sql<
    { brief_id: string; iso_year: number | string; iso_week: number | string; minggu_mulai: string | Date }[]
  >`
    select brief_id, iso_year, iso_week, minggu_mulai
      from ads_weekly_reports where brief_id = any(${ids})`;
  const filedByBrief = new Map<string, Set<string>>();
  const latestByBrief = new Map<string, string>();
  for (const r of reports) {
    const key = weekKey(Number(r.iso_year), Number(r.iso_week));
    const set = filedByBrief.get(r.brief_id) ?? new Set<string>();
    set.add(key);
    filedByBrief.set(r.brief_id, set);
    const monday = dateStr(r.minggu_mulai);
    const prev = latestByBrief.get(r.brief_id);
    if (prev === undefined || monday > prev) {
      latestByBrief.set(r.brief_id, monday);
    }
  }

  return briefs.map((b) => {
    const start = startMap.get(b.id) ?? null;
    const filed = filedByBrief.get(b.id) ?? new Set<string>();
    return {
      briefId: b.id, title: b.title, status: b.status, assignedPic: b.assigned_pic ?? '',
      dueDate: b.due_date === null ? null : dateStr(b.due_date), priority: b.priority,
      hasTargets: b.has_targets, started: start !== null,
      overdueWeeks: start === null ? 0 : countOverdueWeeks(start, now, filed),
      latestReportedWeek: latestByBrief.get(b.id) ?? null,
    };
  });
}

/**
 * fileWeeklyReport records one week's narrative. Append-only: a week already
 * reported cannot be rewritten (the DB guard refuses UPDATE/DELETE too) — a
 * correction is next week's report saying so.
 */
export async function fileWeeklyReport(
  sql: Sql,
  actor: Actor,
  briefId: string,
  input: WeeklyReportInput,
  now: Date = new Date(),
): Promise<WeeklyReportRow> {
  return withTransaction(sql, async (tx) => {
    const brief = await loadAdsBrief(tx, briefId);
    if (!canFileWeeklyReport(actor, brief.assignedPic)) {
      throw new ForbiddenError(MSG_LAPORAN_FORBIDDEN);
    }
    const analisa = (input.analisa ?? '').trim();
    const saran = (input.saran ?? '').trim();
    if (analisa === '' || saran === '') {
      throw new ValidationError(MSG_LAPORAN_NARASI_WAJIB);
    }
    const kendala = (input.kendala ?? '').trim();

    const raw = (input.mingguMulai ?? '').trim();
    let week: tz.IsoWeek;
    if (raw === '') {
      week = tz.isoWeekOf(now);
    } else {
      if (!RE_DATE.test(raw)) {
        throw new ValidationError(MSG_LAPORAN_MINGGU_INVALID);
      }
      let candidate: tz.IsoWeek;
      try {
        candidate = tz.isoWeekOfDate(raw);
      } catch {
        throw new ValidationError(MSG_LAPORAN_MINGGU_INVALID);
      }
      // The caller must name the week by its Monday — any other day would let two
      // requests mean the same week while looking different in the audit trail.
      if (candidate.mondayDate !== raw) {
        throw new ValidationError(MSG_LAPORAN_MINGGU_INVALID);
      }
      week = candidate;
    }
    const thisWeek = tz.isoWeekOf(now);
    if (week.mondayDate > thisWeek.mondayDate) {
      throw new ValidationError(MSG_LAPORAN_MINGGU_DEPAN);
    }
    const start = await firstInProgressAt(tx, briefId);
    if (start === null) {
      throw new ConflictError(MSG_LAPORAN_SEBELUM_MULAI);
    }
    if (week.mondayDate < tz.isoWeekOf(start).mondayDate) {
      throw new ConflictError(MSG_LAPORAN_SEBELUM_MULAI);
    }

    const dup = await tx<{ n: string }[]>`
      select count(*) as n from ads_weekly_reports
       where brief_id = ${briefId} and iso_year = ${week.isoYear} and iso_week = ${week.isoWeek}`;
    if (Number(dup[0].n) > 0) {
      throw new ConflictError(MSG_LAPORAN_SUDAH_ADA);
    }

    await tx`
      insert into ads_weekly_reports
        (brief_id, iso_year, iso_week, minggu_mulai, minggu_akhir, analisa, saran, kendala, created_by)
      values
        (${briefId}, ${week.isoYear}, ${week.isoWeek}, ${week.mondayDate}, ${week.sundayDate},
         ${analisa}, ${saran}, ${kendala === '' ? null : kendala}, ${actor.employeeId})`;

    await executors(tx).audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId,
      action: 'ads_weekly_report',
      beforeJson: null,
      afterJson: { iso_year: week.isoYear, iso_week: week.isoWeek, minggu_mulai: week.mondayDate, kendala: kendala !== '' },
      createdBy: actor.employeeId,
    });

    const targets = await readTargets(tx, briefId);
    const realisasi = await weeklyRealisasi(tx, briefId);
    const r = realisasi.get(weekKey(week.isoYear, week.isoWeek)) ?? emptyRealisasi();
    return {
      briefId, isoYear: week.isoYear, isoWeek: week.isoWeek,
      mingguMulai: week.mondayDate, mingguAkhir: week.sundayDate,
      metrik: metricRows(targets, r),
      berjalan: week.isoWeek === thisWeek.isoWeek && week.isoYear === thisWeek.isoYear,
      terisi: true, terlambat: false,
      analisa, saran, kendala, diisiOleh: actor.employeeId, diisiPada: now,
    };
  });
}

// --- Weekly helpers -------------------------------------------------------

/** One week's Σ over the brief's Metric Entries. Money in minor units. */
interface WeeklyRealisasi {
  spend: bigint;
  gmv: bigint;
  clicks: number;
  impressions: number;
  conversions: number;
}

function emptyRealisasi(): WeeklyRealisasi {
  return { spend: 0n, gmv: 0n, clicks: 0, impressions: 0, conversions: 0 };
}

function weekKey(isoYear: number, isoWeek: number): string {
  return `${isoYear}-${isoWeek}`;
}

/**
 * firstInProgressAt reads the moment the Brief-as-task FIRST entered
 * [In Progress] out of the immutable transition log — the same log M12's
 * turnaround is derived from, so "when did work start" has one answer in the
 * system, not two. Null = never started.
 */
async function firstInProgressAt(sql: Queryable, briefId: string): Promise<Date | null> {
  const rows = await sql<{ created_at: Date }[]>`
    select created_at from audit_log
     where entity_type = 'brief' and entity_id = ${briefId}
       and action like ${`transition:%->${BRIEF_STATUS_IN_PROGRESS}`}
     order by id asc limit 1`;
  return rows.length === 0 ? null : rows[0].created_at;
}

/**
 * countOverdueWeeks — how many FINISHED ISO weeks since `start` carry no filed
 * report. The RUNNING week is never counted (it is owed but not yet late). This
 * is the single definition of "laporan telat": `listWeeklyReports.belumDiisi`
 * (the per-brief panel) and `adsBriefDiscipline.overdueWeeks` (the /ads list)
 * both read it, so a brief's backlog count is identical on both surfaces.
 */
function countOverdueWeeks(start: Date, now: Date, filedKeys: Set<string>): number {
  const today = tz.dateString(now);
  let n = 0;
  for (const w of weeksBetween(start, now)) {
    if (w.sundayDate < today && !filedKeys.has(weekKey(w.isoYear, w.isoWeek))) {
      n++;
    }
  }
  return n;
}

/** weeksBetween lists every ISO week from `from` through the week containing `to`. */
function weeksBetween(from: Date, to: Date): tz.IsoWeek[] {
  const first = tz.isoWeekOf(from);
  const last = tz.isoWeekOf(to);
  const weeks: tz.IsoWeek[] = [];
  let cursor = first;
  // Guard against a clock skew that puts `to` before `from` (never emit nothing
  // for a brief that HAS started — the started week is always shown).
  while (cursor.mondayDate <= last.mondayDate) {
    weeks.push(cursor);
    cursor = tz.isoWeekOfDate(tz.addDaysToDate(cursor.mondayDate, 7));
  }
  if (weeks.length === 0) {
    weeks.push(first);
  }
  return weeks;
}

/**
 * weeklyRealisasi buckets every Metric Entry of every Ad Campaign under the brief
 * into the ISO week its period ENDS in — the same bucketing rule the weekly recap
 * aggregate uses (`me.period_end BETWEEN minggu_mulai AND minggu_akhir`,
 * 20260814040000), so the two surfaces never disagree about which week a number
 * belongs to.
 */
async function weeklyRealisasi(sql: Queryable, briefId: string): Promise<Map<string, WeeklyRealisasi>> {
  const rows = await sql<
    { period_end: string | Date; spend: string; gmv: string;
      clicks: string | null; impressions: string | null; conversions: string | null }[]
  >`
    select me.period_end, me.spend, me.gmv, me.clicks, me.impressions, me.conversions
      from metric_entries me
      join ad_campaigns c on c.id = me.campaign_id
     where c.brief_id = ${briefId}`;
  const out = new Map<string, WeeklyRealisasi>();
  for (const row of rows) {
    const w = tz.isoWeekOfDate(dateStr(row.period_end));
    const key = weekKey(w.isoYear, w.isoWeek);
    const acc = out.get(key) ?? emptyRealisasi();
    acc.spend += money.parse(row.spend);
    acc.gmv += money.parse(row.gmv);
    acc.clicks += Number(row.clicks ?? 0);
    acc.impressions += Number(row.impressions ?? 0);
    acc.conversions += Number(row.conversions ?? 0);
    out.set(key, acc);
  }
  return out;
}

interface FiledReport {
  analisa: string;
  saran: string;
  kendala: string;
  createdBy: string;
  createdAt: Date;
}

async function readFiledReports(sql: Queryable, briefId: string): Promise<Map<string, FiledReport>> {
  const rows = await sql<
    { iso_year: number | string; iso_week: number | string; analisa: string; saran: string;
      kendala: string | null; created_by: string; created_at: Date }[]
  >`
    select iso_year, iso_week, analisa, saran, kendala, created_by, created_at
      from ads_weekly_reports where brief_id = ${briefId}`;
  const out = new Map<string, FiledReport>();
  for (const r of rows) {
    out.set(weekKey(Number(r.iso_year), Number(r.iso_week)), {
      analisa: r.analisa, saran: r.saran, kendala: r.kendala ?? '',
      createdBy: r.created_by, createdAt: r.created_at,
    });
  }
  return out;
}

/**
 * metricRows turns (target, realisasi) into the six display rows. Every derived
 * ratio renders "—" when its denominator is absent or zero (aturan rumah #7);
 * CTR = clicks ÷ impressions, CVR = conversions ÷ clicks, ROAS = GMV ÷ spend,
 * View = impressions — the SAME definitions as the weekly recap (T-3), so an
 * Advertiser's page and the AM's recap never quote different arithmetic.
 */
function metricRows(targets: BriefTargets, r: WeeklyRealisasi): WeeklyMetricRow[] {
  const spend = Number(r.spend) / 100;
  const gmv = Number(r.gmv) / 100;
  const roas = r.spend === 0n ? null : Number(r.gmv) / Number(r.spend);
  const view = r.impressions === 0 ? null : r.impressions;
  const ctr = r.impressions === 0 ? null : (r.clicks / r.impressions) * 100;
  const cvr = r.clicks === 0 ? null : (r.conversions / r.clicks) * 100;
  return [
    row('ads_spent', targets.targetSpend, targets.targetSpendDisplay, spend, money.format(r.spend)),
    row('gmv', targets.targetGmv, targets.targetGmvDisplay, gmv, money.format(r.gmv)),
    row('roas', targets.targetRoas, targets.targetRoasDisplay, roas, roas === null ? '—' : formatRoas(roas)),
    row('view', targets.targetView, targets.targetViewDisplay, view, view === null ? '—' : formatCount(view)),
    row('ctr', targets.targetCtr, targets.targetCtrDisplay, ctr, ctr === null ? '—' : formatPercent(ctr)),
    row('cvr', targets.targetCvr, targets.targetCvrDisplay, cvr, cvr === null ? '—' : formatPercent(cvr)),
  ];
}

function row(
  key: string,
  target: number | null,
  targetDisplay: string,
  realisasi: number | null,
  realisasiDisplay: string,
): WeeklyMetricRow {
  const def = ADS_TARGET_METRICS.find((m) => m.key === key);
  let rasio: number | null = null;
  if (target !== null && target !== 0 && realisasi !== null) {
    rasio = (realisasi / target) * 100;
  }
  return {
    key, label: def?.label ?? key, sifat: def?.sifat ?? 'pencapaian',
    target, targetDisplay, realisasi, realisasiDisplay,
    rasio, rasioDisplay: rasio === null ? '—' : `${rasio.toFixed(2)}%`,
  };
}

// --- Target parsing / formatting -----------------------------------------

/** "" / undefined → null (no target); anything else must be valid money ≥ 0. */
function parseTargetMoney(raw: string | undefined): money.Money | null {
  const s = (raw ?? '').trim();
  if (s === '') {
    return null;
  }
  let m: money.Money;
  try {
    m = money.parse(s);
  } catch {
    throw new ValidationError(MSG_TARGET_INVALID);
  }
  if (m < 0n) {
    throw new ValidationError(MSG_TARGET_INVALID);
  }
  return m;
}

function parseTargetNumber(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (s === '') {
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(MSG_TARGET_INVALID);
  }
  return n;
}

function parseTargetInteger(raw: string | undefined): number | null {
  const n = parseTargetNumber(raw);
  if (n === null) {
    return null;
  }
  if (!Number.isInteger(n)) {
    throw new ValidationError(MSG_TARGET_INVALID);
  }
  return n;
}

/** CTR/CVR: a percentage, so 0..100 — mirrored by the DB CHECK ck_abt_persen. */
function parsePercentTarget(raw: string | undefined): number | null {
  const n = parseTargetNumber(raw);
  if (n !== null && n > 100) {
    throw new ValidationError(MSG_TARGET_PERSEN);
  }
  return n;
}

function numOrNull(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Thousands-separated count, id-ID style ("1.250.000"). */
function formatCount(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}

/** Percent with two decimals, id-ID decimal comma ("1,25%"). */
function formatPercent(n: number): string {
  return `${n.toFixed(2).replace('.', ',')}%`;
}
