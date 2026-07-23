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
 *   - Exact BI `[...]` messages: the 1..5 cap message and the house default.
 *
 * Deferred to later slices (kept out per build order): Negotiation + Closing
 * (module0_sales negotiation/closing/allocation.go) and the MSL admin CRUD
 * (internal/admin write path) — only the MSL READ needed for pricing is ported.
 *
 * Reference: backend/internal/module0_sales/{sales,pricing,commission,qualified}.go,
 * backend/internal/admin/master_service.go (EffectiveAt / ServiceView).
 */

import { bi, money, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** prospect_attempt machine (seeded in 20260102000002_statemachine.sql). */
export const ATTEMPT_MACHINE = 'prospect_attempt';

/** The CDPS division that owns prospect attempts (M0 §9.1). */
export const SALES_DIVISION = 'Sales';

/** Prospect-attempt statuses used by this slice (verbatim). */
export const STATUS_NEW_LEAD = 'New Lead';
export const STATUS_CONTACTED = 'Contacted';
export const STATUS_QUALIFIED = 'Qualified';
export const STATUS_NOT_QUALIFIED = 'Not Qualified';

/** Qualified Lead Form service cap (M0 §4.3). */
export const MAX_SERVICES = 5;

/** Exact BI message for the over-limit service selection (M0 §4.3). */
export const MSG_MAX_SERVICES = '[maksimal pilih 5 jasa saja!]';

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

// ===========================================================================
// MSL v2 "Kalkulator Service Jasa" — line-subtotal engine (pricing.go).
//
//   flat:          subtotal = qty × unit_price                         (qty ≥ 1)
//   min_floor:     subtotal = max(qty, min_qty) × unit_price
//   batch_ceiling: subtotal = ceil(qty / min_qty) × min_qty × unit_price
//   passthrough:   subtotal = input_amount (unit_price ignored)
//   apply_ppn:     subtotal += round_half_up(subtotal × 11%)
// ===========================================================================

export const PRICING_FLAT = 'flat';
export const PRICING_MIN_FLOOR = 'min_floor';
export const PRICING_BATCH_CEILING = 'batch_ceiling';
export const PRICING_PASSTHROUGH = 'passthrough';

const PRICING_MODES = new Set<string>([
  PRICING_FLAT, PRICING_MIN_FLOOR, PRICING_BATCH_CEILING, PRICING_PASSTHROUGH,
]);

/** PPN surcharge: 11% of the subtotal (money.percentOf numerator/scale). */
const PPN_NUMERATOR = 11n;
const PPN_SCALE = 0;

/** Resolved calculator inputs for one service line. */
export interface PriceParams {
  mode: string;
  unitPrice: money.Money;
  quantity: bigint;
  minQty: bigint;
  inputAmount: money.Money;
  applyPPN: boolean;
}

/**
 * computeSubtotal returns the line subtotal per the sheet formulas. Business-rule
 * violations (bad mode, qty < 1, missing min_qty, non-positive passthrough
 * amount) throw IncompleteError; an out-of-range product surfaces from money.mul.
 */
export function computeSubtotal(p: PriceParams): money.Money {
  if (!PRICING_MODES.has(p.mode)) {
    throw new IncompleteError();
  }
  if (p.mode === PRICING_PASSTHROUGH) {
    if (p.inputAmount <= 0n) {
      throw new IncompleteError();
    }
    return applyPPN(p.inputAmount, p.applyPPN);
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
  const subtotal = money.mul(p.unitPrice, effQty);
  return applyPPN(subtotal, p.applyPPN);
}

/** applyPPN adds 11% PPN (half-up to whole rupiah) when the flag is set. */
function applyPPN(subtotal: money.Money, apply: boolean): money.Money {
  if (!apply) {
    return subtotal;
  }
  return subtotal + money.percentOf(subtotal, PPN_NUMERATOR, PPN_SCALE);
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
// Commission rule grammar (commission.go). Only the two documented shapes:
//   "<N>% of standard price"   percentage of the line deal value
//   "flat Rp <N>"              fixed rupiah amount (dots = thousands separators)
// ===========================================================================

const RE_PCT = /^(\d+)(?:\.(\d+))?% of standard price$/;
const RE_FLAT = /^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$/;

/** A parsed, immutable commission rule for one service. */
export interface CommissionRule {
  raw: string;
  isFlat: boolean;
  flat: money.Money;
  pctNum: bigint;
  pctScale: number;
}

/** Thrown when a commission_rule string is not one of the two documented shapes. */
export class BadCommissionRuleError extends Error {
  constructor(rule: string) {
    super(`module0_sales: unrecognized commission_rule: ${JSON.stringify(rule)}`);
    this.name = 'BadCommissionRuleError';
  }
}

/** parseCommissionRule parses an MSL commission_rule string (DECISIONS O14). */
export function parseCommissionRule(rule: string): CommissionRule {
  const r = rule.trim();
  const pct = RE_PCT.exec(r);
  if (pct) {
    const whole = pct[1];
    const frac = pct[2] ?? '';
    return { raw: r, isFlat: false, flat: 0n, pctNum: BigInt(whole + frac), pctScale: frac.length };
  }
  const flat = RE_FLAT.exec(r);
  if (flat) {
    const digits = flat[1].replace(/\./g, ''); // dots are thousands separators
    return { raw: r, isFlat: true, flat: money.parse(digits), pctNum: 0n, pctScale: 0 };
  }
  throw new BadCommissionRuleError(rule);
}

/** computeCommission returns the commission for one service given its deal value. */
export function computeCommission(rule: CommissionRule, dealValue: money.Money): money.Money {
  if (rule.isFlat) {
    return rule.flat;
  }
  return money.percentOf(dealValue, rule.pctNum, rule.pctScale);
}

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
  applyPPN: boolean;
  rule: CommissionRule;
}

function lineParams(l: ServiceLine): PriceParams {
  return {
    mode: l.mode === '' ? PRICING_FLAT : l.mode,
    unitPrice: l.standardPrice,
    quantity: l.quantity === 0n ? 1n : l.quantity,
    minQty: l.minQty,
    inputAmount: l.inputAmount,
    applyPPN: l.applyPPN,
  };
}

/** lineSubtotal is the line deal value from the calculator. */
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
  subtotalIdr: string;
}

/** Read-only money summary for a Qualified/Closing selection. */
export interface Quote {
  lines: LineQuote[];
  estimasiNilai: money.Money;
  totalKomisi: money.Money;
  estimasiNilaiIdr: string;
  totalKomisiIdr: string;
}

/**
 * buildQuote computes Estimasi Nilai Transaksi and Perhitungan Komisi for the
 * selected services, enforcing the 1..MAX_SERVICES rule server-side. Percentage
 * commission computes on each line's subtotal (deal value); flat rules are fixed.
 */
export function buildQuote(lines: ServiceLine[]): Quote {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  if (lines.length > MAX_SERVICES) {
    throw new TooManyServicesError();
  }
  const q: Quote = { lines: [], estimasiNilai: 0n, totalKomisi: 0n, estimasiNilaiIdr: '', totalKomisiIdr: '' };
  for (const l of lines) {
    const p = lineParams(l);
    const subtotal = computeSubtotal(p);
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
  q.estimasiNilaiIdr = money.format(q.estimasiNilai);
  q.totalKomisiIdr = money.format(q.totalKomisi);
  return q;
}

// ===========================================================================
// Master Service List read (admin.EffectiveAt / ServiceView).
// ===========================================================================

/** The MSL version effective at a reference date (pricing-relevant subset). */
export interface ServiceView {
  id: string;
  name: string;
  standardPrice: string;
  commissionRule: string;
  unit: string;
  minQty: string;
  pricingMode: string;
  applyPPN: boolean;
  active: boolean;
  versionNo: number;
  effectiveFrom: string;
}

/** Thrown when no MSL version is effective at the date for a service id. */
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`master service not found: ${serviceId}`);
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * effectiveAt returns the MSL version effective on `date` (YYYY-MM-DD, WIB) for a
 * service — the latest version with effective_from ≤ date. Throws
 * ServiceNotFoundError when none applies.
 */
export async function effectiveAt(sql: Queryable, serviceId: string, date: string): Promise<ServiceView> {
  const rows = await sql<
    {
      name: string; standard_price: string; commission_rule: string;
      unit: string | null; min_qty: string | null; pricing_mode: string;
      apply_ppn: boolean; active: boolean; version_no: number; effective_from: Date;
    }[]
  >`
    select name, standard_price, commission_rule, unit, min_qty, pricing_mode,
           apply_ppn, active, version_no, effective_from
    from master_service_versions
    where service_id = ${serviceId} and effective_from <= ${date}
    order by effective_from desc, version_no desc limit 1`;
  if (rows.length === 0) {
    throw new ServiceNotFoundError(serviceId);
  }
  const r = rows[0];
  return {
    id: serviceId, name: r.name, standardPrice: r.standard_price, commissionRule: r.commission_rule,
    unit: r.unit ?? '', minQty: r.min_qty ?? '', pricingMode: r.pricing_mode, applyPPN: r.apply_ppn,
    active: r.active, versionNo: r.version_no,
    effectiveFrom: r.effective_from instanceof Date ? r.effective_from.toISOString().slice(0, 10) : String(r.effective_from),
  };
}

/**
 * lineFromView resolves an MSL version + the sales-entered quantity / passthrough
 * amount into a ServiceLine (name, unit price, commission rule and calculator
 * params pinned from the version). Passthrough requires a parseable amount > 0;
 * min_floor / batch_ceiling require a whole positive min_qty.
 */
export function lineFromView(v: ServiceView, quantity: bigint, amount: string): ServiceLine {
  const price = money.parse(v.standardPrice);
  const rule = parseCommissionRule(v.commissionRule);
  const mode = v.pricingMode === '' ? PRICING_FLAT : v.pricingMode;
  const line: ServiceLine = {
    serviceId: v.id, versionNo: v.versionNo, name: v.name, standardPrice: price,
    unit: v.unit, mode, quantity, minQty: 0n, inputAmount: 0n, applyPPN: v.applyPPN, rule,
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
    lines.push(lineFromView(v, qty, sel.amount ?? ''));
  }
  return lines;
}

/**
 * previewQuote computes a read-only quote (Estimasi Nilai + Komisi) for a set of
 * selections against the MSL version effective today, without persisting. The
 * 1..MAX_SERVICES cap is enforced by buildQuote with the verbatim BI message.
 */
export async function previewQuote(sql: Sql, selections: ServiceSelection[], now: Date = new Date()): Promise<Quote> {
  const lines = await resolveLines(sql, selections, now);
  return buildQuote(lines);
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
  const rows = forUpdate
    ? await tx<
        { id: string; lead_id: string; owner_employee_id: string; status: string; origin_division: string }[]
      >`
        select pa.id, pa.lead_id, pa.owner_employee_id, pa.status, l.origin_division
        from prospect_attempts pa join leads l on l.id = pa.lead_id
        where pa.id = ${attemptId} for update`
    : await tx<
        { id: string; lead_id: string; owner_employee_id: string; status: string; origin_division: string }[]
      >`
        select pa.id, pa.lead_id, pa.owner_employee_id, pa.status, l.origin_division
        from prospect_attempts pa join leads l on l.id = pa.lead_id
        where pa.id = ${attemptId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return { id: r.id, leadId: r.lead_id, ownerId: r.owner_employee_id, status: r.status, originDivision: r.origin_division };
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
      await tx`
        insert into qualified_form_services
          (attempt_id, master_service_id, master_version_no, name, standard_price, commission_rule,
           quantity, input_amount, unit, min_qty, pricing_mode, apply_ppn, subtotal, created_by)
        values
          (${attemptId}, ${l.serviceId}, ${l.versionNo}, ${l.name}, ${money.decimal(l.standardPrice)},
           ${l.rule.raw}, ${p.quantity.toString()}, ${inputAmountValue(l)}, ${nullString(l.unit)},
           ${minQtyValue(l.minQty)}, ${l.mode}, ${l.applyPPN}, ${money.decimal(subtotal)}, ${actor.employeeId})`;
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

// ---------------------------------------------------------------------------
// Storage null helpers.
// ---------------------------------------------------------------------------

function nullString(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s : null;
}

function nullDecimal(s: string | undefined): string | null {
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

// Re-export narrowing helpers so handlers can classify a rejection.
export const isBlocked = statemachine.isBlocked;
export const isRoleDenied = statemachine.isRoleDenied;
