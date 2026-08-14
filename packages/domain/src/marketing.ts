/**
 * Marketing domain service (M2). Ported from Go's `internal/module2_marketing/*`.
 *
 * Owns the Marketing Performance Record — one per acquisition Campaign (CMP-), 1:1
 * with the Campaign entity (M3, M2 §2 / M3-OA-5). The Campaign (M3) holds identity +
 * lifecycle + ownership + the Online/Offline checklist; THIS record holds the one
 * Marketing input not on the Campaign — the budget — and exposes the read-only
 * Auto-Metrics Engine.
 *
 * Everything Marketing is measured on is DERIVED on read (house rule #4), never stored:
 *   - Lead-by-Dashboard   = COUNT leads with Origin Campaign = this campaign (§4 r1).
 *   - Lead-Real-by-Sales  = COUNT DISTINCT of those leads with ≥1 attempt that reached
 *                           Qualified (transition INTO Qualified in the immutable log).
 *   - Lead-Quality Rate   = Real / Dashboard ("NN%" or "—").
 *   - Attributed Sales    = Σ won-deal value for leads whose LAST-TOUCH campaign = this
 *                           one (M2-OA-2 — deliberately last-touch, NOT M3's Origin),
 *                           inside the 3-month post-Close window (M3-OA-4).
 *   - CPL / CPRL / ROAS   = Budget/Dashboard, Budget/Real, Attributed/Budget.
 *   - Collected-ROAS      = verified-received / Budget (M2-OA-5, M5 Amount Verified).
 *   - Junk breakdown      = Not-Qualified reason counts (M1) for this campaign's leads.
 *
 * Division-by-zero renders "—" (house rule #7). This module reuses `campaign` for the
 * Campaign existence + §5 visibility gate and the 1:1 Online/Offline read — never
 * duplicating that logic or those columns. It emits NO notification event (catalog FROZEN).
 *
 * Reference: backend/internal/module2_marketing/{marketing,metrics}.go.
 */

import { money, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ForbiddenError as CampaignForbidden,
  NotFoundError as CampaignNotFound,
  ValidationError as CampaignValidation,
  getCampaign,
  listCampaigns,
  MARKETING_DIVISION,
  type Campaign,
} from './campaign';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The house division-by-zero render (CLAUDE.md #7): "—" (U+2014), never an error. */
const EM_DASH = '—';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M2). Byte-identical to the M3 generics where reused.
// ---------------------------------------------------------------------------

/** A mandatory field is missing/invalid — §3 Rule 4 / house default (budget missing/≤0). */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/** The Campaign / performance record does not exist (matches campaign.MSG_NOT_FOUND). */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** Actor may not manage/view this record (matches campaign.MSG_FORBIDDEN). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
/** A performance record already exists for this campaign (1:1, M3-OA-5). Proposed new string. */
export const MSG_DUPLICATE = '[performance record untuk campaign ini sudah ada]';

// ---------------------------------------------------------------------------
// Errors — mapped in apps/api http.ts: validation → 400, forbidden → 403,
// not-found → 404, duplicate → 409.
// ---------------------------------------------------------------------------

/** Bad/missing input (→ 400): budget missing, unparseable, or ≤ 0. */
export class ValidationError extends Error {
  constructor(message = MSG_INCOMPLETE) {
    super(message);
    this.name = 'MarketingValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'MarketingForbiddenError';
  }
}
/** The Campaign / performance record does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'MarketingNotFoundError';
  }
}
/** A second performance record for the same campaign (1:1 violation, → 409). */
export class DuplicateError extends Error {
  constructor(message = MSG_DUPLICATE) {
    super(message);
    this.name = 'MarketingDuplicateError';
  }
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** The stored performance-record projection (M2 §6.3 inputs only; Online/Offline from Campaign). */
export interface Record {
  campaignId: string;
  budget: string; // canonical DECIMAL string
  budgetIdr: string; // house IDR display
  online: boolean;
  offline: boolean;
  createdBy: string;
}

/** One Not-Qualified reason count (§4 Rule 9 / M1 taxonomy). Label surfaced VERBATIM. */
export interface JunkReason {
  reason: string;
  count: number;
}

/** The read-only Auto-Metrics view for one Campaign (§4 / §6.3). */
export interface Metrics {
  campaignId: string;
  online: boolean;
  offline: boolean;
  /** Budget input; "" + budgetIdr "—" when the campaign has no record yet. */
  budget: string;
  budgetIdr: string;

  leadByDashboard: number;
  leadRealBySales: number;
  leadQualityRate: string; // "NN%" or "—"

  attributedSales: string; // IDR (Σ, never div-zero)
  attributedSalesDecimal: string; // canonical DECIMAL
  costPerLead: string; // IDR or "—"
  costPerRealLead: string; // IDR or "—"
  roas: string; // "X.XX" or "—" (north-star)

  collectedSales: string; // IDR (verified-received Σ)
  collectedSalesDecimal: string; // canonical DECIMAL
  collectedRoas: string; // "X.XX" or "—" (M2-OA-5)

  junkBreakdown: JunkReason[];
}

// ---------------------------------------------------------------------------
// Authorization (M2 §3 Rule 5 / §5 Rule 3).
// ---------------------------------------------------------------------------

/**
 * canManageRecord is the M2 write gate (create/edit budget). The record is owned by
 * the Campaign owner (§3 Rule 5): the owning Marketing employee (staff OR a lead who
 * owns that campaign) may edit; any OTHER Marketing lead is read-only over the record
 * (§5 Rule 3 "monitor, not edit"); OD is read-only; a Director has full access. This is
 * the M3 canManageCampaign pattern MINUS the "any lead division-wide" write branch
 * (PRD §5 Rule 3 wins — the lead dashboard is read-only over staff records).
 */
export function canManageRecord(a: Actor, campaignOwner: string): boolean {
  if (a.role.director) {
    return true;
  }
  if (a.role.division !== MARKETING_DIVISION) {
    return false;
  }
  return a.employeeId === campaignOwner;
}

/**
 * mapCampaignErr translates the campaign sentinels into the M2 sentinels so callers see
 * a single error set with identical BI messages (the strings are byte-identical).
 */
function mapCampaignErr(e: unknown): never {
  if (e instanceof CampaignNotFound) {
    throw new NotFoundError();
  }
  if (e instanceof CampaignForbidden) {
    throw new ForbiddenError();
  }
  if (e instanceof CampaignValidation) {
    throw new ValidationError();
  }
  throw e;
}

/** viewCampaign reuses campaign.getCampaign's §5 gate, re-wrapping its errors as M2's. */
async function viewCampaign(sql: Queryable, actor: Actor, campaignId: string): Promise<Campaign> {
  try {
    return await getCampaign(sql, actor, campaignId);
  } catch (e) {
    mapCampaignErr(e);
  }
}

// ---------------------------------------------------------------------------
// Record inputs (M2 §3).
// ---------------------------------------------------------------------------

/**
 * createRecord creates the 1:1 performance record for a Campaign (§3). Gate: only the
 * campaign OWNER (Marketing staff/lead who owns it) or a Director — a non-owning lead is
 * read-only over staff records (§5 Rule 3), OD read-only everywhere. Budget is mandatory
 * and must parse to a positive IDR amount (§3 Rule 3), rejected BEFORE any row is written.
 * A second record for the same campaign is rejected (1:1, M3-OA-5). Audited.
 */
export async function createRecord(sql: Sql, actor: Actor, campaignId: string, budget: string): Promise<Record> {
  const c = await viewCampaign(sql, actor, campaignId);
  if (!canManageRecord(actor, c.owner)) {
    throw new ForbiddenError();
  }
  const amt = parsePositiveBudget(budget);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // 1:1 guard: reject a second record; probe first so the caller gets DuplicateError.
    const existing = await tx<{ n: string }[]>`
      select count(*) as n from marketing_performance_records where campaign_id = ${campaignId}`;
    if (Number(existing[0].n) > 0) {
      throw new DuplicateError();
    }
    await tx`
      insert into marketing_performance_records (campaign_id, budget, created_by)
      values (${campaignId}, ${money.decimal(amt)}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'marketing_performance_record', entityId: campaignId, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null, afterJson: { budget: money.decimal(amt) }, createdBy: actor.employeeId,
    });
    return {
      campaignId, budget: money.decimal(amt), budgetIdr: money.format(amt),
      online: c.online, offline: c.offline, createdBy: actor.employeeId,
    };
  });
}

/**
 * updateBudget edits the record's budget — an owner-gated field edit (§3 input), audited
 * before→after (NOT a status). Same manage gate as createRecord; new budget must parse to
 * a positive IDR amount. The auto-metric fields are never editable (§3 Rule 6).
 */
export async function updateBudget(sql: Sql, actor: Actor, campaignId: string, budget: string): Promise<Record> {
  const c = await viewCampaign(sql, actor, campaignId);
  if (!canManageRecord(actor, c.owner)) {
    throw new ForbiddenError();
  }
  const amt = parsePositiveBudget(budget);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const prev = await tx<{ budget: string }[]>`
      select budget from marketing_performance_records where campaign_id = ${campaignId} for update`;
    if (prev.length === 0) {
      throw new NotFoundError();
    }
    await tx`update marketing_performance_records set budget = ${money.decimal(amt)} where campaign_id = ${campaignId}`;
    await ex.audit.insertAudit({
      entityType: 'marketing_performance_record', entityId: campaignId, actorEmployeeId: actor.employeeId,
      action: 'budget_edited', beforeJson: { budget: prev[0].budget }, afterJson: { budget: money.decimal(amt) },
      createdBy: actor.employeeId,
    });
    return {
      campaignId, budget: money.decimal(amt), budgetIdr: money.format(amt),
      online: c.online, offline: c.offline, createdBy: actor.employeeId,
    };
  });
}

/**
 * getRecord returns the stored record (budget + the 1:1 Online/Offline) if the actor may
 * view the campaign (§5 read gate). Missing campaign → NotFound; missing record → NotFound;
 * not visible → Forbidden.
 */
export async function getRecord(sql: Queryable, actor: Actor, campaignId: string): Promise<Record> {
  const c = await viewCampaign(sql, actor, campaignId);
  const rec = await loadRecord(sql, campaignId);
  rec.online = c.online;
  rec.offline = c.offline;
  return rec;
}

/** loadRecord reads the stored budget row (no visibility check — callers gate first). */
async function loadRecord(sql: Queryable, campaignId: string): Promise<Record> {
  const rows = await sql<{ budget: string; created_by: string }[]>`
    select budget, created_by from marketing_performance_records where campaign_id = ${campaignId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const amt = money.parse(rows[0].budget);
  return {
    campaignId, budget: money.decimal(amt), budgetIdr: money.format(amt),
    online: false, offline: false, createdBy: rows[0].created_by,
  };
}

/** parsePositiveBudget parses budget to Money, rejecting blank/garbage/≤0 as ValidationError. */
function parsePositiveBudget(budget: string): money.Money {
  let amt: money.Money;
  try {
    amt = money.parse((budget ?? '').trim());
  } catch {
    throw new ValidationError();
  }
  if (amt <= 0n) {
    throw new ValidationError();
  }
  return amt;
}

// ---------------------------------------------------------------------------
// Auto-Metrics Engine (M2 §4) — everything DERIVED on read.
// ---------------------------------------------------------------------------

/**
 * metrics returns the full Auto-Metrics view for a campaign the actor may view (§5 read
 * gate). The performance record must exist (budget drives CPL/CPRL/ROAS); a campaign with
 * no record is NotFound.
 */
export async function metrics(sql: Queryable, actor: Actor, campaignId: string): Promise<Metrics> {
  const c = await viewCampaign(sql, actor, campaignId);
  const rec = await loadRecord(sql, campaignId);
  return computeMetrics(sql, c, money.parse(rec.budget));
}

/**
 * computeMetrics derives every §4 metric for one campaign. `budget` may be null (a
 * campaign listed on the dashboard before its record exists) — then all budget-dependent
 * metrics render "—" while lead counts, quality, attributed/collected sums still compute.
 */
async function computeMetrics(sql: Queryable, c: Campaign, budget: money.Money | null): Promise<Metrics> {
  const m: Metrics = {
    campaignId: c.id, online: c.online, offline: c.offline,
    budget: budget === null ? '' : money.decimal(budget),
    budgetIdr: budget === null ? EM_DASH : money.format(budget),
    leadByDashboard: 0, leadRealBySales: 0, leadQualityRate: EM_DASH,
    attributedSales: '', attributedSalesDecimal: '', costPerLead: EM_DASH, costPerRealLead: EM_DASH, roas: EM_DASH,
    collectedSales: '', collectedSalesDecimal: '', collectedRoas: EM_DASH,
    junkBreakdown: [],
  };

  // Lead-by-Dashboard = COUNT leads with Origin Campaign = this campaign (§4 r1).
  const dash = await sql<{ n: string }[]>`select count(*) as n from leads where origin_campaign_id = ${c.id}`;
  m.leadByDashboard = Number(dash[0].n);

  // Lead-Real-by-Sales = COUNT DISTINCT leads (Origin) with an attempt that reached
  // Qualified (transition INTO Qualified in the immutable audit log) (§4 r2).
  const real = await sql<{ n: string }[]>`
    select count(distinct l.id) as n
      from leads l
      join prospect_attempts pa on pa.lead_id = l.id
      join audit_log al on al.entity_type = 'prospect_attempt'
                       and al.entity_id = pa.id
                       and al.action = 'transition:Contacted->Qualified'
     where l.origin_campaign_id = ${c.id}`;
  m.leadRealBySales = Number(real[0].n);

  // Attributed (LAST-TOUCH, M2-OA-2) + Collected (verified-received, M2-OA-5), both inside
  // the 3-month post-Close window (M3-OA-4).
  const { attributed, collected } = await attributedAndCollected(sql, c);
  m.attributedSales = money.format(attributed);
  m.attributedSalesDecimal = money.decimal(attributed);
  m.collectedSales = money.format(collected);
  m.collectedSalesDecimal = money.decimal(collected);

  m.junkBreakdown = await junkBreakdown(sql, c.id);

  // Derived ratios (§4 r3/r5/r6/r7/r8). Division-by-zero → "—".
  m.leadQualityRate = percentRound(m.leadRealBySales, m.leadByDashboard);
  if (budget !== null) {
    m.costPerLead = moneyDivCount(budget, m.leadByDashboard);
    m.costPerRealLead = moneyDivCount(budget, m.leadRealBySales);
    m.roas = ratio2dp(attributed, budget);
    m.collectedRoas = ratio2dp(collected, budget);
  }
  return m;
}

/**
 * attributedAndCollected sums, over every won client whose lead's LAST-TOUCH campaign is
 * this one (M2-OA-2): the booked deal value (Attributed Sales, headline ROAS basis) and
 * the verified-received amount (Collected, Collected-ROAS basis, M2-OA-5 — Σ [Terverifikasi]
 * installments + Σ direct verifications with NULL installment_id, mirroring M5 AmountVerified).
 *
 * Window (M3-OA-4): when the campaign has been Closed (end_date set), a win dated MORE than
 * 3 months after end_date no longer credits the campaign. The win date is the immutable
 * "closing" audit event (fallback client.created_at); it is NOT "now" — a pure end_date vs
 * win_date comparison, both taken as WIB calendar dates.
 */
async function attributedAndCollected(sql: Queryable, c: Campaign): Promise<{ attributed: money.Money; collected: money.Money }> {
  const rows = await sql<{ booked: string; verified: string; win_at: Date }[]>`
    select coalesce(t.total_agreed_value, 0) as booked,
           coalesce((select sum(i.amount) from installments i
                      where i.transaction_id = t.id and i.status = '[Terverifikasi]'), 0)
         + coalesce((select sum(pv.amount) from payment_verifications pv
                      where pv.transaction_id = t.id and pv.installment_id is null), 0) as verified,
           coalesce((select min(al.created_at) from audit_log al
                      where al.entity_type = 'client' and al.entity_id = c.id
                        and al.action = 'closing'), c.created_at) as win_at
      from clients c
      join leads l on l.id = c.lead_id
      join transactions t on t.id = c.transaction_id
     where l.last_touch_campaign_id = ${c.id}`;

  // Window cutoff (WIB date string), only when the campaign has an end_date (Closed).
  const cutoff = c.endDate === null ? null : addMonthsToDateStr(c.endDate, 3);

  let attributed = 0n;
  let collected = 0n;
  for (const r of rows) {
    if (cutoff !== null && tz.dateString(r.win_at) > cutoff) {
      continue; // won more than 3 months after Close — no longer credited (M3-OA-4)
    }
    attributed += money.parse(r.booked);
    collected += money.parse(r.verified);
  }
  return { attributed, collected };
}

/**
 * junkBreakdown returns the Not-Qualified reason counts for this campaign's Origin leads
 * (§4 r9). Labels VERBATIM; ordered by count desc then label for a stable presentation.
 */
async function junkBreakdown(sql: Queryable, campaignId: string): Promise<JunkReason[]> {
  const rows = await sql<{ reason: string; c: string }[]>`
    select r.reason, count(*) as c
      from prospect_attempt_nq_reasons r
      join prospect_attempts pa on pa.id = r.attempt_id
      join leads l on l.id = pa.lead_id
     where l.origin_campaign_id = ${campaignId}
     group by r.reason
     order by c desc, r.reason`;
  return rows.map((r) => ({ reason: r.reason, count: Number(r.c) }));
}

/**
 * dashboard is the Lead/Staff dashboard split (§5): the metrics view for every Campaign the
 * actor may see (reused from campaign.listCampaigns) — a Marketing staff gets only OWN
 * campaigns; a lead/head, OD, or Director gets ALL. Campaigns without a record yet still
 * appear (budget-dependent metrics render "—").
 */
export async function dashboard(sql: Queryable, actor: Actor): Promise<Metrics[]> {
  let campaigns: Campaign[];
  try {
    campaigns = await listCampaigns(sql, actor);
  } catch (e) {
    mapCampaignErr(e);
  }
  // P-1: each campaign's metric bundle is ~5 independent reads, and they used to
  // run campaign-after-campaign — 5N sequential round-trips for a dashboard that
  // shows them all at once. Compute the campaigns concurrently (read-only, no
  // shared state); the driver pipelines the queries. `campaigns` order is kept.
  return Promise.all(
    campaigns.map(async (c) => computeMetrics(sql, c, await budgetFor(sql, c.id))),
  );
}

/** budgetFor loads the campaign's record budget, or null when no record exists yet. */
async function budgetFor(sql: Queryable, campaignId: string): Promise<money.Money | null> {
  const rows = await sql<{ budget: string }[]>`
    select budget from marketing_performance_records where campaign_id = ${campaignId}`;
  return rows.length === 0 ? null : money.parse(rows[0].budget);
}

// ---------------------------------------------------------------------------
// Ratio / money-division renderers (house rule #7: div-zero → "—").
// ---------------------------------------------------------------------------

/**
 * moneyDivCount renders budget / count as house IDR, or "—" when count is 0. The division
 * is exact in minor units (integer), then money.format drops cents for display.
 */
function moneyDivCount(budget: money.Money, count: number): string {
  if (count <= 0) {
    return EM_DASH;
  }
  return money.format(budget / BigInt(count));
}

/**
 * ratio2dp renders num/den to two decimals (e.g. ROAS "4.38"), or "—" when den is 0. Both
 * operands are minor-unit integers, so the ratio is unit-free; rounded half-up.
 */
function ratio2dp(num: money.Money, den: money.Money): string {
  if (den === 0n) {
    return EM_DASH;
  }
  const h = roundHalfUpDiv(num * 100n, den); // hundredths
  const neg = h < 0n ? '-' : '';
  const abs = h < 0n ? -h : h;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg}${whole}.${frac}`;
}

/**
 * percentRound renders num/den as an integer percentage "NN%" (rounded half-up), or "—"
 * when den is 0 (§4 r3 / r8). Matches the PRD's "26%" presentation.
 */
function percentRound(num: number, den: number): string {
  if (den === 0) {
    return EM_DASH;
  }
  const pct = roundHalfUpDiv(BigInt(num) * 100n, BigInt(den));
  return `${pct}%`;
}

/** roundHalfUpDiv returns round(num/den) with .5 rounded away from zero. den != 0. */
function roundHalfUpDiv(num: bigint, den: bigint): bigint {
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const half = d / 2n;
  const q = (n + half) / d;
  return neg ? -q : q;
}

/** addMonthsToDateStr adds `months` to a "YYYY-MM-DD" string, normalizing month overflow. */
function addMonthsToDateStr(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
