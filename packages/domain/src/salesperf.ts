/**
 * Kinerja Sales (M0 §7.1) — the Sales performance/OKR read-model + Sales OKR
 * (`sales_targets`) writes. Ported from a real request (Head of Sales Cena's
 * spreadsheet, `docs/handoff/RENCANA_KINERJA_SALES.md`), not a PRD file — the
 * PRD only PROMISES the dashboard exists (M0 §7.1 "sales analytics dashboard +
 * monthly achievement vs OKR", M0 §8 "closing rate + deal-cycle duration per
 * salesperson") without specifying its shape. §3 of the plan maps every sheet
 * column to a CDPS source; this file is that mapping made executable.
 *
 * NEW FILE, not an addition to `sales.ts` (already 2000+ lines) — pure
 * read-model, the same separation `marketing.ts` keeps from `campaign.ts`.
 * `marketing.ts` is the template this module follows most closely: per-actor
 * aggregates under RLS, division-by-zero → "—" (house rule #7), nothing
 * stored that can be recomputed from the log (house rule #4).
 *
 * WHAT IS DELIBERATELY NOT HERE (`docs/handoff/RENCANA_KINERJA_SALES.md` §11):
 *   - Chat Pagi/Total/Sisa, Blaster, Jumlah Respon, Call — not built (no CDPS
 *     source; the sheet's own manual entries, not derivable from any log).
 *   - "Seller"/"Affiliator" terminology — the canonical Qualified/Non-Qualified
 *     names stay; those spreadsheet labels are never introduced in code or UI.
 *   - Tiering T1–T5 — open question to Cena, no rule to encode yet.
 *   - The renewal/cross-sell WRITE door (R-03/R-04) — only the READ side
 *     (R-01/R-02, `contracts.jenis`) is wired here; see contract.ts header for
 *     why the write gate stays closed.
 *
 * PERIOD BUCKETING (recorded interpretation — the plan does not pin this down,
 * and no PRD does either; logged `DECISIONS.md` "Kinerja Sales" per CLAUDE.md's
 * own rule that an unspecified interpretation must be written down, not just
 * silently picked):
 *   - Lead counts (`leadsRegistered`/`leadsScouting`) bucket by `leads.created_at`
 *     (a lead's own intake cohort — mirrors `marketing.ts` Lead-by-Dashboard).
 *   - Funnel/stage counts (`contacted`/`qualified`/`nonQualified`/`negotiating`/
 *     `closedSuccess`/`closedLost`) bucket by the FIRST time the attempt's
 *     `audit_log` shows a transition INTO that stage — an event, not a cohort,
 *     so "this month's closings" means deals that closed this month regardless
 *     of when the lead first came in. Recomputed from the log on every call
 *     (house rule #4): calling `byMonth` twice for a closed period yields byte
 *     -identical rows.
 *   - Money/client-mix (`omzet`, `komisi*`, `klien*`) bucket by the winning
 *     `contracts.created_at` — today (pre-R-03) that IS the closing moment, one
 *     contract per client; R-03 will make this the moment a renewal/cross-sell
 *     contract itself was written, which is the right bucket for "this month's
 *     book of business" either way.
 *   - OKR fields (`targetOmzet`/`pencapaianPct`/`sisaTarget*`/`momPct`) only
 *     populate for a SINGLE calendar month filter (`period.from === period.to`)
 *     — an OKR is inherently monthly/yearly, not a range; a multi-month or
 *     all-periode query renders them `null` ("—"), never a fabricated blend.
 *
 * Reused, not rewritten (CLAUDE.md "never invent"): `core/money` (proRata/
 * format/parse/mul), `core/tz` (period/dateString), `core/permission`,
 * `activity.effortCounts` is NOT bulk-by-type (only a total per attempt), so
 * the Follow Up/Visit/Online Meeting split here is one new grouped query over
 * `prospect_activities` — same table, same shape as `activity.effortByAttempt`,
 * just batched across owners instead of one attempt at a time.
 * `finance.commissionAchievement` — reused verbatim per transaction; its own
 * `shares[]` is ALREADY the allocation-weighted recognized commission, so it is
 * summed directly rather than re-derived.
 */

import { money, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { commissionAchievement } from './finance';
import { SALES_DIVISION } from './leads';

export type Actor = permission.Actor;

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5) — exact strings from the plan §8.
// ---------------------------------------------------------------------------

export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'SalesPerfForbiddenError';
  }
}
export class ValidationError extends Error {
  constructor(message = MSG_INCOMPLETE) {
    super(message);
    this.name = 'SalesPerfValidationError';
  }
}

// ---------------------------------------------------------------------------
// §3a — Level Sales (Senior/Junior) from `employees.jabatan`. Dual-home: the
// six rows are ALSO seeded verbatim in `sales_level_labels`
// (20260901030000) — `salesperf.test.ts` fails if the two drift, the same
// pattern `division.registry.test.ts` uses for `division_registry`.
// ---------------------------------------------------------------------------

/** Verbatim mirror of the `sales_level_labels` seed rows — see that migration's header for the two caveats (jabatan is HRIS-owned; level is CURRENT, not per-period). */
export const SALES_LEVEL_LABELS: ReadonlyMap<string, string> = new Map([
  ['HEAD OF SALES JASA', 'Head'],
  ['SENIOR SALES JASA', 'Senior'],
  ['SALES JASA', 'Junior'],
  ['SALES', 'Junior'],
  ['ADMIN SALES', 'Admin'],
  ['CUSTOMER RELATION OFFICER', 'CRO'],
]);

// ---------------------------------------------------------------------------
// Types (per the plan's S-03 contract).
// ---------------------------------------------------------------------------

/**
 * "YYYY-MM" inclusive on both ends (what an HTML `<input type="month">`
 * produces). Internally normalized to the house "YYYYMM" bucket
 * (`tz.period`/SQL `wib_period`, both char(6), no separator) before any
 * comparison — `SalesPerfMonthRow.period`/`LeadSourceRow.period` are emitted
 * in THAT form, not this one. See `toYyyymm`.
 */
export interface PeriodFilter {
  from: string;
  to: string;
}

/** toYyyymm strips an optional dash: "2026-06" and "202606" both normalize to "202606" — the one internal month format (matches `tz.period`). */
function toYyyymm(s: string): string {
  return s.replace('-', '');
}

export interface SalesPerfFilter {
  period: PeriodFilter | null;
  salespersonId: string | null;
  source: string | null;
  campaignId: string | null;
}

export interface SalesPerfRow {
  salespersonId: string;
  nama: string;
  levelSales: string;
  leadsRegistered: number;
  leadsScouting: number;
  contacted: number;
  qualified: number;
  nonQualified: number;
  nqBreakdown: Record<string, number>;
  negotiating: number;
  closedSuccess: number;
  closedLost: number;
  closingRatePct: number | null;
  qualifiedRatePct: number | null;
  avgDealCycleDays: number | null;
  effortFollowUp: number;
  effortVisit: number;
  effortOnlineMeeting: number;
  klienBaru: string;
  klienPerpanjangan: string;
  klienCrossSell: string;
  klienCount: string;
  omzet: string;
  omzetIdr: string;
  komisiKontrak: string;
  komisiKontrakIdr: string;
  komisiDiakui: string;
  komisiDiakuiIdr: string;
  targetOmzet: string | null;
  targetOmzetIdr: string | null;
  pencapaianPct: number | null;
  sisaTarget: string | null;
  sisaTargetIdr: string | null;
  sisaPerMinggu: string | null;
  sisaPerMingguIdr: string | null;
  sisaPerHari: string | null;
  sisaPerHariIdr: string | null;
  momPct: number | null;
}

export interface SalesPerfMonthRow extends SalesPerfRow {
  period: string;
}

export interface LeadSourceRow {
  period: string;
  source: string;
  campaignId: string | null;
  campaignName: string | null;
  salespersonId: string | null;
  leads: number;
  qualified: number;
  nonQualified: number;
  closing: number;
  /** closing ÷ leads × 100, null on division-by-zero (house rule #7). Matches sheet 3's "Convertion Rate" column (KS-3). */
  conversionRatePct: number | null;
  omzet: string;
  omzetIdr: string;
  nqBreakdown: Record<string, number>;
}

/** Sales OKR period bucket. 'kuartal' added when the plan's omzet-only design turned out not to cover the owner's real OKR examples (KS-4) — periodStart for kuartal is the 1st of the quarter's FIRST month, same "one anchor date" convention as 'tahun' (1 Jan). */
export type PeriodKind = 'bulan' | 'kuartal' | 'tahun';

/**
 * Sales OKR metric catalog — CLOSED list, mirrored by the DB CHECK
 * (`ck_sales_targets_metric_key`) so a caller can never invent a metric that
 * has no formula. Owner's concrete examples (chat 2026-08-29, KS-4):
 *   - 'omzet': "capai omzet Rp X" — Rupiah. The only metric View 1's
 *     `okrFields` reads (unaffected by the other three).
 *   - 'closing_ratio_qualified_pct': "closing ratio 35% dari qualified leads"
 *     — closedSuccess ÷ qualified, DELIBERATELY different from the existing
 *     `closingRatePct` (closedSuccess ÷ (closedSuccess+closedLost)).
 *   - 'klien_count_min_kontrak': "30 klien dengan minimal kontrak Rp10jt" —
 *     a client HEADCOUNT gated by a per-target Rupiah floor (`metricParam`).
 *   - 'scouting_closing_count': "closing minimal 3 klien dari scouting" — a
 *     closing headcount narrowed to one lead source.
 */
export type MetricKey = 'omzet' | 'closing_ratio_qualified_pct' | 'klien_count_min_kontrak' | 'scouting_closing_count';

export const METRIC_KEYS: readonly MetricKey[] = [
  'omzet', 'closing_ratio_qualified_pct', 'klien_count_min_kontrak', 'scouting_closing_count',
];

/** True for the one metric that carries a threshold parameter (mirrors `ck_sales_targets_metric_param`). */
export function metricNeedsParam(k: MetricKey): boolean {
  return k === 'klien_count_min_kontrak';
}

export interface TargetRow {
  salespersonId: string;
  periodStart: string;
  periodKind: PeriodKind;
  metricKey: MetricKey;
  /** Decimal string (Rupiah threshold), only for 'klien_count_min_kontrak'. */
  metricParam: string | null;
  metricParamIdr: string | null;
  /** Unit depends on metricKey: Rupiah (omzet), percentage points, or a plain count. */
  targetValue: string;
  targetValueIdr: string | null;
  /** Recomputed live from the log every call (house rule #4) — never stored. Null on a genuine division-by-zero (house rule #7), e.g. zero qualified leads for the ratio metric. */
  actualValue: string | null;
  actualValueIdr: string | null;
  /** actualValue ÷ targetValue × 100. Null when actualValue is null or targetValue is 0. */
  achievedPct: number | null;
  updatedAt: Date;
  updatedBy: string;
}

export interface SetTargetInput {
  salespersonId: string;
  periodStart: string; // "YYYY-MM-01" (bulan/kuartal) or "YYYY-01-01" (tahun)
  periodKind: PeriodKind;
  metricKey: MetricKey;
  /** Rupiah threshold — required for 'klien_count_min_kontrak', must be absent otherwise. */
  metricParam?: string | null;
  targetValue: string; // decimal string; unit depends on metricKey (see MetricKey)
}

// ---------------------------------------------------------------------------
// Authorization — mirrors `sales_targets_select` / the new S-01 RLS arms
// EXACTLY (CLAUDE.md: the two sides must never diverge).
// ---------------------------------------------------------------------------

/** canViewSalesPerf: any level of Sales, plus the read-everywhere layer (OD/Director). */
export function canViewSalesPerf(actor: Actor): boolean {
  return actor.role.director || actor.role.od || actor.role.division === SALES_DIVISION;
}

export interface SalesPerfScope {
  /** true = Sales staff, restricted to their own rows. false = division-wide or read-all. */
  ownOnly: boolean;
}

/**
 * scopeFor resolves how much of Kinerja Sales an actor may see, or null when
 * they may see none. Sales staff = own row only; Sales lead/SPV = whole
 * division; OD/Director = read-all. Mirrors RLS S-01
 * (`jwt_is_lead() AND jwt_division() = 'Sales'`) arm-for-arm.
 */
export function scopeFor(actor: Actor): SalesPerfScope | null {
  if (actor.role.director || actor.role.od) {
    return { ownOnly: false };
  }
  if (actor.role.division === SALES_DIVISION) {
    return { ownOnly: actor.role.level !== permission.LevelLead };
  }
  return null;
}

/** canManageTargets: OD (M0 §7.1 "OD inputs/manages Sales OKR") or Director. Sales itself never writes its own target. */
export function canManageTargets(actor: Actor): boolean {
  return actor.role.director || actor.role.od;
}

/**
 * resolveSalespersonIds turns (scope, filter.salespersonId, the Sales roster)
 * into the concrete id list every query below scopes on. Throws Forbidden when
 * a staff actor asks for someone else's row, or when the filter names someone
 * outside the actor's division scope — a 403 with the exact BI message beats a
 * query that silently returns nothing (CLAUDE.md #6).
 */
function resolveSalespersonIds(scope: SalesPerfScope, actor: Actor, filter: SalesPerfFilter, roster: readonly string[]): string[] {
  if (filter.salespersonId !== null) {
    if (scope.ownOnly && filter.salespersonId !== actor.employeeId) {
      throw new ForbiddenError();
    }
    if (!roster.includes(filter.salespersonId)) {
      throw new ForbiddenError();
    }
    return [filter.salespersonId];
  }
  if (scope.ownOnly) {
    return [actor.employeeId];
  }
  return [...roster];
}

// ---------------------------------------------------------------------------
// Roster (§3a) — every Sales-division employee + their Level Sales label.
// ---------------------------------------------------------------------------

interface RosterEntry {
  employeeId: string;
  nama: string;
  levelSales: string;
}

/** loadRoster reads the Sales-division roster via the existing assignable-employee picker (directory.ts's own SECURITY DEFINER), joined against the Level Sales label table. */
async function loadRoster(sql: Queryable): Promise<RosterEntry[]> {
  const [emps, labels] = await Promise.all([
    sql<{ employee_id: string; nama: string; jabatan: string }[]>`
      select employee_id, nama, jabatan from private.employee_assignable() where division = ${SALES_DIVISION}`,
    sql<{ jabatan: string; level_label: string }[]>`select jabatan, level_label from sales_level_labels`,
  ]);
  const labelMap = new Map(labels.map((l) => [l.jabatan, l.level_label]));
  return emps.map((e) => ({
    employeeId: e.employee_id,
    nama: e.nama,
    levelSales: labelMap.get(e.jabatan) ?? EM_DASH,
  }));
}

// ---------------------------------------------------------------------------
// Stage-transition events, derived from `audit_log` (house rule #4). Shared by
// `bySalesperson`/`byMonth` (scoped by owner) and `bySource` (scoped by lead).
// ---------------------------------------------------------------------------

type Stage = 'contacted' | 'qualified' | 'nonQualified' | 'negotiating' | 'closedSuccess' | 'closedLost';

/** bucketOf maps a raw `prospect_attempts.status` (the transition's `to`) to the funnel stage it represents, or null for a status this dashboard does not track (e.g. `Blocked`, the negotiation sub-states beyond the first). */
function bucketOf(status: string): Stage | null {
  if (status === 'Contacted') return 'contacted';
  if (status === 'Qualified') return 'qualified';
  if (status === 'Not Qualified') return 'nonQualified';
  if (status.startsWith('Negotiation - ')) return 'negotiating';
  if (status === 'Closed-Success') return 'closedSuccess';
  if (status === 'Closed-Lost' || status === '[Closed - Kalah Kompetisi]') return 'closedLost';
  return null;
}

interface StageEvent {
  attemptId: string;
  ownerOrLead: string; // owner_employee_id when scoped by owner, lead_id when scoped by lead
  stage: Stage;
  at: Date;
}

/** loadStageEventsByOwner: every attempt's first-time-per-stage transitions, for the given attempt owners. */
async function loadStageEventsByOwner(sql: Queryable, ownerIds: readonly string[]): Promise<StageEvent[]> {
  if (ownerIds.length === 0) return [];
  const raw = await sql<{ attempt_id: string; owner: string; to_status: string; at: Date }[]>`
    select al.entity_id as attempt_id, pa.owner_employee_id as owner,
           substring(al.action from position('->' in al.action) + 2) as to_status,
           al.created_at as at
      from audit_log al
      join prospect_attempts pa on pa.id = al.entity_id
     where al.entity_type = 'prospect_attempt'
       and al.action like 'transition:%->%'
       and pa.owner_employee_id = any(${ownerIds})
     order by al.created_at`;
  return firstPerAttemptStage(raw.map((r) => ({ attemptId: r.attempt_id, ownerOrLead: r.owner, raw: r.to_status, at: r.at })));
}

/** loadStageEventsByLead: same, scoped by the lead the attempts belong to (bySource — a lead can be worked by a different salesperson than the one who registered it). */
async function loadStageEventsByLead(sql: Queryable, leadIds: readonly string[]): Promise<StageEvent[]> {
  if (leadIds.length === 0) return [];
  const raw = await sql<{ lead_id: string; to_status: string; at: Date; attempt_id: string }[]>`
    select pa.lead_id, al.entity_id as attempt_id,
           substring(al.action from position('->' in al.action) + 2) as to_status,
           al.created_at as at
      from audit_log al
      join prospect_attempts pa on pa.id = al.entity_id
     where al.entity_type = 'prospect_attempt'
       and al.action like 'transition:%->%'
       and pa.lead_id = any(${leadIds})
     order by al.created_at`;
  return firstPerAttemptStage(raw.map((r) => ({ attemptId: r.attempt_id, ownerOrLead: r.lead_id, raw: r.to_status, at: r.at })));
}

/** firstPerAttemptStage reduces raw transitions to the FIRST time each attempt entered each tracked stage — the recompute-from-log core (house rule #4). */
function firstPerAttemptStage(raw: { attemptId: string; ownerOrLead: string; raw: string; at: Date }[]): StageEvent[] {
  const seen = new Map<string, StageEvent>(); // key: attemptId|stage
  for (const r of raw) {
    const stage = bucketOf(r.raw);
    if (stage === null) continue;
    const key = `${r.attemptId}|${stage}`;
    const existing = seen.get(key);
    if (existing === undefined || r.at < existing.at) {
      seen.set(key, { attemptId: r.attemptId, ownerOrLead: r.ownerOrLead, stage, at: r.at });
    }
  }
  return [...seen.values()];
}

/** inPeriod: true when `period` is null (no filter) or the WIB month of `at` falls within [from,to]. */
function inPeriod(period: PeriodFilter | null, at: Date): boolean {
  if (period === null) return true;
  const p = tz.period(at);
  return p >= toYyyymm(period.from) && p <= toYyyymm(period.to);
}

// ---------------------------------------------------------------------------
// bySalesperson / byMonth — share one accumulation pass; byMonth just keys the
// accumulator by (salesperson, period) instead of (salesperson).
// ---------------------------------------------------------------------------

interface Accumulator {
  leadsRegistered: number;
  leadsScouting: number;
  contacted: number;
  qualified: number;
  nonQualified: number;
  nqBreakdown: Record<string, number>;
  negotiating: number;
  closedSuccess: number;
  closedLost: number;
  dealCycleDaysSum: number;
  dealCycleDaysCount: number;
  effortFollowUp: number;
  effortVisit: number;
  effortOnlineMeeting: number;
  klienBaruFrac: number;
  klienPerpanjanganFrac: number;
  klienCrossSellFrac: number;
  omzet: money.Money;
  komisiKontrak: money.Money;
  komisiDiakui: money.Money;
}

function emptyAcc(): Accumulator {
  return {
    leadsRegistered: 0, leadsScouting: 0, contacted: 0, qualified: 0, nonQualified: 0,
    nqBreakdown: {}, negotiating: 0, closedSuccess: 0, closedLost: 0,
    dealCycleDaysSum: 0, dealCycleDaysCount: 0,
    effortFollowUp: 0, effortVisit: 0, effortOnlineMeeting: 0,
    klienBaruFrac: 0, klienPerpanjanganFrac: 0, klienCrossSellFrac: 0,
    omzet: 0n, komisiKontrak: 0n, komisiDiakui: 0n,
  };
}

/**
 * gather runs every derivation over the given scope + filter and returns one
 * Accumulator per (salespersonId) — or per (salespersonId, period) when
 * `byMonth` is true. This is the single engine `bySalesperson`/`byMonth` both
 * call; `bySalesperson` collapses the `byMonth=false` map's one bucket per
 * salesperson, `byMonth` keeps every period bucket.
 */
async function gather(
  sql: Queryable,
  ids: readonly string[],
  filter: SalesPerfFilter,
  byMonth: boolean,
): Promise<Map<string, Accumulator>> {
  const acc = new Map<string, Accumulator>();
  const keyOf = (salespersonId: string, at: Date | null): string =>
    byMonth ? `${salespersonId}|${at === null ? '' : tz.period(at)}` : salespersonId;
  const get = (salespersonId: string, at: Date | null): Accumulator => {
    const k = keyOf(salespersonId, at);
    let a = acc.get(k);
    if (a === undefined) {
      a = emptyAcc();
      acc.set(k, a);
    }
    return a;
  };

  if (ids.length === 0) return acc;

  // Normalized to '' sentinels (never a bare SQL NULL parameter) — postgres.js
  // cannot infer a bind's type from an `IS NULL`-only context ("could not
  // determine data type of parameter"), and a lead's `source`/`origin_campaign_id`
  // is never '' for real, so '' unambiguously means "no filter".
  const sourceFilter = filter.source ?? '';
  const campaignFilter = filter.campaignId ?? '';

  // --- leads: cohort-bucketed by leads.created_at (§ header). ---
  const leadRows = await sql<{ created_by: string; source: string; created_at: Date }[]>`
    select created_by, source, created_at from leads
     where created_by = any(${ids})
       and (${sourceFilter} = '' or source = ${sourceFilter})
       and (${campaignFilter} = '' or origin_campaign_id = ${campaignFilter})`;
  for (const r of leadRows) {
    if (!inPeriod(filter.period, r.created_at)) continue;
    const a = get(r.created_by, r.created_at);
    a.leadsRegistered += 1;
    if (r.source === 'Scouting') a.leadsScouting += 1;
  }

  // --- funnel stages: event-bucketed from audit_log (§ header). ---
  const stageEvents = await loadStageEventsByOwner(sql, ids);
  // Per-attempt earliest Contacted/Closed-Success, for deal-cycle days.
  const contactedAt = new Map<string, Date>();
  const closedAt = new Map<string, Date>();
  for (const e of stageEvents) {
    if (e.stage === 'contacted') contactedAt.set(e.attemptId, e.at);
    if (e.stage === 'closedSuccess') closedAt.set(e.attemptId, e.at);
  }
  for (const e of stageEvents) {
    if (!inPeriod(filter.period, e.at)) continue;
    const a = get(e.ownerOrLead, e.at);
    a[e.stage] += 1;
    if (e.stage === 'closedSuccess') {
      const startedAt = contactedAt.get(e.attemptId);
      if (startedAt !== undefined) {
        a.dealCycleDaysSum += tz.daysBetween(startedAt, e.at);
        a.dealCycleDaysCount += 1;
      }
    }
  }

  // --- NQ reason breakdown, event-bucketed by the reason row's own timestamp. ---
  const nqRows = await sql<{ owner: string; reason: string; at: Date }[]>`
    select pa.owner_employee_id as owner, r.reason, r.created_at as at
      from prospect_attempt_nq_reasons r
      join prospect_attempts pa on pa.id = r.attempt_id
     where pa.owner_employee_id = any(${ids})`;
  for (const r of nqRows) {
    if (!inPeriod(filter.period, r.at)) continue;
    const a = get(r.owner, r.at);
    a.nqBreakdown[r.reason] = (a.nqBreakdown[r.reason] ?? 0) + 1;
  }

  // --- effort (Follow Up / Visit / Online Meeting), event-bucketed. ---
  const effRows = await sql<{ owner: string; activity_type: string; at: Date }[]>`
    select pa.owner_employee_id as owner, a.activity_type, a.occurred_at as at
      from prospect_activities a
      join prospect_attempts pa on pa.id = a.attempt_id
     where pa.owner_employee_id = any(${ids})`;
  for (const r of effRows) {
    if (!inPeriod(filter.period, r.at)) continue;
    const a = get(r.owner, r.at);
    if (r.activity_type === 'Follow Up') a.effortFollowUp += 1;
    else if (r.activity_type === 'Visit') a.effortVisit += 1;
    else if (r.activity_type === 'Online Meeting') a.effortOnlineMeeting += 1;
  }

  // --- klien mix + money, event-bucketed by the contract's own created_at. ---
  const clientRows = await sql<{ client_id: string; jenis: string; contract_created_at: Date; transaction_id: string | null }[]>`
    select cl.id as client_id, c.jenis, c.created_at as contract_created_at, cl.transaction_id
      from clients cl
      join contracts c on c.client_id = cl.id
     where exists (select 1 from client_sales_allocations a where a.client_id = cl.id and a.salesperson_id = any(${ids}))`;
  const clientIds = clientRows.map((c) => c.client_id);
  const allocRows = clientIds.length === 0 ? [] : await sql<{ client_id: string; salesperson_id: string; basis_points: number }[]>`
    select client_id, salesperson_id, basis_points from client_sales_allocations where client_id = any(${clientIds})`;
  const allocByClient = new Map<string, { salespersonId: string; basisPoints: number }[]>();
  for (const a of allocRows) {
    const list = allocByClient.get(a.client_id) ?? [];
    list.push({ salespersonId: a.salesperson_id, basisPoints: a.basis_points });
    allocByClient.set(a.client_id, list);
  }
  const txnIds = [...new Set(clientRows.map((c) => c.transaction_id).filter((t): t is string => t !== null))];
  const achievements = await Promise.all(txnIds.map((t) => commissionAchievement(sql, t)));
  const achByTxn = new Map(achievements.map((v, i) => [txnIds[i], v]));

  for (const c of clientRows) {
    if (!inPeriod(filter.period, c.contract_created_at)) continue;
    const allocs = allocByClient.get(c.client_id) ?? [];
    const ach = c.transaction_id === null ? null : achByTxn.get(c.transaction_id) ?? null;
    for (const alloc of allocs) {
      if (!ids.includes(alloc.salespersonId)) continue;
      const a = get(alloc.salespersonId, c.contract_created_at);
      const frac = alloc.basisPoints / 10000;
      if (c.jenis === 'baru') a.klienBaruFrac += frac;
      else if (c.jenis === 'perpanjangan') a.klienPerpanjanganFrac += frac;
      else if (c.jenis === 'cross_sell') a.klienCrossSellFrac += frac;
      if (ach !== null) {
        a.omzet += money.proRata(money.parse(ach.totalAgreedValue), BigInt(alloc.basisPoints), 10000n);
        a.komisiKontrak += money.proRata(money.parse(ach.totalDealCommission), BigInt(alloc.basisPoints), 10000n);
        const share = ach.shares.find((s) => s.salespersonId === alloc.salespersonId);
        if (share !== undefined) {
          a.komisiDiakui += money.parse(share.recognizedCommission);
        }
      }
    }
  }

  return acc;
}

/** fmtFrac renders a weighted-client fraction to 2 decimals (§3 "angka pecahan di sheet"). */
function fmtFrac(n: number): string {
  return n.toFixed(2);
}

/** finalizeRow turns one Accumulator into the public SalesPerfRow shape (no OKR fields — callers that have a single-month period fill those in separately). */
function finalizeRow(salespersonId: string, roster: ReadonlyMap<string, RosterEntry>, a: Accumulator): Omit<SalesPerfRow, 'targetOmzet' | 'targetOmzetIdr' | 'pencapaianPct' | 'sisaTarget' | 'sisaTargetIdr' | 'sisaPerMinggu' | 'sisaPerMingguIdr' | 'sisaPerHari' | 'sisaPerHariIdr' | 'momPct'> {
  const r = roster.get(salespersonId);
  const decided = a.closedSuccess + a.closedLost;
  const funneled = a.contacted;
  return {
    salespersonId,
    nama: r?.nama ?? salespersonId,
    levelSales: r?.levelSales ?? EM_DASH,
    leadsRegistered: a.leadsRegistered,
    leadsScouting: a.leadsScouting,
    contacted: a.contacted,
    qualified: a.qualified,
    nonQualified: a.nonQualified,
    nqBreakdown: a.nqBreakdown,
    negotiating: a.negotiating,
    closedSuccess: a.closedSuccess,
    closedLost: a.closedLost,
    closingRatePct: decided === 0 ? null : roundPct(a.closedSuccess, decided),
    qualifiedRatePct: funneled === 0 ? null : roundPct(a.qualified, funneled),
    avgDealCycleDays: a.dealCycleDaysCount === 0 ? null : Math.round(a.dealCycleDaysSum / a.dealCycleDaysCount),
    effortFollowUp: a.effortFollowUp,
    effortVisit: a.effortVisit,
    effortOnlineMeeting: a.effortOnlineMeeting,
    klienBaru: fmtFrac(a.klienBaruFrac),
    klienPerpanjangan: fmtFrac(a.klienPerpanjanganFrac),
    klienCrossSell: fmtFrac(a.klienCrossSellFrac),
    klienCount: fmtFrac(a.klienBaruFrac + a.klienPerpanjanganFrac + a.klienCrossSellFrac),
    omzet: money.decimal(a.omzet),
    omzetIdr: money.format(a.omzet),
    komisiKontrak: money.decimal(a.komisiKontrak),
    komisiKontrakIdr: money.format(a.komisiKontrak),
    komisiDiakui: money.decimal(a.komisiDiakui),
    komisiDiakuiIdr: money.format(a.komisiDiakui),
  };
}

function roundPct(num: number, den: number): number {
  return Math.round((num / den) * 100);
}

/** roundHalfUpDivBig returns round(num/den) with .5 rounded away from zero — exact bigint math, no float, for the money-ratio percentages below. */
function roundHalfUpDivBig(num: bigint, den: bigint): bigint {
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const half = d / 2n;
  const q = (n + half) / d;
  return neg ? -q : q;
}

/** roundPctMoney: num/den as an integer percent, exact bigint math (money amounts can exceed Number.MAX_SAFE_INTEGER in minor units). */
function roundPctMoney(num: money.Money, den: money.Money): number {
  return Number(roundHalfUpDivBig(num * 100n, den));
}

/** bySalesperson: View 1 (REPORT ACTIVITY AND CLOSING) — one row per salesperson over the whole filtered range (or all-time when `period` is null). */
export async function bySalesperson(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<SalesPerfRow[]> {
  const scope = scopeFor(actor);
  if (scope === null) throw new ForbiddenError();
  const rosterList = await loadRoster(sql);
  const rosterIds = rosterList.map((r) => r.employeeId);
  const ids = resolveSalespersonIds(scope, actor, f, rosterIds);
  const rosterMap = new Map(rosterList.map((r) => [r.employeeId, r]));
  const acc = await gather(sql, ids, f, false);
  const single = f.period !== null && f.period.from === f.period.to ? toYyyymm(f.period.from) : null;
  const rows: SalesPerfRow[] = [];
  for (const id of ids) {
    const a = acc.get(id) ?? emptyAcc();
    const base = finalizeRow(id, rosterMap, a);
    const okr = single === null ? null : await okrFields(sql, id, single, a.omzet);
    rows.push({ ...base, ...(okr ?? nullOkr()) });
  }
  return rows;
}

/** byMonth: View 2 (FILTER BY NAME, satu sales, baris = Year-Month) / View 5 (rekap tahunan). One row per (salesperson, period) that has any activity in range. */
export async function byMonth(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<SalesPerfMonthRow[]> {
  const scope = scopeFor(actor);
  if (scope === null) throw new ForbiddenError();
  const rosterList = await loadRoster(sql);
  const rosterIds = rosterList.map((r) => r.employeeId);
  const ids = resolveSalespersonIds(scope, actor, f, rosterIds);
  const rosterMap = new Map(rosterList.map((r) => [r.employeeId, r]));
  const acc = await gather(sql, ids, f, true);
  const rows: SalesPerfMonthRow[] = [];
  for (const [key, a] of acc) {
    const [salespersonId, period] = key.split('|');
    const base = finalizeRow(salespersonId, rosterMap, a);
    const okr = await okrFields(sql, salespersonId, period, a.omzet);
    rows.push({ ...base, ...okr, period });
  }
  rows.sort((x, y) => (x.salespersonId === y.salespersonId ? x.period.localeCompare(y.period) : x.salespersonId.localeCompare(y.salespersonId)));
  return rows;
}

function nullOkr() {
  return {
    targetOmzet: null, targetOmzetIdr: null, pencapaianPct: null,
    sisaTarget: null, sisaTargetIdr: null, sisaPerMinggu: null, sisaPerMingguIdr: null,
    sisaPerHari: null, sisaPerHariIdr: null, momPct: null,
  } as const;
}

/** okrFields resolves the target/achievement/momentum block for exactly one salesperson + one "YYYYMM" month (house format — callers pass `toYyyymm`-normalized strings, see `bySalesperson`/`byMonth`). */
async function okrFields(sql: Queryable, salespersonId: string, month: string, omzet: money.Money) {
  const periodStart = `${month.slice(0, 4)}-${month.slice(4, 6)}-01`;
  const targetRows = await sql<{ target_value: string }[]>`
    select target_value from sales_targets
     where salesperson_id = ${salespersonId} and period_start = ${periodStart}::date
       and period_kind = 'bulan' and metric_key = 'omzet'`;
  if (targetRows.length === 0) {
    return nullOkr();
  }
  const target = money.parse(targetRows[0].target_value);
  const pencapaianPct = target === 0n ? null : roundPctMoney(omzet, target);
  const sisa = target > omzet ? target - omzet : 0n;

  // Working days remaining in the month, from TODAY to the month's last day
  // (WIB). Sen–Jum minus `hari_libur` (`working_days_between`, the one house
  // helper for every "hari kerja" count) — a month already closed renders "—"
  // (zero/negative working days remaining), never a fabricated daily figure.
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4, 6));
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = tz.dateString(new Date());
  const wd = await sql<{ n: number }[]>`select working_days_between(${today}::date, ${lastDay}::date) as n`;
  const daysLeft = wd.length === 0 ? 0 : Number(wd[0].n);

  const perHari = daysLeft > 0 ? sisa / BigInt(daysLeft) : null;
  const perMinggu = perHari === null ? null : money.mul(perHari, 5n);

  // Month-over-month: previous month's weighted omzet for the same salesperson.
  const prevMonth = previousMonth(month);
  const prevAcc = await gather(sql, [salespersonId], { period: { from: prevMonth, to: prevMonth }, salespersonId, source: null, campaignId: null }, false);
  const prevOmzet = prevAcc.get(salespersonId)?.omzet ?? 0n;
  const momPct = prevOmzet === 0n ? null : roundPctMoney(omzet - prevOmzet, prevOmzet);

  return {
    targetOmzet: money.decimal(target),
    targetOmzetIdr: money.format(target),
    pencapaianPct,
    sisaTarget: money.decimal(sisa),
    sisaTargetIdr: money.format(sisa),
    sisaPerMinggu: perMinggu === null ? null : money.decimal(perMinggu),
    sisaPerMingguIdr: perMinggu === null ? null : money.format(perMinggu),
    sisaPerHari: perHari === null ? null : money.decimal(perHari),
    sisaPerHariIdr: perHari === null ? null : money.format(perHari),
    momPct,
  };
}

function previousMonth(yyyymm: string): string {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; -2 = previous month, 0-based
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// bySource — View 3 (DASHBOARD LEAD).
// ---------------------------------------------------------------------------

/** bySource: leads grouped by (period, source, campaign) — narrowed to one salesperson's registrations when `filter.salespersonId` is set, else company-wide (within the actor's own division scope). */
export async function bySource(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<LeadSourceRow[]> {
  const scope = scopeFor(actor);
  if (scope === null) throw new ForbiddenError();
  const rosterList = await loadRoster(sql);
  const rosterIds = rosterList.map((r) => r.employeeId);
  const ids = resolveSalespersonIds(scope, actor, f, rosterIds);

  const sourceFilter = f.source ?? '';
  const campaignFilter = f.campaignId ?? '';
  const leadRows = await sql<{
    id: string; source: string; origin_campaign_id: string | null; created_at: Date; created_by: string;
  }[]>`
    select id, source, origin_campaign_id, created_at, created_by from leads
     where created_by = any(${ids})
       and (${sourceFilter} = '' or source = ${sourceFilter})
       and (${campaignFilter} = '' or origin_campaign_id = ${campaignFilter})`;

  const leadIds = leadRows.map((l) => l.id);
  const [stageEvents, campaigns, nqRows, clientRows] = await Promise.all([
    loadStageEventsByLead(sql, leadIds),
    sql<{ id: string; name: string }[]>`select id, name from campaigns where id = any(${[...new Set(leadRows.map((l) => l.origin_campaign_id).filter((c): c is string => c !== null))]})`,
    leadIds.length === 0 ? Promise.resolve([]) : sql<{ lead_id: string; reason: string }[]>`
      select pa.lead_id, r.reason from prospect_attempt_nq_reasons r
        join prospect_attempts pa on pa.id = r.attempt_id
       where pa.lead_id = any(${leadIds})`,
    leadIds.length === 0 ? Promise.resolve([]) : sql<{ lead_id: string; total_agreed_value: string }[]>`
      select cl.lead_id, t.total_agreed_value from clients cl
        join transactions t on t.id = cl.transaction_id
       where cl.lead_id = any(${leadIds})`,
  ]);
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const qualifiedByLead = new Set(stageEvents.filter((e) => e.stage === 'qualified').map((e) => e.ownerOrLead));
  const nonQualifiedByLead = new Set(stageEvents.filter((e) => e.stage === 'nonQualified').map((e) => e.ownerOrLead));
  const closingByLead = new Set(stageEvents.filter((e) => e.stage === 'closedSuccess').map((e) => e.ownerOrLead));
  const omzetByLead = new Map(clientRows.map((c) => [c.lead_id, money.parse(c.total_agreed_value)]));
  const nqByLead = new Map<string, Record<string, number>>();
  for (const r of nqRows) {
    const m = nqByLead.get(r.lead_id) ?? {};
    m[r.reason] = (m[r.reason] ?? 0) + 1;
    nqByLead.set(r.lead_id, m);
  }

  const groups = new Map<string, LeadSourceRow>();
  for (const l of leadRows) {
    if (!inPeriod(f.period, l.created_at)) continue;
    const period = tz.period(l.created_at);
    const key = `${period}|${l.source}|${l.origin_campaign_id ?? ''}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = {
        period, source: l.source, campaignId: l.origin_campaign_id,
        campaignName: l.origin_campaign_id === null ? null : campaignName.get(l.origin_campaign_id) ?? null,
        salespersonId: f.salespersonId,
        leads: 0, qualified: 0, nonQualified: 0, closing: 0, conversionRatePct: null, omzet: '0.00', omzetIdr: EM_DASH, nqBreakdown: {},
      };
      groups.set(key, g);
    }
    g.leads += 1;
    if (qualifiedByLead.has(l.id)) g.qualified += 1;
    if (nonQualifiedByLead.has(l.id)) g.nonQualified += 1;
    if (closingByLead.has(l.id)) g.closing += 1;
    const omzet = omzetByLead.get(l.id);
    if (omzet !== undefined) {
      const current = money.parse(g.omzet);
      const total = current + omzet;
      g.omzet = money.decimal(total);
      g.omzetIdr = money.format(total);
    }
    const nq = nqByLead.get(l.id);
    if (nq !== undefined) {
      for (const [reason, n] of Object.entries(nq)) {
        g.nqBreakdown[reason] = (g.nqBreakdown[reason] ?? 0) + n;
      }
    }
  }
  // conversionRatePct (KS-3, sheet 3's "Convertion Rate") needs each group's
  // FINAL leads/closing totals, so it is a second pass rather than an
  // incremental update above.
  for (const g of groups.values()) {
    g.conversionRatePct = g.leads === 0 ? null : roundPct(g.closing, g.leads);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period) || a.source.localeCompare(b.source));
}

// ---------------------------------------------------------------------------
// Sales OKR (`sales_targets`) — View 4.
// ---------------------------------------------------------------------------

/** periodRangeFor turns (periodStart, periodKind) into the "YYYYMM" range `gather`/`inPeriod` need — kuartal = periodStart's month plus the next two. */
function periodRangeFor(periodStart: string, periodKind: PeriodKind): PeriodFilter {
  const y = Number(periodStart.slice(0, 4));
  const m = Number(periodStart.slice(5, 7));
  if (periodKind === 'tahun') {
    return { from: `${y}01`, to: `${y}12` };
  }
  if (periodKind === 'kuartal') {
    const endDate = new Date(Date.UTC(y, m - 1 + 2, 1));
    const to = `${endDate.getUTCFullYear()}${String(endDate.getUTCMonth() + 1).padStart(2, '0')}`;
    return { from: `${y}${String(m).padStart(2, '0')}`, to };
  }
  const bulan = `${y}${String(m).padStart(2, '0')}`;
  return { from: bulan, to: bulan };
}

/**
 * computeMetricActual derives the CURRENT value of one OKR metric for one
 * salesperson over one period — recomputed from the log every call (house
 * rule #4), nothing stored. Returns null on a genuine division-by-zero
 * (house rule #7) — e.g. `closing_ratio_qualified_pct` with zero qualified
 * leads has no defined ratio, not a zero one.
 */
async function computeMetricActual(
  sql: Queryable,
  salespersonId: string,
  periodStart: string,
  periodKind: PeriodKind,
  metricKey: MetricKey,
  metricParam: string | null,
): Promise<string | null> {
  const range = periodRangeFor(periodStart, periodKind);
  if (metricKey === 'omzet' || metricKey === 'closing_ratio_qualified_pct') {
    const acc = await gather(sql, [salespersonId], { period: range, salespersonId, source: null, campaignId: null }, false);
    const a = acc.get(salespersonId) ?? emptyAcc();
    if (metricKey === 'omzet') {
      return money.decimal(a.omzet);
    }
    // closing_ratio_qualified_pct = closedSuccess ÷ qualified — deliberately
    // NOT `closingRatePct` (closedSuccess ÷ (closedSuccess+closedLost)); see
    // MetricKey's doc comment for why the owner's OKR names a different ratio.
    return a.qualified === 0 ? null : roundPct(a.closedSuccess, a.qualified).toFixed(2);
  }
  if (metricKey === 'klien_count_min_kontrak') {
    const threshold = money.decimal(money.parse(metricParam ?? '0'));
    const rows = await sql<{ n: string }[]>`
      select count(distinct cl.id) as n
        from clients cl
        join contracts c on c.client_id = cl.id
        join transactions t on t.id = cl.transaction_id
        join client_sales_allocations a on a.client_id = cl.id
       where a.salesperson_id = ${salespersonId}
         and a.basis_points > 0
         and t.total_agreed_value >= ${threshold}::numeric
         and wib_period(c.created_at) between ${range.from} and ${range.to}`;
    return rows[0].n;
  }
  // scouting_closing_count: closings (first ->Closed-Success) whose LEAD
  // source is 'Scouting' — reuses the same first-per-stage reduction the rest
  // of this module uses, so a closing counted here can never disagree with
  // `closedSuccess` on the main dashboard.
  const events = await loadStageEventsByOwner(sql, [salespersonId]);
  const closedInPeriod = events.filter((e) => e.stage === 'closedSuccess' && inPeriod(range, e.at)).map((e) => e.attemptId);
  if (closedInPeriod.length === 0) {
    return '0';
  }
  const rows = await sql<{ n: string }[]>`
    select count(distinct pa.id) as n
      from prospect_attempts pa
      join leads l on l.id = pa.lead_id
     where pa.id = any(${closedInPeriod}) and l.source = 'Scouting'`;
  return rows[0].n;
}

/** Whether metricKey's raw value is Rupiah — the only case an `_idr` sibling field is meaningful. */
function metricIsMoney(k: MetricKey): boolean {
  return k === 'omzet';
}

async function toTargetRow(sql: Queryable, r: {
  salesperson_id: string; period_start: string | Date; period_kind: PeriodKind; metric_key: MetricKey;
  metric_param: string | null; target_value: string; updated_at: Date; updated_by: string;
}): Promise<TargetRow> {
  const periodStart = typeof r.period_start === 'string' ? r.period_start : r.period_start.toISOString().slice(0, 10);
  const actual = await computeMetricActual(sql, r.salesperson_id, periodStart, r.period_kind, r.metric_key, r.metric_param);
  const target = money.parse(r.target_value); // exact decimal math regardless of unit (Rupiah/percent/count)
  const isMoney = metricIsMoney(r.metric_key);
  return {
    salespersonId: r.salesperson_id,
    periodStart,
    periodKind: r.period_kind,
    metricKey: r.metric_key,
    metricParam: r.metric_param === null ? null : money.decimal(money.parse(r.metric_param)),
    metricParamIdr: r.metric_param === null ? null : money.format(money.parse(r.metric_param)),
    targetValue: money.decimal(target),
    targetValueIdr: isMoney ? money.format(target) : null,
    actualValue: actual === null ? null : money.decimal(money.parse(actual)),
    actualValueIdr: isMoney && actual !== null ? money.format(money.parse(actual)) : null,
    achievedPct: actual === null || target === 0n ? null : roundPctMoney(money.parse(actual), target),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

/** listTargets: every target for one period bucket, gated the same as `scopeFor` (staff = own row, lead/SPV = division, OD/Director = all). */
export async function listTargets(sql: Queryable, actor: Actor, periodStart: string): Promise<TargetRow[]> {
  const scope = scopeFor(actor);
  if (scope === null) throw new ForbiddenError();
  const rows = await sql<{ salesperson_id: string; period_start: string | Date; period_kind: PeriodKind; metric_key: MetricKey; metric_param: string | null; target_value: string; updated_at: Date; updated_by: string }[]>`
    select salesperson_id, period_start, period_kind, metric_key, metric_param, target_value, updated_at, updated_by
      from sales_targets where period_start = ${periodStart}::date
      order by salesperson_id, metric_key`;
  const filtered = scope.ownOnly ? rows.filter((r) => r.salesperson_id === actor.employeeId) : rows;
  return Promise.all(filtered.map((r) => toTargetRow(sql, r)));
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** setTarget: OD/Director only (M0 §7.1 — Sales itself never writes its own OKR). Upserts the natural-key row (now keyed by metric too) and appends to `audit_log`. */
export async function setTarget(sql: Sql, actor: Actor, input: SetTargetInput): Promise<void> {
  if (!canManageTargets(actor)) {
    throw new ForbiddenError();
  }
  const salespersonId = (input.salespersonId ?? '').trim();
  const periodStart = (input.periodStart ?? '').trim();
  const periodKind = input.periodKind;
  const metricKey = input.metricKey;
  if (
    salespersonId === '' ||
    !RE_DATE.test(periodStart) ||
    (periodKind !== 'bulan' && periodKind !== 'kuartal' && periodKind !== 'tahun') ||
    !METRIC_KEYS.includes(metricKey)
  ) {
    throw new ValidationError();
  }
  let amt: money.Money;
  try {
    amt = money.parse((input.targetValue ?? '').trim());
  } catch {
    throw new ValidationError();
  }
  if (amt < 0n) {
    throw new ValidationError();
  }
  const needsParam = metricNeedsParam(metricKey);
  const rawParam = (input.metricParam ?? '').toString().trim();
  // Mirrors the DB CHECK (ck_sales_targets_metric_param): the param is
  // MANDATORY for klien_count_min_kontrak and FORBIDDEN for every other
  // metric — a param silently ignored (or silently missing) would make the
  // target mean something different from what the caller typed.
  if (needsParam && rawParam === '') {
    throw new ValidationError();
  }
  if (!needsParam && rawParam !== '') {
    throw new ValidationError();
  }
  let param: money.Money | null = null;
  if (needsParam) {
    try {
      param = money.parse(rawParam);
    } catch {
      throw new ValidationError();
    }
    if (param < 0n) {
      throw new ValidationError();
    }
  }
  const paramDecimal = param === null ? null : money.decimal(param);

  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const prev = await tx<{ target_value: string; metric_param: string | null }[]>`
      select target_value, metric_param from sales_targets
       where salesperson_id = ${salespersonId} and period_start = ${periodStart}::date
         and period_kind = ${periodKind} and metric_key = ${metricKey}`;
    await tx`
      insert into sales_targets (salesperson_id, period_start, period_kind, metric_key, metric_param, target_value, updated_by)
      values (${salespersonId}, ${periodStart}::date, ${periodKind}, ${metricKey}, ${paramDecimal}, ${money.decimal(amt)}, ${actor.employeeId})
      on conflict (salesperson_id, period_start, period_kind, metric_key)
      do update set target_value = excluded.target_value, metric_param = excluded.metric_param,
                    updated_by = excluded.updated_by, updated_at = now()`;
    await ex.audit.insertAudit({
      entityType: 'sales_targets', entityId: `${salespersonId}/${periodStart}/${periodKind}/${metricKey}`,
      actorEmployeeId: actor.employeeId, action: prev.length === 0 ? 'target_set' : 'target_edited',
      beforeJson: prev.length === 0 ? null : { target_value: prev[0].target_value, metric_param: prev[0].metric_param },
      afterJson: { target_value: money.decimal(amt), metric_param: paramDecimal }, createdBy: actor.employeeId,
    });
  });
}
