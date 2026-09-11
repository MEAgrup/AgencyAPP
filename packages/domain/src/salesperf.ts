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
 * `finance.commissionAchievementBatch` (P2 §7 — the batched sibling of
 * `commissionAchievement`, same math, one round of `= any($ids)` queries
 * instead of one call per transaction) — its own `shares[]` is ALREADY the
 * allocation-weighted recognized commission, so it is summed directly rather
 * than re-derived.
 */

import { money, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { commissionAchievementBatch } from './finance';
import { SALES_DIVISION } from './leads';
import { JENIS_BAYAR_KOMISI as RENEWAL_JENIS_BAYAR_KOMISI } from './renewal';

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
  /**
   * "Total Sales" pada permintaan pemilik 2026-09-10 — jumlah DEAL yang orang
   * ini ikut memilikinya, bilangan bulat dan TIDAK dibobot `basis_points`.
   * Deal yang dijual berdua dihitung satu untuk masing-masing: yang dibagi
   * adalah uangnya, bukan kejadiannya. Karena itu kolom ini TIDAK boleh
   * dijumlahkan ke bawah untuk mendapat total agensi — pakai
   * `SalesReportTotal.totalDeal` (COUNT DISTINCT kontrak).
   */
  totalDeal: number;
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

// ---------------------------------------------------------------------------
// Laporan Penjualan (permintaan pemilik 2026-09-10) — gerbangnya SENDIRI.
//
// Pemilik: *"Laporan penjualan all sales, total GMV, service list, bisa
// diakses Finance & Head Sales, bisa diekspor, di halaman /sales/kinerja"*.
//
// ── Kenapa gerbang terpisah, bukan `canViewSalesPerf` yang dilebarkan ──────
//
// Karena Finance sengaja TIDAK diberi corong prospek. Migrasi
// `20261001010000` memberi Finance tiga tabel UANG (`contracts`,
// `client_sales_allocations`, `services`) dan berhenti di situ — bukan
// `leads`, bukan `prospect_attempts`, bukan alasan NQ. Itu keputusan yang
// dijaga tes (`salesperf-scope.rls.test.ts`, "Finance TIDAK diberi corong
// prospek").
//
// Kalau `canViewSalesPerf` dilebarkan ke Finance, `bySalesperson` akan
// menjawab 200 untuk Finance dengan SETIAP kolom corong berisi 0 — bukan
// karena tidak ada aktivitas, melainkan karena RLS memotongnya. Itu bentuk
// kegagalan yang persis sama dengan bug Head Sales yang baru saja ditutup:
// angka nol yang terlihat sah. Jadi Finance mendapat permukaan yang memang
// bisa ia baca seluruhnya — uang + rekap layanan — dan `bySalesperson` tetap
// 403 untuknya, yang jujur.
// ---------------------------------------------------------------------------

/** Divisi Finance — cermin lengan `jwt_division() = 'Finance'` pada ketiga policy tabel uang. */
const FINANCE_DIVISION = 'Finance';

/** canViewSalesReport: Sales (level apa pun), Finance (level apa pun), plus lapisan baca-semua (OD/Director). */
export function canViewSalesReport(actor: Actor): boolean {
  return canViewSalesPerf(actor) || actor.role.division === FINANCE_DIVISION;
}

/**
 * reportScopeFor: sama seperti `scopeFor`, ditambah Finance = seluruh
 * agensi. Finance SEMUA LEVEL, bukan lead saja — cermin lengan Finance pada
 * `transactions_select`/`installments_select`, dan alasannya sama: pekerjaan
 * penagihan dikerjakan staf.
 *
 * Sales STAFF tetap `ownOnly`. Membuka laporan seluruh tim untuk seorang
 * sales staff bukan bagian dari permintaan pemilik ("Finance & Head Sales"),
 * dan RLS pun tidak akan mengizinkannya — barisnya akan nol dan layarnya
 * berbohong. Lebih baik ia melihat barisnya sendiri, dan itu benar.
 */
export function reportScopeFor(actor: Actor): SalesPerfScope | null {
  if (actor.role.division === FINANCE_DIVISION) {
    return { ownOnly: false };
  }
  return scopeFor(actor);
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

/**
 * loadRoster reads the Sales-division roster, joined against the Level Sales
 * label table.
 *
 * It reads `private.employee_roster()` — the HISTORICAL roster, active or not —
 * NOT `private.employee_assignable()`, and that distinction is load-bearing
 * rather than incidental. `employee_assignable()` filters `WHERE status_aktif`,
 * which is right for an assignment dropdown and wrong here: a salesperson who
 * resigns (or is deactivated in HRIS) would drop out of this roster, and with
 * them every closing they ever made. `resolveSalespersonIds` scopes on exactly
 * these ids, so last month's omzet and commission would quietly shrink because
 * of an HR decision taken today. See migration 20260929010000.
 *
 * Both functions are SECURITY DEFINER on purpose: `employees_select` carries no
 * lead/division arm (the O48 narrowness in PERMISSIONS.md), so reading
 * `employees` through RLS would hand a Sales Head an almost-empty roster and
 * silently under-report their own division.
 */
async function loadRoster(sql: Queryable): Promise<RosterEntry[]> {
  const [emps, labels] = await Promise.all([
    sql<{ employee_id: string; nama: string; jabatan: string }[]>`
      select employee_id, nama, jabatan from private.employee_roster() where division = ${SALES_DIVISION}`,
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
  // L5 (Revisi Sales/Creative/Performa) — an attempt can now age straight
  // New Lead -> [Unrespon] (L1), never passing through a 'transition:...
  // ->Contacted' row at all. Without this, firstPerAttemptStage() would
  // never register a 'contacted' event for that attempt, yet a later
  // [Unrespon] -> Not Qualified (auto, L3) DOES register 'nonQualified' —
  // the funnel could then show nonQualified exceeding contacted, which
  // reads as a bug even though the underlying counts are correct.
  // [Unrespon] itself is "attempt was engaged with, not yet Qualified" —
  // the same semantic bucket as Contacted.
  if (status === '[Unrespon]') return 'contacted';
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
  /**
   * Jumlah DEAL (baris `contracts`) yang orang ini ikut memilikinya —
   * bilangan bulat, TIDAK dibobot `basis_points`. Satu deal yang dijual
   * berdua adalah satu deal bagi masing-masing orang; yang dibagi 60/40
   * adalah uangnya, bukan kejadiannya. Karena itu menjumlahkan kolom ini
   * ke bawah TIDAK menghasilkan jumlah deal agensi — lihat
   * `SalesReportTotal.totalDeal`, yang memakai COUNT(DISTINCT contract).
   */
  totalDeal: number;
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
    klienBaruFrac: 0, klienPerpanjanganFrac: 0, klienCrossSellFrac: 0, totalDeal: 0,
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

  // --- deal (bauran + jumlah) DAN uang, keduanya per TRANSAKSI. Lihat loadDealFacts. ---
  const facts = await loadDealFacts(sql, ids);

  for (const d of facts.deals) {
    if (!inPeriod(filter.period, d.at)) continue;
    for (const alloc of d.allocs) {
      if (!ids.includes(alloc.salespersonId)) continue;
      const a = get(alloc.salespersonId, d.at);
      const frac = alloc.basisPoints / 10000;
      if (d.jenis === 'baru') a.klienBaruFrac += frac;
      else if (d.jenis === 'perpanjangan') a.klienPerpanjanganFrac += frac;
      else if (d.jenis === 'cross_sell') a.klienCrossSellFrac += frac;
      a.totalDeal += 1;
      a.omzet += money.proRata(d.totalAgreedValue, BigInt(alloc.basisPoints), 10000n);
      a.komisiKontrak += money.proRata(d.totalDealCommission, BigInt(alloc.basisPoints), 10000n);
      a.komisiDiakui += d.recognized.get(alloc.salespersonId) ?? 0n;
    }
  }

  return acc;
}

// ---------------------------------------------------------------------------
// loadDealFacts — SATU sumber untuk "deal apa yang dimiliki orang-orang ini"
// dan "uang berapa yang menempel padanya". Dipakai `gather` (View 1/2) DAN
// `salesReport` (laporan penjualan Finance & Head Sales), justru supaya kedua
// layar tidak bisa menyebut angka omzet yang berbeda untuk periode yang sama.
//
// ── Bug uang yang penyatuan ini tutup (dibuktikan dengan probe, 2026-09-10) ──
//
// Sampai hari ini `gather` membaca satu baris gabungan `clients ⋈ contracts`
// dan menambahkan uang klien itu SEKALI PER BARIS. Untuk klien yang pernah
// diperpanjang, barisnya ADA DUA (kontrak `baru` + kontrak `perpanjangan`) —
// tapi `clients.transaction_id` hanya ditulis sekali, oleh `sales.close()`
// (`sales.ts:1913`); `renewal.eksekusi` sengaja tidak menyentuhnya. Jadi kedua
// baris membawa transaksi YANG SAMA, dan `omzet` klien itu tercatat DUA KALI.
//
// Dibuktikan, bukan dibaca dari kode: satu klien Rp 10.000.000 dengan satu
// kontrak menghasilkan `omzet 10.000.000,00`; menambah satu kontrak
// `perpanjangan` untuk klien yang sama — tanpa menyentuh uangnya sama sekali —
// menaikkannya jadi `20.000.000,00`. Tanpa galat, tanpa baris ganda di layar:
// hanya satu angka yang dua kali lipat terlalu besar.
//
// Ia bertahan karena hampir setiap fixture (dan hampir setiap klien muda)
// hanya punya SATU kontrak, dan karena filter satu-bulan memisahkan kedua
// kontrak ke bucket berbeda sehingga tiap bulan terlihat benar — yang menggelembung
// hanya tampilan default halaman ini, yang justru TANPA filter periode.
//
// Perbaikannya memisahkan dua fakta yang memang berbeda pemiliknya:
//
//   * `contracts` — bauran jenis deal (baru/perpanjangan/cross-sell) dan
//     jumlah deal. Ini memang MILIK kontrak: perpanjangan adalah deal kedua,
//     dan menghitungnya dua kali di sini benar.
//   * `money`     — omzet & komisi. Ini milik TRANSAKSI, dan sebuah klien
//     hanya punya satu `clients.transaction_id`. Karena itu ia dikumpulkan
//     per KLIEN dan di-bucket ke `transactions.created_at`.
//
// Bucket-nya berpindah dari `contracts.created_at` ke `transactions.created_at`
// dan itu bukan pergeseran semantik: `sales.close()` melahirkan kontrak dan
// transaksi dalam SATU transaksi DB, jadi untuk kasus satu-kontrak (yakni
// setiap kasus yang selama ini benar) kedua stempel waktu itu identik.
//
// ── 2026-09-11, ketokan kedua: SATU DEAL = SATU TRANSAKSI (PR3-RNW-TRX) ──
//
// Perbaikan di atas menghentikan penggelembungan, tapi meninggalkan dua lubang
// yang arahnya berlawanan — laporan KURANG melaporkan penjualan, dan diam:
//
//   1. Transaksi milik perpanjangan tak terhitung di mana pun, karena
//      `clients.transaction_id` hanya menyimpan closing PERTAMA.
//   2. Uang klien hanya dihitung kalau kliennya kebetulan punya baris
//      `contracts` — pagar `exists (contracts)` yang diwarisi dari join lama,
//      bukan yang pernah dipilih siapa pun. Sebuah closing yang semua barisnya
//      one-off tidak melahirkan kontrak sama sekali, dan uangnya hilang.
//
// Diukur di `CDPS SG` sebelum diperbaiki: terlapor Rp 151.075.000 dari
// penjualan sebenarnya Rp 516.307.615 — 16 dari 25 klien tidak punya kontrak
// (Rp 359.232.615) dan perpanjangan pertama sudah dieksekusi 2026-08-31
// (Rp 6.000.000). Pemilik mengetok "hitung semua transaksi penjualan".
//
// Karena itu unitnya sekarang TRANSAKSI, bukan klien dan bukan kontrak:
//
//   * satu baris per transaksi, di-bucket ke `transactions.created_at`;
//   * `jenis` (baru / perpanjangan / cross_sell) dibaca dari
//     `renewal_requests.jenis` kalau transaksinya lahir dari perpanjangan, dari
//     `contracts.jenis` kalau ada kontraknya, dan `baru` selain itu — sebuah
//     transaksi closing SELALU deal pertama kliennya;
//   * `bayar_komisi` DIKECUALIKAN. Ia tagihan atas penjualan yang sudah
//     terjadi, bukan penjualan baru (FS-4), dan ia dikenali lewat
//     `renewal_requests.jenis` — bukan lewat ada-tidaknya kontrak, supaya
//     "tidak punya kontrak" berhenti jadi alasan uang menghilang;
//   * bauran deal dan uang keluar dari SATU daftar, jadi keduanya tidak bisa
//     lagi menyebut periode atau himpunan yang berbeda.
//
// Komisi tidak ikut berlipat karena `finance.dealServices` memetakan setiap
// Service ke tepat satu transaksi — lihat komentarnya di `finance.ts`.
// ---------------------------------------------------------------------------

interface AllocShare {
  salespersonId: string;
  basisPoints: number;
}

/** Satu deal = satu transaksi penjualan. Uang dan bauran deal keluar dari baris yang SAMA. */
interface DealFact {
  /** `transactions.id` — identitas deal-nya, dan yang dihitung DISTINCT pada baris TOTAL. */
  transactionId: string;
  clientId: string;
  /** Kontraknya kalau ada; `null` untuk closing yang semua barisnya one-off (sah, dan tetap penjualan). */
  contractId: string | null;
  /** 'baru' | 'perpanjangan' | 'cross_sell'. */
  jenis: string;
  /** `transactions.created_at` — momen uangnya lahir. */
  at: Date;
  totalAgreedValue: money.Money;
  totalDealCommission: money.Money;
  /** Komisi diakui per salesperson — sudah dibobot alokasi oleh `commissionAchievementBatch`. */
  recognized: ReadonlyMap<string, money.Money>;
  allocs: readonly AllocShare[];
}

interface DealFacts {
  deals: DealFact[];
}

async function loadDealFacts(sql: Queryable, ids: readonly string[]): Promise<DealFacts> {
  if (ids.length === 0) return { deals: [] };

  // Satu baris per TRANSAKSI penjualan milik klien yang orang-orang ini punya
  // alokasinya. `left join` ke `renewal_requests` dan `contracts` keduanya
  // paling banyak satu baris: `renewal_requests` menulis `transaction_id`-nya
  // sekali saat eksekusi, dan `uq_contracts_transaction` (migrasi
  // 20261005010000) melarang satu transaksi dipakai dua kontrak. Jadi join ini
  // tidak bisa mekar — kelas bug yang PR-5 tabrak di sisi Qualified.
  const dealRows = await sql<{
    transaction_id: string; client_id: string; contract_id: string | null; jenis: string; at: Date;
  }[]>`
    select t.id as transaction_id, t.client_id, ctr.id as contract_id,
           coalesce(rr.jenis, ctr.jenis, 'baru') as jenis, t.created_at as at
      from transactions t
      left join renewal_requests rr on rr.transaction_id = t.id
      left join contracts ctr on ctr.transaction_id = t.id
     where exists (select 1 from client_sales_allocations a
                    where a.client_id = t.client_id and a.salesperson_id = any(${[...ids]}))
       and (rr.jenis is null or rr.jenis <> ${RENEWAL_JENIS_BAYAR_KOMISI})`;

  const clientIds = [...new Set(dealRows.map((d) => d.client_id))];
  const allocRows = clientIds.length === 0 ? [] : await sql<{ client_id: string; salesperson_id: string; basis_points: number }[]>`
    select client_id, salesperson_id, basis_points from client_sales_allocations where client_id = any(${clientIds})`;
  const allocByClient = new Map<string, AllocShare[]>();
  for (const a of allocRows) {
    const list = allocByClient.get(a.client_id) ?? [];
    list.push({ salespersonId: a.salesperson_id, basisPoints: a.basis_points });
    allocByClient.set(a.client_id, list);
  }

  // P2 §7 — one batch of queries instead of one round per transaction.
  const achByTxn = await commissionAchievementBatch(sql, dealRows.map((d) => d.transaction_id));

  return {
    deals: dealRows.map((d) => {
      const ach = achByTxn.get(d.transaction_id);
      return {
        transactionId: d.transaction_id,
        clientId: d.client_id,
        contractId: d.contract_id,
        jenis: d.jenis,
        at: d.at,
        // `ach` tidak pernah hilang — idnya berasal dari `transactions` itu
        // sendiri. Nol eksplisit, bukan baris yang dibuang: sebuah deal yang
        // menghilang dari bauran karena komisinya tidak terbaca adalah bug yang
        // jauh lebih sulit dilihat daripada satu kolom uang bernilai nol.
        totalAgreedValue: ach === undefined ? 0n : money.parse(ach.totalAgreedValue),
        totalDealCommission: ach === undefined ? 0n : money.parse(ach.totalDealCommission),
        recognized: new Map((ach?.shares ?? []).map((sh) => [sh.salespersonId, money.parse(sh.recognizedCommission)])),
        allocs: allocByClient.get(d.client_id) ?? [],
      };
    }),
  };
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
    totalDeal: a.totalDeal,
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
// Laporan Penjualan — permintaan pemilik 2026-09-10, Bagian 3.
//
// *"Laporan penjualan all sales, total GMV, service list, bisa diakses Finance
// & Head Sales, bisa diekspor, di halaman /sales/kinerja. Plus kolom total
// sales."*
//
// Ketokan pemilik atas "total sales"/"total GMV" (`AskUserQuestion`,
// 2026-09-10, dicatat di `DECISIONS.md`): **baris TOTAL di kaki tabel** plus
// **kolom jumlah deal per orang**. Dua hal berbeda, dan keduanya di sini.
//
// ── Kenapa BUKAN sekadar menjumlahkan kolom ───────────────────────────────
//
// Sebuah deal yang dijual berdua tercatat pada DUA baris alokasi. Kolom
// `totalDeal` per orang benar bernilai 1 untuk masing-masing — keduanya
// memang mengerjakan deal itu. Tapi menjumlahkan kolom itu ke bawah
// menghasilkan 2 untuk satu deal. Karena itu `SalesReportTotal.totalDeal`
// adalah COUNT(DISTINCT contract), dihitung dari himpunan kontrak, bukan dari
// kolom di atasnya. Hal yang sama berlaku untuk `klienCount`.
//
// Nilai UANG aman dijumlahkan: ia sudah di-pro-rata `basis_points` yang
// Σ-nya 10000 per klien, jadi penjumlahan ke bawah merekonstruksi utuh.
//
// ── Kenapa rekap layanan tidak dibobot alokasi ────────────────────────────
//
// Pertanyaannya "layanan mana yang terjual", bukan "berapa bagian layanan
// ini milik siapa". Membobotnya menghasilkan "2,4 unit Store Management"
// yang tidak menjawab pertanyaan siapa pun. Jadi rekapnya utuh per layanan,
// dibatasi ke klien yang berada dalam cakupan aktor.
//
// `nilai` = Σ `services.standard_price`, dan itu SUDAH subtotal baris
// (penggandanya dibuang saat closing — lihat migrasi `20260925040000`, kepala
// berkas). Mengalikannya dengan `qty` akan menghitung ganda. `qty` sendiri
// nullable dan artinya "tidak pernah dicatat", BUKAN 1, jadi ia sengaja tidak
// muncul sebagai kolom di sini: tidak ada angka jujur yang bisa ditulis di
// kolom itu untuk baris lama.
// ---------------------------------------------------------------------------

/** Status Service yang dibatalkan — dikecualikan dari rekap, cermin `commissionAchievementBatch`. */
const SERVICE_STATUS_VOIDED = '[Cancelled — Service Voided]';

export interface SalesReportRow {
  salespersonId: string;
  nama: string;
  levelSales: string;
  /** Jumlah deal yang orang ini ikut memilikinya. Bilangan bulat, tidak dibobot — JANGAN dijumlahkan ke bawah. */
  totalDeal: number;
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
}

export interface SalesReportTotal {
  /** Berapa orang yang barisnya ikut tertotal (termasuk yang nol — roster, bukan yang berprestasi saja). */
  salespersonCount: number;
  /** COUNT(DISTINCT contract) — BUKAN Σ kolom `totalDeal`: satu deal berdua tetap satu deal. */
  totalDeal: number;
  /** COUNT(DISTINCT client), dengan alasan yang sama. */
  klienCount: number;
  /** Total GMV — Σ omzet per orang, aman karena sudah pro-rata Σ basis_points = 10000. */
  omzet: string;
  omzetIdr: string;
  komisiKontrak: string;
  komisiKontrakIdr: string;
  komisiDiakui: string;
  komisiDiakuiIdr: string;
}

export interface SalesReportServiceRow {
  masterServiceId: string;
  /** Nama snapshot pada baris Service TERBARU untuk layanan ini — katalog boleh berganti nama, riwayat tidak ikut berubah. */
  nama: string;
  /** Berapa baris Service terjual (setelah membuang yang dibatalkan). */
  jumlah: number;
  /** Σ `standard_price` — sudah subtotal baris, jangan dikali `qty`. */
  nilai: string;
  nilaiIdr: string;
}

export interface SalesReport {
  rows: SalesReportRow[];
  total: SalesReportTotal;
  services: SalesReportServiceRow[];
}

/**
 * salesReport: Laporan Penjualan untuk Finance & Head Sales — uang + bauran
 * deal per orang, satu baris TOTAL, dan rekap layanan terjual.
 *
 * Sengaja TANPA kolom corong (leads/contacted/qualified/NQ): Finance tidak
 * punya lengan RLS ke `leads`/`prospect_attempts`, jadi kolom-kolom itu akan
 * berisi nol yang terlihat sah. Lihat kepala `canViewSalesReport`.
 *
 * Angkanya datang dari `loadDealFacts` — engine yang SAMA dengan yang dipakai
 * View 1/2, justru supaya "Omzet" di tab Per Sales dan "Omzet" di laporan ini
 * tidak pernah bisa berbeda untuk periode yang sama.
 */
export async function salesReport(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<SalesReport> {
  const scope = reportScopeFor(actor);
  if (scope === null) throw new ForbiddenError();
  const rosterList = await loadRoster(sql);
  const rosterIds = rosterList.map((r) => r.employeeId);
  const ids = resolveSalespersonIds(scope, actor, f, rosterIds);
  const rosterMap = new Map(rosterList.map((r) => [r.employeeId, r]));

  const facts = await loadDealFacts(sql, ids);
  const idSet = new Set(ids);

  interface Bucket {
    totalDeal: number;
    baru: number; perpanjangan: number; crossSell: number;
    omzet: money.Money; komisiKontrak: money.Money; komisiDiakui: money.Money;
  }
  const per = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    let b = per.get(id);
    if (b === undefined) {
      b = { totalDeal: 0, baru: 0, perpanjangan: 0, crossSell: 0, omzet: 0n, komisiKontrak: 0n, komisiDiakui: 0n };
      per.set(id, b);
    }
    return b;
  };

  // Himpunan (bukan penjumlahan) — inilah yang membuat baris TOTAL benar
  // untuk deal yang dijual berdua. Unitnya transaksi: satu klien yang closing
  // lalu diperpanjang adalah DUA deal, dan tetap SATU klien.
  const distinctDeals = new Set<string>();
  const distinctClients = new Set<string>();

  let totalOmzet = 0n;
  let totalKomisiKontrak = 0n;
  let totalKomisiDiakui = 0n;
  for (const d of facts.deals) {
    if (!inPeriod(f.period, d.at)) continue;
    let counted = false;
    for (const alloc of d.allocs) {
      if (!idSet.has(alloc.salespersonId)) continue;
      const b = bucket(alloc.salespersonId);
      const frac = alloc.basisPoints / 10000;
      if (d.jenis === 'baru') b.baru += frac;
      else if (d.jenis === 'perpanjangan') b.perpanjangan += frac;
      else if (d.jenis === 'cross_sell') b.crossSell += frac;
      b.totalDeal += 1;
      const omzet = money.proRata(d.totalAgreedValue, BigInt(alloc.basisPoints), 10000n);
      const komisiKontrak = money.proRata(d.totalDealCommission, BigInt(alloc.basisPoints), 10000n);
      const komisiDiakui = d.recognized.get(alloc.salespersonId) ?? 0n;
      b.omzet += omzet;
      b.komisiKontrak += komisiKontrak;
      b.komisiDiakui += komisiDiakui;
      totalOmzet += omzet;
      totalKomisiKontrak += komisiKontrak;
      totalKomisiDiakui += komisiDiakui;
      counted = true;
    }
    if (counted) {
      distinctDeals.add(d.transactionId);
      distinctClients.add(d.clientId);
    }
  }

  const rows: SalesReportRow[] = ids.map((id) => {
    const b = per.get(id) ?? { totalDeal: 0, baru: 0, perpanjangan: 0, crossSell: 0, omzet: 0n, komisiKontrak: 0n, komisiDiakui: 0n };
    const r = rosterMap.get(id);
    return {
      salespersonId: id,
      nama: r?.nama ?? id,
      levelSales: r?.levelSales ?? EM_DASH,
      totalDeal: b.totalDeal,
      klienBaru: fmtFrac(b.baru),
      klienPerpanjangan: fmtFrac(b.perpanjangan),
      klienCrossSell: fmtFrac(b.crossSell),
      klienCount: fmtFrac(b.baru + b.perpanjangan + b.crossSell),
      omzet: money.decimal(b.omzet),
      omzetIdr: money.format(b.omzet),
      komisiKontrak: money.decimal(b.komisiKontrak),
      komisiKontrakIdr: money.format(b.komisiKontrak),
      komisiDiakui: money.decimal(b.komisiDiakui),
      komisiDiakuiIdr: money.format(b.komisiDiakui),
    };
  }).sort((a, b) => money.parse(b.omzet) > money.parse(a.omzet) ? 1 : money.parse(b.omzet) < money.parse(a.omzet) ? -1 : a.nama.localeCompare(b.nama));

  const services = await serviceRecap(sql, [...distinctClients]);

  return {
    rows,
    total: {
      salespersonCount: rows.length,
      totalDeal: distinctDeals.size,
      klienCount: distinctClients.size,
      omzet: money.decimal(totalOmzet),
      omzetIdr: money.format(totalOmzet),
      komisiKontrak: money.decimal(totalKomisiKontrak),
      komisiKontrakIdr: money.format(totalKomisiKontrak),
      komisiDiakui: money.decimal(totalKomisiDiakui),
      komisiDiakuiIdr: money.format(totalKomisiDiakui),
    },
    services,
  };
}

/**
 * serviceRecap: layanan apa yang terjual pada klien-klien ini, dikelompokkan
 * per `master_service_id`.
 *
 * Dikelompokkan per ID katalog, bukan per `services.name`: nama adalah
 * snapshot saat penjualan, jadi mengelompokkan per nama akan memecah satu
 * layanan menjadi dua baris begitu katalognya di-rename. Nama yang
 * DITAMPILKAN diambil dari baris Service terbaru — riwayat tetap terbaca
 * dengan istilah yang dikenal pembacanya hari ini.
 *
 * Baris `[Cancelled — Service Voided]` dibuang, cermin
 * `commissionAchievementBatch`: layanan yang dibatalkan tidak menghasilkan
 * komisi, jadi ia juga bukan penjualan.
 */
async function serviceRecap(sql: Queryable, clientIds: readonly string[]): Promise<SalesReportServiceRow[]> {
  if (clientIds.length === 0) return [];
  const rows = await sql<{ master_service_id: string; nama: string; jumlah: number; nilai: string }[]>`
    select s.master_service_id,
           (array_agg(s.name order by s.created_at desc, s.id desc))[1] as nama,
           count(*)::int as jumlah,
           coalesce(sum(s.standard_price), 0)::text as nilai
      from services s
     where s.client_id = any(${[...clientIds]})
       and s.status <> ${SERVICE_STATUS_VOIDED}
     group by s.master_service_id
     order by sum(s.standard_price) desc, s.master_service_id`;
  return rows.map((r) => ({
    masterServiceId: r.master_service_id,
    nama: r.nama,
    jumlah: r.jumlah,
    nilai: money.decimal(money.parse(r.nilai)),
    nilaiIdr: money.format(money.parse(r.nilai)),
  }));
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


/** Whether metricKey's raw value is Rupiah — the only case an `_idr` sibling field is meaningful. */
function metricIsMoney(k: MetricKey): boolean {
  return k === 'omzet';
}

type TargetSourceRow = {
  salesperson_id: string; period_start: string | Date; period_kind: PeriodKind; metric_key: MetricKey;
  metric_param: string | null; target_value: string; updated_at: Date; updated_by: string;
};

function normalizeDate(d: string | Date): string {
  return typeof d === 'string' ? d : d.toISOString().slice(0, 10);
}

/** One `sales_targets` row's identity within a batch, for the actuals-lookup Map (P2 §7). */
function targetRowKey(salespersonId: string, metricKey: MetricKey): string {
  return `${salespersonId}::${metricKey}`;
}

/**
 * computeMetricActualsBatch derives the CURRENT value of every OKR metric row
 * `listTargets` is about to render, in one pass (P2 §7, the perf diagnosis's
 * other named N+1 — this replaced the old one-row-at-a-time
 * `computeMetricActual`): one `gather` call per distinct (period, periodKind)
 * bucket instead of one per row for 'omzet'/'closing_ratio_qualified_pct', one
 * batched `loadStageEventsByOwner` + one batched scouting-source lookup
 * instead of two queries per row for 'scouting_closing_count'.
 * 'klien_count_min_kontrak' stays one query per row — its threshold
 * (`metric_param`) can differ row to row, so there is no shared `= any($ids)`
 * shape to batch into. Same math, same rounding, same null-on-division-by-zero
 * (house rule #7) as before — covered by `listTargets`'s own existing
 * per-metric assertions in `salesperf.test.ts` (all four `metricKey`s, exact
 * expected values), which this refactor left behaviorally unchanged.
 */
async function computeMetricActualsBatch(sql: Queryable, rows: readonly TargetSourceRow[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (rows.length === 0) return result;

  // omzet / closing_ratio_qualified_pct — batch by (periodStart, periodKind).
  const gatherRows = rows.filter((r) => r.metric_key === 'omzet' || r.metric_key === 'closing_ratio_qualified_pct');
  const byRange = new Map<string, { range: PeriodFilter; ids: Set<string>; rows: TargetSourceRow[] }>();
  for (const r of gatherRows) {
    const periodStart = normalizeDate(r.period_start);
    const key = `${periodStart}::${r.period_kind}`;
    let bucket = byRange.get(key);
    if (bucket === undefined) {
      bucket = { range: periodRangeFor(periodStart, r.period_kind), ids: new Set(), rows: [] };
      byRange.set(key, bucket);
    }
    bucket.ids.add(r.salesperson_id);
    bucket.rows.push(r);
  }
  for (const bucket of byRange.values()) {
    const acc = await gather(sql, [...bucket.ids], { period: bucket.range, salespersonId: null, source: null, campaignId: null }, false);
    for (const r of bucket.rows) {
      const a = acc.get(r.salesperson_id) ?? emptyAcc();
      const val = r.metric_key === 'omzet'
        ? money.decimal(a.omzet)
        : (a.qualified === 0 ? null : roundPct(a.closedSuccess, a.qualified).toFixed(2));
      result.set(targetRowKey(r.salesperson_id, r.metric_key), val);
    }
  }

  // scouting_closing_count — one batched stage-event load + one batched
  // scouting-source lookup across every row's closed-in-period attempts.
  const scoutRows = rows.filter((r) => r.metric_key === 'scouting_closing_count');
  if (scoutRows.length > 0) {
    const scoutIds = [...new Set(scoutRows.map((r) => r.salesperson_id))];
    const events = await loadStageEventsByOwner(sql, scoutIds);
    const closedByOwner = new Map<string, { attemptId: string; at: Date }[]>();
    for (const e of events) {
      if (e.stage !== 'closedSuccess') continue;
      const list = closedByOwner.get(e.ownerOrLead) ?? [];
      list.push({ attemptId: e.attemptId, at: e.at });
      closedByOwner.set(e.ownerOrLead, list);
    }
    const closedInPeriodByRow = new Map<TargetSourceRow, string[]>();
    const allAttemptIds = new Set<string>();
    for (const r of scoutRows) {
      const range = periodRangeFor(normalizeDate(r.period_start), r.period_kind);
      const ids = (closedByOwner.get(r.salesperson_id) ?? [])
        .filter((c) => inPeriod(range, c.at))
        .map((c) => c.attemptId);
      closedInPeriodByRow.set(r, ids);
      ids.forEach((id) => allAttemptIds.add(id));
    }
    const scoutingAttemptIds = allAttemptIds.size === 0 ? new Set<string>() : new Set(
      (await sql<{ id: string }[]>`
        select pa.id from prospect_attempts pa join leads l on l.id = pa.lead_id
         where pa.id = any(${[...allAttemptIds]}) and l.source = 'Scouting'`
      ).map((r) => r.id),
    );
    for (const r of scoutRows) {
      const ids = closedInPeriodByRow.get(r) ?? [];
      const n = ids.filter((id) => scoutingAttemptIds.has(id)).length;
      result.set(targetRowKey(r.salesperson_id, r.metric_key), String(n));
    }
  }

  // klien_count_min_kontrak — distinct threshold per row, kept per-row.
  for (const r of rows) {
    if (r.metric_key !== 'klien_count_min_kontrak') continue;
    const range = periodRangeFor(normalizeDate(r.period_start), r.period_kind);
    const threshold = money.decimal(money.parse(r.metric_param ?? '0'));
    const cnt = await sql<{ n: string }[]>`
      select count(distinct cl.id) as n
        from clients cl
        join contracts c on c.client_id = cl.id
        join transactions t on t.id = cl.transaction_id
        join client_sales_allocations a on a.client_id = cl.id
       where a.salesperson_id = ${r.salesperson_id}
         and a.basis_points > 0
         and t.total_agreed_value >= ${threshold}::numeric
         and wib_period(c.created_at) between ${range.from} and ${range.to}`;
    result.set(targetRowKey(r.salesperson_id, r.metric_key), cnt[0].n);
  }

  return result;
}

function toTargetRow(r: TargetSourceRow, actual: string | null): TargetRow {
  const periodStart = normalizeDate(r.period_start);
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
  const rows = await sql<TargetSourceRow[]>`
    select salesperson_id, period_start, period_kind, metric_key, metric_param, target_value, updated_at, updated_by
      from sales_targets where period_start = ${periodStart}::date
      order by salesperson_id, metric_key`;
  const filtered = scope.ownOnly ? rows.filter((r) => r.salesperson_id === actor.employeeId) : rows;
  const actuals = await computeMetricActualsBatch(sql, filtered);
  return filtered.map((r) => toTargetRow(r, actuals.get(targetRowKey(r.salesperson_id, r.metric_key)) ?? null));
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
