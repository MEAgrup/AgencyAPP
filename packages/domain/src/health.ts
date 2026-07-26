/**
 * Client Health Report domain service (M13). Ported from Go's
 * `internal/module13_health/*`.
 *
 * A pure AGGREGATION + scoring layer (M13 §1): it adds no new raw data, only a
 * weighted 0–100 Health Score per Client, computed from data already in Modules 4
 * (GMV), 5 (payment), 6 (complaints), 8 (ROAS) and 12 (task completion / revision).
 *
 * The month boundary produces one immutable snapshot per Client (CHR-, §5.1); the
 * current not-yet-closed month is a read-only live preview that is never stored
 * (Rule 10). Everything a snapshot persists is recomputable from the immutable
 * event/timestamp logs of the source modules (house rule 4).
 *
 * Seven components (§2 Rule 2), confirmed weights (Rule 3), missing-component
 * proportional redistribution (Rule 4), 0–100 capping (Rule 5/6), band assignment
 * (Rule 7), month-over-month band-drop emission (Rule 12), and the per-Client ROAS
 * Inclusion Toggle (Rule 13 / §5.4). Division-by-zero renders "—" (house rule 7).
 *
 * Reuses `ads.parseRoasTarget` (Target-KPI parsing) and `task.computeMetrics`
 * (recompute-from-log Speed Score / Revision Count) — never duplicating that math.
 *
 * Reference: backend/internal/module13_health/{health,compute,roas,service,snapshot}.go.
 */

import { notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { parseRoasTarget } from './ads';
import { computeMetrics, type Transition } from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The CDPS division that owns the Client Health view (§Rule 11). */
export const ACCOUNT_DIVISION = 'Account';

// --- Component names (§2 Rule 2). Stable keys — persisted in components_json. ---
export const COMP_GMV_GROWTH = 'gmv_growth';
export const COMP_ROAS_ATTAINMENT = 'roas_attainment';
export const COMP_TASK_COMPLETION = 'task_completion';
export const COMP_REVISION_BURDEN = 'revision_burden';
export const COMP_COMPLAINTS = 'complaints';
export const COMP_SATISFACTION = 'satisfaction';
export const COMP_PAYMENT_TIMELINESS = 'payment_timeliness';

/** Confirmed base weights out of 100 (§2 Rule 3 / §6 OA-1). Sum to exactly 100. */
const BASE_WEIGHTS: Record<string, number> = {
  [COMP_GMV_GROWTH]: 25,
  [COMP_ROAS_ATTAINMENT]: 25,
  [COMP_TASK_COMPLETION]: 10,
  [COMP_REVISION_BURDEN]: 10,
  [COMP_COMPLAINTS]: 10,
  [COMP_SATISFACTION]: 10,
  [COMP_PAYMENT_TIMELINESS]: 10,
};

// --- Bands (§2 Rule 7 / §6 OA-2). ---
export const BAND_HEALTHY = 'Healthy'; // 80–100
export const BAND_WATCH = 'Watch'; // 60–79
export const BAND_AT_RISK = 'At Risk'; // below 60

// --- Complaint severity penalties (§2 Rule 5 / §6 OA-4). ---
const PENALTY_LOW = 5;
const PENALTY_MEDIUM = 15;
const PENALTY_HIGH = 30;

const AD_CAMPAIGN_ACTIVE_STATUS = '[Active]';
const INSTALLMENT_OVERDUE_STATUS = '[Jatuh Tempo]';
const ADS_BRIEF_DIVISION = 'Ads';
const CHR_PREFIX = 'CHR';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M13). Reuse shared house strings (CLAUDE.md §5).
// ---------------------------------------------------------------------------

/** Actor's role has no M13 access at all. */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
/** Client / snapshot does not exist OR is not visible to the actor. */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** Actor may not trigger the monthly snapshot sweep (W1-09 precedent). */
export const MSG_SCAN_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan pemindaian skor kesehatan klien]';

// ---------------------------------------------------------------------------
// Errors — mapped in apps/api http.ts: forbidden → 403, not-found → 404.
// ---------------------------------------------------------------------------

/** The actor's role may not read/run this M13 surface (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'HealthForbiddenError';
  }
}
/** The Client / snapshot does not exist or is not visible (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'HealthNotFoundError';
  }
}
/** The actor may not run the snapshot sweep (→ 403). */
export class ScanForbiddenError extends Error {
  constructor(message = MSG_SCAN_FORBIDDEN) {
    super(message);
    this.name = 'HealthScanForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** One scored (or excluded) component of the Health Score (§2 Rule 5/6 / §5.6). */
export interface Component {
  name: string;
  included: boolean;
  raw: number | null; // uncapped; null when excluded
  capped: number | null; // clamp(raw,0,100); null when excluded
  baseWeight: number;
  effectiveWeight: number; // post-redistribution (out of 100); 0 when excluded
  excludedReason?: string;
}

/** A Client Health Report — a stored snapshot or a computed-in-memory live preview. */
export interface Snapshot {
  id: string;
  clientId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  finalHealthScore: number | null;
  scoreDisplay: string; // "74.60" or "—"
  band: string;
  roasToggleState: boolean;
  components: Component[];
  computedAt: Date | null;
  computedBy: string;
  preview: boolean;
}

/** The read view of a Client's ROAS Inclusion Toggle (Rule 13 / §5.4). */
export interface RoasToggle {
  clientId: string;
  override: boolean | null; // null = no override (follow default)
  hasAds: boolean;
  hasActive: boolean;
  effective: boolean;
}

/** One RunSnapshotJob pass tally. */
export interface ScanResult {
  period: string;
  snapshotsMade: number;
  bandDropsFlagged: number;
}

/** candidate is the raw pre-scoring input for one component (§2 Rule 4 / §5.6). */
interface Candidate {
  name: string;
  included: boolean;
  raw: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Pure scoring core (§2 Rules 3–7) — no DB, exhaustively unit-testable.
// ---------------------------------------------------------------------------

/** bandRank orders bands so a month-over-month DROP is strictly decreasing (Rule 12). */
export function bandRank(band: string): number {
  switch (band) {
    case BAND_HEALTHY:
      return 3;
    case BAND_WATCH:
      return 2;
    case BAND_AT_RISK:
      return 1;
    default:
      return 0;
  }
}

/** bandFor assigns the band from a final score (Rule 7). */
export function bandFor(score: number): string {
  if (score >= 80) {
    return BAND_HEALTHY;
  }
  if (score >= 60) {
    return BAND_WATCH;
  }
  return BAND_AT_RISK;
}

function clamp01to100(v: number): number {
  if (v > 100) {
    return 100;
  }
  if (v < 0) {
    return 0;
  }
  return v;
}

/**
 * score turns the per-component candidates into the finished Component list plus the
 * final weighted Health Score (0–100) and its band (Rules 3–7). Redistribution
 * (Rule 4): the base weights of the AVAILABLE components are re-normalised to sum to
 * 100. scoreOk is false only in the defensive all-excluded case (renders "—").
 */
export function score(cands: Candidate[]): { components: Component[]; finalScore: number | null; band: string; scoreOk: boolean } {
  let availableBase = 0;
  for (const c of cands) {
    if (c.included) {
      availableBase += BASE_WEIGHTS[c.name];
    }
  }

  const components: Component[] = [];
  let weighted = 0;
  for (const c of cands) {
    const comp: Component = {
      name: c.name, included: false, raw: null, capped: null,
      baseWeight: BASE_WEIGHTS[c.name] ?? 0, effectiveWeight: 0,
    };
    if (c.included && availableBase > 0) {
      const raw = c.raw;
      const capped = clamp01to100(raw);
      const eff = (BASE_WEIGHTS[c.name] * 100) / availableBase;
      comp.included = true;
      comp.raw = raw;
      comp.capped = capped;
      comp.effectiveWeight = eff;
      weighted += (eff / 100) * capped;
    } else {
      comp.excludedReason = c.reason;
    }
    components.push(comp);
  }

  if (availableBase === 0) {
    return { components, finalScore: null, band: '', scoreOk: false };
  }
  let finalScore = Math.round(weighted * 1000) / 1000;
  if (finalScore > 100) {
    finalScore = 100;
  }
  if (finalScore < 0) {
    finalScore = 0;
  }
  return { components, finalScore, band: bandFor(finalScore), scoreOk: true };
}

// ---------------------------------------------------------------------------
// Period (one scored WIB calendar month, O20).
// ---------------------------------------------------------------------------

const WIB_MS = tz.WIB_OFFSET_HOURS * 3600 * 1000;

interface Period {
  startUTC: Date; // WIB first-of-month midnight, as a UTC instant (also the ident bucket anchor)
  endUTC: Date; // next-month WIB midnight (exclusive)
  startDate: string; // "YYYY-MM-01"
  endDate: string; // "YYYY-MM-DD" (inclusive DATE upper bound)
  approvedTag: string; // "YYYY-MM" — compared against task metrics approvedPeriodWib
  id: string; // "YYYYMM"
}

/** monthPeriod builds the period for the WIB calendar month containing `anchor`. */
function monthPeriod(anchor: Date): Period {
  const wib = new Date(anchor.getTime() + WIB_MS);
  const y = wib.getUTCFullYear();
  const mo = wib.getUTCMonth(); // 0-based
  const startUTC = new Date(Date.UTC(y, mo, 1) - WIB_MS);
  const endUTC = new Date(Date.UTC(y, mo + 1, 1) - WIB_MS);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const mm = String(mo + 1).padStart(2, '0');
  return {
    startUTC, endUTC,
    startDate: `${y}-${mm}-01`,
    endDate: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
    approvedTag: `${y}-${mm}`,
    id: `${y}${mm}`,
  };
}

/** closedMonthPeriod is the most-recently CLOSED WIB month relative to now (the previous month). */
function closedMonthPeriod(now: Date): Period {
  const thisMonth = monthPeriod(now);
  // One day before this WIB month's start lands in the previous month.
  return monthPeriod(new Date(thisMonth.startUTC.getTime() - 24 * 3600 * 1000));
}

/** firstFullMonthStartUTC is the WIB first-of-month of the Client's first FULL month (Rule 8 grace). */
function firstFullMonthStartUTC(createdAt: Date): Date {
  const wib = new Date(createdAt.getTime() + WIB_MS);
  const y = wib.getUTCFullYear();
  const mo = wib.getUTCMonth();
  const day = wib.getUTCDate();
  const monthOffset = day === 1 ? 0 : 1;
  return new Date(Date.UTC(y, mo + monthOffset, 1) - WIB_MS);
}

// ---------------------------------------------------------------------------
// Input gathering (compute.go) — the seven component candidates.
// ---------------------------------------------------------------------------

interface ClientInputs {
  baseline: number;
  target: number;
  current: number;
  createdAt: Date;
  roasOverride: boolean | null;
}

/** loadClientInputs reads GMV numbers, onboarding timestamp and ROAS override. */
async function loadClientInputs(sql: Queryable, clientId: string): Promise<ClientInputs> {
  const rows = await sql<
    { gmv_baseline: string; target_gmv: string; total_sales: string; created_at: Date; roas_health_included_override: boolean | null }[]
  >`
    select gmv_baseline, target_gmv, total_sales, created_at, roas_health_included_override
      from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    baseline: Number(r.gmv_baseline),
    target: Number(r.target_gmv),
    current: Number(r.total_sales),
    createdAt: r.created_at,
    roasOverride: r.roas_health_included_override,
  };
}

/**
 * gatherComponents assembles the seven component candidates for one Client + period,
 * plus the effective ROAS-inclusion toggle state recorded on the snapshot (Rule 13).
 */
async function gatherComponents(sql: Queryable, clientId: string, per: Period): Promise<{ cands: Candidate[]; roasState: boolean }> {
  const ci = await loadClientInputs(sql, clientId);
  const cands: Candidate[] = [];

  // GMV Growth (Module 4) — Rule 5 + grace Rule 8.
  const grace = per.startUTC.getTime() <= firstFullMonthStartUTC(ci.createdAt).getTime();
  cands.push(gmvCandidate(ci, grace));

  // ROAS Attainment (Module 8) — Rule 5 + toggle Rule 13.
  const { cand: roasCand, roasState } = await roasCandidate(sql, clientId, per, ci.roasOverride);
  cands.push(roasCand);

  // Task Completion + Revision Burden (Module 12) — Rule 5.
  const { taskCand, revCand } = await taskCandidates(sql, clientId, per);
  cands.push(taskCand, revCand);

  // Complaints (Module 6) — Rule 5 (always available; 0 complaints = 100).
  cands.push(await complaintsCandidate(sql, clientId, per));

  // Satisfaction — ALWAYS N/A until Module 15 (Rule 2 / §5.5). Never proxied.
  cands.push({
    name: COMP_SATISFACTION, included: false, raw: 0,
    reason: 'placeholder — Module 15 (CSAT/Client Portal) belum ada',
  });

  // Payment Timeliness (Module 5) — Rule 5.
  cands.push(await paymentCandidate(sql, clientId, per));

  return { cands, roasState };
}

/** gmvCandidate: (Current−Baseline)/(Target−Baseline)×100. Excluded in grace or when Target==Baseline. */
function gmvCandidate(ci: ClientInputs, grace: boolean): Candidate {
  if (grace) {
    return {
      name: COMP_GMV_GROWTH, included: false, raw: 0,
      reason: 'grace period klien baru — GMV Growth dikecualikan pada bulan penuh pertama (Rule 8)',
    };
  }
  const denom = ci.target - ci.baseline;
  if (denom === 0) {
    return {
      name: COMP_GMV_GROWTH, included: false, raw: 0,
      reason: 'Target GMV sama dengan Baseline GMV — pembagi nol, dikecualikan + bobot didistribusi ulang',
    };
  }
  return { name: COMP_GMV_GROWTH, included: true, raw: ((ci.current - ci.baseline) / denom) * 100, reason: '' };
}

/** roasCandidate: ROAS Attainment (Rule 5) with the toggle (Rule 13). Returns the effective toggle state too. */
async function roasCandidate(
  sql: Queryable,
  clientId: string,
  per: Period,
  override: boolean | null,
): Promise<{ cand: Candidate; roasState: boolean }> {
  const { hasAny, hasActive } = await adsServicePresence(sql, clientId);
  if (!hasAny) {
    return {
      cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0, reason: 'klien tidak memiliki layanan Ads — ROAS N/A struktural (Rule 13)' },
      roasState: false,
    };
  }
  const toggleOn = override === null ? hasActive : override;
  if (!toggleOn) {
    return {
      cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0, reason: 'ROAS dimatikan oleh toggle tim (Rule 13)' },
      roasState: false,
    };
  }
  const cur = await currentPeriodRoas(sql, clientId, per);
  if (cur === null) {
    return {
      cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0, reason: 'tidak ada data metrik ROAS pada periode — dikecualikan + bobot didistribusi ulang' },
      roasState: true,
    };
  }
  const target = await aggregateTargetRoas(sql, clientId);
  if (target === null) {
    return {
      cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0, reason: 'target ROAS tidak dapat diparse dari Target KPI — dikecualikan + bobot didistribusi ulang' },
      roasState: true,
    };
  }
  return { cand: { name: COMP_ROAS_ATTAINMENT, included: true, raw: (cur / target) * 100, reason: '' }, roasState: true };
}

/** adsServicePresence reports whether the Client has ANY / an ACTIVE ad campaign. */
async function adsServicePresence(sql: Queryable, clientId: string): Promise<{ hasAny: boolean; hasActive: boolean }> {
  const rows = await sql<{ any_n: string; active_n: string }[]>`
    select count(*) as any_n,
           coalesce(sum(case when status = ${AD_CAMPAIGN_ACTIVE_STATUS} then 1 else 0 end), 0) as active_n
      from ad_campaigns where client_id = ${clientId}`;
  return { hasAny: Number(rows[0].any_n) > 0, hasActive: Number(rows[0].active_n) > 0 };
}

/** currentPeriodRoas = ΣGMV / ΣSpend over the Client's Metric Entries in the period. null when no spend. */
async function currentPeriodRoas(sql: Queryable, clientId: string, per: Period): Promise<number | null> {
  const rows = await sql<{ spend: string | null; gmv: string | null }[]>`
    select sum(m.spend) as spend, sum(m.gmv) as gmv
      from metric_entries m join ad_campaigns c on c.id = m.campaign_id
     where c.client_id = ${clientId} and m.period_start between ${per.startDate} and ${per.endDate}`;
  const { spend, gmv } = rows[0];
  if (spend === null || gmv === null) {
    return null;
  }
  const sp = Number(spend);
  if (sp === 0) {
    return null; // div-zero → treated as missing data (house rule 7)
  }
  return Number(gmv) / sp;
}

/** aggregateTargetRoas returns the MEAN of the Client's parseable ROAS targets. null when none parse. */
async function aggregateTargetRoas(sql: Queryable, clientId: string): Promise<number | null> {
  const rows = await sql<{ target_kpi: string }[]>`select target_kpi from ad_campaigns where client_id = ${clientId}`;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = parseRoasTarget(r.target_kpi);
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

/** taskCandidates computes Task Completion Rate + Revision Burden over the period-approved Tasks (Rule 5). */
async function taskCandidates(sql: Queryable, clientId: string, per: Period): Promise<{ taskCand: Candidate; revCand: Candidate }> {
  interface TaskRow {
    entityType: 'asset' | 'brief';
    id: string;
    sla: number | null;
  }
  const tasks: TaskRow[] = [];

  const assets = await sql<{ id: string; sla_target_hours: string | null }[]>`
    select a.id, a.sla_target_hours
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId}`;
  for (const a of assets) {
    tasks.push({ entityType: 'asset', id: a.id, sla: a.sla_target_hours === null ? null : Number(a.sla_target_hours) });
  }
  const briefs = await sql<{ id: string; sla_target_hours: string | null }[]>`
    select b.id, b.sla_target_hours
      from briefs b
      join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId} and b.assigned_division = ${ADS_BRIEF_DIVISION}`;
  for (const b of briefs) {
    tasks.push({ entityType: 'brief', id: b.id, sla: b.sla_target_hours === null ? null : Number(b.sla_target_hours) });
  }

  let approvedInPeriod = 0; // Revision Burden denominator
  let slaJudged = 0; // Task Completion denominator (has SLA)
  let withinSLA = 0; // Task Completion numerator
  let revisionSum = 0;

  for (const tr of tasks) {
    const transitions = await taskTransitions(sql, tr.entityType, tr.id);
    const m = computeMetrics(transitions, tr.sla);
    if (m.approvedPeriodWib !== per.approvedTag) {
      continue; // not closed in this period
    }
    approvedInPeriod++;
    revisionSum += m.revisionCount;
    if (m.speedScorePct !== null) {
      slaJudged++;
      if (m.speedScorePct <= 100) {
        withinSLA++;
      }
    }
  }

  const taskCand: Candidate =
    slaJudged === 0
      ? { name: COMP_TASK_COMPLETION, included: false, raw: 0, reason: 'tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' }
      : { name: COMP_TASK_COMPLETION, included: true, raw: (withinSLA / slaJudged) * 100, reason: '' };

  let revCand: Candidate;
  if (approvedInPeriod === 0) {
    revCand = { name: COMP_REVISION_BURDEN, included: false, raw: 0, reason: 'tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' };
  } else {
    const avgRev = revisionSum / approvedInPeriod;
    revCand = { name: COMP_REVISION_BURDEN, included: true, raw: 100 - Math.min(avgRev * 20, 100), reason: '' };
  }
  return { taskCand, revCand };
}

/** taskTransitions reads a Task's immutable transition log as ascending {to, at}. */
async function taskTransitions(sql: Queryable, entityType: string, id: string): Promise<Transition[]> {
  const rows = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = ${entityType} and entity_id = ${id} order by id asc`;
  const out: Transition[] = [];
  for (const r of rows) {
    const to = transitionTarget(r.action);
    if (to !== null) {
      out.push({ to, at: r.created_at });
    }
  }
  return out;
}

/** transitionTarget extracts B from a "transition:A->B" audit action. */
function transitionTarget(action: string): string | null {
  const prefix = 'transition:';
  if (!action.startsWith(prefix)) {
    return null;
  }
  const idx = action.indexOf('->', prefix.length);
  return idx < 0 ? null : action.slice(idx + 2);
}

/** complaintsCandidate: 100 − Σ severity penalty (Rule 5). Always available (0 complaints → 100). */
async function complaintsCandidate(sql: Queryable, clientId: string, per: Period): Promise<Candidate> {
  const rows = await sql<{ severity: string }[]>`
    select severity from complaints
     where client_id = ${clientId} and created_at >= ${per.startUTC} and created_at < ${per.endUTC}`;
  let penalty = 0;
  for (const r of rows) {
    if (r.severity === 'Low') {
      penalty += PENALTY_LOW;
    } else if (r.severity === 'Medium') {
      penalty += PENALTY_MEDIUM;
    } else if (r.severity === 'High') {
      penalty += PENALTY_HIGH;
    }
  }
  return { name: COMP_COMPLAINTS, included: true, raw: 100 - penalty, reason: '' };
}

/** paymentCandidate: % of Installments due in the period that never triggered [Jatuh Tempo] (Rule 5). */
async function paymentCandidate(sql: Queryable, clientId: string, per: Period): Promise<Candidate> {
  const rows = await sql<{ id: string }[]>`
    select i.id from installments i
      join transactions t on t.id = i.transaction_id
     where t.client_id = ${clientId} and i.due_date is not null
       and i.due_date between ${per.startDate} and ${per.endDate}`;
  if (rows.length === 0) {
    return { name: COMP_PAYMENT_TIMELINESS, included: false, raw: 0, reason: 'tidak ada tagihan jatuh tempo pada periode — dikecualikan + bobot didistribusi ulang' };
  }
  let overdue = 0;
  for (const r of rows) {
    if (await installmentEverOverdue(sql, r.id)) {
      overdue++;
    }
  }
  const timely = rows.length - overdue;
  return { name: COMP_PAYMENT_TIMELINESS, included: true, raw: (timely / rows.length) * 100, reason: '' };
}

/** installmentEverOverdue reports whether an installment ever transitioned INTO [Jatuh Tempo]. */
async function installmentEverOverdue(sql: Queryable, instId: string): Promise<boolean> {
  const rows = await sql<{ action: string }[]>`
    select action from audit_log where entity_type = 'installment' and entity_id = ${instId}`;
  for (const r of rows) {
    if (transitionTarget(r.action) === INSTALLMENT_OVERDUE_STATUS) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Compute + snapshot (snapshot.go).
// ---------------------------------------------------------------------------

interface Computed {
  components: Component[];
  finalScore: number | null;
  band: string;
  roasState: boolean;
}

/** computeFor gathers inputs and runs the pure scoring core for one Client + period. */
async function computeFor(sql: Queryable, clientId: string, per: Period): Promise<Computed> {
  const { cands, roasState } = await gatherComponents(sql, clientId, per);
  const { components, finalScore, band, scoreOk } = score(cands);
  return { components, finalScore: scoreOk ? finalScore : null, band, roasState };
}

function scoreDisplay(final: number | null): string {
  return final === null ? '—' : final.toFixed(2);
}

/**
 * Service is the M13 surface. `catalog` toggles the band-drop emission (Rule 12):
 * when unset it is a no-op (unit tests without notification wiring).
 */
export interface Service {
  catalog: boolean;
}

/**
 * runScan is the authorised snapshot-sweep entry point (Account any level or Director,
 * mirrors finance/creative scan gates). Delegates to runSnapshotJob.
 */
export async function runScan(sql: Sql, actor: Actor, now: Date): Promise<ScanResult> {
  if (!canRunScan(actor)) {
    throw new ScanForbiddenError();
  }
  return runSnapshotJob(sql, now);
}

/**
 * runSnapshotJob is the monthly batch (§5.2): it scores every Client for the
 * most-recently CLOSED calendar month and writes one immutable snapshot each.
 * Idempotent — a Client that already has a snapshot for the period is skipped, so the
 * job is safe to re-run (dashboard load OR nightly cron). Each Client is scored +
 * inserted in its own row-locked transaction (UNIQUE key + re-check).
 */
export async function runSnapshotJob(sql: Sql, now: Date): Promise<ScanResult> {
  const per = closedMonthPeriod(now);
  const res: ScanResult = { period: per.id, snapshotsMade: 0, bandDropsFlagged: 0 };
  const clients = await sql<{ id: string }[]>`select id from clients`;
  for (const { id } of clients) {
    const { made, dropped } = await fireSnapshot(sql, id, per);
    if (made) {
      res.snapshotsMade++;
    }
    if (dropped) {
      res.bandDropsFlagged++;
    }
  }
  return res;
}

/**
 * fireSnapshot scores one Client for the period and inserts an immutable snapshot if
 * none exists yet (fire-once). It locks the client row so concurrent sweeps serialise
 * per client; the UNIQUE(client_id, period_start) key is the ultimate idempotency
 * guard. Band-drop emission (Rule 12) happens inside the SAME transaction as the
 * insert, so it is naturally fire-once.
 */
async function fireSnapshot(sql: Sql, clientId: string, per: Period): Promise<{ made: boolean; dropped: boolean }> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Serialise per-client snapshot creation.
    const lock = await tx<{ id: string }[]>`select id from clients where id = ${clientId} for update`;
    if (lock.length === 0) {
      return { made: false, dropped: false }; // client vanished — skip
    }
    // Already snapshotted for this period? Idempotent no-op.
    const existing = await tx<{ id: string }[]>`
      select id from client_health_snapshots where client_id = ${clientId} and period_start = ${per.startDate}`;
    if (existing.length > 0) {
      return { made: false, dropped: false };
    }

    const c = await computeFor(tx, clientId, per);
    const prev = await previousBand(tx, clientId, per.startDate);
    const id = await ex.ident.identNext(CHR_PREFIX, per.startUTC);

    await tx`
      insert into client_health_snapshots
        (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${id}, ${clientId}, ${per.startDate}, ${per.endDate}, ${c.finalScore}, ${c.band},
        ${c.roasState}, ${JSON.stringify(c.components)}, 'system')`;

    // Band drop (Rule 12): a strictly lower band than the previous snapshot → SPV flag.
    let dropped = false;
    if (prev !== null && c.band !== '' && bandRank(c.band) < bandRank(prev)) {
      await emitBandDrop(tx, id);
      dropped = true;
    }
    return { made: true, dropped };
  });
}

/** emitBandDrop fires EvClientBandDrop (§Rule 12; catalog resolver leadsOfDivision → Account leads). */
async function emitBandDrop(tx: Queryable, snapshotId: string): Promise<void> {
  const ex = executors(tx);
  await notification.emit(ex.notify, {
    event: notification.EVENTS.ClientBandDrop,
    entityType: 'client_health_snapshot',
    entityId: snapshotId,
    actor: 'system',
    division: ACCOUNT_DIVISION,
  });
}

/** previousBand returns the band of the Client's most recent snapshot strictly before periodStart. */
async function previousBand(sql: Queryable, clientId: string, periodStart: string): Promise<string | null> {
  const rows = await sql<{ band: string }[]>`
    select band from client_health_snapshots
     where client_id = ${clientId} and period_start < ${periodStart}
     order by period_start desc limit 1`;
  return rows.length === 0 ? null : rows[0].band;
}

// ---------------------------------------------------------------------------
// Reads (Rule 9 trend, Rule 10 preview, Rule 11 visibility).
// ---------------------------------------------------------------------------

/** trend returns every stored snapshot for a Client, oldest first (Rule 9). Visibility gated. */
export async function trend(sql: Queryable, actor: Actor, clientId: string): Promise<Snapshot[]> {
  await assertCanView(sql, actor, clientId);
  const rows = await sql<SnapshotRow[]>`
    select id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_at, computed_by
      from client_health_snapshots where client_id = ${clientId} order by period_start asc`;
  return rows.map(rowToSnapshot);
}

/**
 * getSnapshot returns one stored snapshot. `periodId` ("YYYYMM") picks a month; empty
 * picks the latest. Visibility gated (Rule 11). NotFound when absent/invisible.
 */
export async function getSnapshot(sql: Queryable, actor: Actor, clientId: string, periodId: string): Promise<Snapshot> {
  await assertCanView(sql, actor, clientId);
  const pid = (periodId ?? '').trim();
  const rows = await sql<SnapshotRow[]>`
    select id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_at, computed_by
      from client_health_snapshots
     where client_id = ${clientId}
       ${pid !== '' ? sql`and to_char(period_start, 'YYYYMM') = ${pid}` : sql``}
     order by period_start desc limit 1`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return rowToSnapshot(rows[0]);
}

/** preview computes the CURRENT, not-yet-closed month read-only (Rule 10). Never stored. Visibility gated. */
export async function preview(sql: Queryable, actor: Actor, clientId: string, now: Date): Promise<Snapshot> {
  await assertCanView(sql, actor, clientId);
  const per = monthPeriod(now);
  const c = await computeFor(sql, clientId, per);
  return {
    id: '', clientId, periodStart: per.startDate, periodEnd: per.endDate,
    finalHealthScore: c.finalScore, scoreDisplay: scoreDisplay(c.finalScore), band: c.band,
    roasToggleState: c.roasState, components: c.components, computedAt: null, computedBy: '', preview: true,
  };
}

interface SnapshotRow {
  id: string;
  client_id: string;
  period_start: string | Date;
  period_end: string | Date;
  final_health_score: string | null;
  band: string;
  roas_toggle_state: boolean;
  components_json: Component[] | string;
  computed_at: Date;
  computed_by: string;
}

function rowToSnapshot(r: SnapshotRow): Snapshot {
  const final = r.final_health_score === null ? null : Number(r.final_health_score);
  const comps = typeof r.components_json === 'string' ? (JSON.parse(r.components_json) as Component[]) : r.components_json;
  return {
    id: r.id, clientId: r.client_id, periodStart: dateStr(r.period_start), periodEnd: dateStr(r.period_end),
    finalHealthScore: final, scoreDisplay: scoreDisplay(final), band: r.band, roasToggleState: r.roas_toggle_state,
    components: comps ?? [], computedAt: r.computed_at, computedBy: r.computed_by, preview: false,
  };
}

// ---------------------------------------------------------------------------
// ROAS Inclusion Toggle (roas.go, Rule 13 / §5.4).
// ---------------------------------------------------------------------------

/** getRoasToggle returns a Client's ROAS toggle state. Read-gated (Rule 11). */
export async function getRoasToggle(sql: Queryable, actor: Actor, clientId: string): Promise<RoasToggle> {
  await assertCanView(sql, actor, clientId);
  return readToggle(sql, clientId);
}

/**
 * setRoasToggle sets (override non-null) or clears (null → default) the per-Client
 * ROAS toggle (Rule 13 / §5.4). Write-gated: AM/SPV or Director (OD read-only); an AM
 * may only toggle a client in its own book. Appended to the immutable audit_log
 * (before→after); it affects the NEXT run, never an existing snapshot.
 */
export async function setRoasToggle(sql: Sql, actor: Actor, clientId: string, override: boolean | null): Promise<RoasToggle> {
  if (!canToggleRoas(actor)) {
    throw new ForbiddenError();
  }
  const ownerAM = await clientOwnerAm(sql, clientId);
  if (!canView(actor, ownerAM)) {
    throw new NotFoundError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ roas_health_included_override: boolean | null }[]>`
      select roas_health_included_override from clients where id = ${clientId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const before = rows[0].roas_health_included_override;
    await tx`update clients set roas_health_included_override = ${override} where id = ${clientId}`;
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId, action: 'roas_health_toggle_set',
      beforeJson: { override: before }, afterJson: { override }, createdBy: actor.employeeId,
    });
    return readToggle(tx, clientId);
  });
}

/** readToggle resolves a Client's toggle against the current Ads-service presence. */
async function readToggle(sql: Queryable, clientId: string): Promise<RoasToggle> {
  const rows = await sql<{ roas_health_included_override: boolean | null }[]>`
    select roas_health_included_override from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const override = rows[0].roas_health_included_override;
  const { hasAny, hasActive } = await adsServicePresence(sql, clientId);
  let effective = false;
  if (hasAny) {
    effective = override === null ? hasActive : override;
  }
  return { clientId, override, hasAds: hasAny, hasActive, effective };
}

// ---------------------------------------------------------------------------
// Authorization (service.go, §Rule 11).
// ---------------------------------------------------------------------------

/** canView: AM own clients / Account lead division-wide / OD read / Director full (Rule 11). */
export function canView(actor: Actor, ownerAM: string): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  if (actor.role.division === ACCOUNT_DIVISION) {
    if (actor.role.level === permission.LevelLead) {
      return true;
    }
    return actor.employeeId === ownerAM;
  }
  return false;
}

/** canScope: any M13 read scope (Account / OD / Director). */
export function canScope(actor: Actor): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  return actor.role.division === ACCOUNT_DIVISION;
}

/** canRunScan: Account (any level) or Director; a pure-OD account is read-only. */
export function canRunScan(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  return a.role.division === ACCOUNT_DIVISION && !a.role.od;
}

/** canToggleRoas: AM/SPV or Director; OD read-only (per-client ownership checked by caller). */
export function canToggleRoas(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  if (a.role.od) {
    return false;
  }
  return a.role.division === ACCOUNT_DIVISION;
}

/** assertCanView applies the Rule 11 gate: no scope → Forbidden; absent/invisible → NotFound. */
async function assertCanView(sql: Queryable, actor: Actor, clientId: string): Promise<void> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const ownerAM = await clientOwnerAm(sql, clientId);
  if (!canView(actor, ownerAM)) {
    throw new NotFoundError();
  }
}

/** clientOwnerAm loads a Client's current assigned AM. NotFound when the client is absent. */
async function clientOwnerAm(sql: Queryable, clientId: string): Promise<string> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return rows[0].assigned_am_id ?? '';
}

// --- helpers ---

function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
