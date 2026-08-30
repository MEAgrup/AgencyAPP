/**
 * Kinerja Sales (M0 §7.1) + Sales OKR — read-model service.
 *
 * Ported from the owner-supplied spreadsheet (`docs/handoff/WAVE1_EXTERNAL_REQUESTS.md`,
 * link recorded 2026-07-10) into the CDPS shape the PRDs already promise but never
 * ticketed: `CDPS_Module0_Sales.md` §7.1 ("sales analytics dashboard + monthly
 * achievement vs OKR"), §8 (north-star "closing rate + deal-cycle duration per
 * salesperson, from immutable timestamps"), and `CDPS_Module1_Leads_Database.md`
 * §7 ("dashboard over all sales attempts; monitor contested leads + win/loss").
 *
 * A NEW FILE, not an addition to `sales.ts` (already 2000+ lines) — the same
 * separation `marketing.ts` keeps from `campaign.ts`: this module is PURE read
 * aggregation, it owns no write path and no state machine.
 *
 * Everything here is DERIVED ON READ (house rule #4) from the immutable logs —
 * `leads`, `audit_log` transitions, `prospect_activities`, `client_sales_allocations`,
 * `transactions`, `contracts.jenis` — nothing is cached or stored. Division-by-zero
 * renders as a null percentage/money field; the presentation layer (wire/UI) turns
 * that into the house "—" (rule #7), matching the literal type this module returns
 * (`number | money.Money | null`, NOT a pre-formatted string) — that is the contract
 * `RENCANA_KINERJA_SALES.md` §5 S-03 specifies.
 *
 * SCOPE NOTE (§11 "yang tidak dikerjakan"): chat/blaster/respon/call metrics are
 * NOT built (no CDPS entity records them); "Seller"/"Affiliator" are NOT
 * introduced as terms — the existing Qualified/Non-Qualified vocabulary is kept;
 * Tiering T1–T5 is an open PRD question (`docs/DECISIONS.md`), not implemented.
 *
 * Reuses, never re-derives: `core/money` (proRata/format/parse), `core/tz`
 * (period/dateString), `core/permission`, `activity.effortCounts` is NOT reused
 * for the per-type effort breakdown below — it only returns per-attempt TOTALS,
 * and this module needs a per-type, per-salesperson rollup, which is a genuinely
 * different aggregate (see `effortRows` query). `finance.commissionAchievement`
 * IS reused as-is, once per distinct transaction, for the money split.
 */

import { money, permission, tz } from '@cdps/core';
import type { Queryable, Sql } from '@cdps/db';
import { executors, withTransaction } from '@cdps/db';
import { commissionAchievement } from './finance';
import { SALES_DIVISION } from './sales';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5).
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
// Level Sales (§3a) — derived from `employees.jabatan` (HRIS sync), NOT a new
// field. TS-only lookup (not a dual-home DB table like `division_registry`):
// this is a display label over a small closed HRIS jabatan set, feeds no
// money/score math (§3a caveat 2 — that would need a per-period snapshot,
// deliberately deferred, `docs/DECISIONS.md`), and the plan's own caveat 1
// already accepts that a jabatan rename needs a migration regardless of
// whether the mapping lives in a table or in code. Logged as a scope choice,
// not a silent shortcut.
// ---------------------------------------------------------------------------
const JABATAN_LEVEL: Readonly<Record<string, string>> = {
  'HEAD OF SALES JASA': 'Head',
  'SENIOR SALES JASA': 'Senior',
  'SALES JASA': 'Junior',
  SALES: 'Junior',
  'ADMIN SALES': 'Admin',
  'CUSTOMER RELATION OFFICER': 'CRO',
};

/** levelSalesFor renders the §3a display label, or the raw jabatan if unmapped. */
export function levelSalesFor(jabatan: string | null | undefined): string {
  const j = (jabatan ?? '').trim();
  if (j === '') {
    return EM_DASH;
  }
  return JABATAN_LEVEL[j.toUpperCase()] ?? j;
}

// ---------------------------------------------------------------------------
// Permission (M0 §7.1 / PERMISSIONS.md — universal pattern applied to Sales).
// ---------------------------------------------------------------------------

/** canViewSalesPerf: any Sales employee (staff/lead), OD (read-only), or Director. */
export function canViewSalesPerf(actor: Actor): boolean {
  return actor.role.director || actor.role.od || actor.role.division === SALES_DIVISION;
}

/**
 * scopeFor resolves how much of Kinerja Sales the actor may see: null = no
 * access at all; `{ ownOnly: true }` = Sales STAFF, own rows only; `{ ownOnly:
 * false }` = Sales Lead/SPV (division-wide, S-01), OD (read-only everywhere),
 * or Director.
 */
export function scopeFor(actor: Actor): { ownOnly: boolean } | null {
  if (!canViewSalesPerf(actor)) {
    return null;
  }
  if (actor.role.director || actor.role.od) {
    return { ownOnly: false };
  }
  if (permission.isLead(actor, SALES_DIVISION)) {
    return { ownOnly: false };
  }
  return { ownOnly: true };
}

/** canManageTarget: Sales Lead/SPV, OD, or Director may write Sales OKR (M0 §7.1). */
export function canManageTarget(actor: Actor): boolean {
  return actor.role.director || actor.role.od || permission.isLead(actor, SALES_DIVISION);
}

/**
 * resolveSalespersonFilter applies the actor's scope to the requested
 * `salespersonId` filter. A Sales staff (`ownOnly`) may only ever see their
 * own rows: an explicit filter for someone else is refused; no filter defaults
 * to "self", never to "everyone". Throws ForbiddenError when the actor has no
 * scope at all (checked by callers via `scopeFor` first, but defensive here
 * too since this function is the one every read entry point calls).
 */
function resolveSalespersonFilter(actor: Actor, requested: string | null): string | null {
  const scope = scopeFor(actor);
  if (scope === null) {
    throw new ForbiddenError();
  }
  if (!scope.ownOnly) {
    return requested;
  }
  if (requested !== null && requested !== actor.employeeId) {
    throw new ForbiddenError();
  }
  return actor.employeeId;
}

// ---------------------------------------------------------------------------
// Types (RENCANA_KINERJA_SALES.md §5 S-03 — the literal contract).
// ---------------------------------------------------------------------------

/** period bounds are "YYYY-MM" (inclusive on both ends). */
export interface PeriodFilter {
  from: string;
  to: string;
}

export interface SalesPerfFilter {
  period: PeriodFilter | null; // null = all periode
  salespersonId: string | null; // null = semua sales (subject to scope)
  source: string | null; // leads.source, exact match
  campaignId: string | null; // CMP-
}

export interface SalesPerfRow {
  salespersonId: string;
  nama: string;
  levelSales: string; // §3a
  leadsRegistered: number;
  leadsScouting: number;
  contacted: number; // effort tim
  qualified: number;
  nonQualified: number; // istilah kanonik (bukan Seller/Affiliator)
  nqBreakdown: Record<string, number>;
  negotiating: number;
  closedSuccess: number;
  closedLost: number;
  closingRatePct: number | null; // null → render "—" (house rule #7)
  qualifiedRatePct: number | null;
  avgDealCycleDays: number | null;
  effortFollowUp: number;
  effortVisit: number;
  effortOnlineMeeting: number;
  klienBaru: string; // §4, desimal — Σ basis_points/10000 di kontrak 'baru' (atau tanpa kontrak)
  klienPerpanjangan: string;
  klienCrossSell: string;
  klienCount: string; // total tertimbang alokasi
  omzet: money.Money;
  komisiKontrak: money.Money;
  komisiDiakui: money.Money;
  targetOmzet: money.Money | null;
  pencapaianPct: number | null;
  sisaTarget: money.Money | null;
  sisaPerMinggu: money.Money | null;
  sisaPerHari: money.Money | null;
  momPct: number | null;
}

export interface SalesPerfMonthRow extends SalesPerfRow {
  period: string; // YYYYMM
}

export interface LeadSourceRow {
  period: string; // YYYYMM, or "ALL" when filter.period is null
  source: string;
  campaignId: string | null;
  campaignName: string | null;
  salespersonId: string | null;
  leads: number;
  qualified: number;
  nonQualified: number;
  closing: number;
  omzet: money.Money;
  nqBreakdown: Record<string, number>;
}

export interface TargetRow {
  salespersonId: string;
  periodStart: string; // YYYY-MM-DD
  periodKind: string; // 'bulan' | 'tahun'
  targetOmzet: money.Money;
  updatedAt: Date;
  updatedBy: string;
}

export interface SetTargetInput {
  salespersonId: string;
  periodStart: string; // "YYYY-MM-01" (bulan) or "YYYY-01-01" (tahun)
  periodKind: string; // 'bulan' | 'tahun'
  targetOmzet: string; // DECIMAL string
}

// ---------------------------------------------------------------------------
// Period helpers — WIB bucketing, reusing tz.period (house rule: one clock).
// ---------------------------------------------------------------------------

/** inRange reports whether a "YYYYMM" bucket falls inside an inclusive filter. */
function inRange(bucket: string, f: PeriodFilter | null): boolean {
  if (f === null) {
    return true;
  }
  const from = f.from.replace('-', '');
  const to = f.to.replace('-', '');
  return bucket >= from && bucket <= to;
}

/** previousPeriod returns the "YYYYMM" bucket immediately before `p`. */
function previousPeriod(p: string): string {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(4, 6));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}${String(pm).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Roster — active Sales-division employees (staff + lead), scoped by
// `salespersonId` filter. Employees with zero activity in the window still
// appear (so a target row is visible before the first deal lands).
// ---------------------------------------------------------------------------

interface RosterRow {
  employeeId: string;
  nama: string;
  jabatan: string | null;
}

async function loadRoster(sql: Queryable, salespersonId: string | null): Promise<RosterRow[]> {
  const rows = await sql<{ employee_id: string; nama: string; jabatan: string | null }[]>`
    select e.employee_id, e.nama, e.jabatan
      from employees e
      join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where rm.division = ${SALES_DIVISION}
       and e.status_aktif = true
       and (${salespersonId}::text is null or e.employee_id = ${salespersonId})
     order by e.nama`;
  return rows.map((r) => ({ employeeId: r.employee_id, nama: r.nama, jabatan: r.jabatan }));
}

// ---------------------------------------------------------------------------
// Raw event rows — fetched ONCE per call (roster + source/campaign filtered,
// NOT period-filtered — every row carries its own WIB period bucket so a
// single fetch serves both `bySalesperson` (collapse all buckets in range)
// and `byMonth` (group by bucket) without a second round-trip per period.
// ---------------------------------------------------------------------------

interface LeadRow {
  salespersonId: string;
  period: string;
  isScouting: boolean;
}

async function loadLeadRows(sql: Queryable, rosterIds: string[], f: SalesPerfFilter): Promise<LeadRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{ created_by: string; created_at: Date; source: string }[]>`
    select created_by, created_at, source
      from leads
     where created_by = any(${rosterIds})
       and (${f.source}::text is null or source = ${f.source})
       and (${f.campaignId}::text is null or origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({
    salespersonId: r.created_by,
    period: tz.period(r.created_at),
    isScouting: r.source === 'Scouting',
  }));
}

interface TransitionRow {
  salespersonId: string;
  period: string;
}

/**
 * loadTransitionRows counts one funnel transition (`actionLike`, a LIKE
 * pattern so a multi-source edge like "->Closed-Success" matches every
 * possible from-state) attributed to the ATTEMPT OWNER (not the actor who
 * clicked the transition — a lead can act on staff's behalf), scoped by
 * source/campaign via the lead and by roster.
 */
async function loadTransitionRows(
  sql: Queryable,
  rosterIds: string[],
  f: SalesPerfFilter,
  actionLike: string,
): Promise<TransitionRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{ owner_employee_id: string; created_at: Date }[]>`
    select pa.owner_employee_id, al.created_at
      from audit_log al
      join prospect_attempts pa on pa.id = al.entity_id and al.entity_type = 'prospect_attempt'
      join leads l on l.id = pa.lead_id
     where al.action like ${actionLike}
       and pa.owner_employee_id = any(${rosterIds})
       and (${f.source}::text is null or l.source = ${f.source})
       and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({ salespersonId: r.owner_employee_id, period: tz.period(r.created_at) }));
}

interface NqReasonRow {
  salespersonId: string;
  period: string;
  reason: string;
}

/** loadNqReasonRows mirrors marketing.ts's junkBreakdown join, attributed by attempt owner. */
async function loadNqReasonRows(sql: Queryable, rosterIds: string[], f: SalesPerfFilter): Promise<NqReasonRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{ owner_employee_id: string; created_at: Date; reason: string }[]>`
    select pa.owner_employee_id, r.created_at, r.reason
      from prospect_attempt_nq_reasons r
      join prospect_attempts pa on pa.id = r.attempt_id
      join leads l on l.id = pa.lead_id
     where pa.owner_employee_id = any(${rosterIds})
       and (${f.source}::text is null or l.source = ${f.source})
       and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({ salespersonId: r.owner_employee_id, period: tz.period(r.created_at), reason: r.reason }));
}

interface DealCycleRow {
  salespersonId: string;
  period: string; // period of the Closed-Success event
  cycleDays: number;
}

/** loadDealCycleRows: first ->Contacted to the (single, terminal) ->Closed-Success event, per attempt. */
async function loadDealCycleRows(sql: Queryable, rosterIds: string[], f: SalesPerfFilter): Promise<DealCycleRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{ owner_employee_id: string; contacted_at: Date; closed_at: Date }[]>`
    select pa.owner_employee_id, ct.contacted_at, cs.closed_at
      from prospect_attempts pa
      join leads l on l.id = pa.lead_id
      join lateral (
        select min(created_at) as contacted_at from audit_log
         where entity_type = 'prospect_attempt' and entity_id = pa.id
           and action = 'transition:New Lead->Contacted'
      ) ct on ct.contacted_at is not null
      join lateral (
        select min(created_at) as closed_at from audit_log
         where entity_type = 'prospect_attempt' and entity_id = pa.id
           and action like 'transition:%->Closed-Success'
      ) cs on cs.closed_at is not null
     where pa.owner_employee_id = any(${rosterIds})
       and (${f.source}::text is null or l.source = ${f.source})
       and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({
    salespersonId: r.owner_employee_id,
    period: tz.period(r.closed_at),
    cycleDays: tz.daysBetween(r.contacted_at, r.closed_at),
  }));
}

interface EffortRow {
  salespersonId: string;
  period: string;
  activityType: string;
}

/**
 * loadEffortRows: per-TYPE activity counts by attempt owner. NOT
 * `activity.effortCounts` (that returns per-attempt TOTALS, not a per-type
 * breakdown) — a genuinely different aggregate, so a new grouped query, per
 * the same N+1-avoidance shape `effortCounts` itself uses (one query, not one
 * per attempt).
 */
async function loadEffortRows(sql: Queryable, rosterIds: string[], f: SalesPerfFilter): Promise<EffortRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{ owner_employee_id: string; occurred_at: Date; activity_type: string }[]>`
    select pa.owner_employee_id, a.occurred_at, a.activity_type
      from prospect_activities a
      join prospect_attempts pa on pa.id = a.attempt_id
      join leads l on l.id = pa.lead_id
     where pa.owner_employee_id = any(${rosterIds})
       and a.activity_type in ('Follow Up', 'Visit', 'Online Meeting')
       and (${f.source}::text is null or l.source = ${f.source})
       and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({ salespersonId: r.owner_employee_id, period: tz.period(r.occurred_at), activityType: r.activity_type }));
}

interface ClientRow {
  salespersonId: string;
  clientId: string;
  transactionId: string;
  totalAgreedValue: string;
  basisPoints: number;
  period: string; // period of the closing event
  hasPerpanjangan: boolean;
  hasCrossSell: boolean;
}

/**
 * loadClientRows is the money/klien basis: one row per (salesperson,
 * TRANSACTION) allocation, carrying the weighted share, the transaction to
 * price it against, the closing period, and whether THIS SPECIFIC closing's
 * contract (if any) is a perpanjangan/cross_sell (R-02/R-03).
 *
 * R-03 changed the scope here from "per client" to "per transaction" — a
 * client may now carry more than one closing (the original + any renewal/
 * cross-sell), each with its OWN allocation row (`transaction_id`, migration
 * 20260901080000) and, when it went through the renewal door, its OWN
 * contract (`contracts.transaction_id`, migration 20260901060000). A closing
 * with NO `contracts` row tied to it at all (Contract creation via Account's
 * own door is a separate step, not automatic — or this is the client's very
 * first, non-renewal closing) is unambiguously 'baru' by elimination — it
 * never went through the renewal door, because ONLY that door sets
 * `contracts.transaction_id`.
 *
 * The closing TIMESTAMP is read from the SAME audit row `close()`/
 * `closeRenewal()` both write (`entity_type='client', action='closing'`),
 * matched by `after_json->>'transaction_id'` — a client's audit trail can now
 * hold more than one 'closing' row (one per TRX-), so matching by entity_id
 * alone (as before R-03) would always resolve to the EARLIEST one.
 */
async function loadClientRows(sql: Queryable, rosterIds: string[], f: SalesPerfFilter): Promise<ClientRow[]> {
  if (rosterIds.length === 0) {
    return [];
  }
  const rows = await sql<{
    salesperson_id: string; client_id: string; transaction_id: string; total_agreed_value: string;
    basis_points: number; closed_at: Date; has_perpanjangan: boolean; has_cross_sell: boolean;
  }[]>`
    select csa.salesperson_id, csa.client_id, t.id as transaction_id, t.total_agreed_value,
           csa.basis_points,
           coalesce((select min(al.created_at) from audit_log al
                      where al.entity_type = 'client' and al.entity_id = c.id and al.action = 'closing'
                        and al.after_json->>'transaction_id' = t.id),
                     c.created_at) as closed_at,
           exists (select 1 from contracts ct where ct.transaction_id = t.id and ct.jenis = 'perpanjangan') as has_perpanjangan,
           exists (select 1 from contracts ct where ct.transaction_id = t.id and ct.jenis = 'cross_sell') as has_cross_sell
      from client_sales_allocations csa
      join transactions t on t.id = csa.transaction_id
      join clients c on c.id = csa.client_id
      join leads l on l.id = c.lead_id
     where csa.salesperson_id = any(${rosterIds})
       and (${f.source}::text is null or l.source = ${f.source})
       and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})`;
  return rows.map((r) => ({
    salespersonId: r.salesperson_id, clientId: r.client_id, transactionId: r.transaction_id,
    totalAgreedValue: r.total_agreed_value, basisPoints: r.basis_points, period: tz.period(r.closed_at),
    hasPerpanjangan: r.has_perpanjangan, hasCrossSell: r.has_cross_sell,
  }));
}

/** formatBp renders a basis-points sum (Σ ≤ 10000 per client) as a 4-decimal weighted-count string. */
function formatBp(bp: bigint): string {
  const neg = bp < 0n ? '-' : '';
  const abs = bp < 0n ? -bp : bp;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, '0');
  return `${neg}${whole}.${frac}`;
}

// ---------------------------------------------------------------------------
// Accumulator — folds every raw row kind into one SalesPerfRow-shaped bucket,
// keyed by (salespersonId, period). "period" is the literal WIB bucket for
// byMonth, or the constant ALL_BUCKET for the collapsed bySalesperson view.
// ---------------------------------------------------------------------------

const ALL_BUCKET = 'ALL';

interface Bucket {
  leadsRegistered: number;
  leadsScouting: number;
  contacted: number;
  qualified: number;
  nonQualified: number;
  nqBreakdown: Record<string, number>;
  negotiating: number;
  closedSuccess: number;
  closedLost: number;
  cycleDaysSum: number;
  cycleDaysCount: number;
  effortFollowUp: number;
  effortVisit: number;
  effortOnlineMeeting: number;
  klienBaruBp: bigint;
  klienPerpanjanganBp: bigint;
  klienCrossSellBp: bigint;
  omzet: money.Money;
  komisiKontrak: money.Money;
  komisiDiakui: money.Money;
}

function emptyBucket(): Bucket {
  return {
    leadsRegistered: 0, leadsScouting: 0, contacted: 0, qualified: 0, nonQualified: 0,
    nqBreakdown: {}, negotiating: 0, closedSuccess: 0, closedLost: 0,
    cycleDaysSum: 0, cycleDaysCount: 0, effortFollowUp: 0, effortVisit: 0, effortOnlineMeeting: 0,
    klienBaruBp: 0n, klienPerpanjanganBp: 0n, klienCrossSellBp: 0n,
    omzet: 0n, komisiKontrak: 0n, komisiDiakui: 0n,
  };
}

/** BucketKey = `${salespersonId} ${period}`. */
function bucketKey(salespersonId: string, period: string): string {
  return `${salespersonId} ${period}`;
}

function getBucket(map: Map<string, Bucket>, salespersonId: string, period: string): Bucket {
  const key = bucketKey(salespersonId, period);
  let b = map.get(key);
  if (b === undefined) {
    b = emptyBucket();
    map.set(key, b);
  }
  return b;
}

interface Loaded {
  roster: RosterRow[];
  buckets: Map<string, Bucket>; // per (salesperson, real period) — collapsed view built by caller
}

/**
 * loadAll fetches every raw dataset ONCE and folds it into per-(salesperson,
 * real-WIB-period) buckets. `byMonth`/`bySalesperson` both build on this —
 * `byMonth` reads the buckets as-is; `bySalesperson` collapses every bucket
 * whose period passes `inRange` into ALL_BUCKET.
 */
async function loadAll(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<Loaded> {
  if (!canViewSalesPerf(actor)) {
    throw new ForbiddenError();
  }
  const salespersonId = resolveSalespersonFilter(actor, f.salespersonId);
  const roster = await loadRoster(sql, salespersonId);
  const rosterIds = roster.map((r) => r.employeeId);

  const [leadRows, contactedRows, qualifiedRows, nqRows, nqReasonRows, negotiatingRows,
    closedSuccessRows, closedLostRows, dealCycleRows, effortRows, clientRows] = await Promise.all([
    loadLeadRows(sql, rosterIds, f),
    loadTransitionRows(sql, rosterIds, f, 'transition:New Lead->Contacted'),
    loadTransitionRows(sql, rosterIds, f, 'transition:Contacted->Qualified'),
    loadTransitionRows(sql, rosterIds, f, 'transition:Contacted->Not Qualified'),
    loadNqReasonRows(sql, rosterIds, f),
    loadTransitionRows(sql, rosterIds, f, 'transition:Qualified->Negotiation%'),
    loadTransitionRows(sql, rosterIds, f, 'transition:%->Closed-Success'),
    loadTransitionRows(sql, rosterIds, f, 'transition:%->Closed-Lost'),
    loadDealCycleRows(sql, rosterIds, f),
    loadEffortRows(sql, rosterIds, f),
    loadClientRows(sql, rosterIds, f),
  ]);

  // Commission: one call per DISTINCT transaction (not per allocation row),
  // concurrently — the same N+1-avoidance shape as marketing.dashboard's P-1.
  const uniqueTxIds = [...new Set(clientRows.map((r) => r.transactionId))];
  const views = await Promise.all(uniqueTxIds.map((id) => commissionAchievement(sql, id)));
  const viewByTx = new Map(views.map((v) => [v.transactionId, v]));

  const buckets = new Map<string, Bucket>();

  for (const r of leadRows) {
    const b = getBucket(buckets, r.salespersonId, r.period);
    b.leadsRegistered += 1;
    if (r.isScouting) b.leadsScouting += 1;
  }
  for (const r of contactedRows) getBucket(buckets, r.salespersonId, r.period).contacted += 1;
  for (const r of qualifiedRows) getBucket(buckets, r.salespersonId, r.period).qualified += 1;
  for (const r of nqRows) getBucket(buckets, r.salespersonId, r.period).nonQualified += 1;
  for (const r of nqReasonRows) {
    const b = getBucket(buckets, r.salespersonId, r.period);
    b.nqBreakdown[r.reason] = (b.nqBreakdown[r.reason] ?? 0) + 1;
  }
  for (const r of negotiatingRows) getBucket(buckets, r.salespersonId, r.period).negotiating += 1;
  for (const r of closedSuccessRows) getBucket(buckets, r.salespersonId, r.period).closedSuccess += 1;
  for (const r of closedLostRows) getBucket(buckets, r.salespersonId, r.period).closedLost += 1;
  for (const r of dealCycleRows) {
    const b = getBucket(buckets, r.salespersonId, r.period);
    b.cycleDaysSum += r.cycleDays;
    b.cycleDaysCount += 1;
  }
  for (const r of effortRows) {
    const b = getBucket(buckets, r.salespersonId, r.period);
    if (r.activityType === 'Follow Up') b.effortFollowUp += 1;
    else if (r.activityType === 'Visit') b.effortVisit += 1;
    else if (r.activityType === 'Online Meeting') b.effortOnlineMeeting += 1;
  }
  for (const r of clientRows) {
    const b = getBucket(buckets, r.salespersonId, r.period);
    const bp = BigInt(r.basisPoints);
    if (r.hasPerpanjangan) b.klienPerpanjanganBp += bp;
    else if (r.hasCrossSell) b.klienCrossSellBp += bp;
    else b.klienBaruBp += bp;

    b.omzet += money.proRata(money.parse(r.totalAgreedValue), bp, 10000n);
    const view = viewByTx.get(r.transactionId);
    if (view !== undefined) {
      b.komisiKontrak += money.proRata(money.parse(view.totalDealCommission), bp, 10000n);
      const share = view.shares.find((s) => s.salespersonId === r.salespersonId);
      if (share !== undefined) {
        b.komisiDiakui += money.parse(share.recognizedCommission);
      }
    }
  }

  return { roster, buckets };
}

/** percentRound: round(100*num/den) half-up, or null when den is 0 (house rule #7). */
function percentRound(num: number, den: number): number | null {
  if (den <= 0) {
    return null;
  }
  return Math.round((num / den) * 100 * 100) / 100; // 2dp, half-up via JS round (den/num are small integers)
}

/** buildRow assembles a SalesPerfRow (minus target fields) from one bucket. */
function buildRow(roster: RosterRow, b: Bucket): Omit<SalesPerfRow, 'targetOmzet' | 'pencapaianPct' | 'sisaTarget' | 'sisaPerMinggu' | 'sisaPerHari' | 'momPct'> {
  return {
    salespersonId: roster.employeeId,
    nama: roster.nama,
    levelSales: levelSalesFor(roster.jabatan),
    leadsRegistered: b.leadsRegistered,
    leadsScouting: b.leadsScouting,
    contacted: b.contacted,
    qualified: b.qualified,
    nonQualified: b.nonQualified,
    nqBreakdown: b.nqBreakdown,
    negotiating: b.negotiating,
    closedSuccess: b.closedSuccess,
    closedLost: b.closedLost,
    closingRatePct: percentRound(b.closedSuccess, b.closedSuccess + b.closedLost),
    qualifiedRatePct: percentRound(b.qualified, b.qualified + b.nonQualified),
    avgDealCycleDays: b.cycleDaysCount > 0 ? Math.round((b.cycleDaysSum / b.cycleDaysCount) * 100) / 100 : null,
    effortFollowUp: b.effortFollowUp,
    effortVisit: b.effortVisit,
    effortOnlineMeeting: b.effortOnlineMeeting,
    klienBaru: formatBp(b.klienBaruBp),
    klienPerpanjangan: formatBp(b.klienPerpanjanganBp),
    klienCrossSell: formatBp(b.klienCrossSellBp),
    klienCount: formatBp(b.klienBaruBp + b.klienPerpanjanganBp + b.klienCrossSellBp),
    omzet: b.omzet,
    komisiKontrak: b.komisiKontrak,
    komisiDiakui: b.komisiDiakui,
  };
}

// ---------------------------------------------------------------------------
// Target / OKR (§5 View 4) — attach target + achievement + remaining-target
// fields onto an already-built row. Remaining-target figures only make sense
// for the CURRENTLY OPEN month (a closed month has no "remaining"), so they
// render null outside it — never a stale or misleading number.
// ---------------------------------------------------------------------------

async function targetFor(sql: Queryable, salespersonId: string, monthPeriodStart: string): Promise<money.Money | null> {
  const rows = await sql<{ target_omzet: string }[]>`
    select target_omzet from sales_targets
     where salesperson_id = ${salespersonId} and period_start = ${monthPeriodStart}::date and period_kind = 'bulan'`;
  return rows.length === 0 ? null : money.parse(rows[0].target_omzet);
}

async function remainingWorkingDays(sql: Queryable, monthPeriodStart: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select working_days_between(current_date, (date_trunc('month', ${monthPeriodStart}::date) + interval '1 month - 1 day')::date) as n`;
  return rows[0].n;
}

/** moneyDivCount renders num/count, or null when count ≤ 0 (house rule #7). */
function moneyDivCount(num: money.Money, count: number): money.Money | null {
  if (count <= 0) {
    return null;
  }
  return num / BigInt(count);
}

/**
 * attachTarget fills the target/achievement/remaining columns for ONE month
 * bucket (`period` = "YYYYMM"). Only computed when `period` is the CURRENT
 * WIB month — a request for a closed or future month gets null remaining
 * figures, never a number that would mislead ("Sisa Target" of a month that
 * already ended is not a real remaining amount).
 */
async function attachTarget(
  sql: Queryable,
  row: ReturnType<typeof buildRow>,
  period: string,
  now: Date,
): Promise<SalesPerfRow> {
  const monthStart = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
  const target = await targetFor(sql, row.salespersonId, monthStart);
  const pencapaianPct = target !== null ? percentRound(Number(row.omzet), Number(target)) : null;
  const isCurrentMonth = period === tz.period(now);
  let sisaTarget: money.Money | null = null;
  let sisaPerMinggu: money.Money | null = null;
  let sisaPerHari: money.Money | null = null;
  if (target !== null && isCurrentMonth) {
    sisaTarget = target - row.omzet;
    const workingDays = await remainingWorkingDays(sql, monthStart);
    sisaPerHari = moneyDivCount(sisaTarget, workingDays);
    sisaPerMinggu = moneyDivCount(sisaTarget, Math.ceil(workingDays / 5));
  }
  return { ...row, targetOmzet: target, pencapaianPct, sisaTarget, sisaPerMinggu, sisaPerHari, momPct: null };
}

// ---------------------------------------------------------------------------
// Public reads (RENCANA_KINERJA_SALES.md §5 S-03).
// ---------------------------------------------------------------------------

/** bySalesperson — View 1 (REPORT ACTIVITY AND CLOSING), one row per sales. */
export async function bySalesperson(sql: Queryable, actor: Actor, f: SalesPerfFilter, now: Date = new Date()): Promise<SalesPerfRow[]> {
  const { roster, buckets } = await loadAll(sql, actor, f);

  const out: SalesPerfRow[] = [];
  for (const r of roster) {
    const collapsed = emptyBucket();
    let matched = false;
    for (const [key, b] of buckets) {
      const [sid, period] = key.split(' ');
      if (sid !== r.employeeId || !inRange(period, f.period)) continue;
      matched = true;
      mergeBucket(collapsed, b);
    }
    const built = buildRow(r, matched ? collapsed : emptyBucket());
    // Target/momPct only make sense scoped to a single month; a range or
    // "all periode" view renders them null (there is no one month to compare).
    const singleMonth = f.period !== null && f.period.from === f.period.to
      ? f.period.from.replace('-', '')
      : null;
    if (singleMonth !== null) {
      const withTarget = await attachTarget(sql, built, singleMonth, now);
      withTarget.momPct = await computeMomPct(sql, r.employeeId, singleMonth);
      out.push(withTarget);
    } else {
      out.push({ ...built, targetOmzet: null, pencapaianPct: null, sisaTarget: null, sisaPerMinggu: null, sisaPerHari: null, momPct: null });
    }
  }
  return out;
}

function mergeBucket(dst: Bucket, src: Bucket): void {
  dst.leadsRegistered += src.leadsRegistered;
  dst.leadsScouting += src.leadsScouting;
  dst.contacted += src.contacted;
  dst.qualified += src.qualified;
  dst.nonQualified += src.nonQualified;
  for (const [k, v] of Object.entries(src.nqBreakdown)) dst.nqBreakdown[k] = (dst.nqBreakdown[k] ?? 0) + v;
  dst.negotiating += src.negotiating;
  dst.closedSuccess += src.closedSuccess;
  dst.closedLost += src.closedLost;
  dst.cycleDaysSum += src.cycleDaysSum;
  dst.cycleDaysCount += src.cycleDaysCount;
  dst.effortFollowUp += src.effortFollowUp;
  dst.effortVisit += src.effortVisit;
  dst.effortOnlineMeeting += src.effortOnlineMeeting;
  dst.klienBaruBp += src.klienBaruBp;
  dst.klienPerpanjanganBp += src.klienPerpanjanganBp;
  dst.klienCrossSellBp += src.klienCrossSellBp;
  dst.omzet += src.omzet;
  dst.komisiKontrak += src.komisiKontrak;
  dst.komisiDiakui += src.komisiDiakui;
}

/**
 * computeMomPct compares `omzetThisMonth` against the PRIOR month's omzet for
 * the same salesperson (recomputed with an unfiltered-by-source/campaign
 * period-only query — % vs last month is a whole-of-month figure, not a
 * per-source one, matching the sheet's View 4). Null when the prior month has
 * no allocations at all (house rule #7 — no "vs 0" percentage).
 */
async function computeMomPct(sql: Queryable, salespersonId: string, thisMonth: string): Promise<number | null> {
  const thisRows = await loadClientRows(sql, [salespersonId], { period: null, salespersonId, source: null, campaignId: null });
  let omzetThisMonth = 0n;
  for (const r of thisRows) {
    if (r.period !== thisMonth) continue;
    omzetThisMonth += money.proRata(money.parse(r.totalAgreedValue), BigInt(r.basisPoints), 10000n);
  }
  const prior = previousPeriod(thisMonth);
  let priorOmzet = 0n;
  for (const r of thisRows) {
    if (r.period !== prior) continue;
    priorOmzet += money.proRata(money.parse(r.totalAgreedValue), BigInt(r.basisPoints), 10000n);
  }
  if (priorOmzet === 0n) {
    return null;
  }
  const delta = Number(omzetThisMonth - priorOmzet);
  return Math.round((delta / Number(priorOmzet)) * 100 * 100) / 100;
}

/** byMonth — View 2 (FILTER BY NAME, one row per Year-Month) / View 5 (rekap tahunan). */
export async function byMonth(sql: Queryable, actor: Actor, f: SalesPerfFilter, now: Date = new Date()): Promise<SalesPerfMonthRow[]> {
  const { roster, buckets } = await loadAll(sql, actor, f);
  const rosterById = new Map(roster.map((r) => [r.employeeId, r]));

  const out: SalesPerfMonthRow[] = [];
  for (const [key, b] of buckets) {
    const [sid, period] = key.split(' ');
    const r = rosterById.get(sid);
    if (r === undefined || !inRange(period, f.period)) continue;
    const built = buildRow(r, b);
    const withTarget = await attachTarget(sql, built, period, now);
    withTarget.momPct = await computeMomPct(sql, sid, period);
    out.push({ ...withTarget, period });
  }
  out.sort((a, b) => (a.salespersonId === b.salespersonId ? a.period.localeCompare(b.period) : a.nama.localeCompare(b.nama)));
  return out;
}

/** bySource — View 3 (DASHBOARD LEAD), grouped by period + source + campaign. */
export async function bySource(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<LeadSourceRow[]> {
  if (!canViewSalesPerf(actor)) {
    throw new ForbiddenError();
  }
  const salespersonId = resolveSalespersonFilter(actor, f.salespersonId);
  const roster = await loadRoster(sql, salespersonId);
  const rosterIds = roster.map((r) => r.employeeId);
  if (rosterIds.length === 0) {
    return [];
  }

  const rows = await sql<{
    period: string; source: string; campaign_id: string | null; campaign_name: string | null;
    leads: string; qualified: string; non_qualified: string; closing: string; omzet: string;
  }[]>`
    with base as (
      select l.id as lead_id, wib_period(l.created_at) as period, l.source,
             l.origin_campaign_id as campaign_id, cmp.name as campaign_name
        from leads l
        left join campaigns cmp on cmp.id = l.origin_campaign_id
       where l.created_by = any(${rosterIds})
         and (${f.source}::text is null or l.source = ${f.source})
         and (${f.campaignId}::text is null or l.origin_campaign_id = ${f.campaignId})
    )
    select b.period, b.source, b.campaign_id, b.campaign_name,
           count(distinct b.lead_id) as leads,
           count(distinct pa.id) filter (where exists (
             select 1 from audit_log al where al.entity_type='prospect_attempt' and al.entity_id=pa.id
               and al.action = 'transition:Contacted->Qualified')) as qualified,
           count(distinct pa.id) filter (where exists (
             select 1 from audit_log al where al.entity_type='prospect_attempt' and al.entity_id=pa.id
               and al.action = 'transition:Contacted->Not Qualified')) as non_qualified,
           count(distinct pa.id) filter (where exists (
             select 1 from audit_log al where al.entity_type='prospect_attempt' and al.entity_id=pa.id
               and al.action like 'transition:%->Closed-Success')) as closing,
           coalesce(sum(distinct_trx.total_agreed_value), 0) as omzet
      from base b
      left join prospect_attempts pa on pa.lead_id = b.lead_id
      left join lateral (
        select t.total_agreed_value from clients c join transactions t on t.id = c.transaction_id
         where c.lead_id = b.lead_id
         limit 1
      ) distinct_trx on true
     group by b.period, b.source, b.campaign_id, b.campaign_name`;

  return rows
    .filter((r) => inRange(r.period, f.period))
    .map((r) => ({
      period: r.period,
      source: r.source,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      salespersonId: f.salespersonId,
      leads: Number(r.leads),
      qualified: Number(r.qualified),
      nonQualified: Number(r.non_qualified),
      closing: Number(r.closing),
      omzet: money.parse(r.omzet),
      // Reason breakdown per source is a further drill-down the sheet exposes
      // per-lead, not per-source-row; left empty at this aggregation level to
      // avoid a misleading partial breakdown. Full reasons remain available
      // via `bySalesperson`'s `nqBreakdown`.
      nqBreakdown: {},
    }));
}

// ---------------------------------------------------------------------------
// Target / OKR admin (S-02).
// ---------------------------------------------------------------------------

/** listTargets returns every configured target for one month bucket ("YYYY-MM-01"), scope-gated. */
export async function listTargets(sql: Queryable, actor: Actor, periodStart: string): Promise<TargetRow[]> {
  const scope = scopeFor(actor);
  if (scope === null) {
    throw new ForbiddenError();
  }
  const rows = await sql<{ salesperson_id: string; period_start: string | Date; period_kind: string; target_omzet: string; updated_at: Date; updated_by: string }[]>`
    select salesperson_id, period_start, period_kind, target_omzet, updated_at, updated_by
      from sales_targets
     where period_start = ${periodStart}::date
       and (${scope.ownOnly === false}::boolean or salesperson_id = ${actor.employeeId})
     order by salesperson_id`;
  return rows.map((r) => ({
    salespersonId: r.salesperson_id,
    periodStart: r.period_start instanceof Date ? r.period_start.toISOString().slice(0, 10) : String(r.period_start).slice(0, 10),
    periodKind: r.period_kind,
    targetOmzet: money.parse(r.target_omzet),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

/** setTarget upserts one Sales OKR row (Sales Lead/SPV, OD, or Director — M0 §7.1). Audited. */
export async function setTarget(sql: Sql, actor: Actor, input: SetTargetInput): Promise<void> {
  if (!canManageTarget(actor)) {
    throw new ForbiddenError();
  }
  const salespersonId = (input.salespersonId ?? '').trim();
  const periodStart = (input.periodStart ?? '').trim();
  const periodKind = (input.periodKind ?? '').trim();
  if (salespersonId === '' || periodStart === '' || (periodKind !== 'bulan' && periodKind !== 'tahun')) {
    throw new ValidationError();
  }
  let amt: money.Money;
  try {
    amt = money.parse((input.targetOmzet ?? '').trim());
  } catch {
    throw new ValidationError();
  }
  if (amt < 0n) {
    throw new ValidationError();
  }

  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const prev = await tx<{ target_omzet: string }[]>`
      select target_omzet from sales_targets
       where salesperson_id = ${salespersonId} and period_start = ${periodStart}::date and period_kind = ${periodKind}`;
    await tx`
      insert into sales_targets (salesperson_id, period_start, period_kind, target_omzet, updated_by)
      values (${salespersonId}, ${periodStart}::date, ${periodKind}, ${money.decimal(amt)}, ${actor.employeeId})
      on conflict (salesperson_id, period_start, period_kind)
      do update set target_omzet = excluded.target_omzet, updated_by = excluded.updated_by`;
    await ex.audit.insertAudit({
      entityType: 'sales_targets', entityId: `${salespersonId}/${periodStart}/${periodKind}`,
      actorEmployeeId: actor.employeeId, action: prev.length === 0 ? 'create' : 'update',
      beforeJson: prev.length === 0 ? null : { target_omzet: prev[0].target_omzet },
      afterJson: { target_omzet: money.decimal(amt) }, createdBy: actor.employeeId,
    });
  });
}
