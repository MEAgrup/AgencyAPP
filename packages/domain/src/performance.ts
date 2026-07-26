/**
 * Team Performance domain service (M14). Ported from Go's
 * `internal/module14_performance/*` ({perf,profile,config,compute,modifier,snapshot}.go).
 *
 * Like Module 13 this is a pure AGGREGATION + scoring layer (M14 §2 Rule 1): it
 * invents NO new raw KPI, only a per-staff, per-role, per-month weighted 0..100
 * rollup of KPIs that already live in Modules 7 (Output Quantity / GMV Impact), 8
 * (ROAS / GMV Impact / Optimization Activity), 9 (Creator Count / QC Pass Rate /
 * Escalation), 12 (Speed Score / Revision Count) and 13 (Client Health Score), plus
 * a small cross-division Client-Outcome Modifier drawn from Module 13 snapshots
 * (§2 Rule 3).
 *
 * The month boundary produces one immutable snapshot per scored staff member
 * (PERF-, §5.1). Everything a snapshot persists is recomputable from the immutable
 * event/timestamp logs of the source modules (house rule 4). The current not-yet-
 * closed month is a read-only running preview that is never stored.
 *
 * Reuses `ads.parseRoasTarget` (Target-KPI parsing), `task.computeMetrics` (the
 * §5.1 recompute-from-log Speed Score / Revision Count) and
 * `kol.computeBookingMetrics` (§7/§11 Booking metrics) — never duplicating that math.
 *
 * Reference: backend/internal/module14_performance/*.
 */

import { notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { parseRoasTarget } from './ads';
import { computeMetrics, type Transition } from './task';
import { BKG_ESCALATED, BKG_QC_FAILED, computeBookingMetrics } from './kol';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Role types (M14 §5.1 enum). A staff member's role type is derived from their
// CDPS division (role_mappings), staff-level only in v1 (decision point 1). The
// string values double as the perf_kpi_weights.role_type key and the snapshot
// role_type column.
// ---------------------------------------------------------------------------
export const ROLE_CREATIVE = 'Creative';
export const ROLE_ADS = 'Ads';
export const ROLE_KOL = 'KOL';
export const ROLE_AM = 'AM';

/** CDPS division constants (the real batch-1 role-mapping values). */
export const CREATIVE_DIVISION = 'Creative';
export const ADS_DIVISION = 'Ads';
export const KOL_DIVISION = 'KOL';
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Component keys (M14 §2 Rule 2). Stable string keys — persisted in
// perf_kpi_weights, perf_period_targets and components_json, and surfaced in the
// API, so they never change.
// ---------------------------------------------------------------------------
export const COMP_SPEED_SCORE = 'speed_score'; // M12, transform OA-1
export const COMP_OUTPUT_QUANTITY = 'output_quantity'; // M7 approved assets / period, normalized OA-2
export const COMP_GMV_IMPACT = 'gmv_impact'; // M7§7 / M8§7, normalized OA-2
export const COMP_REVISION_COUNT = 'revision_count'; // M12 inverse
export const COMP_ROAS_ATTAINMENT = 'roas_attainment'; // M8, own managed campaigns
export const COMP_OPTIMIZATION_ACTIVITY = 'optimization_activity'; // M8, normalized OA-2
export const COMP_CREATOR_COUNT = 'creator_count'; // M9 QC-passed bookings / period, normalized OA-2
export const COMP_QC_PASS_RATE = 'qc_pass_rate'; // M9
export const COMP_ESCALATION_RATE = 'escalation_rate'; // M9 inverse
export const COMP_CHR_AVERAGE = 'chr_average'; // M13 portfolio avg (AM, §8/OA-6)
export const COMP_COMPLAINT_RESOLUTION_SPEED = 'complaint_resolution_speed'; // M6, speed transform OA-1 vs SLA target
export const COMP_REVISION_ESCALATION_RATE = 'revision_escalation_rate'; // M6/M12 inverse (AM)

/**
 * Diagnostic (reported, NEVER weighted — §2 Rule 2 KOL row): KOL Sourcing
 * Turnaround is shown on the staff's own breakdown but carries no weight because it
 * is largely already reflected inside the combined Speed Score.
 */
export const COMP_SOURCING_TURNAROUND = 'sourcing_turnaround';

/**
 * modifierComponent maps a role type to the Module 13 Health-Score sub-component its
 * Client-Outcome Modifier draws from (M14 §5.3 / OA-4): Creative → Revision Burden,
 * Ads → ROAS Attainment, KOL → Task Completion. AM has no modifier (Rule 3). The
 * values are the Module 13 components_json component keys (frozen persisted keys).
 */
const MODIFIER_COMPONENT: Record<string, string> = {
  [ROLE_CREATIVE]: 'revision_burden',
  [ROLE_ADS]: 'roas_attainment',
  [ROLE_KOL]: 'task_completion',
};

// The Ads Brief-as-task division label; Creative work is scored via its Assets.
const ADS_BRIEF_DIVISION = 'Ads';
// revisionInverseFactor mirrors Module 13's Revision Burden transform
// (100 − min(avg × 20, 100)) so a Revision Count sub-score is comparable across the
// two modules (decision point 2). avg 0 → 100; avg 5+ → 0.
const REVISION_INVERSE_FACTOR = 20;
// The house-ID prefix for a Performance Score snapshot (DATA_MODEL §1/§29).
const PERF_PREFIX = 'PERF';
// The sentinel period_start meaning "applies to every period unless a period-
// specific override row exists" (migration 0036).
const DEFAULT_TARGET_DATE = '0001-01-01';

/** The closed set a config write may target. */
const VALID_ROLE_TYPES = new Set([ROLE_CREATIVE, ROLE_ADS, ROLE_KOL, ROLE_AM]);

// ---------------------------------------------------------------------------
// Verbatim BI messages (M14). Reuse shared house strings (CLAUDE.md §5).
// ---------------------------------------------------------------------------

/** Actor's role has no M14 access at all (e.g. a Sales staffer). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
/** Snapshot / staff does not exist OR is not visible to the actor. */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** Actor may not trigger the monthly snapshot sweep (W1-09 precedent). */
export const MSG_SCAN_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan pemindaian skor performa tim]';
/** Actor may not edit KPI weights / period targets (Director only). */
export const MSG_CONFIG_FORBIDDEN = '[anda tidak memiliki akses untuk mengubah konfigurasi KPI performa]';
/** An admin weight write whose Σ per role_type != 100 (§5.2 / OA-5). */
export const MSG_WEIGHTS_NOT_HUNDRED = '[total bobot KPI harus berjumlah 100]';
/** An unknown role_type in a config write (shared generic validation string). */
export const MSG_BAD_ROLE_TYPE = '[format data tidak valid]';

// ---------------------------------------------------------------------------
// Errors — mapped in apps/api http.ts: forbidden/scan/config → 403, not-found →
// 404, weights/role-type → 400.
// ---------------------------------------------------------------------------

/** The actor's role may not read this M14 surface (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'PerfForbiddenError';
  }
}
/** The staff / snapshot does not exist or is not visible (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'PerfNotFoundError';
  }
}
/** The actor may not run the snapshot sweep (→ 403). */
export class ScanForbiddenError extends Error {
  constructor(message = MSG_SCAN_FORBIDDEN) {
    super(message);
    this.name = 'PerfScanForbiddenError';
  }
}
/** The actor may not edit KPI weights / period targets (→ 403). */
export class ConfigForbiddenError extends Error {
  constructor(message = MSG_CONFIG_FORBIDDEN) {
    super(message);
    this.name = 'PerfConfigForbiddenError';
  }
}
/** A weight write whose Σ per role_type != 100 (→ 400). */
export class WeightsNotHundredError extends Error {
  constructor(message = MSG_WEIGHTS_NOT_HUNDRED) {
    super(message);
    this.name = 'PerfWeightsNotHundredError';
  }
}
/** An unknown role_type in a config write (→ 400). */
export class BadRoleTypeError extends Error {
  constructor(message = MSG_BAD_ROLE_TYPE) {
    super(message);
    this.name = 'PerfBadRoleTypeError';
  }
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/**
 * One scored (or excluded, or diagnostic) component of a Performance Score. `raw`
 * is the UNCAPPED sub-metric kept for diagnosis (§5.5); `capped` is the [0,100]
 * value used in the weighted math. When `included` is false the component
 * contributed nothing and its weight was redistributed (Rule 6) — raw/capped are
 * then null and `excludedReason` explains why. A `diagnostic` component (KOL
 * Sourcing Turnaround) is REPORTED with its raw value but carries no weight and
 * never participates in redistribution (§2 Rule 2).
 */
export interface Component {
  name: string;
  included: boolean;
  diagnostic?: boolean; // reported, unweighted (Rule 2)
  raw: number | null; // uncapped; null when excluded
  capped: number | null; // clamp(raw,0,100); null when excluded/diagnostic
  baseWeight: number; // configured weight (out of 100); 0 for diagnostic
  effectiveWeight: number; // post-redistribution weight (out of 100); 0 when excluded/diagnostic
  excludedReason?: string;
}

/**
 * The Client-Outcome Modifier (§2 Rule 3 / §5.3): the value applied on top of the
 * KPI Profile, the Module 13 sub-component it drew from, the clients that
 * contributed, and the raw average before the clamp. `present` is false when the
 * role has no modifier (AM) or no CHR source data was available — the effective
 * value is then 0 (recorded, not silently dropped; decision point 3).
 */
export interface Modifier {
  present: boolean;
  value: number; // clamped ±10; 0 when absent
  sourceComponent: string; // e.g. "roas_attainment"; "" when absent
  sourceClients: string[]; // Clients whose CHR sub-score fed the average
  rawAverage: number | null; // the averaged sub-score before the clamp; null when absent
}

/** A Performance Score — a stored snapshot or a computed-in-memory live preview. */
export interface Snapshot {
  id: string;
  staffId: string;
  roleType: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  profileScore: number | null; // weighted KPI Profile; null only if all-excluded
  modifier: Modifier;
  finalScore: number | null; // profile + modifier, bounded 0..100; null if all-excluded
  scoreDisplay: string; // "88.40" or "—"
  components: Component[];
  targetsPlaceholder: boolean; // O9: a raw-value used a placeholder target
  computedAt: Date | null;
  computedBy: string;
  preview: boolean;
}

/** One RunSnapshotJob pass tally. */
export interface ScanResult {
  period: string;
  snapshotsMade: number;
}

/** One member's line in the team rollup. */
export interface TeamRow {
  staffId: string;
  roleType: string;
  finalScore: number | null;
  scoreDisplay: string;
}

/**
 * The team view (§2 Rule 5 / OA-8): the members' snapshots for a period plus the
 * simple average of their final scores — DERIVED ON READ, never stored.
 */
export interface TeamRollup {
  division: string;
  period: string;
  members: TeamRow[];
  teamAverage: number | null;
  averageDisplay: string; // "—" when no member has a score
}

/** One (role_type, component) KPI Profile weight row. */
export interface KpiWeight {
  roleType: string;
  component: string;
  weight: number;
  updatedAt: Date;
  updatedBy: string;
}

/** One normalisation target row (OA-2 / O9). */
export interface PeriodTarget {
  roleType: string;
  component: string;
  periodStart: string; // "YYYY-MM-DD"; DEFAULT_TARGET_DATE = applies to all periods
  targetValue: number;
  isPlaceholder: boolean; // O9: true = illustrative seed, NOT a confirmed target
  updatedAt: Date;
  updatedBy: string;
}

/** candidate is the raw pre-scoring input for one component (§2 Rule 2 / §5.5). */
interface Candidate {
  name: string;
  included: boolean;
  raw: number;
  reason: string;
  diagnostic?: boolean;
}

// ---------------------------------------------------------------------------
// Pure scoring core (profile.go) — no DB, exhaustively unit-testable.
// ---------------------------------------------------------------------------

/**
 * transformSpeed applies the confirmed Speed KPI transform (OA-1): 100 when the
 * Speed Score is at/under 100% of SLA (no bonus for finishing early), else
 * 200 − Speed Score, floored at 0.
 */
export function transformSpeed(speedPct: number): number {
  if (speedPct <= 100) {
    return 100;
  }
  const v = 200 - speedPct;
  return v < 0 ? 0 : v;
}

/** clamp01to100 caps a value to the [0,100] sub-score range (also OA-2 "capped at 100"). */
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
 * scoreProfile turns the per-component candidates into the finished Component list
 * plus the weighted KPI Profile score (0..100) using the supplied per-role weights.
 * Redistribution (Rule 6, identical to Module 13 §4): the base weights of the
 * AVAILABLE weighted components are re-normalised to sum to 100. Diagnostic
 * candidates are appended as reported-only rows (weight 0). `profileOk` is false
 * only in the all-excluded case; the caller renders "—" (house rule 7) and no band.
 */
export function scoreProfile(
  weights: Record<string, number>,
  cands: Candidate[],
): { components: Component[]; profile: number; profileOk: boolean } {
  let availableBase = 0;
  for (const c of cands) {
    if (c.diagnostic) {
      continue;
    }
    if (c.included) {
      availableBase += weights[c.name] ?? 0;
    }
  }

  const components: Component[] = [];
  let weighted = 0;
  for (const c of cands) {
    if (c.diagnostic) {
      // Diagnostic rows are reported by their RAW value only (e.g. Sourcing
      // Turnaround in hours). Capped stays null — no 0..100 sub-score, never in the
      // weighted math (§2 Rule 2).
      const comp: Component = { name: c.name, included: false, diagnostic: true, raw: null, capped: null, baseWeight: 0, effectiveWeight: 0 };
      if (c.included) {
        comp.included = true;
        comp.raw = c.raw;
      } else {
        comp.excludedReason = c.reason;
      }
      components.push(comp);
      continue;
    }
    const base = weights[c.name] ?? 0;
    const comp: Component = { name: c.name, included: false, raw: null, capped: null, baseWeight: base, effectiveWeight: 0 };
    if (c.included && availableBase > 0) {
      const raw = c.raw;
      const capped = clamp01to100(raw);
      const eff = (base * 100) / availableBase;
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
    return { components, profile: 0, profileOk: false };
  }
  // Guard against float dust just past 100/0 from the re-normalisation.
  let profile = Math.round(weighted * 1000) / 1000;
  if (profile > 100) {
    profile = 100;
  }
  if (profile < 0) {
    profile = 0;
  }
  return { components, profile, profileOk: true };
}

/** clampModifier applies the confirmed formula (OA-3): clamp((avg − 80) ÷ 2, −10, +10). */
export function clampModifier(avg: number): number {
  const v = (avg - 80) / 2;
  if (v > 10) {
    return 10;
  }
  if (v < -10) {
    return -10;
  }
  return v;
}

/**
 * boundFinal computes the Final Individual Score = KPI Profile + Modifier, bounded
 * 0..100 (Rule 4). `profile` is null in the all-excluded case, which yields a null
 * final (rendered "—"); a role with a profile still applies its modifier here.
 */
export function boundFinal(profile: number | null, mod: Modifier): number | null {
  if (profile === null) {
    return null;
  }
  let f = profile + mod.value;
  if (f > 100) {
    f = 100;
  }
  if (f < 0) {
    f = 0;
  }
  return Math.round(f * 1000) / 1000;
}

/** scoreDisplay renders a final score for the UI: two decimals, or "—" (house rule 7). */
function scoreDisplay(final: number | null): string {
  return final === null ? '—' : final.toFixed(2);
}

// ---------------------------------------------------------------------------
// Visibility (M14 §2 Rule 7) + gates.
// ---------------------------------------------------------------------------

/** divisionOfRole maps a role type back to the CDPS division whose lead/SPV may see that staff's scores. */
function divisionOfRole(roleType: string): string {
  if (roleType === ROLE_AM) {
    return ACCOUNT_DIVISION;
  }
  return roleType; // Creative / Ads / KOL are 1:1 with their division
}

/** canView reports whether actor may see a snapshot for staffId in roleType (Rule 7). */
export function canView(actor: Actor, staffId: string, roleType: string): boolean {
  if (actor.role.director || actor.role.od) {
    return true; // Director full; OD read-only everywhere
  }
  if (actor.employeeId === staffId) {
    return true; // staff: own score
  }
  // Lead/SPV: full team = own division (division-wide).
  return actor.role.level === permission.LevelLead && actor.role.division === divisionOfRole(roleType);
}

/** canScope reports whether the actor has ANY M14 read scope. */
export function canScope(actor: Actor): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  return actor.role.division !== '' || actor.employeeId !== '';
}

/** canRunScan authorises the on-demand snapshot sweep (Flow 1): Director only. */
export function canRunScan(a: Actor): boolean {
  return a.role.director;
}

/** canManageConfig authorises editing KPI weights + period targets: Director only. */
export function canManageConfig(a: Actor): boolean {
  return a.role.director;
}

/** canViewTeam authorises a team rollup for a division (Rule 7): OD/Director any; a lead only their own. */
export function canViewTeam(a: Actor, division: string): boolean {
  if (a.role.director || a.role.od) {
    return true;
  }
  return a.role.level === permission.LevelLead && a.role.division === division;
}

/** roleTypeFor maps a staff member's CDPS division + level to a Module 14 role type (v1: STAFF level only). */
function roleTypeFor(division: string, level: string): string | null {
  if (level !== permission.LevelStaff) {
    return null;
  }
  return roleTypeOfDivision(division);
}

/** roleTypeOfDivision maps a division to the single role type scored within it (Account → AM). */
function roleTypeOfDivision(division: string): string {
  switch (division) {
    case CREATIVE_DIVISION:
      return ROLE_CREATIVE;
    case ADS_DIVISION:
      return ROLE_ADS;
    case KOL_DIVISION:
      return ROLE_KOL;
    case ACCOUNT_DIVISION:
      return ROLE_AM;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Period (one scored WIB calendar month, O20) — mirrors module13_health.
// ---------------------------------------------------------------------------

const WIB_MS = tz.WIB_OFFSET_HOURS * 3600 * 1000;

interface Period {
  startUTC: Date; // WIB first-of-month midnight, as a UTC instant (also the ident bucket anchor)
  endUTC: Date; // next-month WIB midnight (exclusive)
  startDate: string; // "YYYY-MM-01"
  endDate: string; // "YYYY-MM-DD" (inclusive DATE upper bound)
  approvedTag: string; // "YYYY-MM" — compared against task/booking approvedPeriodWib
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
    startUTC,
    endUTC,
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

// ---------------------------------------------------------------------------
// KPI Profile weights + period targets (config.go). Living config, edited through
// the admin surface (Director gate) and appended to the immutable audit_log.
// ---------------------------------------------------------------------------

/** roleWeights loads the weight map for one role_type (component → weight). Internal, never gated. */
async function roleWeights(sql: Queryable, roleType: string): Promise<Record<string, number>> {
  const rows = await sql<{ component: string; weight: string }[]>`
    select component, weight from perf_kpi_weights where role_type = ${roleType}`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.component] = Number(r.weight);
  }
  return out;
}

/** listWeights returns every configured weight, for the admin UI + read surfaces. Read-gated by canScope. */
export async function listWeights(sql: Queryable, actor: Actor): Promise<KpiWeight[]> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<{ role_type: string; component: string; weight: string; updated_at: Date; updated_by: string }[]>`
    select role_type, component, weight, updated_at, updated_by
      from perf_kpi_weights order by role_type, component`;
  return rows.map((r) => ({
    roleType: r.role_type,
    component: r.component,
    weight: Number(r.weight),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

/**
 * setWeights replaces the FULL weight set for one role_type in a single atomic
 * write (§5.2 / OA-5). The incoming components must sum to exactly 100
 * (WeightsNotHundredError) — validated server-side before any row is touched.
 * Director only. Appended to the immutable audit_log (before→after). Setting weights
 * does NOT recompute or mutate any existing snapshot — it affects the next run.
 */
export async function setWeights(sql: Sql, actor: Actor, roleType: string, weights: Record<string, number>): Promise<void> {
  if (!canManageConfig(actor)) {
    throw new ConfigForbiddenError();
  }
  if (!VALID_ROLE_TYPES.has(roleType)) {
    throw new BadRoleTypeError();
  }
  let sum = 0;
  for (const w of Object.values(weights)) {
    sum += w;
  }
  if (Math.abs(sum - 100) > 1e-6) {
    throw new WeightsNotHundredError();
  }
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await roleWeights(tx, roleType);
    await tx`delete from perf_kpi_weights where role_type = ${roleType}`;
    for (const [comp, w] of Object.entries(weights)) {
      await tx`
        insert into perf_kpi_weights (role_type, component, weight, updated_by)
        values (${roleType}, ${comp}, ${w}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: 'perf_kpi_weights',
      entityId: roleType,
      actorEmployeeId: actor.employeeId,
      action: 'weights_set',
      beforeJson: { weights: before },
      afterJson: { weights },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * targetFor resolves the normalisation target for (role_type, component) in a
 * period: an exact period-specific row wins, else the sentinel default row. `ok` is
 * false when no target is configured at all (the component is then treated as
 * missing data → excluded + redistributed). `placeholder` is surfaced so a snapshot
 * can flag that its normalisation used an unconfirmed target.
 */
async function targetFor(
  sql: Queryable,
  roleType: string,
  component: string,
  periodStartDate: string,
): Promise<{ target: number; placeholder: boolean; ok: boolean }> {
  const exact = await sql<{ target_value: string; is_placeholder: boolean }[]>`
    select target_value, is_placeholder from perf_period_targets
     where role_type = ${roleType} and component = ${component} and period_start = ${periodStartDate}`;
  if (exact.length > 0) {
    return { target: Number(exact[0].target_value), placeholder: exact[0].is_placeholder, ok: true };
  }
  const def = await sql<{ target_value: string; is_placeholder: boolean }[]>`
    select target_value, is_placeholder from perf_period_targets
     where role_type = ${roleType} and component = ${component} and period_start = ${DEFAULT_TARGET_DATE}`;
  if (def.length === 0) {
    return { target: 0, placeholder: false, ok: false };
  }
  return { target: Number(def[0].target_value), placeholder: def[0].is_placeholder, ok: true };
}

/** listTargets returns every configured target, newest-period first. Read-gated by canScope. */
export async function listTargets(sql: Queryable, actor: Actor): Promise<PeriodTarget[]> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<
    { role_type: string; component: string; period_start: string | Date; target_value: string; is_placeholder: boolean; updated_at: Date; updated_by: string }[]
  >`
    select role_type, component, period_start, target_value, is_placeholder, updated_at, updated_by
      from perf_period_targets order by role_type, component, period_start desc`;
  return rows.map((r) => ({
    roleType: r.role_type,
    component: r.component,
    periodStart: dateStr(r.period_start),
    targetValue: Number(r.target_value),
    isPlaceholder: r.is_placeholder,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

/**
 * setTarget upserts one normalisation target (§2 Rule 2 / O9). Director only. When a
 * real target is entered the caller sets isPlaceholder=false; the seed rows stay
 * flagged placeholder until then. `periodStart` "" defaults to the sentinel (applies
 * to every period). Appended to the immutable audit_log.
 */
export async function setTarget(
  sql: Sql,
  actor: Actor,
  t: { roleType: string; component: string; periodStart: string; targetValue: number; isPlaceholder: boolean },
): Promise<void> {
  if (!canManageConfig(actor)) {
    throw new ConfigForbiddenError();
  }
  if (!VALID_ROLE_TYPES.has(t.roleType)) {
    throw new BadRoleTypeError();
  }
  const periodStart = t.periodStart === '' ? DEFAULT_TARGET_DATE : t.periodStart;
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await tx`
      insert into perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by)
      values (${t.roleType}, ${t.component}, ${periodStart}, ${t.targetValue}, ${t.isPlaceholder}, ${actor.employeeId})
      on conflict (role_type, component, period_start)
      do update set target_value = excluded.target_value, is_placeholder = excluded.is_placeholder, updated_by = excluded.updated_by`;
    await ex.audit.insertAudit({
      entityType: 'perf_period_targets',
      entityId: `${t.roleType}/${t.component}/${periodStart}`,
      actorEmployeeId: actor.employeeId,
      action: 'target_set',
      beforeJson: {},
      afterJson: { target_value: t.targetValue, is_placeholder: t.isPlaceholder },
      createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Input gathering (compute.go) — the per-role raw KPI candidates.
// ---------------------------------------------------------------------------

/** placeholderTracker records whether any target lookup returned a placeholder. */
interface PlaceholderTracker {
  used: boolean;
}

/** gatherProfile assembles the weighted (+ diagnostic) candidates for one staff member's role type and period. */
async function gatherProfile(
  sql: Queryable,
  staffId: string,
  roleType: string,
  per: Period,
): Promise<{ cands: Candidate[]; anyPlaceholder: boolean }> {
  const pt: PlaceholderTracker = { used: false };
  let cands: Candidate[] = [];
  switch (roleType) {
    case ROLE_CREATIVE:
      cands = await creativeCandidates(sql, staffId, per, pt);
      break;
    case ROLE_ADS:
      cands = await adsCandidates(sql, staffId, per, pt);
      break;
    case ROLE_KOL:
      cands = await kolCandidates(sql, staffId, per, pt);
      break;
    case ROLE_AM:
      cands = await amCandidates(sql, staffId, per, pt);
      break;
    default:
      return { cands: [], anyPlaceholder: false };
  }
  return { cands, anyPlaceholder: pt.used };
}

/**
 * normalized builds a raw-value candidate normalized as Actual ÷ Period Target × 100
 * (OA-2; the cap to 100 is applied later by scoreProfile). When no target is
 * configured the component is excluded + redistributed. `absentReason` is used when
 * the actual is structurally absent (e.g. no approved output at all).
 */
async function normalized(
  sql: Queryable,
  roleType: string,
  comp: string,
  per: Period,
  actual: number,
  hasActual: boolean,
  absentReason: string,
  pt: PlaceholderTracker,
): Promise<Candidate> {
  if (!hasActual) {
    return { name: comp, included: false, raw: 0, reason: absentReason };
  }
  const { target, placeholder, ok } = await targetFor(sql, roleType, comp, per.startDate);
  if (!ok || target === 0) {
    return {
      name: comp,
      included: false,
      raw: 0,
      reason: 'target periode belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang',
    };
  }
  if (placeholder) {
    pt.used = true;
  }
  return { name: comp, included: true, raw: (actual / target) * 100, reason: '' };
}

// ---- Creative (staff = assets.assigned_pic) ----

async function creativeCandidates(sql: Queryable, staffId: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const assets = await sql<{ id: string; sla_target_hours: string | null; attributed_gmv: string | null }[]>`
    select id, sla_target_hours, attributed_gmv from assets where assigned_pic = ${staffId}`;

  let approvedInPeriod = 0;
  let slaJudged = 0;
  let speedSum = 0;
  let revisionSum = 0;
  let gmvSum = 0;
  for (const a of assets) {
    const sla = a.sla_target_hours === null ? null : Number(a.sla_target_hours);
    const m = await assetMetrics(sql, a.id, sla);
    if (m.approvedPeriodWib !== per.approvedTag) {
      continue;
    }
    approvedInPeriod++;
    revisionSum += m.revisionCount;
    gmvSum += a.attributed_gmv === null ? 0 : Number(a.attributed_gmv);
    if (m.speedScorePct !== null) {
      slaJudged++;
      speedSum += m.speedScorePct;
    }
  }

  const cands: Candidate[] = [];
  cands.push(speedCandidate(speedSum, slaJudged));
  // Output Quantity = approved assets in period, normalized to target.
  cands.push(await normalized(sql, ROLE_CREATIVE, COMP_OUTPUT_QUANTITY, per, approvedInPeriod, true, '', pt));
  // GMV Impact = Σ attributed_gmv over period-approved assets, normalized.
  cands.push(
    await normalized(
      sql,
      ROLE_CREATIVE,
      COMP_GMV_IMPACT,
      per,
      gmvSum,
      approvedInPeriod > 0,
      'tidak ada Asset [Approved] pada periode — GMV Impact dikecualikan + bobot didistribusi ulang',
      pt,
    ),
  );
  cands.push(revisionCandidate(revisionSum, approvedInPeriod));
  return cands;
}

// ---- Ads (staff = setup Brief.assigned_pic; optimizations by actor) ----

async function adsCandidates(sql: Queryable, staffId: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const briefs = await sql<{ id: string; sla_target_hours: string | null }[]>`
    select id, sla_target_hours from briefs where assigned_pic = ${staffId} and assigned_division = ${ADS_BRIEF_DIVISION}`;

  let slaJudged = 0;
  let speedSum = 0;
  for (const b of briefs) {
    const sla = b.sla_target_hours === null ? null : Number(b.sla_target_hours);
    const m = await briefMetrics(sql, b.id, sla);
    if (m.approvedPeriodWib !== per.approvedTag || m.speedScorePct === null) {
      continue;
    }
    slaJudged++;
    speedSum += m.speedScorePct;
  }

  const { roasRaw, hasROAS, gmvSum, hasCampaigns } = await adsCampaignMetrics(sql, staffId, per);

  // Optimization Activity = optimizations this staff logged in the period.
  const optRows = await sql<{ n: string }[]>`
    select count(*) as n from optimization_logs
     where actor = ${staffId} and created_at >= ${per.startUTC} and created_at < ${per.endUTC}`;
  const optCount = Number(optRows[0].n);

  const cands: Candidate[] = [];
  cands.push(speedCandidate(speedSum, slaJudged));
  if (hasROAS) {
    cands.push({ name: COMP_ROAS_ATTAINMENT, included: true, raw: roasRaw, reason: '' });
  } else {
    cands.push({
      name: COMP_ROAS_ATTAINMENT,
      included: false,
      raw: 0,
      reason: 'tidak ada data ROAS/target pada campaign yang dikelola periode ini — dikecualikan + bobot didistribusi ulang',
    });
  }
  cands.push(
    await normalized(
      sql,
      ROLE_ADS,
      COMP_GMV_IMPACT,
      per,
      gmvSum,
      hasCampaigns,
      'tidak ada campaign yang dikelola pada periode — GMV Impact dikecualikan + bobot didistribusi ulang',
      pt,
    ),
  );
  cands.push(await normalized(sql, ROLE_ADS, COMP_OPTIMIZATION_ACTIVITY, per, optCount, true, '', pt));
  return cands;
}

/**
 * adsCampaignMetrics folds the staff's managed campaigns into a single ROAS
 * Attainment sub-score (mean of per-campaign period-ROAS ÷ target-ROAS × 100) and the
 * Σ period GMV. `hasROAS` is false when no managed campaign had BOTH period spend and
 * a parseable ROAS target. `hasCampaigns` is false when the staff manages none.
 */
async function adsCampaignMetrics(
  sql: Queryable,
  staffId: string,
  per: Period,
): Promise<{ roasRaw: number; hasROAS: boolean; gmvSum: number; hasCampaigns: boolean }> {
  const camps = await sql<{ id: string; target_kpi: string }[]>`
    select c.id, c.target_kpi from ad_campaigns c
      join briefs b on b.id = c.brief_id
     where b.assigned_pic = ${staffId}`;
  if (camps.length === 0) {
    return { roasRaw: 0, hasROAS: false, gmvSum: 0, hasCampaigns: false };
  }

  let gmvSum = 0;
  let ratioSum = 0;
  let ratioN = 0;
  for (const c of camps) {
    const { spend, gmv, hasData } = await campaignPeriodSpendGMV(sql, c.id, per);
    if (hasData) {
      gmvSum += gmv;
    }
    if (!hasData || spend === 0) {
      continue;
    }
    const target = parseRoasTarget(c.target_kpi);
    if (target === null) {
      continue;
    }
    const periodROAS = gmv / spend;
    ratioSum += (periodROAS / target) * 100;
    ratioN++;
  }
  if (ratioN > 0) {
    return { roasRaw: ratioSum / ratioN, hasROAS: true, gmvSum, hasCampaigns: true };
  }
  return { roasRaw: 0, hasROAS: false, gmvSum, hasCampaigns: true };
}

/** campaignPeriodSpendGMV = Σ spend / Σ gmv over the campaign's Metric Entries in the snapshot month. */
async function campaignPeriodSpendGMV(sql: Queryable, campaignId: string, per: Period): Promise<{ spend: number; gmv: number; hasData: boolean }> {
  const rows = await sql<{ spend: string | null; gmv: string | null }[]>`
    select sum(spend) as spend, sum(gmv) as gmv from metric_entries
     where campaign_id = ${campaignId} and period_start between ${per.startDate} and ${per.endDate}`;
  const { spend, gmv } = rows[0];
  if (spend === null || gmv === null) {
    return { spend: 0, gmv: 0, hasData: false };
  }
  return { spend: Number(spend), gmv: Number(gmv), hasData: true };
}

// ---- KOL (staff = creator_bookings.assigned_coordinator) ----

async function kolCandidates(sql: Queryable, staffId: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const bookings = await sql<{ id: string; status: string; created_at: Date; sla_target_hours: string | null }[]>`
    select id, status, created_at, sla_target_hours from creator_bookings where assigned_coordinator = ${staffId}`;

  let passedInPeriod = 0;
  let qcActivity = 0;
  let escalations = 0;
  let terminalActivity = 0;
  let speedSum = 0;
  let speedN = 0;
  let sourcingSum = 0;
  let sourcingN = 0;
  for (const b of bookings) {
    const entries = await auditEntries(sql, 'creator_booking', b.id);
    const evs = nativeTransitions(entries);
    const sla = b.sla_target_hours === null ? null : Number(b.sla_target_hours);
    const m = computeBookingMetrics(b.id, b.status, b.created_at, sla, evs);
    // QC-passed in period: Creator Count + Speed Score + terminal activity.
    if (m.approvedPeriodWib === per.approvedTag) {
      passedInPeriod++;
      qcActivity++;
      terminalActivity++;
      if (m.speedScorePct !== null) {
        speedSum += m.speedScorePct;
        speedN++;
      }
      if (m.sourcingTurnaroundHours !== null) {
        sourcingSum += m.sourcingTurnaroundHours;
        sourcingN++;
      }
    }
    // QC failures + escalations occurring in the period (recompute from log).
    qcActivity += transitionCountInPeriod(entries, BKG_QC_FAILED, per);
    if (transitionCountInPeriod(entries, BKG_ESCALATED, per) > 0) {
      escalations++;
      terminalActivity++;
    }
  }

  const cands: Candidate[] = [];
  // Creator Count = QC-passed bookings in period, normalized to target.
  cands.push(await normalized(sql, ROLE_KOL, COMP_CREATOR_COUNT, per, passedInPeriod, true, '', pt));
  // QC Pass Rate = passed ÷ (passed + failed events) in period.
  if (qcActivity === 0) {
    cands.push({ name: COMP_QC_PASS_RATE, included: false, raw: 0, reason: 'tidak ada aktivitas QC pada periode — dikecualikan + bobot didistribusi ulang' });
  } else {
    cands.push({ name: COMP_QC_PASS_RATE, included: true, raw: (passedInPeriod / qcActivity) * 100, reason: '' });
  }
  // Speed Score (combined Sourcing+Delivery vs SLA), transform OA-1.
  cands.push(speedCandidate(speedSum, speedN));
  // Escalation Rate (inverse): 100 − escalated ÷ terminal-activity × 100.
  if (terminalActivity === 0) {
    cands.push({
      name: COMP_ESCALATION_RATE,
      included: false,
      raw: 0,
      reason: 'tidak ada booking terminal (QC Passed/Escalated) pada periode — dikecualikan + bobot didistribusi ulang',
    });
  } else {
    cands.push({ name: COMP_ESCALATION_RATE, included: true, raw: 100 - (escalations / terminalActivity) * 100, reason: '' });
  }
  // Sourcing Turnaround — DIAGNOSTIC (reported, unweighted; §2 Rule 2 KOL row).
  if (sourcingN === 0) {
    cands.push({
      name: COMP_SOURCING_TURNAROUND,
      diagnostic: true,
      included: false,
      raw: 0,
      reason: 'tidak ada booking [Booked] pada periode — turnaround sourcing tidak tersedia',
    });
  } else {
    cands.push({ name: COMP_SOURCING_TURNAROUND, diagnostic: true, included: true, raw: sourcingSum / sourcingN, reason: '' });
  }
  return cands;
}

// ---- AM (staff = clients.assigned_am_id) ----

async function amCandidates(sql: Queryable, staffId: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const clientRows = await sql<{ id: string }[]>`select id from clients where assigned_am_id = ${staffId}`;
  const clientIds = clientRows.map((r) => r.id);

  const cands: Candidate[] = [];

  // CHR Average (M13 §8/OA-6): mean final_health_score over the portfolio's CHR
  // snapshots for the SAME period.
  let chrSum = 0;
  let chrN = 0;
  for (const cid of clientIds) {
    const rows = await sql<{ final_health_score: string | null }[]>`
      select final_health_score from client_health_snapshots where client_id = ${cid} and period_start = ${per.startDate}`;
    if (rows.length === 0) {
      continue;
    }
    if (rows[0].final_health_score !== null) {
      chrSum += Number(rows[0].final_health_score);
      chrN++;
    }
  }
  if (chrN === 0) {
    cands.push({
      name: COMP_CHR_AVERAGE,
      included: false,
      raw: 0,
      reason: 'tidak ada snapshot Client Health untuk portofolio pada periode — dikecualikan + bobot didistribusi ulang',
    });
  } else {
    cands.push({ name: COMP_CHR_AVERAGE, included: true, raw: chrSum / chrN, reason: '' });
  }

  // Complaint Resolution Speed: avg resolution hours over complaints assigned to the
  // AM that reached [Resolved] in the period, transformed OA-1 against the
  // configurable resolution-SLA target (hours).
  const { avgHours, hasRes } = await amResolutionHours(sql, staffId, per);
  cands.push(await complaintResolutionCandidate(sql, avgHours, hasRes, per, pt));

  // Revision Escalation Rate (inverse): fraction of the portfolio's period-approved
  // Tasks that were revision-flagged (≥3 revisions, M12 Rule 15).
  cands.push(await amRevisionEscalation(sql, clientIds, per));
  return cands;
}

/** complaintResolutionCandidate normalizes average resolution hours via the OA-1 Speed transform. */
async function complaintResolutionCandidate(
  sql: Queryable,
  avgHours: number,
  hasRes: boolean,
  per: Period,
  pt: PlaceholderTracker,
): Promise<Candidate> {
  if (!hasRes) {
    return {
      name: COMP_COMPLAINT_RESOLUTION_SPEED,
      included: false,
      raw: 0,
      reason: 'tidak ada komplain yang selesai [Resolved] pada periode — dikecualikan + bobot didistribusi ulang',
    };
  }
  const { target, placeholder, ok } = await targetFor(sql, ROLE_AM, COMP_COMPLAINT_RESOLUTION_SPEED, per.startDate);
  if (!ok || target === 0) {
    return {
      name: COMP_COMPLAINT_RESOLUTION_SPEED,
      included: false,
      raw: 0,
      reason: 'target SLA resolusi komplain belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang',
    };
  }
  if (placeholder) {
    pt.used = true;
  }
  const speedPct = (avgHours / target) * 100;
  return { name: COMP_COMPLAINT_RESOLUTION_SPEED, included: true, raw: transformSpeed(speedPct), reason: '' };
}

/** amResolutionHours = mean (resolved_at − created_at) hours over complaints assigned to the AM that reached [Resolved] in the period. */
async function amResolutionHours(sql: Queryable, staffId: string, per: Period): Promise<{ avgHours: number; hasRes: boolean }> {
  const cpls = await sql<{ id: string; created_at: Date }[]>`
    select id, created_at from complaints where assigned_to = ${staffId}`;
  let sum = 0;
  let n = 0;
  for (const c of cpls) {
    const entries = await auditEntries(sql, 'complaint', c.id);
    const resolvedAt = firstTransitionInto(entries, '[Resolved]');
    if (resolvedAt === null || resolvedAt.getTime() < per.startUTC.getTime() || resolvedAt.getTime() >= per.endUTC.getTime()) {
      continue;
    }
    sum += (resolvedAt.getTime() - c.created_at.getTime()) / 3_600_000;
    n++;
  }
  if (n === 0) {
    return { avgHours: 0, hasRes: false };
  }
  return { avgHours: sum / n, hasRes: true };
}

/** amRevisionEscalation = 100 − flaggedFraction × 100 over the AM portfolio's period-approved Tasks. */
async function amRevisionEscalation(sql: Queryable, clientIds: string[], per: Period): Promise<Candidate> {
  let approved = 0;
  let flagged = 0;
  for (const cid of clientIds) {
    // Creative Assets.
    const assets = await sql<{ id: string; sla_target_hours: string | null }[]>`
      select a.id, a.sla_target_hours from assets a
        join briefs b on b.id = a.brief_id
        join services sv on sv.id = b.service_id
       where sv.client_id = ${cid}`;
    for (const a of assets) {
      const sla = a.sla_target_hours === null ? null : Number(a.sla_target_hours);
      const m = await assetMetrics(sql, a.id, sla);
      if (m.approvedPeriodWib !== per.approvedTag) {
        continue;
      }
      approved++;
      if (m.revisionFlagged) {
        flagged++;
      }
    }
    // Ads Briefs-as-task.
    const briefs = await sql<{ id: string; sla_target_hours: string | null }[]>`
      select b.id, b.sla_target_hours from briefs b
        join services sv on sv.id = b.service_id
       where sv.client_id = ${cid} and b.assigned_division = ${ADS_BRIEF_DIVISION}`;
    for (const b of briefs) {
      const sla = b.sla_target_hours === null ? null : Number(b.sla_target_hours);
      const m = await briefMetrics(sql, b.id, sla);
      if (m.approvedPeriodWib !== per.approvedTag) {
        continue;
      }
      approved++;
      if (m.revisionFlagged) {
        flagged++;
      }
    }
  }
  if (approved === 0) {
    return {
      name: COMP_REVISION_ESCALATION_RATE,
      included: false,
      raw: 0,
      reason: 'tidak ada Task portofolio yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
    };
  }
  return { name: COMP_REVISION_ESCALATION_RATE, included: true, raw: 100 - (flagged / approved) * 100, reason: '' };
}

// ---- shared candidate builders ----

/** speedCandidate builds the Speed Score candidate: average Speed Score % across the period-judged tasks, then the OA-1 transform. */
function speedCandidate(speedSum: number, judged: number): Candidate {
  if (judged === 0) {
    return { name: COMP_SPEED_SCORE, included: false, raw: 0, reason: 'tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' };
  }
  return { name: COMP_SPEED_SCORE, included: true, raw: transformSpeed(speedSum / judged), reason: '' };
}

/** revisionCandidate builds the inverse Revision Count candidate (100 − min(avg × 20, 100)) over the period-approved set. */
function revisionCandidate(revisionSum: number, approved: number): Candidate {
  if (approved === 0) {
    return { name: COMP_REVISION_COUNT, included: false, raw: 0, reason: 'tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang' };
  }
  const avg = revisionSum / approved;
  return { name: COMP_REVISION_COUNT, included: true, raw: 100 - Math.min(avg * REVISION_INVERSE_FACTOR, 100), reason: '' };
}

// ---- task-metric helpers (recompute from the immutable log, house rule 4) ----

async function assetMetrics(sql: Queryable, id: string, sla: number | null): Promise<{ speedScorePct: number | null; revisionCount: number; revisionFlagged: boolean; approvedPeriodWib: string }> {
  const trs = await taskTransitions(sql, 'asset', id);
  const m = computeMetrics(trs, sla);
  return { speedScorePct: m.speedScorePct, revisionCount: m.revisionCount, revisionFlagged: m.revisionFlagged, approvedPeriodWib: m.approvedPeriodWib };
}

async function briefMetrics(sql: Queryable, id: string, sla: number | null): Promise<{ speedScorePct: number | null; revisionCount: number; revisionFlagged: boolean; approvedPeriodWib: string }> {
  const trs = await taskTransitions(sql, 'brief', id);
  const m = computeMetrics(trs, sla);
  return { speedScorePct: m.speedScorePct, revisionCount: m.revisionCount, revisionFlagged: m.revisionFlagged, approvedPeriodWib: m.approvedPeriodWib };
}

/** auditEntries reads an entity's immutable audit log ascending as {action, at}. */
async function auditEntries(sql: Queryable, entityType: string, id: string): Promise<{ action: string; at: Date }[]> {
  const rows = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log where entity_type = ${entityType} and entity_id = ${id} order by id asc`;
  return rows.map((r) => ({ action: r.action, at: r.created_at }));
}

/** taskTransitions reads a canonical Task's immutable transition log ASCENDING as {to, at}. */
async function taskTransitions(sql: Queryable, entityType: string, id: string): Promise<Transition[]> {
  const entries = await auditEntries(sql, entityType, id);
  const out: Transition[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      out.push({ to, at: e.at });
    }
  }
  return out;
}

/** nativeTransitions maps audit entries to the {to, at} pairs kol.computeBookingMetrics expects (ascending). */
function nativeTransitions(entries: { action: string; at: Date }[]): { to: string; at: Date }[] {
  const out: { to: string; at: Date }[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      out.push({ to, at: e.at });
    }
  }
  return out;
}

/** transitionCountInPeriod counts transitions INTO `to` whose timestamp falls in the WIB period window. */
function transitionCountInPeriod(entries: { action: string; at: Date }[], to: string, per: Period): number {
  let n = 0;
  for (const e of entries) {
    if (transitionTarget(e.action) === to && e.at.getTime() >= per.startUTC.getTime() && e.at.getTime() < per.endUTC.getTime()) {
      n++;
    }
  }
  return n;
}

/** firstTransitionInto returns the timestamp of the first (earliest) transition INTO `to`, or null. */
function firstTransitionInto(entries: { action: string; at: Date }[], to: string): Date | null {
  for (const e of entries) {
    if (transitionTarget(e.action) === to) {
      return e.at; // entries are ascending → first match is earliest
    }
  }
  return null;
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

// ---------------------------------------------------------------------------
// Client-Outcome Modifier (modifier.go, §2 Rule 3 / §5.3 / OA-3/OA-4).
// ---------------------------------------------------------------------------

/** chrComponent is one entry of a CHR snapshot's components_json (only the fields the modifier needs). */
interface ChrComponent {
  name: string;
  included: boolean;
  capped: number | null;
}

/**
 * computeModifier builds the Client-Outcome Modifier for one staff member. Returns an
 * absent modifier (present=false, value 0) for AM, and for any role with no touched-
 * Client CHR data in the period.
 */
async function computeModifier(sql: Queryable, staffId: string, roleType: string, per: Period): Promise<Modifier> {
  const comp = MODIFIER_COMPONENT[roleType];
  if (comp === undefined) {
    return { present: false, value: 0, sourceComponent: '', sourceClients: [], rawAverage: null }; // AM — no modifier
  }
  const clients = await touchedClients(sql, staffId, roleType);

  let sum = 0;
  const used: string[] = [];
  for (const cid of clients) {
    const sub = await chrSubScore(sql, cid, per, comp);
    if (sub === null) {
      continue;
    }
    sum += sub;
    used.push(cid);
  }
  if (used.length === 0) {
    return { present: false, value: 0, sourceComponent: comp, sourceClients: [], rawAverage: null }; // absent (effective 0), recorded
  }
  used.sort();
  const avg = sum / used.length;
  return { present: true, value: clampModifier(avg), sourceComponent: comp, sourceClients: used, rawAverage: avg };
}

/** chrSubScore reads the CHR snapshot for (client, period) and returns the CAPPED sub-score of the requested component, or null. */
async function chrSubScore(sql: Queryable, clientId: string, per: Period, comp: string): Promise<number | null> {
  const rows = await sql<{ components_json: ChrComponent[] | string | null }[]>`
    select components_json from client_health_snapshots where client_id = ${clientId} and period_start = ${per.startDate}`;
  if (rows.length === 0) {
    return null;
  }
  const raw = rows[0].components_json;
  let comps: ChrComponent[];
  if (raw === null) {
    return null;
  } else if (typeof raw === 'string') {
    comps = raw.length > 0 ? (JSON.parse(raw) as ChrComponent[]) : [];
  } else {
    comps = raw;
  }
  for (const c of comps) {
    if (c.name === comp && c.included && c.capped !== null && c.capped !== undefined) {
      return c.capped;
    }
  }
  return null;
}

/**
 * touchedClients returns the distinct Client IDs the staff member is PIC on for the
 * role (decision point 3). The period scoping is enforced downstream by requiring a
 * same-period CHR snapshot (chrSubScore).
 */
async function touchedClients(sql: Queryable, staffId: string, roleType: string): Promise<string[]> {
  let rows: { client_id: string }[];
  switch (roleType) {
    case ROLE_CREATIVE:
      rows = await sql<{ client_id: string }[]>`
        select distinct sv.client_id from assets a
          join briefs b on b.id = a.brief_id
          join services sv on sv.id = b.service_id
         where a.assigned_pic = ${staffId}`;
      break;
    case ROLE_ADS:
      rows = await sql<{ client_id: string }[]>`
        select distinct sv.client_id from briefs b
          join services sv on sv.id = b.service_id
         where b.assigned_pic = ${staffId} and b.assigned_division = 'Ads'`;
      break;
    case ROLE_KOL:
      rows = await sql<{ client_id: string }[]>`
        select distinct sv.client_id from creator_bookings bk
          join briefs b on b.id = bk.brief_id
          join services sv on sv.id = b.service_id
         where bk.assigned_coordinator = ${staffId}`;
      break;
    default:
      return [];
  }
  return rows.map((r) => r.client_id);
}

// ---------------------------------------------------------------------------
// Compute + snapshot (snapshot.go).
// ---------------------------------------------------------------------------

interface Computed {
  roleType: string;
  components: Component[];
  profile: number | null; // null in the all-excluded case
  modifier: Modifier;
  final: number | null;
  placeholder: boolean;
}

/** computeFor gathers inputs and runs the scoring core for one staff + period. */
async function computeFor(sql: Queryable, staffId: string, roleType: string, per: Period): Promise<Computed> {
  const weights = await roleWeights(sql, roleType);
  const { cands, anyPlaceholder } = await gatherProfile(sql, staffId, roleType, per);
  const { components, profile, profileOk } = scoreProfile(weights, cands);
  const modifier = await computeModifier(sql, staffId, roleType, per);
  const prof = profileOk ? profile : null;
  return { roleType, components, profile: prof, modifier, final: boundFinal(prof, modifier), placeholder: anyPlaceholder };
}

/**
 * runScan is the authorised entry point for the sweep endpoint. Gate = Director only
 * (the sweep spans every division; decision point 5).
 */
export async function runScan(sql: Sql, actor: Actor, now: Date): Promise<ScanResult> {
  if (!canRunScan(actor)) {
    throw new ScanForbiddenError();
  }
  return runSnapshotJob(sql, now);
}

/**
 * runSnapshotJob is the monthly batch (§5.4): it scores every scored staff member for
 * the most-recently CLOSED calendar month and writes one immutable snapshot each.
 * Idempotent (UNIQUE (staff_id, period_start) + re-check), so it is safe to re-run.
 * Only staff whose CDPS role maps to a KPI Profile role type (Creative/Ads/KOL/AM,
 * staff level) are scored; a division without a profile or a lead is skipped.
 */
export async function runSnapshotJob(sql: Sql, now: Date): Promise<ScanResult> {
  const per = closedMonthPeriod(now);
  const res: ScanResult = { period: per.id, snapshotsMade: 0 };

  const staff = await sql<{ employee_id: string; division: string; level: string }[]>`
    select e.employee_id, rm.division, rm.level
      from employees e
      join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.status_aktif = true`;
  for (const sr of staff) {
    const roleType = roleTypeFor(sr.division, sr.level);
    if (roleType === null || roleType === '') {
      continue; // no KPI Profile for this division/level
    }
    if (await fireSnapshot(sql, sr.employee_id, roleType, per)) {
      res.snapshotsMade++;
    }
  }
  return res;
}

/**
 * fireSnapshot scores one staff member and inserts an immutable snapshot if none
 * exists yet (fire-once). The EvPerformancePublished emission (Flow 6) happens in the
 * SAME transaction as the insert, so it is naturally fire-once — a re-run finds the
 * snapshot already there and does nothing.
 */
async function fireSnapshot(sql: Sql, staffId: string, roleType: string, per: Period): Promise<boolean> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Serialise per-staff snapshot creation.
    const lock = await tx<{ employee_id: string }[]>`select employee_id from employees where employee_id = ${staffId} for update`;
    if (lock.length === 0) {
      return false; // employee vanished — skip
    }
    // Already snapshotted for this period? Idempotent no-op.
    const existing = await tx<{ id: string }[]>`
      select id from performance_snapshots where staff_id = ${staffId} and period_start = ${per.startDate}`;
    if (existing.length > 0) {
      return false;
    }

    const c = await computeFor(tx, staffId, roleType, per);
    const payload = { components: c.components, modifier: c.modifier, targets_placeholder: c.placeholder };
    const id = await ex.ident.identNext(PERF_PREFIX, per.startUTC);

    await tx`
      insert into performance_snapshots
        (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
      values (${id}, ${staffId}, ${roleType}, ${per.startDate}, ${per.endDate},
        ${c.profile}, ${c.modifier.value}, ${c.final}, ${JSON.stringify(payload)}, 'system')`;

    // EvPerformancePublished (Flow 6 / catalog FROZEN): notify the scored staff.
    // Fire-once by construction (one insert). Resolver = explicit (recipient = staff).
    await notification.emit(ex.notify, {
      event: notification.EVENTS.PerformancePublished,
      entityType: 'performance_snapshot',
      entityId: id,
      actor: 'system',
      explicitRecipients: [staffId],
    });
    return true;
  });
}

// ---- reads (Rule 7 visibility, Rule 8 full breakdown) ----

/**
 * getSnapshot returns one stored snapshot for a staff member. `periodId` ("YYYYMM")
 * picks a month; empty picks the latest. Visibility gated (Rule 7). NotFound when the
 * staff is invisible/absent or has no snapshot for the period.
 */
export async function getSnapshot(sql: Queryable, actor: Actor, staffId: string, periodId: string): Promise<Snapshot> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const pid = (periodId ?? '').trim();
  const rows = await sql<SnapshotRow[]>`
    select id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
      from performance_snapshots
     where staff_id = ${staffId}
       ${pid !== '' ? sql`and to_char(period_start, 'YYYYMM') = ${pid}` : sql``}
     order by period_start desc limit 1`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const snap = rowToSnapshot(rows[0]);
  if (!canView(actor, snap.staffId, snap.roleType)) {
    throw new NotFoundError();
  }
  return snap;
}

/**
 * previewCurrent computes the CURRENT, not-yet-closed WIB month's Performance Score
 * for a staff member READ-ONLY (Team Portal / M15). NEVER persisted, never on the
 * trend, and — unlike fireSnapshot — NEVER emits EvPerformancePublished. Reuses the
 * same computeFor gatherers as the batch sweep (no duplicated KPI logic, O19).
 * Visibility gated (Rule 7). NotFound when the staff has no scored KPI-Profile role
 * or is not visible to the actor.
 */
export async function previewCurrent(sql: Queryable, actor: Actor, staffId: string, now: Date): Promise<Snapshot> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const roleType = await staffRoleType(sql, staffId);
  if (roleType === null) {
    throw new NotFoundError();
  }
  if (!canView(actor, staffId, roleType)) {
    throw new NotFoundError();
  }
  const per = monthPeriod(now);
  const c = await computeFor(sql, staffId, roleType, per);
  return {
    id: '',
    staffId,
    roleType,
    periodStart: per.startDate,
    periodEnd: per.endDate,
    profileScore: c.profile,
    modifier: c.modifier,
    finalScore: c.final,
    scoreDisplay: scoreDisplay(c.final),
    components: c.components,
    targetsPlaceholder: c.placeholder,
    computedAt: null,
    computedBy: '',
    preview: true,
  };
}

/** staffRoleType resolves a staff member's Module 14 role type from role_mappings, or null. */
async function staffRoleType(sql: Queryable, staffId: string): Promise<string | null> {
  const rows = await sql<{ division: string; level: string }[]>`
    select rm.division, rm.level
      from employees e
      join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${staffId}`;
  if (rows.length === 0) {
    return null;
  }
  const rt = roleTypeFor(rows[0].division, rows[0].level);
  return rt === null || rt === '' ? null : rt;
}

/** trend returns every stored snapshot for a staff member, oldest first. Visibility gated (Rule 7). */
export async function trend(sql: Queryable, actor: Actor, staffId: string): Promise<Snapshot[]> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<SnapshotRow[]>`
    select id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
      from performance_snapshots where staff_id = ${staffId} order by period_start asc`;
  const out: Snapshot[] = [];
  let visible = false;
  let checked = false;
  for (const r of rows) {
    const snap = rowToSnapshot(r);
    if (!checked) {
      visible = canView(actor, snap.staffId, snap.roleType);
      checked = true;
    }
    if (!visible) {
      throw new NotFoundError();
    }
    out.push(snap);
  }
  return out;
}

/**
 * teamRollup returns the simple-average team view for a division + period (§2 Rule 5 /
 * OA-8): the members' snapshots plus the average of their final scores — DERIVED ON
 * READ. `division` selects the team; OD/Director may view any team, a lead only their
 * own. `periodId` empty = the latest period present.
 */
export async function teamRollup(sql: Queryable, actor: Actor, division: string, periodId: string): Promise<TeamRollup> {
  if (!canViewTeam(actor, division)) {
    throw new ForbiddenError();
  }
  const roleType = roleTypeOfDivision(division);
  if (roleType === '') {
    throw new NotFoundError();
  }
  let pid = (periodId ?? '').trim();
  if (pid === '') {
    const latest = await sql<{ p: string | null }[]>`
      select to_char(max(period_start), 'YYYYMM') as p from performance_snapshots where role_type = ${roleType}`;
    pid = latest[0].p ?? '';
  }
  const out: TeamRollup = { division, period: pid, members: [], teamAverage: null, averageDisplay: '—' };
  if (pid === '') {
    return out;
  }
  const rows = await sql<{ staff_id: string; role_type: string; final_score: string | null }[]>`
    select staff_id, role_type, final_score from performance_snapshots
     where role_type = ${roleType} and to_char(period_start, 'YYYYMM') = ${pid}
     order by staff_id`;
  let sum = 0;
  let scored = 0;
  for (const r of rows) {
    const final = r.final_score === null ? null : Number(r.final_score);
    if (final !== null) {
      sum += final;
      scored++;
    }
    out.members.push({ staffId: r.staff_id, roleType: r.role_type, finalScore: final, scoreDisplay: scoreDisplay(final) });
  }
  if (scored > 0) {
    out.teamAverage = sum / scored;
  }
  out.averageDisplay = scoreDisplay(out.teamAverage);
  return out;
}

// ---------------------------------------------------------------------------
// Row → Snapshot mapping.
// ---------------------------------------------------------------------------

interface SnapshotRow {
  id: string;
  staff_id: string;
  role_type: string;
  period_start: string | Date;
  period_end: string | Date;
  profile_score: string | null;
  modifier_value: string;
  final_score: string | null;
  components_json: { components?: Component[]; modifier?: Modifier; targets_placeholder?: boolean } | string | null;
  computed_at: Date;
  computed_by: string;
}

const EMPTY_MODIFIER: Modifier = { present: false, value: 0, sourceComponent: '', sourceClients: [], rawAverage: null };

function rowToSnapshot(r: SnapshotRow): Snapshot {
  const profile = r.profile_score === null ? null : Number(r.profile_score);
  const final = r.final_score === null ? null : Number(r.final_score);
  let payload: { components?: Component[]; modifier?: Modifier; targets_placeholder?: boolean } = {};
  if (r.components_json !== null) {
    payload = typeof r.components_json === 'string' ? JSON.parse(r.components_json) : r.components_json;
  }
  return {
    id: r.id,
    staffId: r.staff_id,
    roleType: r.role_type,
    periodStart: dateStr(r.period_start),
    periodEnd: dateStr(r.period_end),
    profileScore: profile,
    modifier: payload.modifier ?? { ...EMPTY_MODIFIER, value: Number(r.modifier_value) },
    finalScore: final,
    scoreDisplay: scoreDisplay(final),
    components: payload.components ?? [],
    targetsPlaceholder: payload.targets_placeholder ?? false,
    computedAt: r.computed_at,
    computedBy: r.computed_by,
    preview: false,
  };
}

// --- helpers ---

function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
