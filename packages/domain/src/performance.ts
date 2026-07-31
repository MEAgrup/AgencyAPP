/**
 * Team Performance domain service (M14). Ported from Go's
 * `internal/module14_performance/*`.
 *
 * Like Module 13 this is a pure AGGREGATION and scoring layer (§2 Rule 1): it
 * invents NO new raw KPI, only a per-staff, per-role, per-month weighted 0..100
 * rollup of KPIs that already live in Modules 7 (Output Quantity / GMV Impact),
 * 8 (ROAS / GMV Impact / Optimization Activity), 9 (Creator Count / QC Pass Rate
 * / Escalation), 12 (Speed Score / Revision Count) and 13 (Client Health Score),
 * plus a small cross-division Client-Outcome Modifier drawn from Module 13
 * snapshots (§2 Rule 3).
 *
 * The month boundary produces one immutable snapshot per scored staff member
 * (PERF-, §5.1). Everything a snapshot persists is recomputable from the
 * immutable event/timestamp logs of the source modules (house rule 4).
 *
 * Sections (mirroring the Go files):
 *   - perf.go     → role types, component keys, errors, visibility predicates.
 *   - profile.go  → the PURE KPI-Profile scoring core (transforms, redistribution,
 *     modifier clamp, bounding), no DB dependency, exhaustively unit-testable.
 *   - config.go   → per-role KPI-Profile weights + period targets (Director-gated,
 *     audited).
 *   - modifier.go → the cross-division Client-Outcome Modifier (M13 CHR- snapshots).
 *   - compute.go  → gathers each role's raw KPIs from M7/M8/M9/M12/M13 for a
 *     staff-month.
 *   - snapshot.go → the monthly batch, immutable per-staff snapshot, reads, rollup.
 */

import { deeplink, money, notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { computeMetrics, type Transition } from './task';
import { computeBookingMetrics, BKG_QC_FAILED, BKG_ESCALATED } from './kol';
import { parseRoasTarget } from './ads';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Role types (§5.1) and CDPS divisions.
// ---------------------------------------------------------------------------

export const ROLE_CREATIVE = 'Creative';
export const ROLE_ADS = 'Ads';
export const ROLE_KOL = 'KOL';
export const ROLE_AM = 'AM';

export const CREATIVE_DIVISION = 'Creative';
export const ADS_DIVISION = 'Ads';
export const KOL_DIVISION = 'KOL';
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Component keys (§2 Rule 2). Stable string keys — persisted in perf_kpi_weights,
// perf_period_targets and components_json, and surfaced in the API, so they never
// change.
// ---------------------------------------------------------------------------

export const COMP_SPEED_SCORE = 'speed_score';
export const COMP_OUTPUT_QUANTITY = 'output_quantity';
export const COMP_GMV_IMPACT = 'gmv_impact';
export const COMP_REVISION_COUNT = 'revision_count';
export const COMP_ROAS_ATTAINMENT = 'roas_attainment';
export const COMP_OPTIMIZATION_ACTIVITY = 'optimization_activity';
export const COMP_CREATOR_COUNT = 'creator_count';
export const COMP_QC_PASS_RATE = 'qc_pass_rate';
export const COMP_ESCALATION_RATE = 'escalation_rate';
export const COMP_CHR_AVERAGE = 'chr_average';
export const COMP_COMPLAINT_RESOLUTION_SPEED = 'complaint_resolution_speed';
export const COMP_REVISION_ESCALATION_RATE = 'revision_escalation_rate';
/** Diagnostic (reported, NEVER weighted — §2 Rule 2 KOL row). */
export const COMP_SOURCING_TURNAROUND = 'sourcing_turnaround';

/**
 * modifierComponent maps a role type to the Module 13 Health-Score sub-component
 * its Client-Outcome Modifier draws from (§5.3 / OA-4): Creative → Revision
 * Burden, Ads → ROAS Attainment, KOL → Task Completion. AM has no modifier
 * (Rule 3). The values are the Module 13 components_json component keys, referenced
 * as literals (frozen persisted keys, module13_health §5.6).
 */
const modifierComponent: Record<string, string> = {
  [ROLE_CREATIVE]: 'revision_burden',
  [ROLE_ADS]: 'roas_attainment',
  [ROLE_KOL]: 'task_completion',
};

// ---------------------------------------------------------------------------
// Verbatim BI messages + errors (mapped in apps/api http.ts).
// ---------------------------------------------------------------------------

/** The actor has no M14 read scope (e.g. a Sales staffer). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
/** The snapshot / staff does not exist OR is not visible to the actor. */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** The actor may not trigger the monthly snapshot sweep (Director only). */
export const MSG_SCAN_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan pemindaian skor performa tim]';
/** The actor may not edit KPI weights / period targets (Director only). */
export const MSG_CONFIG_FORBIDDEN = '[anda tidak memiliki akses untuk mengubah konfigurasi KPI performa]';
/** An admin weight write whose Σ per role_type != 100. */
export const MSG_WEIGHTS_NOT_HUNDRED = '[total bobot KPI harus berjumlah 100]';
/** An unknown role_type in a config write. */
export const MSG_BAD_ROLE_TYPE = '[format data tidak valid]';

/** Bad/missing input (→ 400): Σ≠100 weights, unknown role type. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerformanceValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'PerformanceForbiddenError';
  }
}
/** The referenced snapshot / staff does not exist or is not visible (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'PerformanceNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Visibility (§2 Rule 7).
// ---------------------------------------------------------------------------

/** divisionOfRole maps a role type back to the CDPS division whose lead/SPV may see that staff's scores. */
function divisionOfRole(roleType: string): string {
  return roleType === ROLE_AM ? ACCOUNT_DIVISION : roleType; // Creative/Ads/KOL are 1:1
}

/** canView reports whether actor may see a snapshot for staffID in roleType (Rule 7). */
export function canView(actor: Actor, staffID: string, roleType: string): boolean {
  if (actor.role.director || actor.role.od) {
    return true; // Director full; OD read-only everywhere
  }
  if (actor.employeeId === staffID) {
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

/** canRunScan authorises the on-demand snapshot sweep (Director only; spans all divisions). */
export function canRunScan(a: Actor): boolean {
  return a.role.director;
}

/** canManageConfig authorises editing KPI weights + period targets (Director only). */
export function canManageConfig(a: Actor): boolean {
  return a.role.director;
}

/** canViewTeam authorises a team rollup for a division (Rule 7): OD/Director any team; a lead only their own. */
export function canViewTeam(a: Actor, division: string): boolean {
  if (a.role.director || a.role.od) {
    return true;
  }
  return a.role.level === permission.LevelLead && a.role.division === division;
}

// ---------------------------------------------------------------------------
// PURE scoring core (§ profile.go).
// ---------------------------------------------------------------------------

/**
 * One scored (or excluded, or diagnostic) component of a Performance Score. `raw`
 * is the UNCAPPED sub-metric kept for diagnosis (§5.5); `capped` is the [0,100]
 * value used in the weighted math. When `included` is false the component
 * contributed nothing and its weight was redistributed (Rule 6) — raw/capped are
 * then null and excludedReason explains why. A diagnostic component (KOL Sourcing
 * Turnaround) is REPORTED with its raw value but carries no weight and never
 * participates in redistribution (§2 Rule 2).
 */
export interface Component {
  name: string;
  included: boolean;
  diagnostic: boolean;
  raw: number | null;
  capped: number | null;
  baseWeight: number;
  effectiveWeight: number;
  excludedReason: string;
}

/** candidate is the raw pre-scoring input for one component (compute builds these). */
interface Candidate {
  name: string;
  included: boolean;
  raw: number;
  reason: string;
  diagnostic: boolean;
}

/** cand builds a Candidate with sensible defaults. */
function cand(c: Partial<Candidate> & { name: string }): Candidate {
  return { name: c.name, included: c.included ?? false, raw: c.raw ?? 0, reason: c.reason ?? '', diagnostic: c.diagnostic ?? false };
}

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

/** clamp01to100 caps a value to the [0,100] sub-score range (also the OA-2 "capped at 100" rule). */
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
 * AVAILABLE weighted components are re-normalised to sum to 100 — each available
 * weight is scaled by 100/Σ(available base weights) — so an excluded component is
 * never scored as 0. Diagnostic candidates are appended as reported-only rows
 * (weight 0) and never enter the base or the weighted sum.
 *
 * profileOk is false only in the all-excluded case; the caller renders the score
 * as "—" (house rule 7) and no band.
 */
export function scoreProfile(
  weights: Record<string, number>,
  cands: Candidate[],
): { comps: Component[]; profile: number; profileOk: boolean } {
  let availableBase = 0;
  for (const c of cands) {
    if (c.diagnostic) {
      continue;
    }
    if (c.included) {
      availableBase += weights[c.name] ?? 0;
    }
  }

  const comps: Component[] = [];
  let weighted = 0;
  for (const c of cands) {
    if (c.diagnostic) {
      // Diagnostic rows are reported by their RAW value only. capped stays null —
      // a diagnostic carries no 0..100 sub-score and never enters the weighted math.
      const comp: Component = {
        name: c.name, included: false, diagnostic: true, raw: null, capped: null,
        baseWeight: 0, effectiveWeight: 0, excludedReason: '',
      };
      if (c.included) {
        comp.included = true;
        comp.raw = c.raw;
      } else {
        comp.excludedReason = c.reason;
      }
      comps.push(comp);
      continue;
    }
    const base = weights[c.name] ?? 0;
    const comp: Component = {
      name: c.name, included: false, diagnostic: false, raw: null, capped: null,
      baseWeight: base, effectiveWeight: 0, excludedReason: '',
    };
    if (c.included && availableBase > 0) {
      const capped = clamp01to100(c.raw);
      const eff = (base * 100) / availableBase;
      comp.included = true;
      comp.raw = c.raw;
      comp.capped = capped;
      comp.effectiveWeight = eff;
      weighted += (eff / 100) * capped;
    } else {
      comp.excludedReason = c.reason;
    }
    comps.push(comp);
  }

  if (availableBase === 0) {
    return { comps, profile: 0, profileOk: false };
  }
  // Guard against float dust just past 100/0 from the re-normalisation.
  let profile = Math.round(weighted * 1000) / 1000;
  if (profile > 100) {
    profile = 100;
  }
  if (profile < 0) {
    profile = 0;
  }
  return { comps, profile, profileOk: true };
}

/**
 * The Client-Outcome Modifier (§2 Rule 3 / §5.3): the value applied on top of the
 * KPI Profile, the Module 13 sub-component it drew from, the clients that
 * contributed, and the raw average before the clamp. present=false when the role
 * has no modifier (AM) or no CHR source data was available — the effective value
 * is then 0 (recorded, not silently dropped).
 */
export interface Modifier {
  present: boolean;
  value: number;
  sourceComponent: string;
  sourceClients: string[];
  rawAverage: number | null;
}

/** emptyModifier constructs the absent (effective 0) modifier. */
function emptyModifier(sourceComponent = ''): Modifier {
  return { present: false, value: 0, sourceComponent, sourceClients: [], rawAverage: null };
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
 * 0..100 (Rule 4). profile is null in the all-excluded case, which yields a null
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

/** scoreDisplay renders a final score for the UI: two decimals, or "—" when all-excluded (house rule 7). */
export function scoreDisplay(final: number | null): string {
  return final === null ? '—' : final.toFixed(2);
}

// ---------------------------------------------------------------------------
// Period math (§ compute.go — one scored WIB calendar month, O20).
// ---------------------------------------------------------------------------

const OFFSET_MS = tz.WIB_OFFSET_HOURS * 3_600_000;
const MS_PER_HOUR = 3_600_000;

/** period carries the bounds the gatherers need for one WIB calendar month. */
interface Period {
  start: Date; // WIB midnight, first day of month (UTC instant), inclusive
  startDate: string; // "YYYY-MM-01"
  endDate: string; // last day, "YYYY-MM-DD" (inclusive DATE upper bound)
  startUTC: Date; // start instant (inclusive)
  endUTC: Date; // next-month start (exclusive)
  approvedTag: string; // "YYYY-MM" — compared against task/kol ApprovedPeriodWib
  id: string; // "YYYYMM" — id bucket
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** monthPeriod builds the Period the WIB-calendar-month of `anchor` falls in. */
function monthPeriod(anchor: Date): Period {
  const ds = tz.dateString(anchor); // "YYYY-MM-DD" WIB
  const year = Number(ds.slice(0, 4));
  const month = Number(ds.slice(5, 7)); // 1..12
  const startUTC = new Date(Date.UTC(year, month - 1, 1) - OFFSET_MS);
  const endUTC = new Date(Date.UTC(year, month, 1) - OFFSET_MS); // Date.UTC handles month=12 wrap
  const lastDay = new Date(endUTC.getTime() - 24 * MS_PER_HOUR); // WIB midnight of the last day
  return {
    start: startUTC,
    startDate: `${year}-${pad2(month)}-01`,
    endDate: tz.dateString(lastDay),
    startUTC,
    endUTC,
    approvedTag: `${year}-${pad2(month)}`,
    id: `${year}${pad2(month)}`,
  };
}

/** closedMonthPeriod is the most-recently CLOSED WIB calendar month (previous month) — the month the batch scores (§5.4). */
function closedMonthPeriod(now: Date): Period {
  const cur = monthPeriod(now);
  const prevAnchor = new Date(cur.start.getTime() - 24 * MS_PER_HOUR); // one day before this month's start → previous month
  return monthPeriod(prevAnchor);
}

// ---------------------------------------------------------------------------
// Config — KPI Profile weights + period targets (§ config.go).
// ---------------------------------------------------------------------------

/** The sentinel period_start meaning "applies to every period unless a period-specific override exists". */
const DEFAULT_TARGET_DATE = '0001-01-01';

/** The closed set a config write may target. */
const validRoleTypes = new Set([ROLE_CREATIVE, ROLE_ADS, ROLE_KOL, ROLE_AM]);

/** One (role_type, component) weight row. */
export interface KPIWeight {
  roleType: string;
  component: string;
  weight: number;
  updatedAt: Date;
  updatedBy: string;
}

/** One normalisation target row. */
export interface PeriodTarget {
  roleType: string;
  component: string;
  periodStart: string; // "YYYY-MM-DD"; DEFAULT_TARGET_DATE = applies to all periods
  targetValue: number;
  isPlaceholder: boolean; // O9: true = illustrative seed, NOT a confirmed target
  updatedAt: Date;
  updatedBy: string;
}

/** roleWeights loads the weight map for one role_type (component → weight). Internal; never gated. */
async function roleWeights(q: Queryable, roleType: string): Promise<Record<string, number>> {
  const rows = await q<{ component: string; weight: string }[]>`
    select component, weight from perf_kpi_weights where role_type = ${roleType}`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.component] = Number(r.weight);
  }
  return out;
}

/** listWeights returns every configured weight, for the admin UI + read surfaces. Read-gated by canScope. */
export async function listWeights(sql: Queryable, actor: Actor): Promise<KPIWeight[]> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<{ role_type: string; component: string; weight: string; updated_at: Date; updated_by: string }[]>`
    select role_type, component, weight, updated_at, updated_by
      from perf_kpi_weights order by role_type, component`;
  return rows.map((r) => ({
    roleType: r.role_type, component: r.component, weight: Number(r.weight), updatedAt: r.updated_at, updatedBy: r.updated_by,
  }));
}

/**
 * setWeights replaces the FULL weight set for one role_type in a single atomic
 * write (§5.2 / OA-5). The incoming components must sum to exactly 100
 * (MSG_WEIGHTS_NOT_HUNDRED) — validated server-side before any row is touched.
 * Director only. The change is appended to the immutable audit_log (before→after).
 * Setting weights does NOT recompute or mutate any existing snapshot (immutable) —
 * it affects the next run.
 */
export async function setWeights(sql: Sql, actor: Actor, roleType: string, weights: Record<string, number>): Promise<void> {
  if (!canManageConfig(actor)) {
    throw new ForbiddenError(MSG_CONFIG_FORBIDDEN);
  }
  if (!validRoleTypes.has(roleType)) {
    throw new ValidationError(MSG_BAD_ROLE_TYPE);
  }
  let sum = 0;
  for (const w of Object.values(weights)) {
    sum += w;
  }
  if (Math.abs(sum - 100) > 1e-6) {
    throw new ValidationError(MSG_WEIGHTS_NOT_HUNDRED);
  }
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await roleWeights(tx, roleType);
    await tx`delete from perf_kpi_weights where role_type = ${roleType}`;
    for (const [comp, w] of Object.entries(weights)) {
      await tx`insert into perf_kpi_weights (role_type, component, weight, updated_by)
        values (${roleType}, ${comp}, ${w}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: 'perf_kpi_weights', entityId: roleType, actorEmployeeId: actor.employeeId, action: 'weights_set',
      beforeJson: { weights: before }, afterJson: { weights }, createdBy: actor.employeeId,
    });
  });
}

/**
 * targetFor resolves the normalisation target for (role_type, component) in a
 * period: an exact period-specific row wins, else the sentinel default row. ok is
 * false when no target is configured at all. placeholder is surfaced so a snapshot
 * can flag that its normalisation used an unconfirmed target.
 */
async function targetFor(
  q: Queryable,
  roleType: string,
  component: string,
  periodStartDate: string,
): Promise<{ target: number; placeholder: boolean; ok: boolean }> {
  const exact = await q<{ target_value: string; is_placeholder: boolean }[]>`
    select target_value, is_placeholder from perf_period_targets
     where role_type = ${roleType} and component = ${component} and period_start = ${periodStartDate}`;
  if (exact.length > 0) {
    return { target: Number(exact[0].target_value), placeholder: exact[0].is_placeholder, ok: true };
  }
  const def = await q<{ target_value: string; is_placeholder: boolean }[]>`
    select target_value, is_placeholder from perf_period_targets
     where role_type = ${roleType} and component = ${component} and period_start = ${DEFAULT_TARGET_DATE}`;
  if (def.length > 0) {
    return { target: Number(def[0].target_value), placeholder: def[0].is_placeholder, ok: true };
  }
  return { target: 0, placeholder: false, ok: false };
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
    roleType: r.role_type, component: r.component, periodStart: dateStr(r.period_start),
    targetValue: Number(r.target_value), isPlaceholder: r.is_placeholder, updatedAt: r.updated_at, updatedBy: r.updated_by,
  }));
}

/** setTargetInput is the mutable subset of a PeriodTarget an admin writes. */
export interface SetTargetInput {
  roleType: string;
  component: string;
  periodStart: string; // "" defaults to the sentinel (applies to every period)
  targetValue: number;
  isPlaceholder: boolean;
}

/**
 * setTarget upserts one normalisation target (§2 Rule 2 / O9). Director only. When
 * a real target is entered the caller sets isPlaceholder=false; the seed rows stay
 * flagged placeholder until then. periodStart "" defaults to the sentinel. Appended
 * to the immutable audit_log (before→after).
 */
export async function setTarget(sql: Sql, actor: Actor, t: SetTargetInput): Promise<void> {
  if (!canManageConfig(actor)) {
    throw new ForbiddenError(MSG_CONFIG_FORBIDDEN);
  }
  if (!validRoleTypes.has(t.roleType)) {
    throw new ValidationError(MSG_BAD_ROLE_TYPE);
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
      entityType: 'perf_period_targets', entityId: `${t.roleType}/${t.component}/${periodStart}`,
      actorEmployeeId: actor.employeeId, action: 'target_set',
      beforeJson: null, afterJson: { target_value: t.targetValue, is_placeholder: t.isPlaceholder }, createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Client-Outcome Modifier (§ modifier.go).
// ---------------------------------------------------------------------------

/** One entry of a CHR snapshot's components_json (module13_health §5.6). */
interface ChrComponent {
  name: string;
  included: boolean;
  capped: number | null;
}

/**
 * computeModifier builds the Client-Outcome Modifier for one staff member. Returns
 * an absent modifier (present=false, value 0) for AM, and for any role with no
 * touched-Client CHR data in the period.
 */
async function computeModifier(q: Queryable, staffID: string, roleType: string, per: Period): Promise<Modifier> {
  const comp = modifierComponent[roleType];
  if (comp === undefined) {
    return emptyModifier(); // AM — no modifier (Rule 3)
  }
  const clients = await touchedClients(q, staffID, roleType);

  let sum = 0;
  const used: string[] = [];
  for (const cid of clients) {
    const sub = await chrSubScore(q, cid, per, comp);
    if (sub === null) {
      continue;
    }
    sum += sub;
    used.push(cid);
  }
  if (used.length === 0) {
    return emptyModifier(comp); // absent (effective 0), recorded
  }
  used.sort();
  const avg = sum / used.length;
  return { present: true, value: clampModifier(avg), sourceComponent: comp, sourceClients: used, rawAverage: avg };
}

/**
 * chrSubScore reads the CHR snapshot for (client, period) and returns the CAPPED
 * sub-score of the requested component. null when there is no snapshot for the
 * period, or the component is absent/excluded in it.
 */
async function chrSubScore(q: Queryable, clientID: string, per: Period, comp: string): Promise<number | null> {
  const rows = await q<{ components_json: unknown }[]>`
    select components_json from client_health_snapshots where client_id = ${clientID} and period_start = ${per.startDate}`;
  if (rows.length === 0) {
    return null;
  }
  const comps = parseJsonb<ChrComponent[]>(rows[0].components_json) ?? [];
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
 * same-period CHR snapshot (chrSubScore), so this returns the PIC linkage per role.
 */
async function touchedClients(q: Queryable, staffID: string, roleType: string): Promise<string[]> {
  let rows: { client_id: string }[];
  switch (roleType) {
    case ROLE_CREATIVE:
      rows = await q<{ client_id: string }[]>`
        select distinct sv.client_id
          from assets a
          join briefs b on b.id = a.brief_id
          join services sv on sv.id = b.service_id
         where a.assigned_pic = ${staffID}`;
      break;
    case ROLE_ADS:
      rows = await q<{ client_id: string }[]>`
        select distinct sv.client_id
          from briefs b
          join services sv on sv.id = b.service_id
         where b.assigned_pic = ${staffID} and b.assigned_division = 'Ads'`;
      break;
    case ROLE_KOL:
      rows = await q<{ client_id: string }[]>`
        select distinct sv.client_id
          from creator_bookings bk
          join briefs b on b.id = bk.brief_id
          join services sv on sv.id = b.service_id
         where bk.assigned_coordinator = ${staffID}`;
      break;
    default:
      return [];
  }
  return rows.map((r) => r.client_id);
}

// ---------------------------------------------------------------------------
// Compute — gather per-role raw KPI inputs (§ compute.go).
// ---------------------------------------------------------------------------

const ADS_BRIEF_DIVISION = 'Ads';
/** Mirrors Module 13's Revision Burden transform (100 − min(avg × 20, 100)). avg 0 → 100; avg 5+ → 0. */
const REVISION_INVERSE_FACTOR = 20;

/** placeholderTracker records whether any target lookup returned a placeholder. */
interface PlaceholderTracker {
  used: boolean;
}

/**
 * gatherProfile assembles the weighted (+ diagnostic) candidates for one staff
 * member's role type and period. anyPlaceholder reports whether any raw-value
 * normalisation fell back to a placeholder target (O9).
 */
async function gatherProfile(
  q: Queryable,
  staffID: string,
  roleType: string,
  per: Period,
): Promise<{ cands: Candidate[]; anyPlaceholder: boolean }> {
  const pt: PlaceholderTracker = { used: false };
  let cands: Candidate[];
  switch (roleType) {
    case ROLE_CREATIVE:
      cands = await creativeCandidates(q, staffID, per, pt);
      break;
    case ROLE_ADS:
      cands = await adsCandidates(q, staffID, per, pt);
      break;
    case ROLE_KOL:
      cands = await kolCandidates(q, staffID, per, pt);
      break;
    case ROLE_AM:
      cands = await amCandidates(q, staffID, per, pt);
      break;
    default:
      return { cands: [], anyPlaceholder: false };
  }
  return { cands, anyPlaceholder: pt.used };
}

/**
 * normalized builds a raw-value candidate normalized as Actual ÷ Period Target ×
 * 100 (OA-2; the cap to 100 is applied later by scoreProfile). When no target is
 * configured the component is excluded + redistributed. absentReason is used when
 * the actual is structurally absent.
 */
async function normalized(
  q: Queryable,
  roleType: string,
  comp: string,
  per: Period,
  actual: number,
  hasActual: boolean,
  absentReason: string,
  pt: PlaceholderTracker,
): Promise<Candidate> {
  if (!hasActual) {
    return cand({ name: comp, included: false, reason: absentReason });
  }
  const { target, placeholder, ok } = await targetFor(q, roleType, comp, per.startDate);
  if (!ok || target === 0) {
    return cand({
      name: comp, included: false,
      reason: 'target periode belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang',
    });
  }
  if (placeholder) {
    pt.used = true;
  }
  return cand({ name: comp, included: true, raw: (actual / target) * 100 });
}

// ---- Creative (staff = assets.assigned_pic) ----

async function creativeCandidates(q: Queryable, staffID: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const assets = await q<{ id: string; sla_target_hours: string | null; attributed_gmv: string | null }[]>`
    select id, sla_target_hours, attributed_gmv from assets where assigned_pic = ${staffID}`;

  let approvedInPeriod = 0;
  let slaJudged = 0;
  let speedSum = 0;
  let revisionSum = 0;
  let gmvSum = 0;
  for (const ar of assets) {
    const sla = ar.sla_target_hours === null ? null : Number(ar.sla_target_hours);
    const m = await assetMetrics(q, ar.id, sla);
    if (m.approvedPeriodWib !== per.approvedTag) {
      continue;
    }
    approvedInPeriod++;
    revisionSum += m.revisionCount;
    if (ar.attributed_gmv !== null) {
      gmvSum += Number(money.parse(ar.attributed_gmv)) / 100;
    }
    if (m.speedScorePct !== null) {
      slaJudged++;
      speedSum += m.speedScorePct;
    }
  }

  const cands: Candidate[] = [];
  cands.push(speedCandidate(speedSum, slaJudged));
  cands.push(await normalized(q, ROLE_CREATIVE, COMP_OUTPUT_QUANTITY, per, approvedInPeriod, true, '', pt));
  cands.push(
    await normalized(q, ROLE_CREATIVE, COMP_GMV_IMPACT, per, gmvSum, approvedInPeriod > 0,
      'tidak ada Asset [Approved] pada periode — GMV Impact dikecualikan + bobot didistribusi ulang', pt),
  );
  cands.push(revisionCandidate(revisionSum, approvedInPeriod));
  return cands;
}

// ---- Ads (staff = setup Brief.assigned_pic; optimizations by actor) ----

async function adsCandidates(q: Queryable, staffID: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const briefs = await q<{ id: string; sla_target_hours: string | null }[]>`
    select id, sla_target_hours from briefs where assigned_pic = ${staffID} and assigned_division = ${ADS_BRIEF_DIVISION}`;

  let slaJudged = 0;
  let speedSum = 0;
  for (const br of briefs) {
    const sla = br.sla_target_hours === null ? null : Number(br.sla_target_hours);
    const m = await briefMetrics(q, br.id, sla);
    if (m.approvedPeriodWib !== per.approvedTag || m.speedScorePct === null) {
      continue;
    }
    slaJudged++;
    speedSum += m.speedScorePct;
  }

  const camp = await adsCampaignMetrics(q, staffID, per);

  // Optimization Activity = optimizations this staff logged in the period.
  const optRows = await q<{ n: string }[]>`
    select count(*) as n from optimization_logs
     where actor = ${staffID} and created_at >= ${per.startUTC} and created_at < ${per.endUTC}`;
  const optCount = Number(optRows[0].n);

  const cands: Candidate[] = [];
  cands.push(speedCandidate(speedSum, slaJudged));
  if (camp.hasROAS) {
    cands.push(cand({ name: COMP_ROAS_ATTAINMENT, included: true, raw: camp.roasRaw }));
  } else {
    cands.push(cand({
      name: COMP_ROAS_ATTAINMENT, included: false,
      reason: 'tidak ada data ROAS/target pada campaign yang dikelola periode ini — dikecualikan + bobot didistribusi ulang',
    }));
  }
  cands.push(
    await normalized(q, ROLE_ADS, COMP_GMV_IMPACT, per, camp.gmvSum, camp.hasCampaigns,
      'tidak ada campaign yang dikelola pada periode — GMV Impact dikecualikan + bobot didistribusi ulang', pt),
  );
  cands.push(await normalized(q, ROLE_ADS, COMP_OPTIMIZATION_ACTIVITY, per, optCount, true, '', pt));
  return cands;
}

/**
 * adsCampaignMetrics folds the staff's managed campaigns into a single ROAS
 * Attainment sub-score (mean of per-campaign period-ROAS ÷ target-ROAS × 100) and
 * the Σ period GMV. hasROAS is false when no managed campaign had BOTH period spend
 * and a parseable ROAS target. hasCampaigns is false when the staff manages none.
 */
async function adsCampaignMetrics(
  q: Queryable,
  staffID: string,
  per: Period,
): Promise<{ roasRaw: number; hasROAS: boolean; gmvSum: number; hasCampaigns: boolean }> {
  const camps = await q<{ id: string; target_kpi: string }[]>`
    select c.id, c.target_kpi
      from ad_campaigns c
      join briefs b on b.id = c.brief_id
     where b.assigned_pic = ${staffID}`;
  if (camps.length === 0) {
    return { roasRaw: 0, hasROAS: false, gmvSum: 0, hasCampaigns: false };
  }

  let gmvSum = 0;
  let ratioSum = 0;
  let ratioN = 0;
  for (const c of camps) {
    const { spend, gmv, hasData } = await campaignPeriodSpendGMV(q, c.id, per);
    if (hasData) {
      gmvSum += gmv; // rupiah
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

/**
 * campaignPeriodSpendGMV = Σ spend / Σ gmv (rupiah) over the campaign's Metric
 * Entries whose period_start falls in the snapshot month. hasData=false when the
 * campaign has no metric row in the period.
 */
async function campaignPeriodSpendGMV(
  q: Queryable,
  campaignID: string,
  per: Period,
): Promise<{ spend: number; gmv: number; hasData: boolean }> {
  const rows = await q<{ spend: string | null; gmv: string | null }[]>`
    select sum(spend) as spend, sum(gmv) as gmv from metric_entries
     where campaign_id = ${campaignID} and period_start between ${per.startDate} and ${per.endDate}`;
  const r = rows[0];
  if (!r || r.spend === null || r.gmv === null) {
    return { spend: 0, gmv: 0, hasData: false };
  }
  return { spend: Number(money.parse(r.spend)) / 100, gmv: Number(money.parse(r.gmv)) / 100, hasData: true };
}

// ---- KOL (staff = creator_bookings.assigned_coordinator) ----

async function kolCandidates(q: Queryable, staffID: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const bookings = await q<{ id: string; status: string; created_at: Date; sla_target_hours: string | null }[]>`
    select id, status, created_at, sla_target_hours from creator_bookings where assigned_coordinator = ${staffID}`;

  let passedInPeriod = 0;
  let qcActivity = 0;
  let escalations = 0;
  let terminalActivity = 0;
  let speedSum = 0;
  let speedN = 0;
  let sourcingSum = 0;
  let sourcingN = 0;
  for (const b of bookings) {
    const evs = await transitionsFor(q, 'creator_booking', b.id);
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
    const qcFailed = transitionCountInPeriod(evs, BKG_QC_FAILED, per);
    const esc = transitionCountInPeriod(evs, BKG_ESCALATED, per);
    qcActivity += qcFailed;
    if (esc > 0) {
      escalations++;
      terminalActivity++;
    }
  }

  const cands: Candidate[] = [];
  cands.push(await normalized(q, ROLE_KOL, COMP_CREATOR_COUNT, per, passedInPeriod, true, '', pt));
  if (qcActivity === 0) {
    cands.push(cand({
      name: COMP_QC_PASS_RATE, included: false,
      reason: 'tidak ada aktivitas QC pada periode — dikecualikan + bobot didistribusi ulang',
    }));
  } else {
    cands.push(cand({ name: COMP_QC_PASS_RATE, included: true, raw: (passedInPeriod / qcActivity) * 100 }));
  }
  cands.push(speedCandidate(speedSum, speedN));
  if (terminalActivity === 0) {
    cands.push(cand({
      name: COMP_ESCALATION_RATE, included: false,
      reason: 'tidak ada booking terminal (QC Passed/Escalated) pada periode — dikecualikan + bobot didistribusi ulang',
    }));
  } else {
    cands.push(cand({ name: COMP_ESCALATION_RATE, included: true, raw: 100 - (escalations / terminalActivity) * 100 }));
  }
  // Sourcing Turnaround — DIAGNOSTIC (reported, unweighted; §2 Rule 2 KOL row).
  if (sourcingN === 0) {
    cands.push(cand({
      name: COMP_SOURCING_TURNAROUND, diagnostic: true, included: false,
      reason: 'tidak ada booking [Booked] pada periode — turnaround sourcing tidak tersedia',
    }));
  } else {
    cands.push(cand({ name: COMP_SOURCING_TURNAROUND, diagnostic: true, included: true, raw: sourcingSum / sourcingN }));
  }
  return cands;
}

// ---- AM (staff = clients.assigned_am_id) ----

async function amCandidates(q: Queryable, staffID: string, per: Period, pt: PlaceholderTracker): Promise<Candidate[]> {
  const clientRows = await q<{ id: string }[]>`select id from clients where assigned_am_id = ${staffID}`;
  const clientIDs = clientRows.map((r) => r.id);

  const cands: Candidate[] = [];

  // CHR Average (M13 §8/OA-6): mean final_health_score over the portfolio's CHR
  // snapshots for the SAME period.
  let chrSum = 0;
  let chrN = 0;
  for (const cid of clientIDs) {
    const rows = await q<{ final_health_score: string | null }[]>`
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
    cands.push(cand({
      name: COMP_CHR_AVERAGE, included: false,
      reason: 'tidak ada snapshot Client Health untuk portofolio pada periode — dikecualikan + bobot didistribusi ulang',
    }));
  } else {
    cands.push(cand({ name: COMP_CHR_AVERAGE, included: true, raw: chrSum / chrN }));
  }

  // Complaint Resolution Speed: avg resolution hours over complaints assigned to
  // the AM that reached [Resolved] in the period, transformed OA-1.
  const res = await amResolutionHours(q, staffID, per);
  cands.push(await complaintResolutionCandidate(q, res.avgHours, res.hasRes, per, pt));

  // Revision Escalation Rate (inverse): fraction of the portfolio's period-approved
  // Tasks that were revision-flagged (≥3 revisions, M12 Rule 15).
  cands.push(await amRevisionEscalation(q, clientIDs, per));
  return cands;
}

/**
 * complaintResolutionCandidate normalizes average resolution hours via the OA-1
 * Speed transform against the configurable resolution-SLA target. Faster than SLA
 * → 100; slower → 200 − (avg/target×100), floored at 0.
 */
async function complaintResolutionCandidate(
  q: Queryable,
  avgHours: number,
  hasRes: boolean,
  per: Period,
  pt: PlaceholderTracker,
): Promise<Candidate> {
  if (!hasRes) {
    return cand({
      name: COMP_COMPLAINT_RESOLUTION_SPEED, included: false,
      reason: 'tidak ada komplain yang selesai [Resolved] pada periode — dikecualikan + bobot didistribusi ulang',
    });
  }
  const { target, placeholder, ok } = await targetFor(q, ROLE_AM, COMP_COMPLAINT_RESOLUTION_SPEED, per.startDate);
  if (!ok || target === 0) {
    return cand({
      name: COMP_COMPLAINT_RESOLUTION_SPEED, included: false,
      reason: 'target SLA resolusi komplain belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang',
    });
  }
  if (placeholder) {
    pt.used = true;
  }
  const speedPct = (avgHours / target) * 100;
  return cand({ name: COMP_COMPLAINT_RESOLUTION_SPEED, included: true, raw: transformSpeed(speedPct) });
}

/**
 * amResolutionHours = mean (resolved_at − created_at) hours over complaints
 * assigned to the AM that transitioned into [Resolved] within the period.
 * Recompute from the immutable audit log (house rule 4).
 */
async function amResolutionHours(q: Queryable, staffID: string, per: Period): Promise<{ avgHours: number; hasRes: boolean }> {
  const cpls = await q<{ id: string; created_at: Date }[]>`
    select id, created_at from complaints where assigned_to = ${staffID}`;

  let sum = 0;
  let n = 0;
  for (const c of cpls) {
    const evs = await transitionsFor(q, 'complaint', c.id);
    const resolvedAt = firstTransitionInto(evs, '[Resolved]');
    if (resolvedAt === null || resolvedAt.getTime() < per.startUTC.getTime() || resolvedAt.getTime() >= per.endUTC.getTime()) {
      continue;
    }
    sum += (resolvedAt.getTime() - c.created_at.getTime()) / MS_PER_HOUR;
    n++;
  }
  if (n === 0) {
    return { avgHours: 0, hasRes: false };
  }
  return { avgHours: sum / n, hasRes: true };
}

/**
 * amRevisionEscalation = 100 − flaggedFraction × 100 over the AM portfolio's Tasks
 * (Creative Assets + Ads Briefs) approved in the period. Flagged = revision_count
 * ≥ 3 (M12 Rule 15), recomputed from the log.
 */
async function amRevisionEscalation(q: Queryable, clientIDs: string[], per: Period): Promise<Candidate> {
  let approved = 0;
  let flagged = 0;
  for (const cid of clientIDs) {
    // Creative Assets.
    const assets = await q<{ id: string; sla_target_hours: string | null }[]>`
      select a.id, a.sla_target_hours
        from assets a join briefs b on b.id = a.brief_id
        join services sv on sv.id = b.service_id
       where sv.client_id = ${cid}`;
    for (const t of assets) {
      const sla = t.sla_target_hours === null ? null : Number(t.sla_target_hours);
      const m = await assetMetrics(q, t.id, sla);
      if (m.approvedPeriodWib !== per.approvedTag) {
        continue;
      }
      approved++;
      if (m.revisionFlagged) {
        flagged++;
      }
    }
    // Ads Briefs-as-task.
    const briefs = await q<{ id: string; sla_target_hours: string | null }[]>`
      select b.id, b.sla_target_hours
        from briefs b join services sv on sv.id = b.service_id
       where sv.client_id = ${cid} and b.assigned_division = ${ADS_BRIEF_DIVISION}`;
    for (const t of briefs) {
      const sla = t.sla_target_hours === null ? null : Number(t.sla_target_hours);
      const m = await briefMetrics(q, t.id, sla);
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
    return cand({
      name: COMP_REVISION_ESCALATION_RATE, included: false,
      reason: 'tidak ada Task portofolio yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
    });
  }
  return cand({ name: COMP_REVISION_ESCALATION_RATE, included: true, raw: 100 - (flagged / approved) * 100 });
}

// ---- shared candidate builders ----

/**
 * speedCandidate builds the Speed Score candidate: average Speed Score % across the
 * staff's period-judged tasks, then the OA-1 transform. Excluded when no SLA-judged
 * task closed in the period.
 */
function speedCandidate(speedSum: number, judged: number): Candidate {
  if (judged === 0) {
    return cand({
      name: COMP_SPEED_SCORE, included: false,
      reason: 'tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
    });
  }
  return cand({ name: COMP_SPEED_SCORE, included: true, raw: transformSpeed(speedSum / judged) });
}

/**
 * revisionCandidate builds the inverse Revision Count candidate (100 − min(avg × 20,
 * 100)), over the same period-approved set. Excluded when none approved.
 */
function revisionCandidate(revisionSum: number, approved: number): Candidate {
  if (approved === 0) {
    return cand({
      name: COMP_REVISION_COUNT, included: false,
      reason: 'tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang',
    });
  }
  const avg = revisionSum / approved;
  const burden = 100 - Math.min(avg * REVISION_INVERSE_FACTOR, 100);
  return cand({ name: COMP_REVISION_COUNT, included: true, raw: burden });
}

// ---- task-metric helpers (recompute from the immutable log, house rule 4) ----

/** Metrics subset both task sources expose that M14 consumes. */
interface TaskMetrics {
  speedScorePct: number | null;
  revisionCount: number;
  revisionFlagged: boolean;
  approvedPeriodWib: string;
}

async function assetMetrics(q: Queryable, id: string, sla: number | null): Promise<TaskMetrics> {
  const evs = await transitionsFor(q, 'asset', id);
  return computeMetrics(evs, sla);
}

async function briefMetrics(q: Queryable, id: string, sla: number | null): Promise<TaskMetrics> {
  const evs = await transitionsFor(q, 'brief', id);
  return computeMetrics(evs, sla);
}

/**
 * transitionsFor reads a canonical entity's immutable transition log ASCENDING and
 * maps it to {to, at}. Shared by the task (asset/brief), KOL booking, and complaint
 * gatherers (mirrors module13_health.taskTransitions).
 */
async function transitionsFor(q: Queryable, entityType: string, id: string): Promise<Transition[]> {
  const entries = await q<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log where entity_type = ${entityType} and entity_id = ${id} order by id asc`;
  const out: Transition[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      out.push({ to, at: e.created_at });
    }
  }
  return out;
}

/** transitionCountInPeriod counts transitions INTO `to` whose timestamp falls in the WIB period window. */
function transitionCountInPeriod(evs: Transition[], to: string, per: Period): number {
  let n = 0;
  for (const e of evs) {
    if (e.to === to && e.at.getTime() >= per.startUTC.getTime() && e.at.getTime() < per.endUTC.getTime()) {
      n++;
    }
  }
  return n;
}

/** firstTransitionInto returns the timestamp of the first (earliest) transition INTO `to`. */
function firstTransitionInto(evs: Transition[], to: string): Date | null {
  for (const e of evs) {
    if (e.to === to) {
      return e.at; // evs are ascending, so the first match is the earliest
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
// Snapshot — monthly batch, immutable per-staff snapshot, reads, rollup (§ snapshot.go).
// ---------------------------------------------------------------------------

/** perfPrefix is the house-ID prefix for a Performance Score snapshot (DATA_MODEL §1/§29). */
const PERF_PREFIX = 'PERF';

/**
 * The API view of a Performance Score — the full breakdown is MANDATORY (§2 Rule 8
 * / Flow 6 / §5.5: never a single number without its components).
 */
export interface Snapshot {
  id: string;
  staffId: string;
  roleType: string;
  periodStart: string;
  periodEnd: string;
  profileScore: number | null;
  modifier: Modifier;
  finalScore: number | null;
  scoreDisplay: string; // "88.40" or "—" (all-excluded)
  components: Component[];
  targetsPlaceholder: boolean; // O9: a raw-value used a placeholder target
  computedAt: Date | null;
  computedBy: string;
  preview: boolean;
}

/** The components_json shape: the component breakdown, the modifier, and the placeholder-target flag. */
interface StoredPayload {
  components: Component[];
  modifier: Modifier;
  targetsPlaceholder: boolean;
}

/** computed is the raw scoring output for one staff + period. */
interface Computed {
  roleType: string;
  components: Component[];
  profile: number | null; // null in the all-excluded case
  modifier: Modifier;
  final: number | null; // null in the all-excluded case
  placeholder: boolean;
}

/** computeFor gathers inputs and runs the scoring core for one staff + period. */
async function computeFor(q: Queryable, staffID: string, roleType: string, per: Period): Promise<Computed> {
  const weights = await roleWeights(q, roleType);
  const { cands, anyPlaceholder } = await gatherProfile(q, staffID, roleType, per);
  const { comps, profile, profileOk } = scoreProfile(weights, cands);
  const mod = await computeModifier(q, staffID, roleType, per);
  const prof = profileOk ? profile : null;
  return { roleType, components: comps, profile: prof, modifier: mod, final: boundFinal(prof, mod), placeholder: anyPlaceholder };
}

/** ScanResult tallies one runSnapshotJob pass. */
export interface ScanResult {
  period: string;
  snapshotsMade: number;
}

/**
 * runScan is the authorised entry point for the sweep endpoint. Gate = Director
 * only (the sweep spans every division; decision point 5).
 */
export async function runScan(sql: Sql, actor: Actor, now: Date): Promise<ScanResult> {
  if (!canRunScan(actor)) {
    throw new ForbiddenError(MSG_SCAN_FORBIDDEN);
  }
  return runSnapshotJob(sql, now);
}

/**
 * runSnapshotJob is the monthly batch (§5.4): it scores every scored staff member
 * for the most-recently CLOSED calendar month and writes one immutable snapshot
 * each. Idempotent (UNIQUE (staff_id, period_start) + re-check), so it is safe to
 * re-run. Only staff whose CDPS role maps to a KPI Profile role type (Creative/Ads/
 * KOL/AM, staff level) are scored; a division without a profile or a lead is skipped.
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
    if (roleType === null) {
      continue; // no KPI Profile for this division/level (decision point 6)
    }
    const made = await fireSnapshot(sql, sr.employee_id, roleType, per);
    if (made) {
      res.snapshotsMade++;
    }
  }
  return res;
}

/**
 * roleTypeFor maps a staff member's CDPS division + level to a Module 14 role type.
 * v1 scores STAFF level only (decision point 1). Leads and profile-less divisions
 * return null.
 */
function roleTypeFor(division: string, level: string): string | null {
  if (level !== permission.LevelStaff) {
    return null;
  }
  return roleTypeOfDivision(division);
}

/**
 * fireSnapshot scores one staff member and inserts an immutable snapshot if none
 * exists yet (fire-once). The PerformancePublished emission (Flow 6) happens in the
 * SAME transaction as the insert, so it is naturally fire-once — a re-run finds the
 * snapshot already there and does nothing.
 */
async function fireSnapshot(sql: Sql, staffID: string, roleType: string, per: Period): Promise<boolean> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);

    // Serialise per-staff snapshot creation.
    const lock = await tx<{ employee_id: string }[]>`
      select employee_id from employees where employee_id = ${staffID} for update`;
    if (lock.length === 0) {
      return false;
    }

    const existing = await tx<{ id: string }[]>`
      select id from performance_snapshots where staff_id = ${staffID} and period_start = ${per.startDate}`;
    if (existing.length > 0) {
      return false; // already snapshotted — idempotent no-op
    }

    const c = await computeFor(tx, staffID, roleType, per);
    const payload: StoredPayload = { components: c.components, modifier: c.modifier, targetsPlaceholder: c.placeholder };
    const id = await ex.ident.identNext(PERF_PREFIX, per.start);

    await tx`
      insert into performance_snapshots
        (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
      values (${id}, ${staffID}, ${roleType}, ${per.startDate}, ${per.endDate},
        ${c.profile}, ${c.modifier.value}, ${c.final}, ${payload as never}, 'system')`;

    // PerformancePublished (Flow 6 / catalog FROZEN): notify the staff member.
    // Fire-once by construction (one insert). Resolver = explicit.
    await notification.emit(ex.notify, {
      event: notification.EVENTS.PerformancePublished,
      entityType: 'performance_snapshot', entityId: id, actor: 'system', explicitRecipients: [staffID],
      deepLink: deeplink.performanceSnapshot(id), // O51 — route is /performance/[id]
    });
    return true;
  });
}

// ---- reads (Rule 7 visibility, Rule 8 full breakdown) ----

/**
 * getSnapshot returns one stored snapshot for a staff member. periodID ("YYYYMM")
 * picks a month; empty picks the latest. Visibility gated (Rule 7). NotFoundError
 * when the staff is invisible/absent or has no snapshot for the period.
 */
export async function getSnapshot(sql: Queryable, actor: Actor, staffID: string, periodID: string): Promise<Snapshot> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = periodID !== ''
    ? await sql<SnapshotRow[]>`
        select id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
          from performance_snapshots where staff_id = ${staffID} and to_char(period_start, 'YYYYMM') = ${periodID}
         order by period_start desc limit 1`
    : await sql<SnapshotRow[]>`
        select id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
          from performance_snapshots where staff_id = ${staffID}
         order by period_start desc limit 1`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const snap = scanSnapshot(rows[0]);
  if (!canView(actor, snap.staffId, snap.roleType)) {
    throw new NotFoundError();
  }
  return snap;
}

/**
 * previewCurrent computes the CURRENT, not-yet-closed WIB month's Performance Score
 * for a staff member READ-ONLY (Team Portal / M15 Rule 9). NEVER persisted, never on
 * the trend, and — unlike fireSnapshot — it NEVER emits PerformancePublished. It
 * reuses the same computeFor gatherers as the batch sweep (no duplicated KPI logic,
 * O19). Visibility gated (Rule 7). NotFoundError when the staff has no scored
 * KPI-Profile role or is not visible to the actor.
 */
export async function previewCurrent(sql: Queryable, actor: Actor, staffID: string, now: Date): Promise<Snapshot> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const roleType = await staffRoleType(sql, staffID);
  if (roleType === null) {
    throw new NotFoundError();
  }
  if (!canView(actor, staffID, roleType)) {
    throw new NotFoundError();
  }
  const per = monthPeriod(now);
  const c = await computeFor(sql, staffID, roleType, per);
  return {
    id: '', staffId: staffID, roleType, periodStart: per.startDate, periodEnd: per.endDate,
    profileScore: c.profile, modifier: c.modifier, finalScore: c.final, scoreDisplay: scoreDisplay(c.final),
    components: c.components, targetsPlaceholder: c.placeholder, computedAt: null, computedBy: '', preview: true,
  };
}

/**
 * staffRoleType resolves a staff member's Module 14 role type from role_mappings.
 * null when the employee has no active role mapping or maps to a division/level
 * without a KPI Profile.
 */
async function staffRoleType(sql: Queryable, staffID: string): Promise<string | null> {
  const rows = await sql<{ division: string; level: string }[]>`
    select rm.division, rm.level
      from employees e
      join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${staffID}`;
  if (rows.length === 0) {
    return null;
  }
  return roleTypeFor(rows[0].division, rows[0].level);
}

/** trend returns every stored snapshot for a staff member, oldest first. Visibility gated (Rule 7). */
export async function trend(sql: Queryable, actor: Actor, staffID: string): Promise<Snapshot[]> {
  if (!canScope(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<SnapshotRow[]>`
    select id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_at, computed_by
      from performance_snapshots where staff_id = ${staffID} order by period_start asc`;
  const out: Snapshot[] = [];
  let visible = false;
  let checked = false;
  for (const row of rows) {
    const snap = scanSnapshot(row);
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

/** teamRollup returns the simple-average team view for a division + period. */
export async function teamRollup(sql: Queryable, actor: Actor, division: string, periodIDArg: string): Promise<TeamRollup> {
  if (!canViewTeam(actor, division)) {
    throw new ForbiddenError();
  }
  const roleType = roleTypeOfDivision(division);
  if (roleType === null) {
    throw new NotFoundError();
  }
  // Resolve the period: latest present when unspecified.
  let periodID = periodIDArg;
  if (periodID === '') {
    const latest = await sql<{ p: string | null }[]>`
      select to_char(max(period_start), 'YYYYMM') as p from performance_snapshots where role_type = ${roleType}`;
    periodID = latest[0].p ?? '';
  }
  if (periodID === '') {
    return { division, period: periodID, members: [], teamAverage: null, averageDisplay: '—' };
  }
  const rows = await sql<{ staff_id: string; role_type: string; final_score: string | null }[]>`
    select staff_id, role_type, final_score
      from performance_snapshots
     where role_type = ${roleType} and to_char(period_start, 'YYYYMM') = ${periodID}
     order by staff_id`;
  const members: TeamRow[] = [];
  let sum = 0;
  let scored = 0;
  for (const r of rows) {
    const final = r.final_score === null ? null : Number(r.final_score);
    if (final !== null) {
      sum += final;
      scored++;
    }
    members.push({ staffId: r.staff_id, roleType: r.role_type, finalScore: final, scoreDisplay: scoreDisplay(final) });
  }
  const teamAverage = scored > 0 ? sum / scored : null;
  return { division, period: periodID, members, teamAverage, averageDisplay: scoreDisplay(teamAverage) };
}

/** roleTypeOfDivision maps a division to the single role type scored within it. */
function roleTypeOfDivision(division: string): string | null {
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
      return null;
  }
}

/** The raw DB row shape of a persisted snapshot. */
interface SnapshotRow {
  id: string;
  staff_id: string;
  role_type: string;
  period_start: string | Date;
  period_end: string | Date;
  profile_score: string | null;
  modifier_value: string;
  final_score: string | null;
  components_json: unknown;
  computed_at: Date;
  computed_by: string;
}

/** scanSnapshot reads one persisted row (components_json → payload). */
function scanSnapshot(r: SnapshotRow): Snapshot {
  const profile = r.profile_score === null ? null : Number(r.profile_score);
  const final = r.final_score === null ? null : Number(r.final_score);
  let components: Component[] = [];
  let modifier = emptyModifier();
  let targetsPlaceholder = false;
  const payload = parseJsonb<StoredPayload>(r.components_json);
  if (payload) {
    components = payload.components ?? [];
    modifier = payload.modifier ?? emptyModifier();
    targetsPlaceholder = payload.targetsPlaceholder ?? false;
  }
  return {
    id: r.id, staffId: r.staff_id, roleType: r.role_type,
    periodStart: dateStr(r.period_start), periodEnd: dateStr(r.period_end),
    profileScore: profile, modifier, finalScore: final, scoreDisplay: scoreDisplay(final),
    components, targetsPlaceholder, computedAt: r.computed_at, computedBy: r.computed_by, preview: false,
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------

/** dateStr renders a `date` column value as "YYYY-MM-DD" (matches ads.ts; no WIB offset). */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * parseJsonb tolerates postgres.js returning a jsonb column either already parsed
 * (object) or as a raw string (this setup returns the latter — see M13's
 * components_json note). Returns null on empty/unparseable input.
 */
function parseJsonb<T>(v: unknown): T | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === 'string') {
    if (v === '') {
      return null;
    }
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}
