/**
 * Module 13 — Client Health Report. Ported from Go's
 * `internal/module13_health/{health,compute,roas,service,snapshot}.go`.
 *
 * A pure AGGREGATION + scoring layer (§1): it introduces no new raw data, only a
 * weighted 0–100 Health Score per Client, computed from data already in Modules 4
 * (GMV), 5 (payment), 6 (complaints), 8 (ROAS) and 12 (task completion / revision
 * count). The month boundary produces one immutable snapshot per Client (CHR-,
 * §5.1); the current not-yet-closed month is a read-only live preview, never stored
 * (Rule 10). Everything a snapshot persists is recomputable from the immutable
 * event/timestamp logs of the source modules (house rule 4).
 *
 * Reference: backend/internal/module13_health/*.go.
 */

import { deeplink, money, notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { parseRoasTarget } from './ads';
import { computeMetrics, type Transition } from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const ACCOUNT_DIVISION = 'Account';

// --- Errors (health-scoped; mapped in apps/api http.ts). ---

/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'HealthForbiddenError';
  }
}
/** The Client / snapshot does not exist OR is invisible to the actor (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'HealthNotFoundError';
  }
}

export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
export const MSG_SCAN_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan pemindaian skor kesehatan klien]';

// ---------------------------------------------------------------------------
// Pure scoring core (§2 Rules 3–7). No DB dependency — exhaustively unit-testable.
// ---------------------------------------------------------------------------

// Component names (§2 Rule 2). Stable string keys — persisted + surfaced in the API.
export const COMP_GMV_GROWTH = 'gmv_growth';
export const COMP_ROAS_ATTAINMENT = 'roas_attainment';
export const COMP_TASK_COMPLETION = 'task_completion';
export const COMP_REVISION_BURDEN = 'revision_burden';
export const COMP_COMPLAINTS = 'complaints';
export const COMP_SATISFACTION = 'satisfaction';
export const COMP_PAYMENT_TIMELINESS = 'payment_timeliness';

/** Confirmed component weights (§2 Rule 3 / §6 OA-1), out of 100 (sum = 100). */
const baseWeights: Record<string, number> = {
  [COMP_GMV_GROWTH]: 25,
  [COMP_ROAS_ATTAINMENT]: 25,
  [COMP_TASK_COMPLETION]: 10,
  [COMP_REVISION_BURDEN]: 10,
  [COMP_COMPLAINTS]: 10,
  [COMP_SATISFACTION]: 10,
  [COMP_PAYMENT_TIMELINESS]: 10,
};

// Bands (§2 Rule 7 / §6 OA-2).
export const BAND_HEALTHY = 'Healthy'; // 80–100
export const BAND_WATCH = 'Watch'; // 60–79
export const BAND_AT_RISK = 'At Risk'; // below 60

/** bandRank orders the bands so a month-over-month DROP (Rule 12) is strictly decreasing. */
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

/** bandFor assigns the band from a final score (Rule 7): >=80 Healthy, >=60 Watch, else At Risk. */
export function bandFor(score: number): string {
  if (score >= 80) {
    return BAND_HEALTHY;
  }
  if (score >= 60) {
    return BAND_WATCH;
  }
  return BAND_AT_RISK;
}

/** One scored (or excluded) component. Raw is UNCAPPED (Rule 6); Capped is clamp(raw,0,100). */
export interface Component {
  name: string;
  included: boolean;
  raw: number | null; // uncapped; null when excluded
  capped: number | null; // clamp(raw,0,100); null when excluded
  baseWeight: number;
  effectiveWeight: number; // post-redistribution weight (out of 100); 0 when excluded
  excludedReason?: string;
}

/** Raw pre-scoring input for one component (compute layer builds these). */
export interface Candidate {
  name: string;
  included: boolean;
  raw: number;
  reason?: string;
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

export interface ScoreResult {
  components: Component[];
  finalScore: number;
  band: string;
  ok: boolean; // false only in the all-excluded case (no component had data)
}

/**
 * score turns the per-component candidates into the finished Component list plus
 * the final weighted Health Score (0–100) and band (Rules 3–7). Redistribution
 * (Rule 4): the base weights of the AVAILABLE components are re-normalised to sum
 * to 100 (each scaled by 100/Σ available base weights) — an excluded component is
 * never scored as 0 or 100. `ok` is false only in the defensive all-excluded case.
 */
export function score(cands: Candidate[]): ScoreResult {
  let availableBase = 0;
  for (const c of cands) {
    if (c.included) {
      availableBase += baseWeights[c.name];
    }
  }

  const components: Component[] = [];
  let weighted = 0;
  for (const c of cands) {
    const comp: Component = { name: c.name, included: false, raw: null, capped: null, baseWeight: baseWeights[c.name], effectiveWeight: 0 };
    if (c.included && availableBase > 0) {
      const capped = clamp01to100(c.raw);
      const eff = (baseWeights[c.name] * 100) / availableBase;
      comp.included = true;
      comp.raw = c.raw;
      comp.capped = capped;
      comp.effectiveWeight = eff;
      weighted += (eff / 100) * capped;
    } else {
      comp.excludedReason = c.reason;
    }
    components.push(comp);
  }

  if (availableBase === 0) {
    return { components, finalScore: 0, band: '', ok: false };
  }
  let finalScore = Math.round(weighted * 1000) / 1000; // guard float dust past 100/0
  if (finalScore > 100) {
    finalScore = 100;
  }
  if (finalScore < 0) {
    finalScore = 0;
  }
  return { components, finalScore, band: bandFor(finalScore), ok: true };
}

// ---------------------------------------------------------------------------
// WIB period math (O20).
// ---------------------------------------------------------------------------

const OFFSET_MS = tz.WIB_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** One scored calendar month, in WIB. */
interface Period {
  start: Date; // WIB midnight, first day of month (a UTC instant)
  startDate: string; // "YYYY-MM-01"
  endDate: string; // last day, "YYYY-MM-DD"
  startUTC: Date; // inclusive lower bound for DATETIME columns
  endUTC: Date; // exclusive upper bound (next-month start)
  approvedTag: string; // "YYYY-MM" — compared against task.approvedPeriodWib
  id: string; // "YYYYMM" — CHR- id month bucket
}

/** monthPeriod builds the Period for the WIB calendar month that contains anchor. */
function monthPeriod(anchor: Date): Period {
  const shifted = new Date(anchor.getTime() + OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth(); // 0-based
  const startUTC = new Date(Date.UTC(y, m, 1) - OFFSET_MS);
  const endUTC = new Date(Date.UTC(y, m + 1, 1) - OFFSET_MS);
  const endDate = tz.dateString(new Date(endUTC.getTime() - DAY_MS)); // last day of month, WIB
  return {
    start: startUTC,
    startDate: `${y}-${pad2(m + 1)}-01`,
    endDate,
    startUTC,
    endUTC,
    approvedTag: `${y}-${pad2(m + 1)}`,
    id: `${y}${pad2(m + 1)}`,
  };
}

/** closedMonthPeriod is the most-recently CLOSED calendar month relative to now (WIB) — the previous month. */
function closedMonthPeriod(now: Date): Period {
  const thisMonthStart = monthPeriod(now).start;
  return monthPeriod(new Date(thisMonthStart.getTime() - DAY_MS));
}

/** firstFullMonthStart is the WIB first-of-month of the Client's first FULL calendar month (Rule 8 grace). */
function firstFullMonthStart(createdAt: Date): Date {
  const shifted = new Date(createdAt.getTime() + OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  if (d === 1) {
    return new Date(Date.UTC(y, m, 1) - OFFSET_MS);
  }
  return new Date(Date.UTC(y, m + 1, 1) - OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Component gatherers (compute layer).
// ---------------------------------------------------------------------------

// Severity penalties for the Complaints component (§2 Rule 5 / §6 OA-4). Working defaults.
const PENALTY_LOW = 5;
const PENALTY_MEDIUM = 15;
const PENALTY_HIGH = 30;
const AD_CAMPAIGN_ACTIVE = '[Active]';
const INSTALLMENT_OVERDUE = '[Jatuh Tempo]';
const ADS_BRIEF_DIVISION = 'Ads';

interface ClientInputs {
  baselineCents: number;
  targetCents: number;
  currentCents: number;
  createdAt: Date;
  roasOverride: boolean | null; // null = follow default
}

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
    baselineCents: Number(money.parse(r.gmv_baseline)),
    targetCents: Number(money.parse(r.target_gmv)),
    currentCents: Number(money.parse(r.total_sales)),
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
  const grace = per.start.getTime() <= firstFullMonthStart(ci.createdAt).getTime();
  cands.push(gmvCandidate(ci, grace));

  // ROAS Attainment (Module 8) — Rule 5 + toggle Rule 13.
  const { cand: roasCand, roasState } = await roasCandidate(sql, clientId, per, ci.roasOverride);
  cands.push(roasCand);

  // Task Completion + Revision Burden (Module 12) — Rule 5.
  const { taskCand, revCand } = await taskCandidates(sql, clientId, per);
  cands.push(taskCand, revCand);

  // Complaints (Module 6) — always available (0 complaints = 100).
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

/** GMV Growth (Rule 5): (Current−Baseline)/(Target−Baseline)×100. Excluded in grace or zero-denominator. */
function gmvCandidate(ci: ClientInputs, grace: boolean): Candidate {
  if (grace) {
    return { name: COMP_GMV_GROWTH, included: false, raw: 0,
      reason: 'grace period klien baru — GMV Growth dikecualikan pada bulan penuh pertama (Rule 8)' };
  }
  const denom = ci.targetCents - ci.baselineCents;
  if (denom === 0) {
    return { name: COMP_GMV_GROWTH, included: false, raw: 0,
      reason: 'Target GMV sama dengan Baseline GMV — pembagi nol, dikecualikan + bobot didistribusi ulang' };
  }
  const raw = ((ci.currentCents - ci.baselineCents) / denom) * 100;
  return { name: COMP_GMV_GROWTH, included: true, raw };
}

/** ROAS Attainment (Rule 5) with the toggle (Rule 13). Returns the candidate + the effective toggle state. */
async function roasCandidate(
  sql: Queryable,
  clientId: string,
  per: Period,
  override: boolean | null,
): Promise<{ cand: Candidate; roasState: boolean }> {
  const { hasAny, hasActive } = await adsServicePresence(sql, clientId);
  if (!hasAny) {
    return { cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0,
      reason: 'klien tidak memiliki layanan Ads — ROAS N/A struktural (Rule 13)' }, roasState: false };
  }
  const toggleOn = override !== null ? override : hasActive;
  if (!toggleOn) {
    return { cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0,
      reason: 'ROAS dimatikan oleh toggle tim (Rule 13)' }, roasState: false };
  }

  const cur = await currentPeriodROAS(sql, clientId, per);
  if (cur === null) {
    return { cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0,
      reason: 'tidak ada data metrik ROAS pada periode — dikecualikan + bobot didistribusi ulang' }, roasState: true };
  }
  const target = await aggregateTargetROAS(sql, clientId);
  if (target === null) {
    return { cand: { name: COMP_ROAS_ATTAINMENT, included: false, raw: 0,
      reason: 'target ROAS tidak dapat diparse dari Target KPI — dikecualikan + bobot didistribusi ulang' }, roasState: true };
  }
  return { cand: { name: COMP_ROAS_ATTAINMENT, included: true, raw: (cur / target) * 100 }, roasState: true };
}

/** adsServicePresence reports whether the Client has ANY ad campaign, and whether it has an ACTIVE one. */
async function adsServicePresence(sql: Queryable, clientId: string): Promise<{ hasAny: boolean; hasActive: boolean }> {
  const rows = await sql<{ any_n: string; active_n: string }[]>`
    select count(*)::int as any_n,
           count(*) filter (where status = ${AD_CAMPAIGN_ACTIVE})::int as active_n
      from ad_campaigns where client_id = ${clientId}`;
  return { hasAny: Number(rows[0].any_n) > 0, hasActive: Number(rows[0].active_n) > 0 };
}

/** currentPeriodROAS = ΣGMV / ΣSpend over the Client's Metric Entries whose period starts in the month. null = no spend. */
async function currentPeriodROAS(sql: Queryable, clientId: string, per: Period): Promise<number | null> {
  const rows = await sql<{ spend: string | null; gmv: string | null }[]>`
    select sum(m.spend) as spend, sum(m.gmv) as gmv
      from metric_entries m join ad_campaigns c on c.id = m.campaign_id
     where c.client_id = ${clientId} and m.period_start between ${per.startDate}::date and ${per.endDate}::date`;
  const { spend, gmv } = rows[0];
  if (spend === null || gmv === null) {
    return null;
  }
  const sp = Number(money.parse(spend));
  const gm = Number(money.parse(gmv));
  if (sp === 0) {
    return null; // div-zero → treated as missing data (house rule 7)
  }
  return gm / sp;
}

/** aggregateTargetROAS = MEAN of the parseable per-campaign ROAS targets. null = none parse. */
async function aggregateTargetROAS(sql: Queryable, clientId: string): Promise<number | null> {
  const rows = await sql<{ target_kpi: string | null }[]>`select target_kpi from ad_campaigns where client_id = ${clientId}`;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = parseRoasTarget(r.target_kpi ?? '');
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

/**
 * taskCandidates computes Task Completion Rate + Revision Burden (Module 12) over
 * the Client's canonical Tasks that reached [Approved] IN the period. Every metric
 * is recomputed from the immutable transition log (house rule 4).
 */
async function taskCandidates(sql: Queryable, clientId: string, per: Period): Promise<{ taskCand: Candidate; revCand: Candidate }> {
  const assets = await sql<{ id: string; sla_target_hours: string | null }[]>`
    select a.id, a.sla_target_hours
      from assets a join briefs b on b.id = a.brief_id join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId}`;
  const briefs = await sql<{ id: string; sla_target_hours: string | null }[]>`
    select b.id, b.sla_target_hours
      from briefs b join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId} and b.assigned_division = ${ADS_BRIEF_DIVISION}`;

  const tasks: { entityType: 'asset' | 'brief'; id: string; sla: number | null }[] = [
    ...assets.map((r) => ({ entityType: 'asset' as const, id: r.id, sla: r.sla_target_hours === null ? null : Number(r.sla_target_hours) })),
    ...briefs.map((r) => ({ entityType: 'brief' as const, id: r.id, sla: r.sla_target_hours === null ? null : Number(r.sla_target_hours) })),
  ];

  let approvedInPeriod = 0; // denominator for Revision Burden
  let slaJudged = 0; // denominator for Task Completion (has SLA)
  let withinSLA = 0; // numerator for Task Completion
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
      ? { name: COMP_TASK_COMPLETION, included: false, raw: 0,
          reason: 'tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' }
      : { name: COMP_TASK_COMPLETION, included: true, raw: (withinSLA / slaJudged) * 100 };

  const revCand: Candidate =
    approvedInPeriod === 0
      ? { name: COMP_REVISION_BURDEN, included: false, raw: 0,
          reason: 'tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' }
      : { name: COMP_REVISION_BURDEN, included: true, raw: 100 - Math.min((revisionSum / approvedInPeriod) * 20, 100) };

  return { taskCand, revCand };
}

/** taskTransitions reads a canonical Task's immutable transition log ASCENDING (destination label + timestamp). */
async function taskTransitions(sql: Queryable, entityType: 'asset' | 'brief', id: string): Promise<Transition[]> {
  const rows = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = ${entityType} and entity_id = ${id} and action like 'transition:%'
     order by created_at asc, id asc`;
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
  const idx = action.indexOf('->');
  return idx < 0 ? null : action.slice(idx + 2);
}

/** Complaints (Rule 5): 100 − Σ severity penalty (the [0,100] cap floors it). Always available. */
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
  return { name: COMP_COMPLAINTS, included: true, raw: 100 - penalty };
}

/** Payment Timeliness (Rule 5): % of Installments due in the period that never triggered [Jatuh Tempo]. */
async function paymentCandidate(sql: Queryable, clientId: string, per: Period): Promise<Candidate> {
  const rows = await sql<{ id: string }[]>`
    select i.id from installments i join transactions t on t.id = i.transaction_id
     where t.client_id = ${clientId} and i.due_date is not null
       and i.due_date between ${per.startDate}::date and ${per.endDate}::date`;
  if (rows.length === 0) {
    return { name: COMP_PAYMENT_TIMELINESS, included: false, raw: 0,
      reason: 'tidak ada tagihan jatuh tempo pada periode — dikecualikan + bobot didistribusi ulang' };
  }
  let overdue = 0;
  for (const r of rows) {
    if (await installmentEverOverdue(sql, r.id)) {
      overdue++;
    }
  }
  const timely = rows.length - overdue;
  return { name: COMP_PAYMENT_TIMELINESS, included: true, raw: (timely / rows.length) * 100 };
}

/** installmentEverOverdue reports whether an installment ever transitioned INTO [Jatuh Tempo]. */
async function installmentEverOverdue(sql: Queryable, instId: string): Promise<boolean> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::int as n from audit_log
     where entity_type = 'installment' and entity_id = ${instId}
       and action = ${`transition:[Belum Jatuh Tempo]->${INSTALLMENT_OVERDUE}`}`;
  return Number(rows[0].n) > 0;
}

// ---------------------------------------------------------------------------
// Permission gates (§Rule 11 / scan / toggle).
// ---------------------------------------------------------------------------

/** canView (§2 Rule 11): AM = own clients; Account lead/SPV = division-wide; OD = read everywhere; Director = full. */
export function canView(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  if (actor.role.division === ACCOUNT_DIVISION) {
    if (actor.role.level === permission.LevelLead) {
      return true;
    }
    return actor.employeeId === ownerAm;
  }
  return false;
}

/** canScope: has ANY M13 read scope (Account / OD / Director). */
export function canScope(actor: Actor): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  return actor.role.division === ACCOUNT_DIVISION;
}

/** canRunScan: Account (any level, not read-only OD) or Director may trigger the sweep. */
export function canRunScan(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === ACCOUNT_DIVISION && !actor.role.od;
}

/** canToggleRoas (Rule 13 / §5.4): AM/SPV (Account) or Director. OD is read-only. */
export function canToggleRoas(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.od) {
    return false;
  }
  return actor.role.division === ACCOUNT_DIVISION;
}

/** clientOwnerAM loads a Client's assigned AM; ErrNotFound when the client is absent. */
async function clientOwnerAM(sql: Queryable, clientId: string): Promise<string> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return rows[0].assigned_am_id ?? '';
}

/** assertCanView applies the Rule 11 gate: no scope → Forbidden; invisible/absent → NotFound. */
async function assertCanView(sql: Queryable, actor: Actor, clientId: string): Promise<void> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const ownerAm = await clientOwnerAM(sql, clientId);
  if (!canView(actor, ownerAm)) {
    throw new NotFoundError();
  }
}

// ---------------------------------------------------------------------------
// Snapshot / preview / trend (§3 / §5.1–§5.3, Rules 9/10/12).
// ---------------------------------------------------------------------------

const CHR_PREFIX = 'CHR';

/** A Client Health Report — a stored snapshot, or a computed-in-memory live preview (Rule 10). */
export interface Snapshot {
  id: string;
  clientId: string;
  periodStart: string;
  periodEnd: string;
  finalHealthScore: number | null;
  scoreDisplay: string; // "74.60" or "—" (all-excluded, house rule 7)
  band: string;
  roasToggleState: boolean;
  components: Component[];
  computedAt: Date | null;
  computedBy: string;
  preview: boolean;
}

/** scoreDisplay renders the composite: two decimals, or "—" when no component was available. */
function scoreDisplay(final: number | null): string {
  return final === null ? '—' : final.toFixed(2);
}

interface Computed {
  components: Component[];
  finalScore: number | null;
  band: string;
  roasState: boolean;
}

/** computeFor gathers the inputs and runs the pure scoring core for one Client + period. */
async function computeFor(sql: Queryable, clientId: string, per: Period): Promise<Computed> {
  const { cands, roasState } = await gatherComponents(sql, clientId, per);
  const r = score(cands);
  return { components: r.components, finalScore: r.ok ? r.finalScore : null, band: r.band, roasState };
}

/** What one runSnapshotJob pass did. */
export interface ScanResult {
  period: string;
  snapshotsMade: number;
  bandDropsFlagged: number;
}

/** runScan is the authorised entry point for the snapshot-sweep endpoint (Account any-level or Director). */
export async function runScan(sql: Sql, actor: Actor, now: Date = new Date()): Promise<ScanResult> {
  if (!canRunScan(actor)) {
    throw new ForbiddenError(MSG_SCAN_FORBIDDEN);
  }
  return runSnapshotJob(sql, now);
}

/**
 * runSnapshotJob is the monthly batch (§5.2): it scores every Client for the
 * most-recently CLOSED calendar month and writes one immutable snapshot each.
 * Idempotent — a client already snapshotted for the period is skipped. Each client
 * is scored + inserted in its own transaction so concurrent runs never double-insert.
 */
export async function runSnapshotJob(sql: Sql, now: Date = new Date()): Promise<ScanResult> {
  const per = closedMonthPeriod(now);
  const res: ScanResult = { period: per.id, snapshotsMade: 0, bandDropsFlagged: 0 };

  const clientIds = (await sql<{ id: string }[]>`select id from clients`).map((r) => r.id);
  for (const id of clientIds) {
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

/** fireSnapshot scores one Client for the period and inserts an immutable snapshot if none exists (fire-once). */
async function fireSnapshot(sql: Sql, clientId: string, per: Period): Promise<{ made: boolean; dropped: boolean }> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Serialise per-client snapshot creation.
    const lock = await tx<{ id: string }[]>`select id from clients where id = ${clientId} for update`;
    if (lock.length === 0) {
      return { made: false, dropped: false }; // client vanished
    }
    // Already snapshotted for this period? Idempotent no-op.
    const existing = await tx<{ id: string }[]>`
      select id from client_health_snapshots where client_id = ${clientId} and period_start = ${per.startDate}::date`;
    if (existing.length > 0) {
      return { made: false, dropped: false };
    }

    const c = await computeFor(tx, clientId, per);
    const prev = await previousBand(tx, clientId, per.startDate);
    const id = await ex.ident.identNext(CHR_PREFIX, per.start);

    await tx`
      insert into client_health_snapshots
        (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${id}, ${clientId}, ${per.startDate}::date, ${per.endDate}::date, ${c.finalScore}, ${c.band},
        ${c.roasState}, ${JSON.stringify(componentsToJson(c.components))}::jsonb, 'system')`;

    // Band drop (Rule 12): a strictly lower band than the previous snapshot → visibility flag to SPV.
    let dropped = false;
    if (prev !== null && c.band !== '' && bandRank(c.band) < bandRank(prev)) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.ClientBandDrop, entityType: 'client_health_snapshot', entityId: id,
        actor: 'system', division: ACCOUNT_DIVISION, notifyActor: false,
        // O51: the page is /health/[clientId] — it shows the client's snapshot
        // history, so it needs the CLIENT id, not the CHR- snapshot id.
        deepLink: deeplink.clientHealth(clientId),
      });
      dropped = true;
    }
    return { made: true, dropped };
  });
}

/** previousBand returns the band of the Client's most recent snapshot strictly before periodStart (Rule 12). */
async function previousBand(sql: Queryable, clientId: string, periodStart: string): Promise<string | null> {
  const rows = await sql<{ band: string }[]>`
    select band from client_health_snapshots
     where client_id = ${clientId} and period_start < ${periodStart}::date
     order by period_start desc limit 1`;
  return rows.length === 0 ? null : rows[0].band;
}

/** trend returns every stored snapshot for a Client, oldest first (Rule 9). Visibility gated. */
export async function trend(sql: Queryable, actor: Actor, clientId: string): Promise<Snapshot[]> {
  await assertCanView(sql, actor, clientId);
  const rows = await sql<SnapshotRow[]>`
    ${snapshotSelect(sql)} where client_id = ${clientId} order by period_start asc`;
  return rows.map(rowToSnapshot);
}

/** getSnapshot returns one stored snapshot. periodId ("YYYYMM") picks a month; empty picks the latest. */
export async function getSnapshot(sql: Queryable, actor: Actor, clientId: string, periodId = ''): Promise<Snapshot> {
  await assertCanView(sql, actor, clientId);
  const pid = periodId.trim();
  const rows = await sql<SnapshotRow[]>`
    ${snapshotSelect(sql)}
     where client_id = ${clientId}
       and (${pid === ''} or to_char(period_start, 'YYYYMM') = ${pid})
     order by period_start desc limit 1`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return rowToSnapshot(rows[0]);
}

/** preview computes the CURRENT, not-yet-closed month's score read-only (Rule 10). Never stored. */
export async function preview(sql: Queryable, actor: Actor, clientId: string, now: Date = new Date()): Promise<Snapshot> {
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
  period_start: string;
  period_end: string;
  final_health_score: string | null;
  band: string;
  roas_toggle_state: boolean;
  components_json: unknown;
  computed_at: Date;
  computed_by: string;
}

function snapshotSelect(sql: Queryable) {
  return sql`
    select id, client_id, to_char(period_start,'YYYY-MM-DD') as period_start,
           to_char(period_end,'YYYY-MM-DD') as period_end, final_health_score, band, roas_toggle_state,
           components_json, computed_at, computed_by
      from client_health_snapshots`;
}

function rowToSnapshot(r: SnapshotRow): Snapshot {
  const final = r.final_health_score === null ? null : Number(r.final_health_score);
  return {
    id: r.id, clientId: r.client_id, periodStart: r.period_start, periodEnd: r.period_end,
    finalHealthScore: final, scoreDisplay: scoreDisplay(final), band: r.band,
    roasToggleState: r.roas_toggle_state, components: jsonToComponents(r.components_json),
    computedAt: r.computed_at, computedBy: r.computed_by, preview: false,
  };
}

// components_json is stored/read in the snake_case shape that mirrors the Go struct
// tags, so a DB written by either stack round-trips identically.
interface ComponentJson {
  name: string;
  included: boolean;
  raw: number | null;
  capped: number | null;
  base_weight: number;
  effective_weight: number;
  excluded_reason?: string;
}

function componentsToJson(comps: Component[]): ComponentJson[] {
  return comps.map((c) => ({
    name: c.name, included: c.included, raw: c.raw, capped: c.capped,
    base_weight: c.baseWeight, effective_weight: c.effectiveWeight,
    ...(c.excludedReason ? { excluded_reason: c.excludedReason } : {}),
  }));
}

function jsonToComponents(v: unknown): Component[] {
  // postgres.js returns jsonb as a string here — parse it before mapping.
  const arr: unknown = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(arr)) {
    return [];
  }
  return (arr as ComponentJson[]).map((c) => ({
    name: c.name, included: c.included, raw: c.raw ?? null, capped: c.capped ?? null,
    baseWeight: c.base_weight, effectiveWeight: c.effective_weight,
    ...(c.excluded_reason ? { excludedReason: c.excluded_reason } : {}),
  }));
}

// ---------------------------------------------------------------------------
// ROAS Inclusion Toggle (Rule 13 / §5.4).
// ---------------------------------------------------------------------------

/** The read view of a Client's ROAS Inclusion Toggle. */
export interface RoasToggle {
  clientId: string;
  override: boolean | null; // null = no override (follow default)
  hasAds: boolean;
  hasActive: boolean;
  effective: boolean; // resolved inclusion (false when structurally N/A)
}

/** getRoasToggle returns a Client's ROAS toggle state. Read-gated (Rule 11). */
export async function getRoasToggle(sql: Queryable, actor: Actor, clientId: string): Promise<RoasToggle> {
  await assertCanView(sql, actor, clientId);
  return readToggle(sql, clientId);
}

/**
 * setRoasToggle sets (override non-null) or clears (null → default) the per-Client
 * ROAS toggle (Rule 13 / §5.4). Write-gated: AM/SPV or Director; an AM may only
 * toggle a client in its own book. Appended to the immutable audit_log; does NOT
 * recompute or mutate any existing snapshot.
 */
export async function setRoasToggle(sql: Sql, actor: Actor, clientId: string, override: boolean | null): Promise<RoasToggle> {
  if (!canToggleRoas(actor)) {
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
    effective = override !== null ? override : hasActive;
  }
  return { clientId, override, hasAds: hasAny, hasActive, effective };
}
