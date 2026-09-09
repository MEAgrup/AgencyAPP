/**
 * Sales domain service — M0 Qualified stage (Contacted → Qualified), ported to
 * the Supabase stack from Go's `internal/module0_sales` (sales/pricing/commission
 * /qualified.go) + the `internal/admin` MSL read.
 *
 * This slice covers the acquisition path from a Contacted attempt up to (and
 * including) a submitted Qualified Lead Form:
 *   - markContacted:       New Lead → Contacted (a real action was logged).
 *   - previewQuote:        read-only Estimasi Nilai + Komisi for a selection.
 *   - submitQualifiedForm: persist the client draft + service lines (MSL version
 *                          pinned), Contacted → Qualified — one transaction, so
 *                          the status never advances before a successful submit.
 *   - setNotQualified:     Contacted → Not Qualified with the closed NQ taxonomy.
 *
 * House rules honored here (CLAUDE.md §Non-negotiable):
 *   - Estimasi Nilai Transaksi + Perhitungan Komisi are AUTO-computed, read-only,
 *     and recomputable from the pinned MSL version + selection (§4 auto-calc).
 *     All rupiah math is exact via @cdps/core money (bigint minor units).
 *   - IDs are not minted here (attempts already exist); status is written ONLY
 *     through sm_transition; every write appends to the audit log.
 *   - Exact BI `[...]` messages: the 1..MAX_SERVICES cap message and the house default.
 *
 * Deferred to later slices (kept out per build order): Negotiation + Closing
 * (module0_sales negotiation/closing/allocation.go) and the MSL admin CRUD
 * (internal/admin write path) — only the MSL READ needed for pricing is ported.
 *
 * Reference: archive/backend-go/internal/module0_sales/{sales,pricing,commission,qualified}.go,
 * archive/backend-go/internal/admin/master_service.go (EffectiveAt / ServiceView).
 */

import { bi, money, notification, page, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { effectiveAt, type DurasiOption, type ServiceView } from './msl';
import { resolveWin } from './leads';
import { allowedTransitions } from './engine';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** prospect_attempt machine (seeded in 20260723055732_statemachine.sql). */
export const ATTEMPT_MACHINE = 'prospect_attempt';

/** The CDPS division that owns prospect attempts (M0 §9.1). */
export const SALES_DIVISION = 'Sales';

/** Prospect-attempt statuses (verbatim; the machine governs the legal moves). */
export const STATUS_NEW_LEAD = 'New Lead';
export const STATUS_CONTACTED = 'Contacted';
export const STATUS_QUALIFIED = 'Qualified';
export const STATUS_NOT_QUALIFIED = 'Not Qualified';
export const STATUS_NEG_PENDING = 'Negotiation - Pending Approval';
export const STATUS_NEG_AUTO_APPROVE = 'Negotiation - Auto Approved';
export const STATUS_NEG_APPROVED = 'Negotiation - Approved';
export const STATUS_NEG_REVISION = 'Negotiation - Revision Required';
export const STATUS_NEG_REJECTED = 'Negotiation - Rejected';
export const STATUS_CLOSED_SUCCESS = 'Closed-Success';
export const STATUS_CLOSED_LOST = 'Closed-Lost';
/** L1 (Revisi Sales/Creative/Performa) — auto-aged, non-terminal (STATE_MACHINES.md §1). */
export const STATUS_UNRESPON = '[Unrespon]';

/**
 * Qualified Lead Form service cap (M0 §4.3).
 *
 * Raised 5 → 10 by the owner on 2026-08-07 (QA revisi, `docs/DECISIONS.md`): real
 * bundles regularly exceed five lines, and a salesperson who hit the cap had no
 * legal way to quote the deal. The cap itself stays — it is what keeps the quote a
 * quote — and it is enforced in three places (buildQuote, submitQualifiedForm,
 * writeProposal), all reading THIS constant so they cannot drift apart.
 */
export const MAX_SERVICES = 10;

/** Exact BI message for the over-limit service selection (M0 §4.3). */
export const MSG_MAX_SERVICES = '[maksimal pilih 10 jasa saja!]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'SalesIncompleteError';
  }
}

/** More than MAX_SERVICES services selected (carries the verbatim BI message). */
export class TooManyServicesError extends Error {
  constructor() {
    super(MSG_MAX_SERVICES);
    this.name = 'SalesTooManyServicesError';
  }
}

/** Requested attempt/entity does not exist. */
export class NotFoundError extends Error {
  constructor(message = 'prospect attempt not found') {
    super(message);
    this.name = 'SalesNotFoundError';
  }
}

/** Actor lacks write authority over the attempt (BI role-denied message). */
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'SalesForbiddenError';
  }
}

/**
 * A No-Negotiation submission carried a custom term (it must use the negotiation
 * path). The PRD gives no BI prompt for this — an internal sentinel (stream A
 * W1-07/08); the API maps it to 400.
 */
export class CustomTermRequiresNegotiationError extends Error {
  constructor() {
    super('module0_sales: custom terms require the negotiation path');
    this.name = 'CustomTermRequiresNegotiationError';
  }
}

/** Sales allocation shares do not sum to exactly 100% (verbatim BI, → 400). */
export class AllocationTotalError extends Error {
  constructor() {
    super('[total alokasi sales harus 100%]');
    this.name = 'AllocationTotalError';
  }
}

/** More than 5 salespeople on a closing (verbatim BI, → 400). */
export class TooManySalespeopleError extends Error {
  constructor() {
    super('[maksimal 5 salesperson per closing!]');
    this.name = 'TooManySalespeopleError';
  }
}

/**
 * A-4 (K-2): the closing overrode the catalog-derived contract duration without
 * saying why. The override is the whole point of the field — an AM's number that
 * beats the catalog — so it is the reason that makes it auditable. Without one
 * there is nothing to compare next quarter's renewal against.
 */
export class OverrideReasonRequiredError extends Error {
  constructor() {
    super('[alasan wajib diisi jika durasi kerja sama diubah dari katalog]');
    this.name = 'OverrideReasonRequiredError';
  }
}

/** The attempt is not in an Approved/Auto-Approved state, so it cannot close (→ 409). */
export class NotClosableError extends Error {
  constructor() {
    super(bi.TRANSITION_NOT_ALLOWED);
    this.name = 'NotClosableError';
  }
}

// ===========================================================================
// MSL v2 "Kalkulator Service Jasa" — line-subtotal engine (pricing.go).
//
//   flat:          subtotal = qty × unit_price                         (qty ≥ 1)
//   min_floor:     subtotal = max(qty, min_qty) × unit_price
//   batch_ceiling: subtotal = ceil(qty / min_qty) × min_qty × unit_price
//   passthrough:   subtotal = input_amount (unit_price ignored)
//
// PPN is not here at all (ketokan D-4, 2026-09-08). EVERY price in the catalog
// is a NON-PPN figure — negotiated and standard alike, across the whole MSL —
// and tax is a per-INVOICE choice Sales makes with one button, not a property of
// a service. The same service can be billed with PPN to one client and without
// to another; only the invoice knows. So `computePPN` takes an `includePPN`
// that comes from that button, and the result lands in `transactions.total_ppn`
// beside a `total_agreed_value` that is always the base.
//
// Until 2026-09-08 the 11% was folded INTO the subtotal, and that one line had
// two consequences. The first was that accrual revenue read 11% high — PPN is
// money held for the state, not revenue. The second was worse and quieter:
// `buildQuote` computed commission from the PPN-inclusive figure, so a "10% of
// standard price" rule on Rp 10.000.000 paid Rp 1.110.000 instead of
// Rp 1.000.000 — commission on tax money. (No live deal actually lost money to
// it: every PPN row in live carries a `0%` rule. It was latent, not realized.)
// ===========================================================================

export const PRICING_FLAT = 'flat';
export const PRICING_MIN_FLOOR = 'min_floor';
export const PRICING_BATCH_CEILING = 'batch_ceiling';
export const PRICING_PASSTHROUGH = 'passthrough';

const PRICING_MODES = new Set<string>([
  PRICING_FLAT, PRICING_MIN_FLOOR, PRICING_BATCH_CEILING, PRICING_PASSTHROUGH,
]);

/** PPN rate: 11% of the base (money.percentOf numerator/scale). */
const PPN_NUMERATOR = 11n;
const PPN_SCALE = 0;

/** Resolved calculator inputs for one service line. */
export interface PriceParams {
  mode: string;
  unitPrice: money.Money;
  quantity: bigint;
  minQty: bigint;
  inputAmount: money.Money;
}

/**
 * computeSubtotal returns the line's BASE subtotal — before PPN — per the sheet
 * formulas. Business-rule violations (bad mode, qty < 1, missing min_qty,
 * non-positive passthrough amount) throw IncompleteError; an out-of-range
 * product surfaces from money.mul.
 *
 * There is no PPN input here at all, and that is the point (D-4): tax is decided
 * on the invoice, not on the line, so this function cannot even be handed the
 * flag that would let it fold 11% back in.
 */
export function computeSubtotal(p: PriceParams): money.Money {
  if (!PRICING_MODES.has(p.mode)) {
    throw new IncompleteError();
  }
  if (p.mode === PRICING_PASSTHROUGH) {
    if (p.inputAmount <= 0n) {
      throw new IncompleteError();
    }
    return p.inputAmount;
  }
  if (p.quantity < 1n) {
    throw new IncompleteError();
  }

  let effQty: bigint;
  switch (p.mode) {
    case PRICING_FLAT:
      effQty = p.quantity;
      break;
    case PRICING_MIN_FLOOR:
      if (p.minQty < 1n) {
        throw new IncompleteError();
      }
      effQty = p.quantity > p.minQty ? p.quantity : p.minQty;
      break;
    case PRICING_BATCH_CEILING: {
      if (p.minQty < 1n) {
        throw new IncompleteError();
      }
      const batches = (p.quantity + p.minQty - 1n) / p.minQty;
      effQty = batches * p.minQty;
      break;
    }
    default:
      throw new IncompleteError();
  }
  return money.mul(p.unitPrice, effQty);
}

/**
 * computePPN returns the PPN payable on an invoice's base total — 11%, half-up
 * to whole rupiah — or zero when Sales did not press "Include PPN".
 *
 * `includePPN` is the INVOICE's choice (`transactions.include_ppn`), never a
 * catalog flag. It is an ADDITION beside the base, never folded into it (D-4).
 * Exported because every writer of the money path needs the same one:
 * `renewal.ts` and the closing path both total invoices, and two copies of an
 * 11% would eventually disagree by a rounding rule.
 */
export function computePPN(base: money.Money, includePPN: boolean): money.Money {
  if (!includePPN || base <= 0n) {
    return 0n;
  }
  return money.percentOf(base, PPN_NUMERATOR, PPN_SCALE);
}

/**
 * parseWholeQty parses a DECIMAL string into a whole positive bigint, rejecting
 * fractional or non-positive values. Reuses money.parse for exact decimal reading
 * (minor units), then requires an exact multiple of 100 (no cents). Returns null
 * when invalid.
 */
export function parseWholeQty(s: string): bigint | null {
  let m: money.Money;
  try {
    m = money.parse(s);
  } catch {
    return null;
  }
  if (m <= 0n || m % 100n !== 0n) {
    return null;
  }
  return m / 100n;
}

// ===========================================================================
// Commission rule grammar (commission.go). The rule itself now lives in
// `commission_rule.ts` so the MSL admin (`msl.ts`) can gate it on WRITE without
// importing this module — see that file's header (DECISIONS O73). Re-exported
// here so every existing `sales.parseCommissionRule` / `sales.CommissionRule` /
// `sales.BadCommissionRuleError` call site (apps/api error mapping, the seed
// validator, finance, renewal) keeps working unchanged.
// ===========================================================================

import {
  computeCommission,
  parseCommissionRule,
  type CommissionRule,
} from './commission_rule';

export {
  BadCommissionRuleError,
  computeCommission,
  isCommissionRule,
  parseCommissionRule,
  RULE_ZERO_PCT,
  type CommissionRule,
} from './commission_rule';

// ---------------------------------------------------------------------------
// Service line + quote (commission.go BuildQuote).
// ---------------------------------------------------------------------------

/** One selected service resolved against the MSL version effective at a date. */
export interface ServiceLine {
  serviceId: string;
  versionNo: number;
  name: string;
  standardPrice: money.Money; // unit price
  unit: string;
  mode: string; // pricing_mode; "" == flat
  quantity: bigint; // 0 == 1
  minQty: bigint;
  inputAmount: money.Money; // passthrough only
  rule: CommissionRule;
  /**
   * FS-6b — the tenor the client CHOSE, in months, when the catalog offers
   * several (`ServiceView.durasiOptions`). `null` means "no tenor was chosen",
   * which is the only honest thing to record for the ~100% of the catalog that
   * has one tenor: the version's own `durasiBulan` already says it, and
   * duplicating it here would make a re-versioned catalog and a deliberately
   * chosen tenor indistinguishable later.
   *
   * When it IS set, `standardPrice` above is that option's PACKAGE price — not
   * the version's — which is the whole point: a 12-month package is cheaper
   * per month than three 3-month ones, and no linear `qty` multiplier can say
   * that (see migration 20260925040000's header).
   */
  durasiBulan: number | null;
}

function lineParams(l: ServiceLine): PriceParams {
  return {
    mode: l.mode === '' ? PRICING_FLAT : l.mode,
    unitPrice: l.standardPrice,
    quantity: l.quantity === 0n ? 1n : l.quantity,
    minQty: l.minQty,
    inputAmount: l.inputAmount,
  };
}

/** lineSubtotal is the line's BASE deal value from the calculator — before PPN. */
export function lineSubtotal(l: ServiceLine): money.Money {
  return computeSubtotal(lineParams(l));
}

/** The computed money view for one service line. */
export interface LineQuote {
  serviceId: string;
  name: string;
  quantity: number;
  unit: string;
  standardPriceIdr: string;
  komisiIdr: string;
  /**
   * ALWAYS non-PPN (D-4). There is no per-line tax figure by design: PPN is one
   * decision on the invoice, so it is totalled once at the bottom rather than
   * sprinkled across lines that would each round separately.
   */
  subtotalIdr: string;
}

/** Read-only money summary for a Qualified/Closing selection. */
export interface Quote {
  lines: LineQuote[];
  /**
   * Σ base, BEFORE PPN (D-4). This is what the accrual engine recognizes and
   * what commission is computed from — the money the company actually earns.
   */
  estimasiNilai: money.Money;
  /** PPN on the whole invoice — zero unless Sales pressed "Include PPN". Held for the state, never revenue. */
  totalPPN: money.Money;
  /** What the client is billed: `estimasiNilai + totalPPN`. */
  nilaiDitagih: money.Money;
  totalKomisi: money.Money;
  estimasiNilaiIdr: string;
  totalPPNIdr: string;
  nilaiDitagihIdr: string;
  totalKomisiIdr: string;
}

/**
 * buildQuote computes Estimasi Nilai Transaksi and Perhitungan Komisi for the
 * selected services, enforcing the 1..MAX_SERVICES rule server-side. Percentage
 * commission computes on each line's subtotal (deal value); flat rules are fixed.
 *
 * `includePPN` is the "Include PPN" button Sales presses (D-4). It changes only
 * what the client is BILLED (`nilaiDitagih`); `estimasiNilai` and every komisi
 * stay exactly the same either way, because tax is not revenue and not deal
 * value. Defaults to false — a quote that does not say it is taxed is not.
 */
export function buildQuote(lines: ServiceLine[], includePPN = false): Quote {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  if (lines.length > MAX_SERVICES) {
    throw new TooManyServicesError();
  }
  const q: Quote = {
    lines: [], estimasiNilai: 0n, totalPPN: 0n, nilaiDitagih: 0n, totalKomisi: 0n,
    estimasiNilaiIdr: '', totalPPNIdr: '', nilaiDitagihIdr: '', totalKomisiIdr: '',
  };
  for (const l of lines) {
    const p = lineParams(l);
    const subtotal = computeSubtotal(p);
    // Commission on the BASE, never on base+PPN (D-4). Tax collected for the
    // state is not deal value, and paying a percentage of it is money out the
    // door for nothing.
    const komisi = computeCommission(l.rule, subtotal);
    q.estimasiNilai += subtotal;
    q.totalKomisi += komisi;
    q.lines.push({
      serviceId: l.serviceId,
      name: l.name,
      quantity: Number(p.quantity),
      unit: l.unit,
      standardPriceIdr: money.format(l.standardPrice),
      komisiIdr: money.format(komisi),
      subtotalIdr: money.format(subtotal),
    });
  }
  // ONCE, on the invoice total — not per line. Taxing each line and summing can
  // land a rupiah away from taxing the sum (11% of 5.000.005 twice ≠ 11% of
  // 10.000.010 once), and the invoice is what the client pays, so the invoice is
  // what the rounding must be right for.
  q.totalPPN = computePPN(q.estimasiNilai, includePPN);
  q.nilaiDitagih = q.estimasiNilai + q.totalPPN;
  q.estimasiNilaiIdr = money.format(q.estimasiNilai);
  q.totalPPNIdr = money.format(q.totalPPN);
  q.nilaiDitagihIdr = money.format(q.nilaiDitagih);
  q.totalKomisiIdr = money.format(q.totalKomisi);
  return q;
}

// ===========================================================================
// Qualified Lead Form — service selection resolved against the MSL (msl.ts owns
// the read + ServiceView; this layer turns a version into a priced ServiceLine).
// ===========================================================================

/**
 * resolveTenor picks the duration option the caller asked for, and refuses
 * anything the catalog does not actually offer.
 *
 * Three answers, and each is a different fact:
 *   - caller asked for nothing (`undefined`/`null`)  ⇒ `null`, "use the version
 *     as it stands". Every pre-FS-6b caller lands here, unchanged.
 *   - caller asked for a tenor the version offers    ⇒ that option, whose
 *     `harga` becomes the line's unit price.
 *   - caller asked for a tenor it does NOT offer, or the version has no options
 *     at all                                          ⇒ `IncompleteError`.
 *
 * The refusal is the important one. A tenor silently falling back to the
 * version's price would sell a 12-month package at the 3-month price — a money
 * bug with no error anywhere, which is exactly the failure class the FS-6
 * invariant (`trg_msdo_terpendek`) was built to avoid, arriving through the
 * other door.
 */
function resolveTenor(v: ServiceView, durasiBulan?: number | null): DurasiOption | null {
  if (durasiBulan === undefined || durasiBulan === null) {
    return null;
  }
  if (!Number.isInteger(durasiBulan) || durasiBulan <= 0) {
    throw new IncompleteError();
  }
  const hit = v.durasiOptions.find((o) => o.durasiBulan === durasiBulan);
  if (hit === undefined) {
    throw new IncompleteError();
  }
  return hit;
}

/**
 * lineFromView resolves an MSL version + the sales-entered quantity / passthrough
 * amount into a ServiceLine (name, unit price, commission rule and calculator
 * params pinned from the version). Passthrough requires a parseable amount > 0;
 * min_floor / batch_ceiling require a whole positive min_qty.
 */
export function lineFromView(
  v: ServiceView,
  quantity: bigint,
  amount: string,
  durasiBulan?: number | null,
): ServiceLine {
  const tenor = resolveTenor(v, durasiBulan);
  const price = money.parse(tenor === null ? v.standardPrice : tenor.harga);
  const rule = parseCommissionRule(v.commissionRule);
  const mode = v.pricingMode === '' ? PRICING_FLAT : v.pricingMode;
  const line: ServiceLine = {
    serviceId: v.id, versionNo: v.versionNo, name: v.name, standardPrice: price,
    unit: v.unit, mode, quantity, minQty: 0n, inputAmount: 0n, rule,
    durasiBulan: tenor === null ? null : tenor.durasiBulan,
  };
  if (mode === PRICING_MIN_FLOOR || mode === PRICING_BATCH_CEILING) {
    const mq = parseWholeQty(v.minQty);
    if (mq === null) {
      throw new IncompleteError();
    }
    line.minQty = mq;
  } else if (mode === PRICING_PASSTHROUGH) {
    let amt: money.Money;
    try {
      amt = money.parse(amount);
    } catch {
      throw new IncompleteError();
    }
    if (amt <= 0n) {
      throw new IncompleteError();
    }
    line.inputAmount = amt;
  }
  return line;
}

/** One service chosen on the Qualified Form (by master id). */
export interface ServiceSelection {
  masterServiceId: string;
  /** feeds the calculator (omitted / 0 defaults to 1). */
  quantity?: number;
  /** passthrough rupiah value (passthrough mode only). */
  amount?: string;
  /**
   * FS-6b — which tenor of this service, in months, when the catalog offers
   * several. Omit for a single-tenor service; supplying a tenor the version
   * does not offer is refused (`resolveTenor`), never quietly ignored.
   */
  durasiBulan?: number | null;
}

/** resolveLines resolves each selection against the MSL version effective today. */
async function resolveLines(sql: Queryable, selections: ServiceSelection[], now: Date): Promise<ServiceLine[]> {
  const today = tz.dateString(now); // MSL "effective today" in WIB (DECISIONS O20)
  const lines: ServiceLine[] = [];
  for (const sel of selections) {
    if ((sel.masterServiceId ?? '').trim() === '') {
      throw new IncompleteError();
    }
    const v = await effectiveAt(sql, sel.masterServiceId, today);
    const qty = sel.quantity && sel.quantity > 0 ? BigInt(Math.trunc(sel.quantity)) : 0n;
    lines.push(lineFromView(v, qty, sel.amount ?? '', sel.durasiBulan));
  }
  return lines;
}

/**
 * previewQuote computes a read-only quote (Estimasi Nilai + Komisi) for a set of
 * selections against the MSL version effective today, without persisting. The
 * 1..MAX_SERVICES cap is enforced by buildQuote with the verbatim BI message.
 */
export async function previewQuote(
  sql: Sql,
  selections: ServiceSelection[],
  now: Date = new Date(),
  includePPN = false,
): Promise<Quote> {
  const lines = await resolveLines(sql, selections, now);
  return buildQuote(lines, includePPN);
}

// ===========================================================================
// Attempt lifecycle (transactional).
// ===========================================================================

/** The loaded prospect attempt + its lead linkage. */
interface AttemptInfo {
  id: string;
  leadId: string;
  ownerId: string;
  status: string;
  originDivision: string;
  originCampaignId: string | null;
}

/**
 * canWriteAttempt applies the M0 §9.1 matrix: Director everywhere; Sales Lead
 * division-wide; Sales staff own attempts only; OD (read-only) never writes.
 */
export function canWriteAttempt(actor: Actor, ownerId: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.division !== SALES_DIVISION) {
    return false;
  }
  if (actor.role.level === permission.LevelLead) {
    return true;
  }
  return actor.role.level === permission.LevelStaff && actor.employeeId === ownerId;
}

/** loadAttempt reads an attempt joined to its lead (FOR UPDATE inside a tx). */
async function loadAttempt(tx: Queryable, attemptId: string, forUpdate: boolean): Promise<AttemptInfo> {
  type Row = {
    id: string; lead_id: string; owner_employee_id: string; status: string;
    origin_division: string; origin_campaign_id: string | null;
  };
  const rows = forUpdate
    ? await tx<Row[]>`
        select pa.id, pa.lead_id, pa.owner_employee_id, pa.status, l.origin_division, l.origin_campaign_id
        from prospect_attempts pa join leads l on l.id = pa.lead_id
        where pa.id = ${attemptId} for update`
    : await tx<Row[]>`
        select pa.id, pa.lead_id, pa.owner_employee_id, pa.status, l.origin_division, l.origin_campaign_id
        from prospect_attempts pa join leads l on l.id = pa.lead_id
        where pa.id = ${attemptId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    id: r.id, leadId: r.lead_id, ownerId: r.owner_employee_id, status: r.status,
    originDivision: r.origin_division, originCampaignId: r.origin_campaign_id,
  };
}

/** transition drives the prospect_attempt machine within tx (only status path). */
async function attemptTransition(
  sm: statemachine.SmExecutor,
  attemptId: string,
  to: string,
  actor: Actor,
): Promise<statemachine.TransitionResult> {
  return statemachine.transition(sm, {
    machine: ATTEMPT_MACHINE,
    entityType: 'prospect_attempt',
    table: 'prospect_attempts',
    entityId: attemptId,
    to,
    actor,
  });
}

/**
 * markContacted advances a New Lead attempt to Contacted (M0 §4 — a real action
 * was logged). Owner (or Sales Lead/Director) only.
 */
export async function markContacted(
  sql: Sql,
  actor: Actor,
  attemptId: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    return attemptTransition(executors(tx).sm, attemptId, STATUS_CONTACTED, actor);
  });
}

/**
 * markLost drives an attempt to `Closed-Lost` (M0 §5). Owner (or Sales
 * Lead/Director) only, exactly as `markContacted`.
 *
 * Which source states may reach it is the engine's call, not this function's:
 * `sm_edges` allows it from `Negotiation - Rejected` / `- Approved` /
 * `- Auto Approved` and blocks everything else with the default BI message
 * (migration 20260723055732 §1). Mirrors Go `Service.MarkLost`.
 *
 * `Closed-Lost` is a TERMINAL attempt status, so recording it is what releases
 * the lead: M1's dedup treats a non-terminal attempt as "sedang diproses oleh
 * sales lain", and `open_attempt_count` counts only non-terminal ones.
 */
export async function markLost(
  sql: Sql,
  actor: Actor,
  attemptId: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    return attemptTransition(executors(tx).sm, attemptId, STATUS_CLOSED_LOST, actor);
  });
}

/** The Qualified Lead Form client draft + selected services (M0 §4). */
export interface QualifiedForm {
  namaPic: string;
  toko: string;
  kota: string;
  linkToko: string;
  kategori: string;
  platform: string;
  storeLink?: string;
  gmvBaseline: string;
  targetGmv: string;
  marketingBudget?: string;
  services: ServiceSelection[];
}

function qualifiedFormValid(f: QualifiedForm): boolean {
  return (
    (f.namaPic ?? '').trim() !== '' && (f.toko ?? '').trim() !== '' && (f.kota ?? '').trim() !== '' &&
    (f.linkToko ?? '').trim() !== '' && (f.kategori ?? '').trim() !== '' && (f.platform ?? '').trim() !== '' &&
    (f.gmvBaseline ?? '').trim() !== '' && (f.targetGmv ?? '').trim() !== ''
  );
}

/**
 * submitQualifiedForm submits the Qualified Lead Form (M0 §4). It resolves each
 * selected service against the MSL version effective now (pinning name, price and
 * commission_rule), enforces the 1..MAX_SERVICES cap, persists the form + service
 * lines (with the computed subtotal so each line stays recomputable), and
 * transitions the attempt Contacted → Qualified — all in the submit transaction,
 * so the status never advances before a successful submit.
 */
export async function submitQualifiedForm(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  form: QualifiedForm,
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (!qualifiedFormValid(form)) {
    throw new IncompleteError();
  }
  if (form.services.length === 0) {
    throw new IncompleteError();
  }
  if (form.services.length > MAX_SERVICES) {
    throw new TooManyServicesError();
  }
  // The same service twice is refused HERE, at the door that creates the snapshot.
  // Closing joins each proposal line to `qualified_form_services` on
  // master_service_id, so a duplicated snapshot row multiplies that join: the deal
  // closes with duplicated Service rows and an inflated total_agreed_value, with no
  // error anywhere. Quantity is the field for "two of this service", not a second row.
  const picked = new Set<string>();
  for (const sel of form.services) {
    const sid = (sel.masterServiceId ?? '').trim();
    if (sid === '' || picked.has(sid)) {
      throw new IncompleteError();
    }
    picked.add(sid);
  }

  // Resolve MSL versions + compute subtotals BEFORE the write transaction; the
  // pinned snapshot (params + subtotal) is what gets persisted.
  const lines = await resolveLines(sql, form.services, now);
  const pins = lines.map((l) => ({ line: l, subtotal: lineSubtotal(l) }));

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }

    await tx`
      insert into qualified_forms
        (attempt_id, lead_id, nama_pic, toko, kota, link_toko, kategori,
         gmv_baseline, target_gmv, marketing_budget, platform, store_link, created_by)
      values
        (${attemptId}, ${a.leadId}, ${form.namaPic}, ${form.toko}, ${form.kota}, ${form.linkToko},
         ${form.kategori}, ${form.gmvBaseline}, ${form.targetGmv},
         ${nullDecimal(form.marketingBudget)}, ${form.platform}, ${nullString(form.storeLink)},
         ${actor.employeeId})`;

    for (const { line: l, subtotal } of pins) {
      const p = lineParams(l);
      // `apply_ppn` is NOT written: it is deprecated by D-4 and its column
      // default (false) is now the only value it ever takes. `subtotal` is
      // always the non-PPN base; tax is decided later, on the invoice.
      await tx`
        insert into qualified_form_services
          (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule,
           quantity, input_amount, unit, min_qty, pricing_mode, subtotal, durasi_bulan, created_by)
        values
          (${attemptId}, ${l.serviceId}, ${l.versionNo}, ${l.name}, ${money.decimal(l.standardPrice)},
           ${l.rule.raw}, ${p.quantity.toString()}, ${inputAmountValue(l)}, ${nullString(l.unit)},
           ${minQtyValue(l.minQty)}, ${l.mode}, ${money.decimal(subtotal)}, ${l.durasiBulan},
           ${actor.employeeId})`;
    }

    await ex.audit.insertAudit({
      entityType: 'prospect_attempt', entityId: attemptId, actorEmployeeId: actor.employeeId,
      action: 'qualified_form_submit', beforeJson: null,
      afterJson: { toko: form.toko, services: pins.length }, createdBy: actor.employeeId,
    });

    return attemptTransition(ex.sm, attemptId, STATUS_QUALIFIED, actor);
  });
}

// NQ taxonomy (M1-OA-8): seven closed reasons; "[Lainnya ...]" requires free
// text, stored as `[Lainnya ...] <teks>` in the same column. Verbatim BI.
export const NQ_BUKAN_SELLER = '[Bukan seller]';
export const NQ_KONTAK_SALAH = '[Kontak salah/tidak valid]';
export const NQ_SPAM_DUPLIKAT = '[Spam/duplikat]';
export const NQ_SUDAH_KLIEN = '[Sudah jadi klien]';
export const NQ_TIDAK_BUDGET = '[Tidak ada budget]';
export const NQ_TIDAK_RESPON = '[Tidak ada respon]';
export const NQ_LAINNYA = '[Lainnya ...]';

const NQ_CLOSED_REASONS = new Set<string>([
  NQ_BUKAN_SELLER, NQ_KONTAK_SALAH, NQ_SPAM_DUPLIKAT, NQ_SUDAH_KLIEN,
  NQ_TIDAK_BUDGET, NQ_TIDAK_RESPON, NQ_LAINNYA,
]);

/**
 * setNotQualified closes a Contacted attempt as Not Qualified with ≥1 mandatory
 * reason from the closed NQ taxonomy (M1-OA-8). "[Lainnya ...]" requires free
 * text, persisted as `[Lainnya ...] <teks>`.
 */
export async function setNotQualified(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  reasons: string[],
  lainnyaText = '',
): Promise<statemachine.TransitionResult> {
  if (reasons.length === 0) {
    throw new IncompleteError();
  }
  const stored: string[] = [];
  for (const r of reasons) {
    if (!NQ_CLOSED_REASONS.has(r)) {
      throw new IncompleteError();
    }
    if (r === NQ_LAINNYA) {
      if (lainnyaText.trim() === '') {
        throw new IncompleteError();
      }
      stored.push(`${NQ_LAINNYA} ${lainnyaText.trim()}`);
      continue;
    }
    stored.push(r);
  }

  return withTransaction(sql, async (tx) => {
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    for (const r of stored) {
      await tx`
        insert into prospect_attempt_nq_reasons (attempt_id, reason, created_by)
        values (${attemptId}, ${r}, ${actor.employeeId})`;
    }
    return attemptTransition(executors(tx).sm, attemptId, STATUS_NOT_QUALIFIED, actor);
  });
}

/** Result of one `leads_unrespon_tick` run — see `runUnresponTick`. */
export interface UnresponTickResult {
  unrespon: number;
  autoNotQualified: number;
}

/**
 * runUnresponTick drives the daily "lead aging" sweep (L1/L3, `docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`). The work itself lives in the SQL
 * function `leads_unrespon_tick` (migration 20260911060000) — pg_cron calls it
 * directly on Supabase, so this is the manual/backfill entry point over the
 * SAME function (pola `stage.runStageOverdueTick`). This is attempt-machine
 * work (per-sales), not `leads.record_status` — hence living here, not in
 * `leads.ts`. Idempotent (each attempt ages at most once per threshold
 * crossed); `now` is a parameter so tests can pin the WIB day.
 */
export async function runUnresponTick(sql: Sql, now?: Date): Promise<UnresponTickResult> {
  const rows =
    now === undefined
      ? await sql<{ r: { unrespon: number; auto_not_qualified: number } }[]>`select leads_unrespon_tick() as r`
      : await sql<{ r: { unrespon: number; auto_not_qualified: number } }[]>`select leads_unrespon_tick(${now}) as r`;
  return { unrespon: rows[0].r.unrespon, autoNotQualified: rows[0].r.auto_not_qualified };
}

// ===========================================================================
// Negotiation (M0 §5) — versioned proposals + superior approval.
// ===========================================================================

/** Superior's decision on a Pending Approval attempt (M0 §5). */
export const DECISION_APPROVE = 'approve';
export const DECISION_REVISE = 'revise';
export const DECISION_REJECT = 'reject';

/**
 * One service line of a negotiation proposal.
 *
 * TWO shapes, and which one it is decides everything downstream:
 *
 *   - **standard** — `proposedPrice` and `commissionRule` both empty. The line is
 *     priced by the SERVER from the MSL version effective now (calculator subtotal
 *     + the version's own commission_rule), exactly as the Qualified Form is. This
 *     is the shape a newly ADDED service arrives in: the client sends an id and a
 *     quantity, never a price, so money math stays server-side (CLAUDE.md #4/#7).
 *   - **custom** — an explicit `proposedPrice` (and `commissionRule`). This is a
 *     negotiated term and therefore needs the superior (M0 §5).
 *
 * `quantity` / `amount` feed the calculator and are read for STANDARD lines only;
 * a custom line already carries its agreed rupiah value.
 */
export interface ProposalLine {
  masterServiceId: string;
  /**
   * The negotiated price, ALWAYS non-PPN (D-4: "semua harga non ppn, negosiasi
   * maupun non nego"). Nobody types tax into this field; if the invoice is
   * taxed, 11% is added once at the bottom of the invoice.
   */
  proposedPrice?: string;
  commissionRule?: string;
  paymentTerms?: string;
  /** calculator quantity for a standard line (omitted / 0 defaults to 1). */
  quantity?: number;
  /** passthrough rupiah nominal for a standard line in passthrough mode. */
  amount?: string;
  /**
   * FS-6b — the tenor this line is sold at, in months. Read for BOTH kinds of
   * line, not only standard ones: negotiating the price of a 12-month package
   * does not turn it into a 3-month one, so a custom line carries its tenor
   * through to the snapshot even though its price came from the negotiation
   * rather than from the option.
   *
   * On a standard line it also selects the PRICE (the option's package price).
   * On a custom line it is recorded only — the negotiated price wins, which is
   * what "custom" means.
   */
  durasiBulan?: number | null;
}

/**
 * isCustomLine reports whether a line carries negotiated terms (an explicit price
 * or commission rule) rather than standard MSL terms. This single predicate is what
 * routes a submission: standard-only may bypass the superior (§5 non-negotiation),
 * anything custom may not.
 */
export function isCustomLine(l: ProposalLine): boolean {
  return (l.proposedPrice ?? '').trim() !== '' || (l.commissionRule ?? '').trim() !== '';
}

/** hasCustomLine reports whether ANY line in the set carries negotiated terms. */
export function hasCustomLine(lines: ProposalLine[]): boolean {
  return lines.some(isCustomLine);
}

/**
 * submitNegotiation opens the negotiation from a Qualified attempt.
 *
 * `noNego=true` is the §5 Non-Negotiation flow and goes straight to Negotiation -
 * Auto Approved (bypasses the superior). Two sub-cases, both standard-terms-only:
 *   - EMPTY `lines` — take the Qualified Form snapshot as it stands (its pinned
 *     subtotals). This is the plain "client accepts the offer" path.
 *   - NON-EMPTY `lines` — the §5 Flow step 1 "Service Selection & Confirmation"
 *     screen: the salesperson deselected some offered services and/or added
 *     others from the Master Service List. Every line must use standard terms, so
 *     the server prices them from the MSL; a line carrying a custom price is
 *     refused with CustomTermRequiresNegotiationError ("switch to the Negotiation
 *     flow"), exactly as §5 rule 2 requires.
 *
 * Otherwise (`noNego=false`) the lines are versioned (NEG-) and routed to the
 * superior as Negotiation - Pending Approval, firing the pending-approval
 * notification. Owner / Sales Lead / Director only.
 */
export async function submitNegotiation(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  lines: ProposalLine[],
  noNego: boolean,
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (noNego && hasCustomLine(lines)) {
    throw new CustomTermRequiresNegotiationError();
  }
  if (!noNego && lines.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    const to = noNego ? STATUS_NEG_AUTO_APPROVE : STATUS_NEG_PENDING;
    // Transition first: an invalid edge (attempt not Qualified) rejects cleanly
    // with nothing written; a valid one lets the proposal write commit atomically.
    const result = await attemptTransition(ex.sm, attemptId, to, actor);
    if (!result.ok) {
      return result;
    }
    const proposalLines = noNego && lines.length === 0 ? await standardLines(tx, attemptId) : lines;
    await writeProposal(tx, ex, actor, attemptId, proposalLines, now, !noNego);
    if (!noNego) {
      await emitPendingApproval(ex.notify, actor, attemptId);
    }
    return result;
  });
}

/**
 * reviseServices is the **Edit Service** door: the final service set often differs
 * from what was offered at Qualified, and until now the only way to change it was
 * to have never left the Qualified stage (owner QA revisi 2026-08-07,
 * `docs/DECISIONS.md`).
 *
 * It appends a NEW proposal version carrying the revised set, from an
 * already-approved attempt (`Negotiation - Approved` / `- Auto Approved`), i.e. in
 * the window between approval and closing. Where it lands depends on the terms —
 * the same rule §5 already applies to the first proposal, not a new one:
 *   - every line STANDARD ⇒ status unchanged. Standard terms are what the
 *     non-negotiation flow lets bypass the superior, so re-picking standard
 *     services cannot need an approval the original selection did not.
 *   - ANY line CUSTOM ⇒ back to `Negotiation - Pending Approval` and the superior
 *     is notified. A salesperson must not be able to rewrite a price the superior
 *     already approved; changing money re-opens the approval (edges added in
 *     20260807040000_edit_service_reapproval.sql).
 *
 * The previous version is never mutated — the proposal chain is the immutable
 * record of what changed and when (house rule #3), and `close` always reads the
 * LATEST version, so the revision is what gets born as Services at closing.
 *
 * Owner / Sales Lead / Director only.
 */
export async function reviseServices(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  lines: ProposalLine[],
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  const custom = hasCustomLine(lines);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    // Only the pre-closing window. Anything else (still negotiating, already
    // closed) has its own door, so refuse rather than silently writing a version
    // nobody will read.
    if (a.status !== STATUS_NEG_APPROVED && a.status !== STATUS_NEG_AUTO_APPROVE) {
      throw new NotClosableError();
    }
    if (!custom) {
      // Standard-only: no status move at all, so no sm_transition — the audit row
      // written by writeProposal is the history of the change.
      await writeProposal(tx, ex, actor, attemptId, lines, now, false);
      const unmoved: statemachine.TransitionOk = { ok: true, from: a.status, to: a.status };
      return unmoved;
    }
    const result = await attemptTransition(ex.sm, attemptId, STATUS_NEG_PENDING, actor);
    if (!result.ok) {
      return result;
    }
    await writeProposal(tx, ex, actor, attemptId, lines, now, true);
    await emitPendingApproval(ex.notify, actor, attemptId);
    return result;
  });
}

/**
 * resubmitNegotiation sends a fresh proposal version after a Revision Required or
 * a Reject (M0 §5 — salesperson action). Both routes go back to Negotiation -
 * Pending Approval. Owner / Sales Lead / Director only.
 */
export async function resubmitNegotiation(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  lines: ProposalLine[],
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    const result = await attemptTransition(ex.sm, attemptId, STATUS_NEG_PENDING, actor);
    if (!result.ok) {
      return result;
    }
    await writeProposal(tx, ex, actor, attemptId, lines, now, hasCustomLine(lines));
    await emitPendingApproval(ex.notify, actor, attemptId);
    return result;
  });
}

/**
 * decideNegotiation is the superior's decision on a Pending Approval attempt. The
 * prospect_attempt machine enforces Lead/Director-only on these edges; the
 * decision note is recorded on the latest un-noted proposal version and an event
 * fires to the salesperson. Revise/Reject require a mandatory note (M0 §5).
 */
export async function decideNegotiation(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  decision: string,
  note = '',
): Promise<statemachine.TransitionResult> {
  let to: string;
  switch (decision) {
    case DECISION_APPROVE:
      to = STATUS_NEG_APPROVED;
      break;
    case DECISION_REVISE:
      to = STATUS_NEG_REVISION;
      break;
    case DECISION_REJECT:
      to = STATUS_NEG_REJECTED;
      break;
    default:
      throw new IncompleteError();
  }
  if ((decision === DECISION_REVISE || decision === DECISION_REJECT) && note.trim() === '') {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    // The engine returns role_denied for a non-superior; nothing is written then.
    const result = await attemptTransition(ex.sm, attemptId, to, actor);
    if (!result.ok) {
      return result;
    }
    await tx`
      update negotiation_proposals set decision_note = ${note}
      where id = (
        select id from negotiation_proposals
        where attempt_id = ${attemptId} and decision_note is null
        order by version_no desc limit 1
      )`;
    await emitDecision(ex.notify, actor, attemptId, a.ownerId);
    return result;
  });
}

/**
 * acceptCounter is the salesperson accepting the superior's counter-offer (M0 §5
 * — "system syncs values"): Negotiation - Revision Required → Negotiation -
 * Approved. Owner-driven (DECISIONS O18).
 */
export async function acceptCounter(
  sql: Sql,
  actor: Actor,
  attemptId: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    return attemptTransition(executors(tx).sm, attemptId, STATUS_NEG_APPROVED, actor);
  });
}

/**
 * standardLines builds proposal lines from the Qualified Form snapshot (the
 * no-nego path takes the pinned deal value = calculator subtotal, not the unit
 * standard price — MSL v2, DECISIONS 2026-07-16).
 */
async function standardLines(tx: Queryable, attemptId: string): Promise<ProposalLine[]> {
  const rows = await tx<
    { master_service_id: string; subtotal: string; commission_rule: string; durasi_bulan: number | null }[]
  >`
    select master_service_id, subtotal, commission_rule, durasi_bulan
    from qualified_form_services where attempt_id = ${attemptId} order by id`;
  if (rows.length === 0) {
    throw new IncompleteError();
  }
  return rows.map((r) => ({
    masterServiceId: r.master_service_id, proposedPrice: r.subtotal, commissionRule: r.commission_rule,
    // FS-6b: carried through, not re-derived. These rows read as CUSTOM here
    // (they carry a pinned price), so `resolveProposalLine` will not look at the
    // catalog at all — if the tenor were dropped here it would be lost for the
    // whole no-negotiation path, which is the path most deals take.
    durasiBulan: r.durasi_bulan === null ? null : Number(r.durasi_bulan),
  }));
}

/**
 * resolveProposalLine turns one input line into the (price, commission_rule) pair
 * that gets persisted.
 *
 * A CUSTOM line is validated and passed through — its price is the negotiated
 * number and this layer never second-guesses it. A STANDARD line (no price, no
 * rule) is priced HERE, from the MSL version effective today: the calculator
 * subtotal for the given quantity/nominal plus that version's own commission_rule.
 * That is why an added service needs no price on the wire — the client cannot
 * compute rupiah (CLAUDE.md #4), and a price it did compute could not be trusted.
 *
 * Exported so `renewal.ts` (R-03) can price a renewal/cross-sell proposal line
 * with the EXACT same MSL/custom-term rule this module uses for a fresh
 * closing — one pricing engine, not two that could drift.
 */
export async function resolveProposalLine(
  tx: Queryable,
  l: ProposalLine,
  now: Date,
): Promise<{ price: string; rule: string; durasiBulan: number | null }> {
  if ((l.masterServiceId ?? '').trim() === '') {
    throw new IncompleteError();
  }
  if (isCustomLine(l)) {
    const price = (l.proposedPrice ?? '').trim();
    const rule = (l.commissionRule ?? '').trim();
    // A half-custom line (price without rule, or rule without price) is ambiguous:
    // it names neither the standard terms nor a complete negotiated one.
    if (price === '' || rule === '') {
      throw new IncompleteError();
    }
    try {
      money.parse(price);
    } catch {
      throw new IncompleteError();
    }
    parseCommissionRule(rule); // throws BadCommissionRuleError on a bad shape
    // A negotiated price is non-PPN, like every other price (D-4). There is no
    // tax to resolve here at all — the invoice decides that later, once.
    //
    // FS-6b: the tenor IS still recorded, and deliberately not validated against
    // the catalog. A custom line is the door through which a negotiated
    // agreement enters, including one whose tenor the catalog never listed; the
    // DB's `> 0` check is the whole guard it gets, and `resolveClosingWindow`
    // still refuses anything past 36 months with the house BI message.
    return { price, rule, durasiBulan: normalizeTenor(l.durasiBulan) };
  }
  const view = await effectiveAt(tx, l.masterServiceId, tz.dateString(now));
  const qty = l.quantity && l.quantity > 0 ? BigInt(Math.trunc(l.quantity)) : 0n;
  const line = lineFromView(view, qty, l.amount ?? '', l.durasiBulan);
  return { price: money.decimal(lineSubtotal(line)), rule: line.rule.raw, durasiBulan: line.durasiBulan };
}

/**
 * normalizeTenor accepts what a custom line may carry and reduces it to the two
 * values the column stores: a whole positive month count, or `null`.
 *
 * Zero and negatives are REFUSED rather than folded into `null`. `null` means
 * "no tenor chosen — read the version"; a caller that sent `0` said something
 * else, and turning a wrong answer into a plausible one is how a deal ends up
 * accruing over the wrong window with nothing in the log to show for it.
 */
function normalizeTenor(v: number | null | undefined): number | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (!Number.isInteger(v) || v <= 0) {
    throw new IncompleteError();
  }
  return v;
}

/**
 * writeProposal appends a new immutable proposal version + its lines. Custom lines
 * are validated and standard ones priced from the MSL (resolveProposalLine); the
 * 1..MAX_SERVICES cap holds here too.
 *
 * The SAME service twice in one set is refused. That is not tidiness: closing
 * enriches each proposal line by joining `qualified_form_services` on
 * master_service_id, so two rows for one service MULTIPLY the join — the deal
 * closes with duplicated Service rows and an inflated `total_agreed_value`, silently.
 * `submitQualifiedForm` refuses duplicates for the same reason.
 */
async function writeProposal(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  actor: Actor,
  attemptId: string,
  lines: ProposalLine[],
  now: Date,
  // Whether the CALLER asked for negotiated terms. Passed in rather than derived
  // from `lines`, because the no-negotiation path substitutes the Qualified
  // snapshot (which carries pinned prices and would read as custom here) — the
  // audit row must say what the salesperson actually did.
  customTerms: boolean,
): Promise<void> {
  if (lines.length === 0 || lines.length > MAX_SERVICES) {
    throw lines.length > MAX_SERVICES ? new TooManyServicesError() : new IncompleteError();
  }
  const seen = new Set<string>();
  for (const l of lines) {
    const id = (l.masterServiceId ?? '').trim();
    if (id === '' || seen.has(id)) {
      throw new IncompleteError();
    }
    seen.add(id);
  }
  // Resolve every line BEFORE the first insert: a bad line must not leave a
  // half-written proposal version behind (the whole call is one transaction, but
  // resolving first also means no NEG- id is burned on an invalid set).
  const resolved: { line: ProposalLine; price: string; rule: string; durasiBulan: number | null }[] = [];
  for (const l of lines) {
    const { price, rule, durasiBulan } = await resolveProposalLine(tx, l, now);
    resolved.push({ line: l, price, rule, durasiBulan });
  }

  const verRows = await tx<{ max: number | null }[]>`
    select max(version_no) as max from negotiation_proposals where attempt_id = ${attemptId}`;
  const version = Number(verRows[0]?.max ?? 0) + 1;

  const proposalId = await ex.ident.identNext('NEG', now);
  await tx`
    insert into negotiation_proposals (id, attempt_id, version_no, proposed_by, created_by)
    values (${proposalId}, ${attemptId}, ${version}, ${actor.employeeId}, ${actor.employeeId})`;

  for (const { line: l, price, rule, durasiBulan } of resolved) {
    await tx`
      insert into negotiation_proposal_lines
        (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms,
         durasi_bulan, created_by)
      values (${proposalId}, ${l.masterServiceId}, ${price}, ${rule},
              ${nullString(l.paymentTerms)}, ${durasiBulan}, ${actor.employeeId})`;
  }
  await ex.audit.insertAudit({
    entityType: 'prospect_attempt', entityId: attemptId, actorEmployeeId: actor.employeeId,
    action: 'negotiation_version', beforeJson: null,
    afterJson: {
      proposal_id: proposalId, version_no: version, lines: lines.length,
      // Which services the version carries, so a set CHANGE is readable from the
      // log itself and not only by diffing two proposal rows (house rule #3).
      services: resolved.map((r) => r.line.masterServiceId),
      custom_terms: customTerms,
    },
    createdBy: actor.employeeId,
  });
}

/** emitPendingApproval notifies the Sales division leads (resolver leadsOfDivision). */
async function emitPendingApproval(
  notify: notification.NotifyExecutor,
  actor: Actor,
  attemptId: string,
): Promise<void> {
  await notification.emit(notify, {
    event: notification.EVENTS.NegotiationPendingApproval,
    entityType: 'prospect_attempt', entityId: attemptId, actor: actor.employeeId,
    division: SALES_DIVISION, deepLink: `/attempts/${attemptId}`,
  });
}

/** emitDecision notifies the attempt owner (salesperson) of the superior's call. */
async function emitDecision(
  notify: notification.NotifyExecutor,
  actor: Actor,
  attemptId: string,
  ownerId: string,
): Promise<void> {
  await notification.emit(notify, {
    event: notification.EVENTS.NegotiationDecision,
    entityType: 'prospect_attempt', entityId: attemptId, actor: actor.employeeId,
    explicitRecipients: [ownerId], deepLink: `/attempts/${attemptId}`,
  });
}

// ===========================================================================
// Closing (M0 §6) — births Client / Transaction / Services / Installments.
// ===========================================================================

/** Payment schemes (M0 §6 rule 5) — VERBATIM, shared with M4/M5. */
export const PAYMENT_SCHEME_LUNAS = '[Bayar Penuh (Lunas)]';
export const PAYMENT_SCHEME_SEBAGIAN = '[Bayar Sebagian]';
export const PAYMENT_SCHEME_TERMIN = '[Termin]';
export const PAYMENT_SCHEME_DI_BELAKANG = '[Bayar di Belakang]';
const PAYMENT_SCHEMES = new Set<string>([
  PAYMENT_SCHEME_LUNAS, PAYMENT_SCHEME_SEBAGIAN, PAYMENT_SCHEME_TERMIN, PAYMENT_SCHEME_DI_BELAKANG,
]);

/** Initial statuses birthed at closing (match the seeded machines verbatim). */
// Exported (alongside the birth-time constants below) so `renewal.ts` (R-03)
// births a Service/Transaction/Installment in the SAME initial state a fresh
// closing does — one set of "what a brand-new row looks like" constants.
export const TRX_STATUS_MENUNGGU = '[Menunggu Verifikasi]';
export const INST_STATUS_BELUM_JATUH_TEMPO = '[Belum Jatuh Tempo]';
export const SERVICE_STATUS_AWAITING_ONBOARDING = '[Awaiting Onboarding]';

/** 100% expressed in integer basis points (exact Σ check — no float). */
export const FULL_ALLOCATION_BP = 10000;
/** Closing Form salesperson cap (M0 §6 rule 3). */
export const MAX_SALESPEOPLE = 5;

/** One salesperson's share of a closing (100% == 10000 bp). */
export interface Allocation {
  salespersonId: string;
  basisPoints: number;
}

/** The salespeople side of a Closing Form submission. */
export interface ClosingParties {
  primarySalespersonId: string;
  allocations: Allocation[];
  commissionPaymentPicId?: string;
}

/** One Payment Schedule row (M0 §6 rule 8 / M5 §4). */
export interface InstallmentInput {
  amount: string;
  dueDate: string; // YYYY-MM-DD
}

/** The Closing Form payload (M0 §6). Value + services come from the approved proposal. */
export interface ClosingInput {
  parties: ClosingParties;
  paymentScheme: string;
  installments?: InstallmentInput[];
  managedSince?: string; // optional YYYY-MM-DD
  /**
   * A-4 (ketokan K-2) — the cooperation duration in months, moved here from the
   * AM's Strategi form. Normally DERIVED from the catalog (see `deriveDuration`)
   * and left unset; supply it only to override, and then `alasanOverride` is
   * mandatory. 1…36, the same band `contracts` enforces.
   */
  durasiBulanOverride?: number | null;
  /** Mandatory when `durasiBulanOverride` is set. Free text, audited. */
  alasanOverride?: string | null;
  /**
   * The "Include PPN" button Sales presses at closing (ketokan D-4 2026-09-08).
   * Every price in the system is non-PPN; this is the ONE place that decides
   * whether 11% is added to the invoice, and it is stored on the transaction so
   * the answer is never re-derived from a catalog flag that may have moved.
   *
   * Absent = false. That default is the safe side: an invoice that nobody
   * marked as taxed is billed without tax, which under-bills by a visible,
   * correctable amount — whereas taxing by default would over-bill a client who
   * never agreed to it.
   */
  includePPN?: boolean;
}

/** The ids birthed by a successful closing. */
export interface ClosingResult {
  clientId: string;
  transactionId: string;
}

/**
 * validateParties enforces the full allocation rule set (M0 §6): Primary is
 * mandatory and must hold a share; ≤5 salespeople; positive shares summing to
 * EXACTLY 100% (basis points); the Commission & Payment PIC is mandatory when >1
 * salesperson and must be a member.
 */
export function validateParties(c: ClosingParties): void {
  const primary = (c.primarySalespersonId ?? '').trim();
  if (primary === '' || c.allocations.length === 0) {
    throw new IncompleteError();
  }
  if (c.allocations.length > MAX_SALESPEOPLE) {
    throw new TooManySalespeopleError();
  }
  const seen = new Set<string>();
  let primaryIncluded = false;
  let sum = 0;
  for (const a of c.allocations) {
    const id = (a.salespersonId ?? '').trim();
    if (id === '' || !Number.isInteger(a.basisPoints) || a.basisPoints <= 0) {
      throw new IncompleteError();
    }
    if (seen.has(id)) {
      throw new IncompleteError(); // a salesperson may appear at most once
    }
    seen.add(id);
    if (id === primary) {
      primaryIncluded = true;
    }
    sum += a.basisPoints;
  }
  if (!primaryIncluded) {
    throw new IncompleteError();
  }
  if (sum !== FULL_ALLOCATION_BP) {
    throw new AllocationTotalError();
  }
  if (c.allocations.length > 1) {
    const pic = (c.commissionPaymentPicId ?? '').trim();
    if (pic === '' || !seen.has(pic)) {
      throw new IncompleteError();
    }
  }
}

/** resolvePIC returns the Commission & Payment PIC, defaulting to Primary when solo. Exported for `renewal.ts` (R-03) — same parties shape, same rule. */
export function resolvePIC(c: ClosingParties): string {
  if (c.allocations.length === 1 || (c.commissionPaymentPicId ?? '').trim() === '') {
    return c.primarySalespersonId;
  }
  return c.commissionPaymentPicId as string;
}

/**
 * validateSchemeShape enforces ONLY the payment-scheme ↔ schedule half of
 * M0 §6 rule 5 — no parties, no allocation.
 *
 * Dipisah dari `validateShape` untuk FS-4: `renewal.executeRenewal` dengan
 * jenis `bayar_komisi` tidak memakai alokasi sales sama sekali (ketokan FS-3 —
 * penagihan komisi tidak boleh memindahkan kepemilikan klien), tapi jadwal
 * cicilannya tetap tagihan sungguhan yang Finance verifikasi seperti tagihan
 * lain. Diekstrak, BUKAN disalin: satu aturan jadwal, satu tempat.
 */
export function validateSchemeShape(input: {
  paymentScheme: string;
  installments?: InstallmentInput[];
}): void {
  if (!PAYMENT_SCHEMES.has(input.paymentScheme)) {
    throw new IncompleteError();
  }
  const installments = input.installments ?? [];
  switch (input.paymentScheme) {
    case PAYMENT_SCHEME_TERMIN:
      if (installments.length === 0) {
        throw new IncompleteError();
      }
      break;
    case PAYMENT_SCHEME_DI_BELAKANG:
      if (installments.length !== 1) {
        throw new IncompleteError();
      }
      break;
    default: // Lunas / Sebagian carry no schedule
      if (installments.length !== 0) {
        throw new IncompleteError();
      }
  }
  for (const inst of installments) {
    let amt: money.Money;
    try {
      amt = money.parse(inst.amount);
    } catch {
      throw new IncompleteError();
    }
    if (amt <= 0n || (inst.dueDate ?? '').trim() === '') {
      throw new IncompleteError();
    }
  }
}

/** validateShape enforces the payment-scheme ↔ schedule shape (M0 §6 rule 5) PLUS the parties/allocation rules. Exported so `renewal.ts` (R-03) validates a renewal/cross-sell's parties+payment shape with the same rule, not a second copy. */
export function validateShape(input: ClosingInput): void {
  validateParties(input.parties);
  validateSchemeShape(input);
}

/** approvedLine is one line of the latest proposal, enriched from the Qualified snapshot. */
interface ApprovedLine {
  masterServiceId: string;
  /** ALWAYS non-PPN (D-4). */
  proposedPrice: string;
  commissionRule: string;
  name: string;
  versionNo: number;
  requiresStrategyPlan: boolean;
  planTier: string;
  /**
   * A-4 — the catalog's duration for this line, in months. `null` is NOT
   * "unfilled": per the Q5 ketokan (2026-09-07) it means the service is one-off
   * and has no period at all, which is why `deriveDuration` skips those rows
   * rather than treating them as zero.
   */
  durasiBulan: number | null;
  /**
   * FS-6b — the tenor this proposal line explicitly agreed, or `null` when
   * nobody chose one and `durasiBulan` above therefore came from the catalog.
   *
   * Kept SEPARATE from `durasiBulan` on purpose. `durasiBulan` answers "how
   * long does this run" (which is what the contract window needs, whichever
   * source it came from); this one answers "did anyone choose", which is what
   * `services.durasi_bulan` must store — writing a catalog-derived number into
   * the snapshot column would make a re-versioned catalog and a deliberate
   * choice indistinguishable, and that column exists precisely to tell them
   * apart.
   */
  durasiDipilih: number | null;
}

interface QualifiedFormRow {
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  platform: string;
  store_link: string | null;
  gmv_baseline: string;
  target_gmv: string;
  marketing_budget: string | null;
}

// ---------------------------------------------------------------------------
// A-4 — the cooperation window (ketokan K-2, 2026-09-07)
// ---------------------------------------------------------------------------

/**
 * deriveDuration resolves the contract duration in months for a closing.
 *
 * ## Why this moved out of the Strategi form
 *
 * Until A-4 the ONLY UI that wrote `contracts.durasi_bulan` was the AM's
 * Strategi form, which runs weeks after the money is agreed. So the number that
 * every Plan period boundary, every accrual month and every renewal date derive
 * from was typed by someone who was not in the negotiation, from memory. K-2
 * moves it to the moment it is actually known: closing.
 *
 * ## The rule, and the two things it is not
 *
 * `MAX(durasi_bulan)` over the closed lines. Not the sum — a twelve-month Store
 * Management bought alongside a three-month GMV Max is a twelve-month
 * agreement, not fifteen. And not the min either: the agreement has to still be
 * open on the last day the longest service runs, or its final Plan period falls
 * outside its own contract window.
 *
 * `null` lines are SKIPPED, not counted as zero (Q5 ketokan): a null duration
 * means the service is one-off and has no period at all. A deal made up
 * entirely of one-off services therefore derives NO window, and this returns
 * null — there is nothing periodic to bound. `close` mints no contract in that
 * case rather than inventing a one-month one.
 *
 * Per-line quantity does not enter into it: `negotiation_proposal_lines` carries
 * no qty column, so the `qty_menambah = 'durasi'` scaling the MSL describes
 * (buy 3 GMV Max ⇒ 3 months) is not derivable here. An AM who negotiated that
 * uses the override, with a reason — which is exactly what the override is for.
 *
 * ## Where each line's number comes from (FS-6b)
 *
 * This function does not read the catalog; `loadApprovedLines` already resolved
 * each line to ONE number, preferring the tenor the deal chose over the version
 * the line pinned. Before FS-6b there was only the version to read, and since
 * the FS-6 invariant makes a version equal to its SHORTEST option, every
 * multi-tenor deal derived the shortest window no matter what was sold. The
 * MAX-over-lines rule below is unchanged — it is the per-line input that got
 * honest.
 */
export function deriveDuration(lines: ApprovedLine[]): number | null {
  let max: number | null = null;
  for (const l of lines) {
    if (l.durasiBulan === null) continue;
    if (max === null || l.durasiBulan > max) max = l.durasiBulan;
  }
  return max;
}

/**
 * resolveClosingWindow picks the window a closing writes, override over
 * derivation, and validates the pair.
 *
 * The `> 36` clamp is not defensive noise: `ck_contracts_durasi` refuses it at
 * the DB, and a rejection surfacing as a raw constraint violation instead of the
 * house BI message is a bug of its own class. Deriving above 36 should be
 * impossible (the catalog is bounded the same way) but the closing can still be
 * overridden by hand, so the check has to live here.
 */
export function resolveClosingWindow(
  lines: ApprovedLine[],
  input: ClosingInput,
  now: Date,
): { durasiBulan: number; tanggalMulai: string; tanggalAkhir: string; alasan: string | null } | null {
  const override = input.durasiBulanOverride;
  const alasan = (input.alasanOverride ?? '').trim();
  let durasi: number | null;
  if (override !== undefined && override !== null) {
    if (!Number.isInteger(override) || override < 1 || override > CONTRACT_DURATION_MAX) {
      throw new IncompleteError();
    }
    if (alasan === '') {
      throw new OverrideReasonRequiredError();
    }
    durasi = override;
  } else {
    durasi = deriveDuration(lines);
    if (durasi === null) {
      return null; // every line is one-off — no periodic window to bound.
    }
    if (durasi > CONTRACT_DURATION_MAX) {
      throw new IncompleteError();
    }
  }
  // `managedSince` is the date the client says the engagement starts; absent
  // that, the engagement starts when it was closed. Both are WIB calendar dates
  // (tz.dateString), never a UTC instant sliced — the difference is a whole day
  // for anything closed after 17:00 WIB.
  const mulai = (input.managedSince ?? '').trim() !== ''
    ? (input.managedSince as string).trim()
    : tz.dateString(now);
  return {
    durasiBulan: durasi,
    tanggalMulai: mulai,
    // CALENDAR months, clamped (tz.addMonthsToDate) — never `+ 30 days`. A deal
    // starting 31 January for one month ends 28 February; +30 days would end it
    // 2 March, and every Plan period after it would inherit the drift.
    tanggalAkhir: tz.addMonthsToDate(mulai, durasi),
    alasan: override !== undefined && override !== null ? alasan : null,
  };
}

/** `ck_contracts_durasi` upper bound, mirrored so the BI message wins. */
const CONTRACT_DURATION_MAX = 36;

/** `ck_contracts_jenis` — a closing is always a NEW agreement (renewals: M14). */
const CONTRACT_JENIS_BARU = 'baru';

/**
 * contractCatatan puts the override reason where an AM will actually read it —
 * on the agreement — labelled, so it does not read as a stray note. The
 * structured copy lives in the audit row; this is the human-facing one.
 */
function contractCatatan(alasan: string | null): string | null {
  return alasan === null ? null : `Durasi diubah dari katalog saat closing: ${alasan}`;
}

/**
 * close births the Client Record + Transaction + Services + Installments from a
 * Negotiation-Approved / Auto-Approved attempt, in ONE transaction. It splits
 * achievement across 1..5 salespeople (Σ = 10000 bp), fixes the payment scheme,
 * transitions the attempt to Closed-Success, and fires M1 §6 win resolution for
 * any pool competitors — all atomically. Owner / Sales Lead / Director only.
 */
export async function close(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  input: ClosingInput,
  now: Date = new Date(),
): Promise<ClosingResult> {
  validateShape(input);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const a = await loadAttempt(tx, attemptId, true);
    if (!canWriteAttempt(actor, a.ownerId)) {
      throw new ForbiddenError();
    }
    // M0 §6 rule 1: only Approved / Auto Approved may close.
    if (a.status !== STATUS_NEG_APPROVED && a.status !== STATUS_NEG_AUTO_APPROVE) {
      throw new NotClosableError();
    }

    const qf = await loadQualifiedForm(tx, attemptId);
    const lines = await loadApprovedLines(tx, attemptId);
    if (lines.length === 0) {
      throw new IncompleteError();
    }

    // Two totals, and they are NOT interchangeable (D-4):
    //   total    = Σ proposed_price — always non-PPN. This is
    //              `total_agreed_value`, what the accrual engine recognizes and
    //              what commission is computed from. PPN is never revenue.
    //   totalPPN = 11% of that, but ONLY if Sales pressed "Include PPN".
    //              Computed once on the invoice total, not per line, because
    //              the invoice is what the client pays and so the invoice is
    //              what the rounding has to be right for.
    // What the client is BILLED is the sum, and that is what the installment
    // schedule has to add up to. Validating the schedule against the base alone
    // would let a taxed deal close with instalments 11% short of the invoice —
    // silently, since every row would look self-consistent.
    let total = 0n;
    for (const l of lines) {
      total += money.parse(l.proposedPrice);
    }
    const includePPN = input.includePPN ?? false;
    const totalPPN = computePPN(total, includePPN);
    validateScheduleTotal(input, total + totalPPN);

    const primary = input.parties.primarySalespersonId;
    const pic = resolvePIC(input.parties);

    // 1) Client Record (CLI-), inheriting the locked Qualified data.
    const clientId = await ex.ident.identNext('CLI', now);
    await tx`
      insert into clients
        (id, lead_id, winning_attempt_id, nama_pic, toko, kota, link_toko, kategori,
         gmv_baseline, target_gmv, marketing_budget, origin_campaign_id,
         sales_pic_id, commission_payment_pic_id, created_by)
      values
        (${clientId}, ${a.leadId}, ${attemptId}, ${qf.nama_pic}, ${qf.toko}, ${qf.kota}, ${qf.link_toko},
         ${qf.kategori}, ${qf.gmv_baseline}, ${qf.target_gmv}, ${qf.marketing_budget}, ${a.originCampaignId},
         ${primary}, ${pic}, ${actor.employeeId})`;

    // 2) Platform snapshot — one client_platforms row PER selected platform
    //    (M4-OA-2: "each entry carries its own sub-data"), not the Platform
    //    List checklist joined into a single string (DECISIONS 2026-07-10
    //    W1-11: that gap was deferred, not endorsed). qf.platform is Sales'
    //    UI-side `join(', ')` of the checklist (sales page PLATFORMS); split it
    //    back apart here so every platform gets its own row/method/baseline.
    const platformNames = qf.platform.split(',').map((p) => p.trim()).filter((p) => p !== '');
    for (const platformName of platformNames.length ? platformNames : [qf.platform]) {
      await tx`
        insert into client_platforms (client_id, platform, store_link, managed_since, created_by)
        values (${clientId}, ${platformName}, ${qf.store_link}, ${nullDate(input.managedSince)}, ${actor.employeeId})`;
    }

    // 3) Sales allocation (Σ = 100% = 10000 bp, read-only snapshot).
    for (const al of input.parties.allocations) {
      await tx`
        insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
        values (${clientId}, ${al.salespersonId}, ${al.basisPoints}, ${actor.employeeId})`;
    }

    // 4) Services (SVC- per line, born [Awaiting Onboarding]); inherit the pinned
    //    MSL version's "Requires Strategy Plan" flag AND plan_tier (M6 §2, M6C
    //    S4). Both must travel together — a service pinned to the `ditentukan_am`
    //    middle tier that only got `requires_strategy_plan` would silently fall
    //    back to the `plan_tier` column default (`tanpa_plan`), skipping the G-B
    //    determination gate entirely instead of leaving it pending (the exact
    //    class of bug M6C Rule 1 warns about — see `nextOnboardingStep`).
    // 4a) A-4 (K-2) — the cooperation window (CTR-), minted HERE and not weeks
    //     later in the AM's Strategi form. One agreement per closing: O57 says a
    //     client who buys three services in one deal gets ONE Strategi, so they
    //     get one contract, and every Service born below hangs under it.
    //     `null` means every line is one-off — no periodic window exists to
    //     record, so none is invented (the AM can still group them later through
    //     `contract.createContract`).
    const window = resolveClosingWindow(lines, input, now);
    let contractId: string | null = null;
    if (window !== null) {
      contractId = await ex.ident.identNext('CTR', now);
      await tx`
        insert into contracts
          (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, catatan, jenis, created_by)
        values
          (${contractId}, ${clientId}, ${window.durasiBulan}, ${window.tanggalMulai},
           ${window.tanggalAkhir}, ${contractCatatan(window.alasan)}, ${CONTRACT_JENIS_BARU},
           ${actor.employeeId})`;
      await ex.audit.insertAudit({
        entityType: 'contract', entityId: contractId, actorEmployeeId: actor.employeeId,
        action: 'create',
        beforeJson: null,
        afterJson: {
          client_id: clientId,
          attempt_id: attemptId,
          durasi_bulan: window.durasiBulan,
          tanggal_mulai: window.tanggalMulai,
          tanggal_akhir: window.tanggalAkhir,
          // Which of the two answers this was, and why — the whole point of
          // making the reason mandatory is that it is readable HERE later.
          sumber_durasi: window.alasan === null ? 'katalog' : 'override',
          alasan_override: window.alasan,
        },
        createdBy: actor.employeeId,
      });
    }

    for (const l of lines) {
      const svcId = await ex.ident.identNext('SVC', now);
      await tx`
        insert into services
          (id, client_id, contract_id, master_service_id, master_version_no, name, standard_price,
           commission_rule, status, requires_strategy_plan, plan_tier, durasi_bulan, created_by)
        values
          (${svcId}, ${clientId}, ${contractId}, ${l.masterServiceId}, ${l.versionNo}, ${l.name},
           ${l.proposedPrice}, ${l.commissionRule}, ${SERVICE_STATUS_AWAITING_ONBOARDING},
           ${l.requiresStrategyPlan}, ${l.planTier}, ${l.durasiDipilih}, ${actor.employeeId})`;
    }

    // 5) Transaction (TRX-) born awaiting Finance verification.
    const trxId = await ex.ident.identNext('TRX', now);
    await tx`
      insert into transactions
        (id, client_id, payment_intent_scheme, total_agreed_value, include_ppn, total_ppn,
         payment_status, created_by)
      values
        (${trxId}, ${clientId}, ${input.paymentScheme}, ${money.decimal(total)}, ${includePPN},
         ${money.decimal(totalPPN)}, ${TRX_STATUS_MENUNGGU}, ${actor.employeeId})`;
    await tx`update clients set transaction_id = ${trxId}, payment_intent = ${input.paymentScheme} where id = ${clientId}`;

    // 6) Installments (INST-) for scheduled schemes.
    const installments = input.installments ?? [];
    for (let i = 0; i < installments.length; i++) {
      const instId = await ex.ident.identNext('INST', now);
      await tx`
        insert into installments
          (id, transaction_id, installment_no, amount, due_date, status, created_by)
        values
          (${instId}, ${trxId}, ${i + 1}, ${money.decimal(money.parse(installments[i].amount))},
           ${installments[i].dueDate}, ${INST_STATUS_BELUM_JATUH_TEMPO}, ${actor.employeeId})`;
    }

    // 7) Transition the attempt to Closed-Success (engine, audited).
    const result = await attemptTransition(ex.sm, attemptId, STATUS_CLOSED_SUCCESS, actor);
    if (!result.ok) {
      // Should not happen (status pre-checked) — surface as a lifecycle conflict.
      throw new NotClosableError();
    }

    // 8) Win resolution for pool competitors (M1 §6 rule 5), inside this tx.
    await resolveWin(tx, a.leadId, attemptId, primary);

    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'closing', beforeJson: null,
      afterJson: {
        transaction_id: trxId, attempt_id: attemptId,
        total_agreed_value: money.decimal(total), payment_scheme: input.paymentScheme,
        // A-4: explicit null when every line was one-off, so a later reader can
        // tell "no window exists" from "the key was forgotten" (O43's lesson,
        // applied to the audit trail).
        contract_id: contractId,
        durasi_bulan: window === null ? null : window.durasiBulan,
      },
      createdBy: actor.employeeId,
    });

    return { clientId, transactionId: trxId };
  });
}

/**
 * validateScheduleTotal enforces that scheduled installments sum exactly to the
 * transaction total for Termin / Bayar di Belakang (M5 §4). Exported for
 * `renewal.ts` (R-03) — a renewal's execution needs the identical check.
 */
export function validateScheduleTotal(input: ClosingInput, total: money.Money): void {
  // `total` here is the BILLED figure — base + PPN (D-4) — because that is what
  // the client actually pays in instalments, not the tax-exclusive base.
  if (input.paymentScheme !== PAYMENT_SCHEME_TERMIN && input.paymentScheme !== PAYMENT_SCHEME_DI_BELAKANG) {
    return;
  }
  let sum = 0n;
  for (const inst of input.installments ?? []) {
    sum += money.parse(inst.amount);
  }
  if (sum !== total) {
    throw new IncompleteError();
  }
}

/** loadQualifiedForm reads the locked client draft (throws IncompleteError if absent). */
async function loadQualifiedForm(tx: Queryable, attemptId: string): Promise<QualifiedFormRow> {
  const rows = await tx<QualifiedFormRow[]>`
    select nama_pic, toko, kota, link_toko, kategori, platform, store_link,
           gmv_baseline, target_gmv, marketing_budget
    from qualified_forms where attempt_id = ${attemptId}`;
  if (rows.length === 0) {
    throw new IncompleteError();
  }
  return rows[0];
}

/**
 * loadApprovedLines returns the latest proposal version's lines, enriched with the
 * MSL name + version_no + requires_strategy_plan the closing needs.
 *
 * Enrichment has TWO sources, and the fallback is not cosmetic. A service the
 * Qualified Form never offered — added later through the negotiation editor or the
 * Edit Service door — has no `qualified_form_services` row, so joining only there
 * produced `name = ''`, `master_version_no = 0` and `requires_strategy_plan =
 * false`. That closes into a Client Record holding a NAMELESS Service whose M6
 * plan gate is silently off. So:
 *   - offered service ⇒ the version PINNED at Qualified (unchanged; that pin is
 *     what makes the deal reproducible even after the MSL is re-versioned);
 *   - added service   ⇒ the version effective when the proposal was made, which is
 *     the version the price in that proposal was computed from.
 */
async function loadApprovedLines(tx: Queryable, attemptId: string): Promise<ApprovedLine[]> {
  const rows = await tx<
    {
      master_service_id: string; proposed_price: string; commission_rule: string;
      name: string; master_version_no: number; requires_strategy_plan: boolean; plan_tier: string;
      durasi_bulan: number | null;
      durasi_dipilih: number | null;
    }[]
  >`
    select npl.master_service_id, npl.proposed_price, npl.commission_rule,
           coalesce(qfs.name, at_proposal.name, '') as name,
           coalesce(qfs.master_version_no, at_proposal.version_no, 0) as master_version_no,
           coalesce(pinned.requires_strategy_plan, at_proposal.requires_strategy_plan, false)
             as requires_strategy_plan,
           coalesce(pinned.plan_tier, at_proposal.plan_tier, 'tanpa_plan') as plan_tier,
           -- FS-6b: the CHOSEN tenor first, the catalog's only as a fallback.
           -- The order matters and is not the same as the enrichment order
           -- above: npl.durasi_bulan is what this proposal version agreed,
           -- qfs.durasi_bulan what the Qualified Form offered, and the two
           -- version columns are what the catalog would say if nobody chose.
           -- Reading the catalog first would make every FS-6 deal close at the
           -- SHORTEST tenor, because the shortest option IS the version
           -- (trg_msdo_terpendek) — silently, with no error to notice.
           coalesce(npl.durasi_bulan, qfs.durasi_bulan, pinned.durasi_bulan,
                    at_proposal.durasi_bulan) as durasi_bulan,
           -- The SAME chain minus the two catalog fallbacks. The two must not
           -- diverge: if this read only npl.durasi_bulan, a proposal version
           -- that dropped the tenor would close with a 12-month CONTRACT (the
           -- Qualified snapshot still says 12) holding a Service that accrues
           -- over the catalog's 3 — two rows born in the same transaction
           -- disagreeing about the same deal, each self-consistent.
           coalesce(npl.durasi_bulan, qfs.durasi_bulan) as durasi_dipilih
    from negotiation_proposal_lines npl
    join negotiation_proposals np on np.id = npl.proposal_id
    left join qualified_form_services qfs
           on qfs.attempt_id = np.attempt_id and qfs.master_service_id = npl.master_service_id
    left join master_service_versions pinned
           on pinned.service_id = npl.master_service_id and pinned.version_no = qfs.master_version_no
    left join lateral (
      select msv.version_no, msv.name, msv.requires_strategy_plan, msv.plan_tier, msv.durasi_bulan
      from master_service_versions msv
      where msv.service_id = npl.master_service_id
        and msv.effective_from <= (np.created_at at time zone 'Asia/Jakarta')::date
      order by msv.effective_from desc, msv.version_no desc
      limit 1
    ) at_proposal on true
    where np.attempt_id = ${attemptId}
      and np.version_no = (select max(version_no) from negotiation_proposals where attempt_id = ${attemptId})
    order by npl.id`;
  return rows.map((r) => ({
    masterServiceId: r.master_service_id, proposedPrice: r.proposed_price,
    commissionRule: r.commission_rule,
    name: r.name, versionNo: r.master_version_no, requiresStrategyPlan: r.requires_strategy_plan,
    planTier: r.plan_tier,
    durasiBulan: r.durasi_bulan === null ? null : Number(r.durasi_bulan),
    durasiDipilih: r.durasi_dipilih === null ? null : Number(r.durasi_dipilih),
  }));
}

// ---------------------------------------------------------------------------
// Storage null helpers.
// ---------------------------------------------------------------------------

function nullString(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s : null;
}

function nullDecimal(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s : null;
}

/** nullDate stores an empty optional date string as SQL NULL. */
function nullDate(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s : null;
}

/** inputAmountValue stores the passthrough amount, NULL for other modes. */
function inputAmountValue(l: ServiceLine): string | null {
  return l.mode === PRICING_PASSTHROUGH ? money.decimal(l.inputAmount) : null;
}

/** minQtyValue stores a positive min_qty, NULL when the mode has no floor/batch. */
function minQtyValue(minQty: bigint): string | null {
  return minQty > 0n ? minQty.toString() : null;
}

// ---------------------------------------------------------------------------
// Read models (M0/M1 §7, M4). Row scope is enforced by RLS (as leads.list /
// leads.get); these shape rows for the API over a service-role or user-scoped
// handle. Ports Go's module0_sales/reads.go + module1_leads/reads.go.
// ---------------------------------------------------------------------------

/** One prospect attempt in the list view (M0/M1 §7). Mirrors Go's AttemptRow. */
export interface AttemptListRow {
  id: string;
  leadId: string;
  leadName: string;
  phoneNumber: string;
  source: string;
  ownerEmployeeId: string;
  ownerNama: string;
  status: string;
  claimedAt: Date;
  createdAt: Date;
}

interface AttemptRow {
  id: string; lead_id: string; lead_name: string; phone_number: string; source: string;
  owner_employee_id: string; owner_nama: string; status: string;
  claimed_at: Date; created_at: Date;
}

function toAttemptRow(r: AttemptRow): AttemptListRow {
  return {
    id: r.id, leadId: r.lead_id, leadName: r.lead_name, phoneNumber: r.phone_number,
    source: r.source, ownerEmployeeId: r.owner_employee_id,
    ownerNama: r.owner_nama, status: r.status, claimedAt: r.claimed_at, createdAt: r.created_at,
  };
}

/**
 * listAttempts returns prospect attempts (RLS-scoped), newest first, optionally
 * narrowed to one status. Ports Go's ListAttempts: Go narrows rows to the actor
 * in SQL (`canListAttempts`), here that scoping is RLS's job — the status filter
 * is not, and it is the one the client's status tabs depend on.
 *
 * `page` (P2 §6) is the optional keyset page over `created_at desc, id desc`.
 * Absent = unbounded (internal callers keep the whole set); the request path
 * passes one.
 */
export async function listAttempts(
  sql: Queryable,
  filter: { status?: string; page?: page.PageRequest } = {},
): Promise<page.Page<AttemptListRow>> {
  const status = filter.status?.trim() ?? '';
  const b = page.sqlBounds(filter.page);
  const rows = await sql<AttemptRow[]>`
    select pa.id, pa.lead_id, l.lead_name, l.phone_number, l.source, pa.owner_employee_id,
           private.employee_display_name(pa.owner_employee_id) as owner_nama,
           pa.status, pa.claimed_at, pa.created_at
    from prospect_attempts pa
    join leads l on l.id = pa.lead_id
    where (${status} = '' or pa.status = ${status})
      and (pa.created_at, pa.id) < (${b.at}, ${b.id})
    order by pa.created_at desc, pa.id desc
    limit ${b.limit}::bigint`;
  return page.paginate(rows.map(toAttemptRow), filter.page, (r) => ({ createdAt: r.createdAt, id: r.id }));
}

/** The attempt block of the detail view — Go's AttemptCore. */
export interface AttemptCoreView {
  id: string;
  leadId: string;
  ownerEmployeeId: string;
  ownerNama: string;
  /**
   * FS-3 — rekan prospek bersama, dilihat dari attempt INI. Diisi dari dua
   * arah (attempt ini menautkan diri, atau attempt lain menautkan diri ke
   * attempt ini), karena penunjuknya hanya ada di satu baris sementara
   * keduanya sama-sama pemilik prospeknya. `null` bila bukan prospek bersama.
   */
  bersamaOwnerEmployeeId: string | null;
  bersamaOwnerNama: string | null;
  status: string;
  claimedAt: Date;
  createdAt: Date;
}

/** The lead block of the attempt detail view — Go's LeadCore. */
export interface AttemptLeadView {
  id: string;
  leadName: string;
  phoneNumber: string;
  email: string | null;
  source: string;
  recordStatus: string;
  originCampaignId: string | null;
  lastTouchCampaignId: string | null;
  winningAttemptId: string | null;
}

/**
 * One persisted Qualified-form service line (qualified_form_services joined with
 * its pricing snapshot) — Go's QFServiceView. The DECIMAL columns stay strings:
 * money never round-trips through a JS number (house rule #4/#7).
 */
export interface QualifiedFormServiceView {
  masterServiceId: string;
  masterVersionNo: number;
  name: string;
  quantity: string;
  unit: string | null;
  pricingMode: string;
  standardPrice: string;
  inputAmount: string | null;
  subtotal: string;
  commissionRule: string;
  /** FS-6b — tenor yang dipilih, atau `null` bila baris ini memakai durasi versi. */
  durasiBulan: number | null;
}

/** The locked Qualified draft carried on an attempt (M0 §4) — Go's QualifiedFormView. */
export interface AttemptQualified {
  namaPic: string;
  toko: string;
  kota: string;
  linkToko: string;
  kategori: string;
  platform: string;
  storeLink: string | null;
  gmvBaseline: string;
  targetGmv: string;
  marketingBudget: string | null;
  services: QualifiedFormServiceView[];
}

/** One line of a negotiation proposal — Go's ProposalLineView. */
export interface AttemptProposalLine {
  masterServiceId: string;
  name: string;
  proposedPrice: string;
  commissionRule: string;
  paymentTerms: string | null;
  /** FS-6b — tenor yang disepakati baris ini, atau `null`. */
  durasiBulan: number | null;
}

/** One versioned negotiation proposal with its lines — Go's ProposalView. */
export interface AttemptProposal {
  id: string;
  versionNo: number;
  proposedBy: string;
  proposedByNama: string;
  decisionNote: string | null;
  createdAt: Date;
  lines: AttemptProposalLine[];
}

/**
 * Attempt detail: the negotiation/quote view (M0 §5/§7) — Go's AttemptDetail.
 *
 * The whole proposal HISTORY is returned (version_no ASC), not just the latest:
 * the negotiation panel renders every round, and a single "current quote" cannot
 * show that a price was revised. `allowedTransitions` is what the client uses to
 * decide which action buttons exist at all — an empty list renders a dead page,
 * so it is derived from the engine's own edge table, never hardcoded.
 */
export interface AttemptDetail {
  attempt: AttemptCoreView;
  lead: AttemptLeadView;
  qualifiedForm: AttemptQualified | null;
  proposals: AttemptProposal[];
  nqReasons: string[];
  allowedTransitions: string[];
}

/**
 * getAttempt returns the full attempt detail (M0 §5/§7): the attempt, its lead,
 * the persisted Qualified-form snapshot with its service lines, the whole
 * negotiation history, the not-qualified reasons, and the engine's legal next
 * moves. Throws NotFoundError when absent. Ports Go's Service.GetAttempt.
 */
export async function getAttempt(sql: Queryable, id: string): Promise<AttemptDetail> {
  const rows = await sql<{
    id: string; lead_id: string; owner_employee_id: string; owner_nama: string;
    status: string; claimed_at: Date; created_at: Date;
    bersama_owner_employee_id: string | null; bersama_owner_nama: string | null;
  }[]>`
    select pa.id, pa.lead_id, pa.owner_employee_id,
           private.employee_display_name(pa.owner_employee_id) as owner_nama,
           pa.status, pa.claimed_at, pa.created_at,
           -- FS-3: rekan prospek bersama, DUA ARAH. Penunjuknya hanya ada di
           -- baris yang menyusul, sementara keduanya sama-sama pemilik
           -- prospeknya — jadi satu arah saja membuat sales yang mendaftarkan
           -- lead-nya lebih dulu tidak pernah melihat rekannya di form closing.
           rekan.owner_employee_id as bersama_owner_employee_id,
           private.employee_display_name(rekan.owner_employee_id) as bersama_owner_nama
    from prospect_attempts pa
    left join lateral (
      select p2.owner_employee_id
        from prospect_attempts p2
       where p2.id = pa.bersama_dengan_attempt_id
          or p2.bersama_dengan_attempt_id = pa.id
       order by p2.created_at, p2.id
       limit 1
    ) rekan on true
    where pa.id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const a = rows[0];
  const attempt: AttemptCoreView = {
    id: a.id, leadId: a.lead_id, ownerEmployeeId: a.owner_employee_id,
    ownerNama: a.owner_nama,
    bersamaOwnerEmployeeId: a.bersama_owner_employee_id,
    bersamaOwnerNama: a.bersama_owner_nama,
    status: a.status, claimedAt: a.claimed_at, createdAt: a.created_at,
  };

  // P-2 (kecepatan loading) — satu batch untuk seluruh panel attempt.
  //
  // Semuanya di-key oleh `id` attempt (atau `attempt.leadId` yang baru saja
  // dibaca), dan tak satu pun memakai baris hasil query lain: form Qualified,
  // baris layanannya, riwayat negosiasi, dan alasan Not Qualified adalah empat
  // pertanyaan terpisah atas kunci yang sama. Berurutan, panel ini membayar
  // lima round-trip sebelum baris proposal pertama pun dibaca.
  //
  // `qualified_form_services` ikut dibaca tanpa syarat: kalau tidak ada form
  // Qualified, hasilnya kosong dan diabaikan — satu query yang mungkin mubazir
  // lebih murah daripada satu round-trip ekstra yang pasti.
  const [leadRows, qfRows, svcRows, propRows, nqRows, allowed] = await Promise.all([
    sql<{
      id: string; lead_name: string; phone_number: string; email: string | null; source: string;
      record_status: string; origin_campaign_id: string | null;
      last_touch_campaign_id: string | null; winning_attempt_id: string | null;
    }[]>`
      select id, lead_name, phone_number, email, source, record_status,
             origin_campaign_id, last_touch_campaign_id, winning_attempt_id
      from leads where id = ${attempt.leadId}`,

    sql<QualifiedFormRow[]>`
      select nama_pic, toko, kota, link_toko, kategori, platform, store_link,
             gmv_baseline, target_gmv, marketing_budget
      from qualified_forms where attempt_id = ${id}`,

    sql<{
      master_service_id: string; master_version_no: number; name: string; quantity: string;
      unit: string | null; pricing_mode: string; standard_price: string;
      input_amount: string | null; subtotal: string; commission_rule: string;
      durasi_bulan: number | null;
    }[]>`
      select master_service_id, master_version_no, name, quantity, unit, pricing_mode,
             standard_price, input_amount, subtotal, commission_rule, durasi_bulan
      from qualified_form_services where attempt_id = ${id} order by id`,

    sql<{
      id: string; version_no: number; proposed_by: string; proposed_by_nama: string;
      decision_note: string | null; created_at: Date;
    }[]>`
      select np.id, np.version_no, np.proposed_by,
             private.employee_display_name(np.proposed_by) as proposed_by_nama,
             np.decision_note, np.created_at
      from negotiation_proposals np
      where np.attempt_id = ${id}
      order by np.version_no asc`,

    sql<{ reason: string }[]>`
      select reason from prospect_attempt_nq_reasons where attempt_id = ${id} order by id`,

    allowedTransitions(sql, ATTEMPT_MACHINE, attempt.status),
  ]);

  if (leadRows.length === 0) {
    // Go returns the raw sql.ErrNoRows here; the FK makes this unreachable, but a
    // 404 beats leaking a driver error if the row is ever hidden by RLS.
    throw new NotFoundError();
  }
  const l = leadRows[0];
  const lead: AttemptLeadView = {
    id: l.id, leadName: l.lead_name, phoneNumber: l.phone_number, email: l.email,
    source: l.source, recordStatus: l.record_status, originCampaignId: l.origin_campaign_id,
    lastTouchCampaignId: l.last_touch_campaign_id, winningAttemptId: l.winning_attempt_id,
  };

  let qualifiedForm: AttemptQualified | null = null;
  if (qfRows.length > 0) {
    qualifiedForm = {
      namaPic: qfRows[0].nama_pic, toko: qfRows[0].toko, kota: qfRows[0].kota,
      linkToko: qfRows[0].link_toko, kategori: qfRows[0].kategori, platform: qfRows[0].platform,
      storeLink: qfRows[0].store_link, gmvBaseline: qfRows[0].gmv_baseline,
      targetGmv: qfRows[0].target_gmv, marketingBudget: qfRows[0].marketing_budget,
      services: svcRows.map((s) => ({
        masterServiceId: s.master_service_id, masterVersionNo: s.master_version_no,
        name: s.name, quantity: s.quantity, unit: s.unit, pricingMode: s.pricing_mode,
        standardPrice: s.standard_price, inputAmount: s.input_amount, subtotal: s.subtotal,
        commissionRule: s.commission_rule,
        durasiBulan: s.durasi_bulan === null ? null : Number(s.durasi_bulan),
      })),
    };
  }

  // P-2: the proposal LINES used to be read one query per proposal — an N+1
  // whose cost grew with the length of the negotiation, which is precisely the
  // attempt a salesperson opens most often. One `any($1)` read replaces it; the
  // rows come back ordered by proposal and then by line id, so grouping them in
  // JS reproduces the per-proposal ordering the loop produced.
  const proposalIds = propRows.map((p) => p.id);
  const lineRows =
    proposalIds.length === 0
      ? []
      : await sql<{
          proposal_id: string; master_service_id: string; name: string; proposed_price: string;
          commission_rule: string; payment_terms: string | null; durasi_bulan: number | null;
        }[]>`
          select npl.proposal_id, npl.master_service_id,
                 coalesce(qfs.name, latest.name, '') as name,
                 npl.proposed_price, npl.commission_rule, npl.payment_terms, npl.durasi_bulan
          from negotiation_proposal_lines npl
          left join qualified_form_services qfs
                 on qfs.attempt_id = ${id} and qfs.master_service_id = npl.master_service_id
          -- A service ADDED during negotiation / Edit Service has no Qualified
          -- snapshot row, so its name comes from the MSL. Without this the
          -- negotiation panel renders a priced line with a blank service name.
          left join lateral (
            select msv.name from master_service_versions msv
            where msv.service_id = npl.master_service_id
            order by msv.effective_from desc, msv.version_no desc
            limit 1
          ) latest on true
          where npl.proposal_id = any(${proposalIds})
          order by npl.proposal_id, npl.id`;

  const linesByProposal = new Map<string, AttemptProposalLine[]>();
  for (const ln of lineRows) {
    const list = linesByProposal.get(ln.proposal_id) ?? [];
    list.push({
      masterServiceId: ln.master_service_id, name: ln.name, proposedPrice: ln.proposed_price,
      commissionRule: ln.commission_rule, paymentTerms: ln.payment_terms,
      durasiBulan: ln.durasi_bulan === null ? null : Number(ln.durasi_bulan),
    });
    linesByProposal.set(ln.proposal_id, list);
  }

  const proposals: AttemptProposal[] = propRows.map((p) => ({
    id: p.id, versionNo: p.version_no, proposedBy: p.proposed_by,
    proposedByNama: p.proposed_by_nama, decisionNote: p.decision_note, createdAt: p.created_at,
    lines: linesByProposal.get(p.id) ?? [],
  }));

  return {
    attempt,
    lead,
    qualifiedForm,
    proposals,
    nqReasons: nqRows.map((r) => r.reason),
    allowedTransitions: allowed,
  };
}

/** One platform snapshot on a Client Record (M4). */
export interface ClientPlatformRow {
  /** The client_platforms surrogate id — the anchor a client report is built against (C1). */
  clientPlatformId: number;
  platform: string;
  storeLink: string | null;
  managedSince: Date | null;
  active: boolean;
  /** R3 — buyer-journey stage this store is chasing, or null when unset (report.setTahapFokus). */
  tahapFokus: string | null;
}

/** One salesperson's read-only achievement share (Σ = 10000 bp). */
export interface ClientAllocationRow {
  salespersonId: string;
  salespersonNama: string;
  basisPoints: number;
}

/** One closed Service line on a Client Record. */
export interface ClientServiceRow {
  id: string;
  /** The Master Service List entry this line was priced from (MSL-). */
  masterServiceId: string;
  name: string;
  standardPrice: string;
  commissionRule: string;
  status: string;
  requiresStrategyPlan: boolean;
}

/** One installment on the client's transaction. */
export interface ClientInstallmentRow {
  id: string;
  installmentNo: number;
  amount: string;
  dueDate: Date | null;
  status: string;
  jatuhTempo: boolean;
}

/** The client's payment Transaction (TRX-) + its schedule. */
export interface ClientTransaction {
  id: string;
  paymentIntentScheme: string;
  totalAgreedValue: string;
  paymentStatus: string;
  bermasalah: boolean;
  releasedToAccountAt: Date | null;
  installments: ClientInstallmentRow[];
}

/** Client Record detail (M4 basic): the client + platforms + allocations +
 *  services + the payment transaction. */
export interface ClientDetail {
  id: string;
  leadId: string | null;
  winningAttemptId: string | null;
  namaPic: string;
  toko: string;
  kota: string;
  linkToko: string;
  kategori: string;
  gmvBaseline: string;
  targetGmv: string;
  marketingBudget: string | null;
  originCampaignId: string | null;
  salesPicId: string;
  salesPicNama: string;
  commissionPaymentPicId: string;
  paymentIntent: string | null;
  /** Σ of the closed Service prices, system-computed at closing (raw decimal). */
  totalSales: string;
  /** The linked payment Transaction's ID as stored on the client row (M4 §2). */
  transactionId: string | null;
  releasedToAccountAt: Date | null;
  createdAt: Date;
  platforms: ClientPlatformRow[];
  allocations: ClientAllocationRow[];
  services: ClientServiceRow[];
  transaction: ClientTransaction | null;
}

/**
 * getClient returns one Client Record with its platforms, sales allocation
 * snapshot, closed Services, and payment Transaction (+ installments) — the M4
 * Client Record basic view. Throws NotFoundError when absent.
 */
export async function getClient(sql: Queryable, id: string): Promise<ClientDetail> {
  const rows = await sql<
    {
      id: string; lead_id: string | null; winning_attempt_id: string | null;
      nama_pic: string; toko: string; kota: string; link_toko: string; kategori: string;
      gmv_baseline: string; target_gmv: string; marketing_budget: string | null;
      origin_campaign_id: string | null; sales_pic_id: string; sales_pic_nama: string;
      commission_payment_pic_id: string; payment_intent: string | null;
      total_sales: string; transaction_id: string | null;
      released_to_account_at: Date | null; created_at: Date;
    }[]
  >`
    select c.id, c.lead_id, c.winning_attempt_id, c.nama_pic, c.toko, c.kota, c.link_toko,
           c.kategori, c.gmv_baseline, c.target_gmv, c.marketing_budget, c.origin_campaign_id,
           c.sales_pic_id, private.employee_display_name(c.sales_pic_id) as sales_pic_nama,
           c.commission_payment_pic_id, c.payment_intent, c.total_sales, c.transaction_id,
           c.released_to_account_at, c.created_at
    from clients c
    where c.id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const c = rows[0];

  // P-2 (kecepatan loading) — platform, alokasi, layanan dan transaksi adalah
  // empat pertanyaan atas `client_id` yang sama; tak satu pun membaca baris
  // hasil query lain, jadi keempatnya berangkat bersama. Hanya `installments`
  // yang tersisa berurutan di bawah, karena ia memang butuh id transaksi yang
  // baru diketahui di sini.
  const [platRows, allocRows, svcRows, trxRows] = await Promise.all([
    sql<
      { id: string; platform: string; store_link: string | null; managed_since: Date | null; active: boolean; tahap_fokus: string | null }[]
    >`
      select id, platform, store_link, managed_since, active, tahap_fokus
      from client_platforms where client_id = ${id} order by id`,

    sql<
      { salesperson_id: string; salesperson_nama: string; basis_points: number }[]
    >`
      select csa.salesperson_id,
             private.employee_display_name(csa.salesperson_id) as salesperson_nama,
             csa.basis_points
      from client_sales_allocations csa
      where csa.client_id = ${id} order by csa.id`,

    sql<
      { id: string; master_service_id: string; name: string; standard_price: string; commission_rule: string; status: string; requires_strategy_plan: boolean }[]
    >`
      select id, master_service_id, name, standard_price, commission_rule, status, requires_strategy_plan
      from services where client_id = ${id} order by id`,

    sql<
      {
        id: string; payment_intent_scheme: string; total_agreed_value: string; payment_status: string;
        bermasalah: boolean; released_to_account_at: Date | null;
      }[]
    >`
      select id, payment_intent_scheme, total_agreed_value, payment_status, bermasalah, released_to_account_at
      from transactions where client_id = ${id} order by created_at desc, id desc limit 1`,
  ]);

  let transaction: ClientTransaction | null = null;
  if (trxRows.length > 0) {
    const t = trxRows[0];
    const instRows = await sql<
      { id: string; installment_no: number; amount: string; due_date: Date | null; status: string; jatuh_tempo: boolean }[]
    >`
      select id, installment_no, amount, due_date, status, jatuh_tempo
      from installments where transaction_id = ${t.id} order by installment_no`;
    transaction = {
      id: t.id, paymentIntentScheme: t.payment_intent_scheme, totalAgreedValue: t.total_agreed_value,
      paymentStatus: t.payment_status, bermasalah: t.bermasalah, releasedToAccountAt: t.released_to_account_at,
      installments: instRows.map((i) => ({
        id: i.id, installmentNo: i.installment_no, amount: i.amount, dueDate: i.due_date,
        status: i.status, jatuhTempo: i.jatuh_tempo,
      })),
    };
  }

  return {
    id: c.id, leadId: c.lead_id, winningAttemptId: c.winning_attempt_id, namaPic: c.nama_pic,
    toko: c.toko, kota: c.kota, linkToko: c.link_toko, kategori: c.kategori,
    gmvBaseline: c.gmv_baseline, targetGmv: c.target_gmv, marketingBudget: c.marketing_budget,
    originCampaignId: c.origin_campaign_id, salesPicId: c.sales_pic_id, salesPicNama: c.sales_pic_nama,
    commissionPaymentPicId: c.commission_payment_pic_id, paymentIntent: c.payment_intent,
    totalSales: c.total_sales, transactionId: c.transaction_id,
    releasedToAccountAt: c.released_to_account_at, createdAt: c.created_at,
    platforms: platRows.map((p) => ({
      clientPlatformId: Number(p.id), platform: p.platform, storeLink: p.store_link,
      managedSince: p.managed_since, active: p.active, tahapFokus: p.tahap_fokus,
    })),
    allocations: allocRows.map((a) => ({
      salespersonId: a.salesperson_id, salespersonNama: a.salesperson_nama, basisPoints: a.basis_points,
    })),
    services: svcRows.map((s) => ({
      id: s.id, masterServiceId: s.master_service_id, name: s.name,
      standardPrice: s.standard_price, commissionRule: s.commission_rule,
      status: s.status, requiresStrategyPlan: s.requires_strategy_plan,
    })),
    transaction,
  };
}

// Re-export narrowing helpers so handlers can classify a rejection.
export const isBlocked = statemachine.isBlocked;
export const isRoleDenied = statemachine.isRoleDenied;
