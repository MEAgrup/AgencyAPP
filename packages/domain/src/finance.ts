/**
 * Admin & Finance domain service (M5) — the verification gate between a closed
 * deal and Account starting work, ported from Go's `internal/module5_finance`.
 *
 * This slice covers the money-in path (M5 §3/§4/§5 + M0 §5 commission):
 *   - verifyPayment: Finance confirms actual receipt (amount, date, proof) against
 *     a Transaction, optionally satisfying one Installment. It appends an
 *     immutable verification EVENT (payment_verifications), drives the
 *     installment + transaction_payment machines, and — on the FIRST verification
 *     — releases the Client Record to Account (the routing gate, §5).
 *   - attachContract: records the Transaction's contract link (M5 §7), the hard
 *     gate before a Transaction may reach [Lunas].
 *   - getPaymentStatus / commissionAchievement: PURE DERIVED read-models. Amount
 *     Verified / Outstanding (§2) and commission achievement (M0 §5 "recognized
 *     only after payment is verified, on the actual paid amount") are recomputed
 *     from the immutable verification log — never stored as mutable columns
 *     (house rule #4; same precedent as M7 Daily Output / M8 ROAS).
 *
 * House rules honored here (CLAUDE.md §Non-negotiable):
 *   - payment_status / installment status written ONLY through sm_transition.
 *   - every verification, release, and contract attach appends to the audit log.
 *   - all money math via @cdps/core money (bigint) — never float.
 *   - verbatim Bahasa Indonesia `[...]` messages (M5 §3/§7).
 *
 * Deferred to their own clusters (kept out of this money-in slice): the reminder
 * dashboard + [Jatuh Tempo] scan (M5 §6, schema in 0012), the [Bermasalah]
 * dispute flow + joint SPV resolution (M5-OA-5, schema in 0012), scheme change
 * mid-flight (M5-OA-6), and the soft 7-day contract flag (M5 §7 Rule 3).
 *
 * Reference: backend/internal/module5_finance/{verify,contract,reads}.go.
 */

import { bi, money, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { computeCommission, parseCommissionRule } from './sales.js';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** The CDPS division that owns Payment Status writes (seed.sql role_mappings). */
export const FINANCE_DIVISION = 'Finance';

/** transaction_payment machine (seeded in 20260102000002_statemachine.sql). */
export const TRANSACTION_MACHINE = 'transaction_payment';
/** installment machine. */
export const INSTALLMENT_MACHINE = 'installment';

/** Transaction Payment Status values (M5 §2). */
export const PAYMENT_MENUNGGU = '[Menunggu Verifikasi]';
export const PAYMENT_SEBAGIAN = '[Terverifikasi - Sebagian]';
export const PAYMENT_LUNAS = '[Lunas]';

/** Installment status values (M5 §4). */
export const INST_BELUM = '[Belum Jatuh Tempo]';
export const INST_JATUH_TEMPO = '[Jatuh Tempo]';
export const INST_TERVERIFIKASI = '[Terverifikasi]';

/** Payment schemes (mirror sales.ts — the transaction's payment_intent_scheme). */
export const SCHEME_LUNAS = '[Bayar Penuh (Lunas)]';
export const SCHEME_SEBAGIAN = '[Bayar Sebagian]';
export const SCHEME_TERMIN = '[Termin]';
export const SCHEME_DI_BELAKANG = '[Bayar di Belakang]';

/** Schemes that carry an Installment schedule (Lunas / Bayar Sebagian do not). */
const SCHEDULED_SCHEMES = new Set<string>([SCHEME_TERMIN, SCHEME_DI_BELAKANG]);

// ---------------------------------------------------------------------------
// Verbatim BI messages (M5 §3 Rule 4, §7 Rule 2).
// ---------------------------------------------------------------------------

/** A verification would push Amount Verified past the agreed total (§3 Rule 4). */
export const MSG_OVER_VERIFICATION = '[jumlah melebihi total transaksi, periksa kembali]';
/** The contract must be attached before a Transaction may reach [Lunas] (§7 Rule 2). */
export const MSG_CONTRACT_REQUIRED = '[kontrak belum diupload, lengkapi sebelum verifikasi penuh]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'FinanceIncompleteError';
  }
}

/** Requested transaction / installment does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = 'transaction not found') {
    super(message);
    this.name = 'FinanceNotFoundError';
  }
}

/** Actor is not Admin & Finance (nor Director) — cannot write Payment Status (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'FinanceForbiddenError';
  }
}

/** A verification exceeds the agreed total (verbatim BI, → 400). */
export class OverVerificationError extends Error {
  constructor() {
    super(MSG_OVER_VERIFICATION);
    this.name = 'OverVerificationError';
  }
}

/** Full verification blocked: no contract attached yet (verbatim BI, → 409). */
export class ContractRequiredError extends Error {
  constructor() {
    super(MSG_CONTRACT_REQUIRED);
    this.name = 'ContractRequiredError';
  }
}

// ---------------------------------------------------------------------------
// Permission (M5 §8.1): only Admin & Finance (staff/lead) or Director may write
// Payment Status. Sales/Account read only; OD is read-only everywhere.
// ---------------------------------------------------------------------------

/** canVerifyPayment applies the M5 §8.1 write matrix. */
export function canVerifyPayment(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === FINANCE_DIVISION &&
    (actor.role.level === permission.LevelLead || actor.role.level === permission.LevelStaff);
}

// ---------------------------------------------------------------------------
// Loaders.
// ---------------------------------------------------------------------------

interface TransactionInfo {
  id: string;
  clientId: string;
  scheme: string;
  totalAgreed: money.Money;
  paymentStatus: string;
  contractAttachment: string | null;
  releasedToAccountAt: Date | null;
}

async function loadTransaction(tx: Queryable, id: string, forUpdate: boolean): Promise<TransactionInfo> {
  type Row = {
    id: string; client_id: string; payment_intent_scheme: string; total_agreed_value: string;
    payment_status: string; contract_attachment: string | null; released_to_account_at: Date | null;
  };
  const rows = forUpdate
    ? await tx<Row[]>`
        select id, client_id, payment_intent_scheme, total_agreed_value, payment_status,
               contract_attachment, released_to_account_at
        from transactions where id = ${id} for update`
    : await tx<Row[]>`
        select id, client_id, payment_intent_scheme, total_agreed_value, payment_status,
               contract_attachment, released_to_account_at
        from transactions where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    id: r.id, clientId: r.client_id, scheme: r.payment_intent_scheme,
    totalAgreed: money.parse(r.total_agreed_value), paymentStatus: r.payment_status,
    contractAttachment: r.contract_attachment, releasedToAccountAt: r.released_to_account_at,
  };
}

interface InstallmentInfo {
  id: string;
  transactionId: string;
  amount: money.Money;
  status: string;
}

async function loadInstallment(tx: Queryable, id: string): Promise<InstallmentInfo> {
  const rows = await tx<{ id: string; transaction_id: string; amount: string; status: string }[]>`
    select id, transaction_id, amount, status from installments where id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError('installment not found');
  }
  const r = rows[0];
  return { id: r.id, transactionId: r.transaction_id, amount: money.parse(r.amount), status: r.status };
}

/** sumVerified returns the current Amount Verified for a transaction (Σ event log). */
async function sumVerified(q: Queryable, transactionId: string): Promise<money.Money> {
  const rows = await q<{ total: string | null }[]>`
    select coalesce(sum(amount), 0)::text as total
    from payment_verifications where transaction_id = ${transactionId}`;
  return money.parse(rows[0].total ?? '0');
}

// ---------------------------------------------------------------------------
// Payment verification (transactional).
// ---------------------------------------------------------------------------

/** One verification event (M5 §3). amount is a plain IDR string (e.g. "15000000"). */
export interface VerifyInput {
  transactionId: string;
  /** required for Termin / Bayar di Belakang; must be absent for Lunas / Sebagian. */
  installmentId?: string;
  amount: string;
  receivedDate: string; // YYYY-MM-DD
  proofOfPayment?: string;
}

/** The outcome of a verification. */
export interface VerifyResult {
  transactionId: string;
  paymentStatus: string;
  amountVerified: string;
  amountOutstanding: string;
  /** true when THIS verification was the first — the client just released to Account. */
  releasedToAccount: boolean;
}

/**
 * verifyPayment records one confirmed receipt against a Transaction (M5 §3). It
 * appends an immutable verification event, marks the referenced Installment
 * [Terverifikasi] (Termin / Bayar di Belakang), rolls the transaction Payment
 * Status forward ([Menunggu Verifikasi] → [Terverifikasi - Sebagian] → [Lunas]),
 * and on the FIRST verification releases the Client Record to Account (§5) — all
 * in one transaction. Admin & Finance / Director only.
 *
 * Guards (verbatim BI): a verification may not push Amount Verified past the
 * agreed total (OverVerificationError); a Transaction may not reach [Lunas]
 * without a contract attached (ContractRequiredError, §7 Rule 2).
 */
export async function verifyPayment(
  sql: Sql,
  actor: Actor,
  input: VerifyInput,
  now: Date = new Date(),
): Promise<VerifyResult> {
  if (!canVerifyPayment(actor)) {
    throw new ForbiddenError();
  }
  const amount = parseAmount(input.amount);
  if ((input.receivedDate ?? '').trim() === '') {
    throw new IncompleteError();
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const trx = await loadTransaction(tx, input.transactionId, true);

    const scheduled = SCHEDULED_SCHEMES.has(trx.scheme);
    const installmentId = (input.installmentId ?? '').trim();
    // Scheme ↔ installment shape: scheduled schemes verify per-installment;
    // Lunas / Bayar Sebagian verify the transaction directly.
    if (scheduled && installmentId === '') {
      throw new IncompleteError();
    }
    if (!scheduled && installmentId !== '') {
      throw new IncompleteError();
    }

    let inst: InstallmentInfo | null = null;
    if (installmentId !== '') {
      inst = await loadInstallment(tx, installmentId);
      if (inst.transactionId !== trx.id) {
        throw new NotFoundError('installment not on transaction');
      }
      if (inst.status === INST_TERVERIFIKASI) {
        throw new IncompleteError(); // already verified — no double verification
      }
    }

    // Over-verification guard (§3 Rule 4): Amount Verified may not exceed total.
    const current = await sumVerified(tx, trx.id);
    const newTotal = current + amount;
    if (newTotal > trx.totalAgreed) {
      throw new OverVerificationError();
    }

    // Target Payment Status. Scheduled schemes reach [Lunas] only when EVERY
    // installment is [Terverifikasi] (§4 Rule 3); Lunas / Sebagian are amount-based.
    const target = await computeTarget(tx, trx, newTotal, inst, scheduled);

    // Contract gate (§7 Rule 2): no [Lunas] without a contract attached.
    if (target === PAYMENT_LUNAS && !trx.contractAttachment) {
      throw new ContractRequiredError();
    }

    // 1) Append the immutable verification event (one proof per event, §7 Rule 1).
    await tx`
      insert into payment_verifications
        (transaction_id, installment_id, amount, received_date, proof_of_payment, verified_by, created_by)
      values
        (${trx.id}, ${inst ? inst.id : null}, ${money.decimal(amount)}, ${input.receivedDate},
         ${nullString(input.proofOfPayment)}, ${actor.employeeId}, ${actor.employeeId})`;

    // 2) Installment → [Terverifikasi] (engine) + its verified fields.
    if (inst) {
      const r = await instTransition(ex.sm, inst.id, INST_TERVERIFIKASI, actor);
      if (!r.ok) {
        throw new NotFoundError(`installment ${inst.id} -> [Terverifikasi] failed: ${r.message}`);
      }
      await tx`
        update installments
        set verified_date = ${input.receivedDate}, verified_by = ${actor.employeeId},
            proof_of_payment = coalesce(${nullString(input.proofOfPayment)}, proof_of_payment)
        where id = ${inst.id}`;
    }

    // 3) Transaction Payment Status transition (only when it actually changes).
    if (target !== trx.paymentStatus) {
      const r = await trxTransition(ex.sm, trx.id, target, actor);
      if (!r.ok) {
        throw new NotFoundError(`transaction ${trx.id} -> ${target} failed: ${r.message}`);
      }
    }

    // 4) Routing gate (§5): the FIRST verification releases the client to Account.
    const routed = trx.paymentStatus === PAYMENT_MENUNGGU && trx.releasedToAccountAt === null;
    if (routed) {
      await tx`update clients set released_to_account_at = ${now} where id = ${trx.clientId} and released_to_account_at is null`;
      await tx`update transactions set released_to_account_at = ${now} where id = ${trx.id} and released_to_account_at is null`;
      await ex.audit.insertAudit({
        entityType: 'client', entityId: trx.clientId, actorEmployeeId: actor.employeeId,
        action: 'released_to_account', beforeJson: null,
        afterJson: { transaction_id: trx.id, trigger: 'payment_verified' }, createdBy: actor.employeeId,
      });
    }

    // 5) Audit the verification on the transaction.
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'payment_verified', beforeJson: null,
      afterJson: {
        amount: money.decimal(amount), installment_id: inst ? inst.id : null,
        amount_verified: money.decimal(newTotal), payment_status: target,
      },
      createdBy: actor.employeeId,
    });

    return {
      transactionId: trx.id,
      paymentStatus: target,
      amountVerified: money.decimal(newTotal),
      amountOutstanding: money.decimal(trx.totalAgreed - newTotal),
      releasedToAccount: routed,
    };
  });
}

/**
 * computeTarget picks the transaction's next Payment Status after a verification.
 * Scheduled schemes (Termin / Bayar di Belakang) reach [Lunas] only when every
 * installment is [Terverifikasi] (§4 Rule 3), counting the one just verified;
 * Lunas / Bayar Sebagian are amount-based (full agreed value received).
 */
async function computeTarget(
  tx: Queryable,
  trx: TransactionInfo,
  newTotal: money.Money,
  inst: InstallmentInfo | null,
  scheduled: boolean,
): Promise<string> {
  if (scheduled) {
    const verifyingId = inst ? inst.id : '';
    const rows = await tx<{ remaining: number }[]>`
      select count(*)::int as remaining
      from installments
      where transaction_id = ${trx.id} and status <> ${INST_TERVERIFIKASI} and id <> ${verifyingId}`;
    return rows[0].remaining === 0 ? PAYMENT_LUNAS : PAYMENT_SEBAGIAN;
  }
  return newTotal >= trx.totalAgreed ? PAYMENT_LUNAS : PAYMENT_SEBAGIAN;
}

/** trxTransition drives the transaction_payment machine (status col = payment_status). */
function trxTransition(
  sm: statemachine.SmExecutor,
  transactionId: string,
  to: string,
  actor: Actor,
): Promise<statemachine.TransitionResult> {
  return statemachine.transition(sm, {
    machine: TRANSACTION_MACHINE, entityType: 'transaction', table: 'transactions',
    statusColumn: 'payment_status', entityId: transactionId, to, actor,
  });
}

/** instTransition drives the installment machine (default status column). */
function instTransition(
  sm: statemachine.SmExecutor,
  installmentId: string,
  to: string,
  actor: Actor,
): Promise<statemachine.TransitionResult> {
  return statemachine.transition(sm, {
    machine: INSTALLMENT_MACHINE, entityType: 'installment', table: 'installments',
    entityId: installmentId, to, actor,
  });
}

// ---------------------------------------------------------------------------
// Contract attachment (M5 §7) — the hard gate before [Lunas].
// ---------------------------------------------------------------------------

/**
 * attachContract records the Transaction's contract link (M5 §7 Rule 1). It is
 * settable at any point ≤ full settlement and is the hard precondition for
 * reaching [Lunas] (§7 Rule 2). Admin & Finance / Director only. Attachments are
 * permanent — a new link supersedes the previous one and is audited (§7 Rule 4).
 */
export async function attachContract(sql: Sql, actor: Actor, transactionId: string, link: string): Promise<void> {
  if (!canVerifyPayment(actor)) {
    throw new ForbiddenError();
  }
  const trimmed = (link ?? '').trim();
  if (trimmed === '') {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const trx = await loadTransaction(tx, transactionId, true);
    await tx`update transactions set contract_attachment = ${trimmed} where id = ${trx.id}`;
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'contract_attached', beforeJson: { contract_attachment: trx.contractAttachment },
      afterJson: { contract_attachment: trimmed }, createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Derived read-models (recomputed from the verification log — house rule #4).
// ---------------------------------------------------------------------------

/** One verification event in the trail. */
export interface VerificationRow {
  installmentId: string | null;
  amount: string;
  receivedDate: Date;
  proofOfPayment: string | null;
  verifiedBy: string;
  createdAt: Date;
}

/** One installment in the schedule. */
export interface InstallmentRow {
  id: string;
  installmentNo: number;
  amount: string;
  dueDate: Date | null;
  status: string;
  jatuhTempo: boolean;
  verifiedDate: Date | null;
  verifiedBy: string | null;
}

/** Payment status + derived Amount Verified / Outstanding + the full trail. */
export interface PaymentStatusView {
  transactionId: string;
  clientId: string;
  scheme: string;
  paymentStatus: string;
  totalAgreedValue: string;
  amountVerified: string;
  amountOutstanding: string;
  contractAttachment: string | null;
  releasedToAccountAt: Date | null;
  installments: InstallmentRow[];
  verifications: VerificationRow[];
}

/**
 * getPaymentStatus returns the Transaction's Payment Status with Amount Verified
 * and Amount Outstanding DERIVED from the immutable verification log (§2), plus
 * the installment schedule and verification trail. Throws NotFoundError if absent.
 */
export async function getPaymentStatus(sql: Queryable, transactionId: string): Promise<PaymentStatusView> {
  const trx = await loadTransaction(sql, transactionId, false);
  const verified = await sumVerified(sql, trx.id);

  const instRows = await sql<
    {
      id: string; installment_no: number; amount: string; due_date: Date | null; status: string;
      jatuh_tempo: boolean; verified_date: Date | null; verified_by: string | null;
    }[]
  >`
    select id, installment_no, amount, due_date, status, jatuh_tempo, verified_date, verified_by
    from installments where transaction_id = ${trx.id} order by installment_no`;

  const verRows = await sql<
    {
      installment_id: string | null; amount: string; received_date: Date;
      proof_of_payment: string | null; verified_by: string; created_at: Date;
    }[]
  >`
    select installment_id, amount, received_date, proof_of_payment, verified_by, created_at
    from payment_verifications where transaction_id = ${trx.id} order by created_at, id`;

  return {
    transactionId: trx.id, clientId: trx.clientId, scheme: trx.scheme, paymentStatus: trx.paymentStatus,
    totalAgreedValue: money.decimal(trx.totalAgreed), amountVerified: money.decimal(verified),
    amountOutstanding: money.decimal(trx.totalAgreed - verified),
    contractAttachment: trx.contractAttachment, releasedToAccountAt: trx.releasedToAccountAt,
    installments: instRows.map((i) => ({
      id: i.id, installmentNo: i.installment_no, amount: i.amount, dueDate: i.due_date, status: i.status,
      jatuhTempo: i.jatuh_tempo, verifiedDate: i.verified_date, verifiedBy: i.verified_by,
    })),
    verifications: verRows.map((v) => ({
      installmentId: v.installment_id, amount: v.amount, receivedDate: v.received_date,
      proofOfPayment: v.proof_of_payment, verifiedBy: v.verified_by, createdAt: v.created_at,
    })),
  };
}

/** One salesperson's recognized commission share. */
export interface CommissionShare {
  salespersonId: string;
  basisPoints: number;
  recognizedCommission: string;
}

/** Commission achievement recognized on the actually-verified amount (M0 §5). */
export interface CommissionAchievementView {
  transactionId: string;
  clientId: string;
  totalAgreedValue: string;
  amountVerified: string;
  /** total commission of the whole deal (Σ per-service rule × agreed price). */
  totalDealCommission: string;
  /** commission recognized so far = totalDealCommission × amountVerified / totalAgreed. */
  recognizedCommission: string;
  /** per-salesperson split by allocation basis points (Σ = 10000). */
  shares: CommissionShare[];
}

/**
 * commissionAchievement DERIVES the commission recognized on a deal from the
 * verification log (M0 §5 §138: "commission achievement is recognized only after
 * client payment is verified by Finance (Amount Verified), calculated on the
 * actual paid amount"). The total deal commission (Σ each Service's rule applied
 * to its agreed price) is recognized pro-rata to Amount Verified / Total Agreed,
 * then split across the Sales Allocation snapshot (Σ = 10000 bp). Nothing is
 * stored — fully recomputable (house rule #4). Throws NotFoundError if absent.
 */
export async function commissionAchievement(sql: Queryable, transactionId: string): Promise<CommissionAchievementView> {
  const trx = await loadTransaction(sql, transactionId, false);
  const verified = await sumVerified(sql, trx.id);

  // Total deal commission = Σ over services of rule(applied to its agreed price).
  const svcRows = await sql<{ standard_price: string; commission_rule: string }[]>`
    select standard_price, commission_rule from services where client_id = ${trx.clientId}`;
  let totalCommission = 0n;
  for (const s of svcRows) {
    totalCommission += computeCommission(parseCommissionRule(s.commission_rule), money.parse(s.standard_price));
  }

  // Recognize pro-rata to the verified fraction (guard the zero-total edge).
  const recognized = trx.totalAgreed > 0n ? money.proRata(totalCommission, verified, trx.totalAgreed) : 0n;

  const allocRows = await sql<{ salesperson_id: string; basis_points: number }[]>`
    select salesperson_id, basis_points from client_sales_allocations
    where client_id = ${trx.clientId} order by id`;
  const shares: CommissionShare[] = allocRows.map((a) => ({
    salespersonId: a.salesperson_id, basisPoints: a.basis_points,
    recognizedCommission: money.decimal(money.proRata(recognized, BigInt(a.basis_points), 10000n)),
  }));

  return {
    transactionId: trx.id, clientId: trx.clientId, totalAgreedValue: money.decimal(trx.totalAgreed),
    amountVerified: money.decimal(verified), totalDealCommission: money.decimal(totalCommission),
    recognizedCommission: money.decimal(recognized), shares,
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** parseAmount parses a positive IDR amount, else IncompleteError. */
function parseAmount(s: string): money.Money {
  let amt: money.Money;
  try {
    amt = money.parse(s);
  } catch {
    throw new IncompleteError();
  }
  if (amt <= 0n) {
    throw new IncompleteError();
  }
  return amt;
}

function nullString(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s : null;
}
