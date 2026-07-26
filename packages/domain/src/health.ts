/**
 * Client Health domain service (M13). Ported from Go's
 * `internal/module13_health/*`.
 *
 * M13 is a pure AGGREGATION and scoring layer (§1): it introduces no new raw
 * data, only a weighted 0–100 Health Score per Client, computed from data that
 * already lives in Modules 4 (GMV), 5 (payment), 6 (complaints), 8 (ROAS) and 12
 * (task completion / revision count).
 *
 * The month boundary produces one immutable snapshot per Client (CHR-, §5.1); the
 * current not-yet-closed month is available as a read-only live preview that is
 * never stored (Rule 10). Everything a snapshot persists is recomputable from the
 * immutable event/timestamp logs of the source modules (house rule 4).
 *
 * Layers, mirroring the Go files:
 *   - the PURE scoring core (`score` / `bandFor`) — the seven components, the
 *     confirmed weights (Rule 3), the missing-component proportional redistribution
 *     (Rule 4), the 0–100 capping (Rule 5/6) and band assignment (Rule 7); no DB;
 *   - `gatherComponents` + the per-component gatherers — the DB reads (§5);
 *   - the monthly batch sweep + immutable persistence + live preview + trend reads;
 *   - the per-Client ROAS Inclusion Toggle (Rule 13 / §5.4).
 *
 * Reference: backend/internal/module13_health/{health,compute,roas,snapshot,service}.go.
 */

import { money, notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { computeMetrics, type Transition } from './task';
import { parseRoasTarget } from './ads';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The Account division owns the M13 view (§Rule 11). */
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Component names (§2 Rule 2). Stable string keys — persisted in components_json
// and surfaced in the API, so they never change.
// ---------------------------------------------------------------------------
export const COMP_GMV_GROWTH = 'gmv_growth';
export const COMP_ROAS_ATTAINMENT = 'roas_attainment';
export const COMP_TASK_COMPLETION = 'task_completion';
export const COMP_REVISION_BURDEN = 'revision_burden';
export const COMP_COMPLAINTS = 'complaints';
export const COMP_SATISFACTION = 'satisfaction';
export const COMP_PAYMENT_TIMELINESS = 'payment_timeliness';

/** Confirmed component weights (§2 Rule 3 / §6 OA-1), out of 100. Sum to exactly 100. */
const BASE_WEIGHTS: Record<string, number> = {
  [COMP_GMV_GROWTH]: 25,
  [COMP_ROAS_ATTAINMENT]: 25,
  [COMP_TASK_COMPLETION]: 10,
  [COMP_REVISION_BURDEN]: 10,
  [COMP_COMPLAINTS]: 10,
  [COMP_SATISFACTION]: 10,
  [COMP_PAYMENT_TIMELINESS]: 10,
};

/** Bands (§2 Rule 7 / §6 OA-2). */
export const BAND_HEALTHY = 'Healthy'; // 80–100
export const BAND_WATCH = 'Watch'; // 60–79
export const BAND_AT_RISK = 'At Risk'; // below 60

// Severity penalties for the Complaints component (§2 Rule 5 / §6 OA-4, using
// Module 6's 3-tier scale). Working defaults (§2 Rule 5).
const PENALTY_LOW = 5;
const PENALTY_MEDIUM = 15;
const PENALTY_HIGH = 30;

/** module8_ads' launched status — a Client "has an active Ads service" (Rule 13) when it has ≥1. */
const AD_CAMPAIGN_ACTIVE_STATUS = '[Active]';
/** module5_finance's overdue label — an installment that ever entered it broke Payment Timeliness. */
const INSTALLMENT_OVERDUE_STATUS = '[Jatuh Tempo]';
/** An Ads Brief runs the canonical Task machine, so its briefs count directly in Task Completion. */
const ADS_BRIEF_DIVISION = 'Ads';

/** House-ID prefix for a Client Health Report Snapshot (DATA_MODEL §1). */
const CHR_PREFIX = 'CHR';

const WIB_OFFSET_MS = tz.WIB_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Verbatim BI messages (M13). Each mirrors a Go sentinel 1:1 (service.go).
// ---------------------------------------------------------------------------

/** The actor's role has no M13 access at all (shared access-denied string). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
/** The Client/snapshot does not exist OR is not visible (invisible-but-existing → not-found). */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** The actor may not trigger the monthly snapshot sweep (W1-09 precedent). */
export const MSG_SCAN_FORBIDDEN =
  '[anda tidak memiliki akses untuk menjalankan pemindaian skor kesehatan klien]';

/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'HealthForbiddenError';
  }
}
/** The Client (or snapshot) does not exist OR is invisible to the actor (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'HealthNotFoundError';
  }
}
/** The actor may not run the monthly snapshot sweep (→ 403). */
export class ScanForbiddenError extends Error {
  constructor(message = MSG_SCAN_FORBIDDEN) {
    super(message);
    this.name = 'HealthScanForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Permission predicates (service.go). Pure — no DB access.
// ---------------------------------------------------------------------------

/**
 * canView reports whether the actor may see a Client's health data (§2 Rule 11):
 * AM = own assigned clients; Account lead/SPV = division-wide; OD = read-only
 * everywhere; Director = full. Every other role is denied.
 */
export function canView(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director || actor.role.od) {
    return true; // Director full; OD read-only everywhere
  }
  if (actor.role.division === ACCOUNT_DIVISION) {
    if (actor.role.level === permission.LevelLead) {
      return true; // Account lead/SPV: division-wide
    }
    return actor.employeeId === ownerAm; // Account staff (AM): own assigned clients only
  }
  return false;
}

/** canScope reports whether the actor has ANY M13 read scope (Account/OD/Director). */
export function canScope(actor: Actor): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  return actor.role.division === ACCOUNT_DIVISION;
}

/**
 * canRunScan authorises the on-demand snapshot sweep: Account (any level) or
 * Director. Mirrors finance.canRunScan — the division that OWNS the dashboard
 * triggers its own sweep; a pure-OD account is read-only and cannot run it.
 */
export function canRunScan(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === ACCOUNT_DIVISION && !actor.role.od;
}

/**
 * canToggleROAS authorises setting the per-Client ROAS Inclusion Toggle (Rule 13 /
 * §5.4): AM/SPV (Account staff or lead) or Director. OD is read-only. The
 * per-client ownership check is done by the caller via canView.
 */
export function canToggleROAS(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.od) {
    return false;
  }
  return actor.role.division === ACCOUNT_DIVISION;
}

// ---------------------------------------------------------------------------
// Pure scoring core (health.go).
// ---------------------------------------------------------------------------

/**
 * One scored (or excluded) component of the Health Score. `raw` is the UNCAPPED
 * sub-metric kept for diagnosis (Rule 6); `capped` is the [0,100] value used in
 * the composite (Rule 5). When `included` is false the component contributed
 * nothing and its weight was redistributed (Rule 4) — raw/capped are then null
 * and `excludedReason` explains why (§5.6).
 */
export interface Component {
  name: string;
  included: boolean;
  raw: number | null; // uncapped; null when excluded
  capped: number | null; // clamp(raw,0,100); null when excluded
  baseWeight: number; // Rule 3 confirmed weight (out of 100)
  effectiveWeight: number; // post-redistribution weight (out of 100); 0 when excluded
  excludedReason?: string;
}

/** Raw pre-scoring input for one component (compute builds these). Exported for the pure-core tests. */
export interface Candidate {
  name: string;
  included: boolean;
  raw: number;
  reason: string;
}

function included(name: string, raw: number): Candidate {
  return { name, included: true, raw, reason: '' };
}
function excluded(name: string, reason: string): Candidate {
  return { name, included: false, raw: 0, reason };
}

/** clampTo100 caps a value to the [0,100] sub-score range (Rule 5 header). */
function clampTo100(v: number): number {
  if (v > 100) {
    return 100;
  }
  if (v < 0) {
    return 0;
  }
  return v;
}

/**
 * bandRank orders the bands so a month-over-month DROP (Rule 12) is a strictly
 * decreasing rank. Higher = healthier.
 */
function bandRank(band: string): number {
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

/**
 * bandFor assigns the band from a final score (Rule 7). Boundaries are inclusive
 * at the bottom of the healthier band: >=80 Healthy, >=60 Watch, else At Risk.
 */
export function bandFor(score: number): string {
  if (score >= 80) {
    return BAND_HEALTHY;
  }
  if (score >= 60) {
    return BAND_WATCH;
  }
  return BAND_AT_RISK;
}

/** The finished output of scoring one Client + period. */
export interface ScoreResult {
  components: Component[];
  /** null in the defensive all-excluded case — renders "—" (house rule 7), no band. */
  finalScore: number | null;
  band: string;
}

/**
 * score turns the per-component candidates into the finished Component list plus
 * the final weighted Health Score (0–100) and its band (Rules 3–7).
 *
 * Redistribution (Rule 4): the base weights of the AVAILABLE components are
 * re-normalised to sum to 100 — each scaled by 100/Σ(available base weights) — so
 * an excluded component is never scored as 0 or 100. Excluded components keep
 * effectiveWeight 0. finalScore is null only in the defensive all-excluded case.
 */
export function score(cands: Candidate[]): ScoreResult {
  let availableBase = 0;
  for (const c of cands) {
    if (c.included) {
      availableBase += BASE_WEIGHTS[c.name] ?? 0;
    }
  }

  const components: Component[] = [];
  let weighted = 0;
  for (const c of cands) {
    const base = BASE_WEIGHTS[c.name] ?? 0;
    if (c.included && availableBase > 0) {
      const capped = clampTo100(c.raw);
      const eff = (base * 100) / availableBase;
      components.push({
        name: c.name, included: true, raw: c.raw, capped, baseWeight: base, effectiveWeight: eff,
      });
      weighted += (eff / 100) * capped;
    } else {
      components.push({
        name: c.name, included: false, raw: null, capped: null, baseWeight: base, effectiveWeight: 0,
        excludedReason: c.reason,
      });
    }
  }

  if (availableBase === 0) {
    return { components, finalScore: null, band: '' };
  }
  // Guard against float dust just past 100/0 from the re-normalisation.
  let finalScore = Math.round(weighted * 1000) / 1000;
  if (finalScore > 100) {
    finalScore = 100;
  }
  if (finalScore < 0) {
    finalScore = 0;
  }
  return { components, finalScore, band: bandFor(finalScore) };
}

// ---------------------------------------------------------------------------
// Period math (compute.go). One scored WIB calendar month (O20).
// ---------------------------------------------------------------------------

interface Period {
  start: Date; // WIB midnight, first day of month (an absolute instant)
  startDate: string; // first day, "YYYY-MM-DD" (inclusive DATE lower bound)
  endDate: string; // last day, "YYYY-MM-DD" (inclusive DATE upper bound)
  startUtc: Date; // start instant (inclusive) for DATETIME columns
  endUtc: Date; // next-month start instant (exclusive)
  approvedTag: string; // "YYYY-MM" — compared against computeMetrics' approvedPeriodWib
  id: string; // "YYYYMM" — CHR- id month bucket
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** monthPeriod builds the Period for the WIB calendar month that contains anchor. */
function monthPeriod(anchor: Date): Period {
  const shifted = new Date(anchor.getTime() + WIB_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth(); // 0-based
  const start = new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS);
  const next = new Date(Date.UTC(y, m + 1, 1) - WIB_OFFSET_MS);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = pad2(m + 1);
  return {
    start,
    startDate: `${y}-${mm}-01`,
    endDate: `${y}-${mm}-${pad2(lastDay)}`,
    startUtc: start,
    endUtc: next,
    approvedTag: `${y}-${mm}`,
    id: `${y}${mm}`,
  };
}

/**
 * closedMonthPeriod is the most-recently CLOSED calendar month relative to now
 * (WIB) — i.e. the previous month. The monthly batch scores exactly this period
 * (§3 / §5.2).
 */
function closedMonthPeriod(now: Date): Period {
  const thisMonthStart = monthPeriod(now).start;
  return monthPeriod(new Date(thisMonthStart.getTime() - DAY_MS));
}

/**
 * firstFullMonthStart is the WIB first-of-month of the Client's first FULL calendar
 * month (Rule 8 grace). Onboarded on day 1 → that month is the first full month;
 * onboarded mid-month → the following month.
 */
function firstFullMonthStart(createdAt: Date): Date {
  const shifted = new Date(createdAt.getTime() + WIB_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const monthStart = new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS);
  if (day === 1) {
    return monthStart;
  }
  return new Date(Date.UTC(y, m + 1, 1) - WIB_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Component gatherers (compute.go). Each draws from an already-existing module.
// ---------------------------------------------------------------------------

interface ClientInputs {
  baselineCents: number;
  targetCents: number;
  currentCents: number;
  createdAt: Date;
  roasOverride: boolean | null; // null = follow default; else explicit toggle
}

/** loadClientInputs reads the Client's GMV numbers, onboarding timestamp and ROAS override. */
async function loadClientInputs(q: Queryable, clientId: string): Promise<ClientInputs> {
  const rows = await q<
    { gmv_baseline: string; target_gmv: string; total_sales: string; created_at: Date; roas_health_included_override: boolean | null }[]
  >`
    select gmv_baseline, target_gmv, total_sales, created_at, roas_health_included_override
      from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    baselineCents: Number(money.parse(r.gmv_baseline)),
    targetCents: Number(money.parse(r.target_gmv)),
    currentCents: Number(money.parse(r.total_sales)),
    createdAt: r.created_at,
    roasOverride: r.roas_health_included_override,
  };
}

/**
 * gatherComponents assembles the seven component candidates for one Client and
 * period, plus the effective ROAS-inclusion toggle state recorded on the snapshot
 * (Rule 13 / §5.1). Single source of truth shared by the sweep, get and preview.
 */
async function gatherComponents(
  q: Queryable,
  clientId: string,
  per: Period,
): Promise<{ cands: Candidate[]; roasState: boolean }> {
  const ci = await loadClientInputs(q, clientId);
  const cands: Candidate[] = [];

  // --- GMV Growth (Module 4) — Rule 5 + grace Rule 8 ---
  const grace = per.start.getTime() <= firstFullMonthStart(ci.createdAt).getTime();
  cands.push(gmvCandidate(ci, grace));

  // --- ROAS Attainment (Module 8) — Rule 5 + toggle Rule 13 ---
  const roas = await roasCandidate(q, clientId, per, ci.roasOverride);
  cands.push(roas.cand);

  // --- Task Completion + Revision Burden (Module 12) — Rule 5 ---
  const tasks = await taskCandidates(q, clientId, per);
  cands.push(tasks.task, tasks.revision);

  // --- Complaints (Module 6) — Rule 5 (always available; 0 complaints = 100) ---
  cands.push(await complaintsCandidate(q, clientId, per));

  // --- Satisfaction — ALWAYS N/A until Module 15 (Rule 2 / §5.5). Never proxied. ---
  cands.push(excluded(COMP_SATISFACTION, 'placeholder — Module 15 (CSAT/Client Portal) belum ada'));

  // --- Payment Timeliness (Module 5) — Rule 5 ---
  cands.push(await paymentCandidate(q, clientId, per));

  return { cands, roasState: roas.roasState };
}

/**
 * gmvCandidate implements GMV Growth (Rule 5): (Current−Baseline)/(Target−Baseline)×100.
 * Excluded during the first-full-month grace (Rule 8) or when Target==Baseline
 * (zero denominator → excluded + redistributed, not an error).
 */
function gmvCandidate(ci: ClientInputs, grace: boolean): Candidate {
  if (grace) {
    return excluded(
      COMP_GMV_GROWTH,
      'grace period klien baru — GMV Growth dikecualikan pada bulan penuh pertama (Rule 8)',
    );
  }
  const denom = ci.targetCents - ci.baselineCents;
  if (denom === 0) {
    return excluded(
      COMP_GMV_GROWTH,
      'Target GMV sama dengan Baseline GMV — pembagi nol, dikecualikan + bobot didistribusi ulang',
    );
  }
  const raw = ((ci.currentCents - ci.baselineCents) / denom) * 100;
  return included(COMP_GMV_GROWTH, raw);
}

/**
 * roasCandidate implements ROAS Attainment (Rule 5) with the toggle (Rule 13) and
 * returns the EFFECTIVE toggle state persisted on the snapshot.
 *
 * Effective inclusion = hasAnyAds && coalesce(override, hasActiveAds):
 *   - No Ads campaign at all → structurally N/A regardless of toggle (Rule 13).
 *   - Explicit override present → obey it (team toggled ON/OFF).
 *   - Otherwise default = the Client has an ACTIVE ([Active]) campaign (Rule 13).
 * Even when included, no metric data in the period (Σ spend == 0) or no parseable
 * ROAS target excludes it as a missing-data case (redistribute).
 */
async function roasCandidate(
  q: Queryable,
  clientId: string,
  per: Period,
  override: boolean | null,
): Promise<{ cand: Candidate; roasState: boolean }> {
  const { hasAny, hasActive } = await adsServicePresence(q, clientId);
  if (!hasAny) {
    // No Ads service at all — structurally N/A (Rule 13). Toggle irrelevant.
    return {
      cand: excluded(COMP_ROAS_ATTAINMENT, 'klien tidak memiliki layanan Ads — ROAS N/A struktural (Rule 13)'),
      roasState: false,
    };
  }
  const toggleOn = override !== null ? override : hasActive;
  if (!toggleOn) {
    return {
      cand: excluded(COMP_ROAS_ATTAINMENT, 'ROAS dimatikan oleh toggle tim (Rule 13)'),
      roasState: false,
    };
  }

  const cur = await currentPeriodROAS(q, clientId, per);
  if (cur === null) {
    return {
      cand: excluded(
        COMP_ROAS_ATTAINMENT,
        'tidak ada data metrik ROAS pada periode — dikecualikan + bobot didistribusi ulang',
      ),
      roasState: true,
    };
  }
  const target = await aggregateTargetROAS(q, clientId);
  if (target === null) {
    return {
      cand: excluded(
        COMP_ROAS_ATTAINMENT,
        'target ROAS tidak dapat diparse dari Target KPI — dikecualikan + bobot didistribusi ulang',
      ),
      roasState: true,
    };
  }
  return { cand: included(COMP_ROAS_ATTAINMENT, (cur / target) * 100), roasState: true };
}

/** adsServicePresence reports whether the Client has ANY ad campaign, and an ACTIVE one (Rule 13). */
async function adsServicePresence(q: Queryable, clientId: string): Promise<{ hasAny: boolean; hasActive: boolean }> {
  const rows = await q<{ any_n: number; active_n: number }[]>`
    select count(*)::int as any_n,
           count(*) filter (where status = ${AD_CAMPAIGN_ACTIVE_STATUS})::int as active_n
      from ad_campaigns where client_id = ${clientId}`;
  return { hasAny: rows[0].any_n > 0, hasActive: rows[0].active_n > 0 };
}

/**
 * currentPeriodROAS = ΣGMV / ΣSpend over the Client's Metric Entries whose period
 * starts within the snapshot month (across ALL the Client's campaigns). null when
 * there is no spend to divide by (Σ == 0 or no rows) — treated as missing data.
 */
async function currentPeriodROAS(q: Queryable, clientId: string, per: Period): Promise<number | null> {
  const rows = await q<{ spend: string | null; gmv: string | null }[]>`
    select sum(m.spend) as spend, sum(m.gmv) as gmv
      from metric_entries m join ad_campaigns c on c.id = m.campaign_id
     where c.client_id = ${clientId} and m.period_start between ${per.startDate}::date and ${per.endDate}::date`;
  const { spend, gmv } = rows[0];
  if (spend === null || gmv === null) {
    return null;
  }
  const sp = Number(money.parse(spend));
  if (sp === 0) {
    return null; // div-zero → treated as missing data (house rule 7)
  }
  return Number(money.parse(gmv)) / sp;
}

/**
 * aggregateTargetROAS parses each of the Client's campaigns' Target KPI (free text)
 * via module8_ads' parser and returns the MEAN of the parseable ROAS targets. null
 * when none parse — treated as missing data (mirrors module8_ads' no-false-escalation).
 */
async function aggregateTargetROAS(q: Queryable, clientId: string): Promise<number | null> {
  const rows = await q<{ target_kpi: string }[]>`select target_kpi from ad_campaigns where client_id = ${clientId}`;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = parseRoasTarget(r.target_kpi);
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  if (n === 0) {
    return null;
  }
  return sum / n;
}

/**
 * taskCandidates computes Task Completion Rate and Revision Burden (Module 12,
 * Rule 5) over the Client's canonical Tasks that reached [Approved] IN the period.
 *
 *   - Task Completion = % of period-approved Tasks WITH an SLA whose Speed Score
 *     ≤ 100% (within SLA). Tasks without an SLA are excluded from the ratio; if
 *     none had an SLA, the component is excluded (redistribute).
 *   - Revision Burden = 100 − min(avg Revision Count × 20, 100), over the same set;
 *     excluded when no Task closed in the period.
 *
 * Every metric is recomputed from the immutable transition log (house rule 4) via
 * task.computeMetrics — the same pure core M12 uses.
 */
async function taskCandidates(
  q: Queryable,
  clientId: string,
  per: Period,
): Promise<{ task: Candidate; revision: Candidate }> {
  interface TaskRow {
    entityType: 'asset' | 'brief';
    id: string;
    sla: number | null;
  }
  const tasks: TaskRow[] = [];

  // Creative Assets of the Client (asset entities).
  const assetRows = await q<{ id: string; sla_target_hours: string | null }[]>`
    select a.id, a.sla_target_hours
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId}`;
  for (const a of assetRows) {
    tasks.push({ entityType: 'asset', id: a.id, sla: a.sla_target_hours === null ? null : Number(a.sla_target_hours) });
  }

  // Ads Briefs-as-task of the Client.
  const briefRows = await q<{ id: string; sla_target_hours: string | null }[]>`
    select b.id, b.sla_target_hours
      from briefs b
      join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId} and b.assigned_division = ${ADS_BRIEF_DIVISION}`;
  for (const b of briefRows) {
    tasks.push({ entityType: 'brief', id: b.id, sla: b.sla_target_hours === null ? null : Number(b.sla_target_hours) });
  }

  let approvedInPeriod = 0; // denominator for Revision Burden
  let slaJudged = 0; // denominator for Task Completion (has SLA)
  let withinSla = 0; // numerator for Task Completion
  let revisionSum = 0; // for the average revision count

  for (const tr of tasks) {
    const transitions = await taskTransitions(q, tr.entityType, tr.id);
    const m = computeMetrics(transitions, tr.sla);
    if (m.approvedPeriodWib !== per.approvedTag) {
      continue; // not closed in this period
    }
    approvedInPeriod++;
    revisionSum += m.revisionCount;
    if (m.speedScorePct !== null) {
      // has an SLA and is judged
      slaJudged++;
      if (m.speedScorePct <= 100) {
        withinSla++;
      }
    }
  }

  const task =
    slaJudged === 0
      ? excluded(
          COMP_TASK_COMPLETION,
          'tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
        )
      : included(COMP_TASK_COMPLETION, (withinSla / slaJudged) * 100);

  let revision: Candidate;
  if (approvedInPeriod === 0) {
    revision = excluded(
      COMP_REVISION_BURDEN,
      'tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
    );
  } else {
    const avgRev = revisionSum / approvedInPeriod;
    revision = included(COMP_REVISION_BURDEN, 100 - Math.min(avgRev * 20, 100));
  }
  return { task, revision };
}

/**
 * taskTransitions reads a canonical Task's immutable transition log and maps it to
 * the destination label + timestamp, ASCENDING (mirrors task.metricsFor).
 */
async function taskTransitions(q: Queryable, entityType: string, id: string): Promise<Transition[]> {
  const entries = await q<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = ${entityType} and entity_id = ${id} order by id asc`;
  const out: Transition[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      out.push({ to, at: e.created_at });
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

/**
 * complaintsCandidate implements Complaints (Rule 5): 100 − Σ severity penalty,
 * floored at 0 (the [0,100] cap does the floor). Complaints logged in the period =
 * created within the WIB month window. Always available — zero complaints → 100.
 */
async function complaintsCandidate(q: Queryable, clientId: string, per: Period): Promise<Candidate> {
  const rows = await q<{ severity: string }[]>`
    select severity from complaints
     where client_id = ${clientId} and created_at >= ${per.startUtc} and created_at < ${per.endUtc}`;
  let penalty = 0;
  for (const r of rows) {
    switch (r.severity) {
      case 'Low':
        penalty += PENALTY_LOW;
        break;
      case 'Medium':
        penalty += PENALTY_MEDIUM;
        break;
      case 'High':
        penalty += PENALTY_HIGH;
        break;
    }
  }
  return included(COMP_COMPLAINTS, 100 - penalty);
}

/**
 * paymentCandidate implements Payment Timeliness (Rule 5): % of Installments due in
 * the period that never triggered [Jatuh Tempo]. "Due in the period" = due_date
 * within the WIB month. "Never triggered" is recomputed from the immutable
 * transition log (house rule 4). Excluded (redistribute) when none was due.
 */
async function paymentCandidate(q: Queryable, clientId: string, per: Period): Promise<Candidate> {
  const rows = await q<{ id: string }[]>`
    select i.id from installments i
      join transactions t on t.id = i.transaction_id
     where t.client_id = ${clientId} and i.due_date is not null
       and i.due_date between ${per.startDate}::date and ${per.endDate}::date`;
  if (rows.length === 0) {
    return excluded(
      COMP_PAYMENT_TIMELINESS,
      'tidak ada tagihan jatuh tempo pada periode — dikecualikan + bobot didistribusi ulang',
    );
  }
  let overdue = 0;
  for (const r of rows) {
    if (await installmentEverOverdue(q, r.id)) {
      overdue++;
    }
  }
  const timely = rows.length - overdue;
  return included(COMP_PAYMENT_TIMELINESS, (timely / rows.length) * 100);
}

/** installmentEverOverdue reports whether an installment ever transitioned INTO [Jatuh Tempo]. */
async function installmentEverOverdue(q: Queryable, instId: string): Promise<boolean> {
  const entries = await q<{ action: string }[]>`
    select action from audit_log where entity_type = 'installment' and entity_id = ${instId}`;
  for (const e of entries) {
    if (transitionTarget(e.action) === INSTALLMENT_OVERDUE_STATUS) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Snapshot: compute, persist, preview, trend (snapshot.go).
// ---------------------------------------------------------------------------

/**
 * The API view of a Client Health Report — a stored snapshot, or a
 * computed-in-memory live preview (Rule 10). Live previews carry id "" and no
 * computedAt, and are never persisted (`preview: true`).
 */
export interface Snapshot {
  id: string;
  clientId: string;
  periodStart: string;
  periodEnd: string;
  finalHealthScore: number | null;
  scoreDisplay: string; // e.g. "74.56" or "—" (all-excluded, house rule 7)
  band: string;
  roasToggleState: boolean;
  components: Component[];
  computedAt?: Date;
  computedBy?: string;
  preview: boolean; // true for a live, unstored current-month view
}

/** The raw output of scoring one Client + period. */
interface Computed {
  components: Component[];
  finalScore: number | null; // null in the defensive all-excluded case
  band: string;
  roasState: boolean;
}

/**
 * scoreDisplay renders the composite for the UI: two decimals, or "—" when no
 * component was available (house rule 7 division-by-zero rendering).
 */
function scoreDisplay(final: number | null): string {
  return final === null ? '—' : final.toFixed(2);
}

/** computeFor gathers the inputs and runs the pure scoring core for one Client + period. */
async function computeFor(q: Queryable, clientId: string, per: Period): Promise<Computed> {
  const { cands, roasState } = await gatherComponents(q, clientId, per);
  const res = score(cands);
  return { components: res.components, finalScore: res.finalScore, band: res.band, roasState };
}

/** Tally of one runSnapshotJob pass. */
export interface ScanResult {
  period: string;
  snapshotsMade: number;
  bandDropsFlagged: number;
}

/**
 * runScan is the authorised entry point for the snapshot-sweep endpoint. Gate =
 * Account (any level) or Director, mirroring finance.runScan.
 */
export async function runScan(sql: Sql, actor: Actor, now: Date = new Date()): Promise<ScanResult> {
  if (!canRunScan(actor)) {
    throw new ScanForbiddenError();
  }
  return runSnapshotJob(sql, now);
}

/**
 * runSnapshotJob is the monthly batch (§5.2): it scores every Client for the
 * most-recently CLOSED calendar month and writes one immutable snapshot each.
 * Idempotent — a client that already has a snapshot for the period is skipped, so
 * the job is safe to re-run. Each client is scored + inserted in its own row-locked
 * transaction so concurrent runs never double-insert (UNIQUE key + re-check).
 */
export async function runSnapshotJob(sql: Sql, now: Date = new Date()): Promise<ScanResult> {
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
 * fireSnapshot scores one Client for the period and inserts an immutable snapshot
 * if none exists yet (fire-once). It locks the client row so concurrent sweeps
 * serialise per client; the UNIQUE(client_id, period_start) key is the ultimate
 * idempotency guard. Band-drop emission (Rule 12) happens inside the SAME
 * transaction as the insert, so it is naturally fire-once.
 */
async function fireSnapshot(sql: Sql, clientId: string, per: Period): Promise<{ made: boolean; dropped: boolean }> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);

    // Serialise per-client snapshot creation.
    const lock = await tx<{ id: string }[]>`select id from clients where id = ${clientId} for update`;
    if (lock.length === 0) {
      return { made: false, dropped: false }; // client vanished since we listed — skip
    }

    // Already snapshotted for this period? Idempotent no-op.
    const existing = await tx<{ id: string }[]>`
      select id from client_health_snapshots where client_id = ${clientId} and period_start = ${per.startDate}::date`;
    if (existing.length > 0) {
      return { made: false, dropped: false };
    }

    const c = await computeFor(tx, clientId, per);

    // Previous snapshot's band (most recent earlier period) for the drop check.
    const prev = await previousBand(tx, clientId, per.startDate);

    const id = await ex.ident.identNext(CHR_PREFIX, per.start);
    await tx`
      insert into client_health_snapshots
        (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${id}, ${clientId}, ${per.startDate}::date, ${per.endDate}::date, ${c.finalScore},
              ${c.band}, ${c.roasState}, ${tx.json(c.components as never)}, 'system')`;

    // Band drop (Rule 12): a strictly lower band than the previous snapshot →
    // visibility flag to SPV (no gate). Fire-once by construction (one insert).
    let dropped = false;
    if (prev !== null && c.band !== '' && bandRank(c.band) < bandRank(prev)) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.ClientBandDrop,
        entityType: 'client_health_snapshot',
        entityId: id,
        actor: 'system',
        division: ACCOUNT_DIVISION,
      });
      dropped = true;
    }
    return { made: true, dropped };
  });
}

/**
 * previousBand returns the band of the Client's most recent snapshot strictly
 * before periodStart (the trend-continuity comparison for Rule 12). null when none.
 */
async function previousBand(q: Queryable, clientId: string, periodStart: string): Promise<string | null> {
  const rows = await q<{ band: string }[]>`
    select band from client_health_snapshots
     where client_id = ${clientId} and period_start < ${periodStart}::date
     order by period_start desc limit 1`;
  return rows.length === 0 ? null : rows[0].band;
}

const SNAPSHOT_COLS = `id, client_id,
  to_char(period_start, 'YYYY-MM-DD') as period_start,
  to_char(period_end, 'YYYY-MM-DD') as period_end,
  final_health_score, band, roas_toggle_state, components_json, computed_at, computed_by`;

interface SnapshotDbRow {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  final_health_score: string | null;
  band: string;
  roas_toggle_state: boolean;
  components_json: Component[] | null;
  computed_at: Date;
  computed_by: string;
}

/** scanSnapshot maps one persisted snapshot row to the API Snapshot shape. */
function scanSnapshot(r: SnapshotDbRow): Snapshot {
  const finalHealthScore = r.final_health_score === null ? null : Number(r.final_health_score);
  return {
    id: r.id,
    clientId: r.client_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    finalHealthScore,
    scoreDisplay: scoreDisplay(finalHealthScore),
    band: r.band,
    roasToggleState: r.roas_toggle_state,
    components: r.components_json ?? [],
    computedAt: r.computed_at,
    computedBy: r.computed_by,
    preview: false,
  };
}

/**
 * trend returns every stored snapshot for a Client, oldest first (Rule 9 — trend
 * reads stored snapshots only, never a retroactive recompute). Visibility gated (Rule 11).
 */
export async function trend(sql: Sql, actor: Actor, clientId: string): Promise<Snapshot[]> {
  await assertCanView(sql, actor, clientId);
  const rows = await sql<SnapshotDbRow[]>`
    select ${sql.unsafe(SNAPSHOT_COLS)}
      from client_health_snapshots where client_id = ${clientId} order by period_start asc`;
  return rows.map(scanSnapshot);
}

/**
 * getSnapshot returns one stored snapshot for a Client. periodId ("YYYYMM") picks a
 * month; empty picks the latest. Visibility gated (Rule 11). NotFoundError when the
 * client is invisible/absent or has no snapshot for the period.
 */
export async function getSnapshot(sql: Sql, actor: Actor, clientId: string, periodId = ''): Promise<Snapshot> {
  await assertCanView(sql, actor, clientId);
  const rows =
    periodId !== ''
      ? await sql<SnapshotDbRow[]>`
          select ${sql.unsafe(SNAPSHOT_COLS)}
            from client_health_snapshots
           where client_id = ${clientId} and to_char(period_start, 'YYYYMM') = ${periodId}
           order by period_start desc limit 1`
      : await sql<SnapshotDbRow[]>`
          select ${sql.unsafe(SNAPSHOT_COLS)}
            from client_health_snapshots
           where client_id = ${clientId}
           order by period_start desc limit 1`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return scanSnapshot(rows[0]);
}

/**
 * preview computes the CURRENT, not-yet-closed month's score read-only (Rule 10 /
 * §5.3). NEVER stored, never on the trend. Visibility gated.
 */
export async function preview(sql: Sql, actor: Actor, clientId: string, now: Date = new Date()): Promise<Snapshot> {
  await assertCanView(sql, actor, clientId);
  const per = monthPeriod(now);
  const c = await computeFor(sql, clientId, per);
  return {
    id: '',
    clientId,
    periodStart: per.startDate,
    periodEnd: per.endDate,
    finalHealthScore: c.finalScore,
    scoreDisplay: scoreDisplay(c.finalScore),
    band: c.band,
    roasToggleState: c.roasState,
    components: c.components,
    preview: true,
  };
}

/**
 * assertCanView loads the Client's owner AM and applies the Rule 11 gate.
 * Non-existent or invisible clients are NotFoundError (an AM cannot probe outside
 * its book); a role with no M13 scope at all is ForbiddenError.
 */
async function assertCanView(q: Queryable, actor: Actor, clientId: string): Promise<void> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const ownerAm = await clientOwnerAM(q, clientId);
  if (!canView(actor, ownerAm)) {
    throw new NotFoundError();
  }
}

/** clientOwnerAM loads a client's current assigned AM. NotFoundError when absent. */
async function clientOwnerAM(q: Queryable, clientId: string): Promise<string> {
  const rows = await q<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return rows[0].assigned_am_id ?? '';
}

// ---------------------------------------------------------------------------
// ROAS Inclusion Toggle (roas.go / Rule 13 / §5.4).
// ---------------------------------------------------------------------------

/**
 * The read view of a Client's ROAS Inclusion Toggle: the explicit override (null =
 * following the default), the two Ads-service signals, and the resolved effective
 * inclusion the scorer will use this run.
 */
export interface ROASToggle {
  clientId: string;
  override: boolean | null; // null = no override (follow default)
  hasAds: boolean; // any Ads campaign exists (else structurally N/A)
  hasActive: boolean; // an [Active] campaign exists (the default when no override)
  effective: boolean; // resolved inclusion intent (false when structurally N/A)
}

/** getRoasToggle returns a Client's ROAS toggle state. Read-gated by Rule 11. */
export async function getRoasToggle(sql: Sql, actor: Actor, clientId: string): Promise<ROASToggle> {
  await assertCanView(sql, actor, clientId);
  return readToggle(sql, clientId);
}

/**
 * setRoasToggle sets (override non-null) or clears (override null → back to default)
 * the per-Client ROAS toggle (Rule 13 / §5.4). Write-gated: AM/SPV or Director (OD
 * read-only); an AM may only toggle a client in its own book. The change is appended
 * to the immutable audit_log (before→after) — no stored history column. Setting the
 * toggle does NOT recompute or mutate any existing snapshot — it affects the next run.
 */
export async function setRoasToggle(
  sql: Sql,
  actor: Actor,
  clientId: string,
  override: boolean | null,
): Promise<ROASToggle> {
  if (!canToggleROAS(actor)) {
    throw new ForbiddenError();
  }
  const ownerAm = await clientOwnerAM(sql, clientId);
  if (!canView(actor, ownerAm)) {
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
      entityType: 'client',
      entityId: clientId,
      actorEmployeeId: actor.employeeId,
      action: 'roas_health_toggle_set',
      beforeJson: { override: before },
      afterJson: { override },
      createdBy: actor.employeeId,
    });
    return readToggle(tx, clientId);
  });
}

/** readToggle resolves a Client's toggle against the current Ads-service presence. */
async function readToggle(q: Queryable, clientId: string): Promise<ROASToggle> {
  const rows = await q<{ roas_health_included_override: boolean | null }[]>`
    select roas_health_included_override from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const override = rows[0].roas_health_included_override;
  const { hasAny, hasActive } = await adsServicePresence(q, clientId);
  // Effective inclusion mirrors roasCandidate: structurally N/A without any Ads.
  let effective = false;
  if (hasAny) {
    effective = override !== null ? override : hasActive;
  }
  return { clientId, override, hasAds: hasAny, hasActive, effective };
}
