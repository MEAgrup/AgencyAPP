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

import { bi, money, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { computeCommission, parseCommissionRule } from './sales';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** The CDPS division that owns Payment Status writes (seed.sql role_mappings). */
export const FINANCE_DIVISION = 'Finance';

/** transaction_payment machine (seeded in 20260723055732_statemachine.sql). */
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

/** A new installment schedule does not sum to the agreed total (verbatim BI, → 400). */
export const MSG_SCHEDULE_TOTAL = '[total termin tidak sama dengan nilai transaksi]';
export class ScheduleTotalError extends Error {
  constructor() {
    super(MSG_SCHEDULE_TOTAL);
    this.name = 'ScheduleTotalError';
  }
}

/**
 * A collection schedule was requested for a Transaction with nothing left to
 * collect (Amount Outstanding = 0) → 409. New BI string: the PRD never described
 * this surface (see scheduleOutstanding), and `[total termin tidak sama…]` would
 * misname the problem — there is no shortfall at all, so no amount could pass.
 */
export const MSG_NO_OUTSTANDING = '[tidak ada kekurangan pembayaran pada transaksi ini]';
export class NoOutstandingError extends Error {
  constructor() {
    super(MSG_NO_OUTSTANDING);
    this.name = 'NoOutstandingError';
  }
}

/**
 * A collection schedule does not sum to Amount Outstanding (verbatim-style BI,
 * → 400). Deliberately NOT MSG_SCHEDULE_TOTAL: that one compares against the
 * agreed TOTAL, and telling Finance "total termin tidak sama dengan nilai
 * transaksi" while they are scheduling only the REMAINDER sends them to fix the
 * wrong number.
 */
export const MSG_OUTSTANDING_TOTAL = '[total jadwal penagihan tidak sama dengan kekurangan pembayaran]';
export class OutstandingTotalError extends Error {
  constructor() {
    super(MSG_OUTSTANDING_TOTAL);
    this.name = 'OutstandingTotalError';
  }
}

/**
 * A scheme change was attempted after money already came in. Scheme change is a
 * pre-verification edit only (see changeScheme) — once a payment is verified the
 * schedule is locked. Reuses the verbatim engine BI (→ 409).
 */
export class SchemeLockedError extends Error {
  constructor() {
    super(bi.TRANSITION_NOT_ALLOWED);
    this.name = 'SchemeLockedError';
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

/** The Account division (SPV Account co-approves [Bermasalah] resolution, M5-OA-5). */
export const ACCOUNT_DIVISION = 'Account';

/** canManageScheme: scheme change needs SPV/Head Finance or Director (M5-OA-6). */
export function canManageScheme(actor: Actor): boolean {
  return actor.role.director ||
    (actor.role.division === FINANCE_DIVISION && actor.role.level === permission.LevelLead);
}

/**
 * canVoteBermasalah: only SPV Finance / SPV Account (lead level of their
 * division) or Director may vote on a [Bermasalah] resolution (M5-OA-5).
 */
export function canVoteBermasalah(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.level === permission.LevelLead &&
    (actor.role.division === FINANCE_DIVISION || actor.role.division === ACCOUNT_DIVISION);
}

/**
 * SYSTEM drives the reminder scan's automatic installment overdue transitions.
 * Director authority passes any role gate; the audit records SYSTEM as actor.
 */
const SYSTEM_ACTOR: Actor = { employeeId: 'SYSTEM', role: permission.makeRole({ director: true }) };

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

/** Σ verified against ONE installment — how much of its own amount is covered. */
async function sumVerifiedForInstallment(q: Queryable, installmentId: string): Promise<money.Money> {
  const rows = await q<{ total: string | null }[]>`
    select coalesce(sum(amount), 0)::text as total
    from payment_verifications where installment_id = ${installmentId}`;
  return money.parse(rows[0].total ?? '0');
}

// ---------------------------------------------------------------------------
// Payment verification (transactional).
// ---------------------------------------------------------------------------

/** One verification event (M5 §3). amount is a plain IDR string (e.g. "15000000"). */
export interface VerifyInput {
  transactionId: string;
  /** required while the Transaction has an OPEN installment; empty otherwise. */
  installmentId?: string;
  amount: string;
  receivedDate: string; // YYYY-MM-DD
  proofOfPayment?: string;
  /**
   * Optional contract link recorded in the SAME transaction as the verification
   * (M5 §7 Rule 1). The contract is the hard gate before [Lunas] (§7 Rule 2), so
   * Finance used to have to remember a second, separate action before the
   * verification that settles a deal could be accepted at all — and the page
   * offered no hint that the two were connected. Attaching it here makes "money
   * in + paperwork in" one atomic step: if the verification rolls back, the
   * contract link does not survive on its own.
   */
  contractAttachment?: string;
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
    // Installment shape is decided by what the Transaction ACTUALLY carries, not
    // by its declared scheme: Finance may schedule the collection of a shortfall
    // on a Lunas / Bayar Sebagian deal (scheduleOutstanding), and those rows have
    // to be verifiable one by one like any other installment. A scheduled scheme
    // still may not be verified before its schedule exists (§4 Rule 3).
    const counts = await tx<{ total: number; open: number }[]>`
      select count(*)::int as total,
             count(*) filter (where status <> ${INST_TERVERIFIKASI})::int as open
      from installments where transaction_id = ${trx.id}`;
    if (scheduled && counts[0].total === 0) {
      throw new IncompleteError();
    }
    if (counts[0].open > 0 && installmentId === '') {
      throw new IncompleteError();
    }
    if (counts[0].open === 0 && installmentId !== '') {
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

    // An installment is only settled once its OWN amount is covered (§8.4
    // "Amount … must sum to Total Agreed Value"). A short payment against an
    // installment used to mark it [Terverifikasi] in full, which silently erased
    // the shortfall from the schedule and from the reminder dashboard.
    const instVerified = inst ? await sumVerifiedForInstallment(tx, inst.id) : 0n;
    const instSettled = inst !== null && instVerified + amount >= inst.amount;

    // Contract link recorded in the same transaction, BEFORE the [Lunas] gate is
    // evaluated — so one submit can carry both the paperwork and the payment that
    // needs it.
    const contractLink = nullString(input.contractAttachment);
    if (contractLink !== null && contractLink !== trx.contractAttachment) {
      await tx`update transactions set contract_attachment = ${contractLink} where id = ${trx.id}`;
      await ex.audit.insertAudit({
        entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
        action: 'contract_attached', beforeJson: { contract_attachment: trx.contractAttachment },
        afterJson: { contract_attachment: contractLink, via: 'verify' }, createdBy: actor.employeeId,
      });
      trx.contractAttachment = contractLink;
    }

    // Target Payment Status. Scheduled schemes reach [Lunas] only when EVERY
    // installment is [Terverifikasi] (§4 Rule 3); Lunas / Sebagian are amount-based.
    const target = await computeTarget(tx, trx, newTotal, instSettled ? inst : null, scheduled);

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

    // 2) Installment → [Terverifikasi] (engine) + its verified fields, but ONLY
    //    once its own amount is fully covered. A short payment leaves the row
    //    open (and still overdue if it was) so the remainder keeps surfacing.
    if (inst && instSettled) {
      const r = await instTransition(ex.sm, inst.id, INST_TERVERIFIKASI, actor);
      if (!r.ok) {
        throw new NotFoundError(`installment ${inst.id} -> [Terverifikasi] failed: ${r.message}`);
      }
      await tx`
        update installments
        set verified_date = ${input.receivedDate}, verified_by = ${actor.employeeId},
            proof_of_payment = coalesce(${nullString(input.proofOfPayment)}, proof_of_payment),
            jatuh_tempo = false
        where id = ${inst.id}`;
    } else if (inst) {
      await tx`
        update installments
        set proof_of_payment = coalesce(${nullString(input.proofOfPayment)}, proof_of_payment)
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
        installment_settled: inst ? instSettled : null,
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
  /**
   * Σ verified against THIS installment, derived from the verification log
   * (house rule #4). Needed because a short payment no longer settles a row: the
   * page has to be able to show "Rp 1jt of Rp 3jt received" instead of silently
   * rendering an open installment that already has money against it.
   */
  amountVerified: string;
  dueDate: Date | null;
  status: string;
  jatuhTempo: boolean;
  verifiedDate: Date | null;
  verifiedBy: string | null;
  /**
   * Proof-of-payment link recorded at verification. Present because the wire
   * shape web-internal consumes carries `proof_of_payment` (Go instViews) — it
   * was missing here, so every installment the FE rendered had an undefined
   * proof column.
   */
  proofOfPayment: string | null;
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

  const instRows = await selectInstallments(sql, trx.id);

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
    installments: instRows.map(toInstallmentRow),
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
  // A voided Service (M4-OA-5) is excluded — no commission accrues for work that
  // will not be delivered (the Transaction total itself stays immutable).
  const svcRows = await sql<{ standard_price: string; commission_rule: string }[]>`
    select standard_price, commission_rule from services
    where client_id = ${trx.clientId} and status <> '[Cancelled — Service Voided]'`;
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
// Reminder scan + dashboard (M5 §6) + soft 7-day contract flag (§7 Rule 3).
//
// The scan is a batch job (nightly / on demand): it drives the automatic
// installment [Belum Jatuh Tempo] → [Jatuh Tempo] transitions and fires the
// FROZEN catalog events (m0m5.installment.due, m5.contract.not_received) exactly
// once per lapse, guarded by the fire-once columns from migration 0012. The
// [Jatuh Tempo] boolean flag mirrors the status waypoint (set here, cleared on
// verification) — reconciling PRD §2 ("parallel flag") with STATE_MACHINES §5
// ("[Jatuh Tempo]" status): the status is the lifecycle waypoint, the boolean is
// its denormalized "currently overdue" mirror; both move together.
// ---------------------------------------------------------------------------

/** Upcoming-reminder horizon (M5 §6 "within N days") — mirrors the H-3 fire-once. */
export const REMINDER_HORIZON_DAYS = 3;
/** Soft contract expectation window (M5 §7 Rule 3 / M5-OA-3). */
export const CONTRACT_GRACE_DAYS = 7;

/** What one scan pass did (fire-once, so re-running is a no-op). */
export interface ScanSummary {
  markedOverdue: number;
  overdueNotified: number;
  upcomingNotified: number;
  contractFlagged: number;
}

/**
 * scanReminders drives the reminder lifecycle (M5 §6 / §7 Rule 3) in one
 * transaction: unverified installments past due move [Belum Jatuh Tempo] →
 * [Jatuh Tempo] (+ the overdue notification, once); installments due within the
 * horizon fire an upcoming reminder (once); Transactions routed to Account > 7
 * days ago without a contract raise the soft contract flag (+ notification,
 * once). Idempotent — every effect is guarded by a fire-once column (0012).
 */
export async function scanReminders(sql: Sql, now: Date = new Date()): Promise<ScanSummary> {
  const today = tz.dateString(now); // WIB calendar date (O20)
  const summary: ScanSummary = { markedOverdue: 0, overdueNotified: 0, upcomingNotified: 0, contractFlagged: 0 };

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);

    // 1) Overdue: [Belum Jatuh Tempo] with due_date < today → [Jatuh Tempo].
    const overdue = await tx<
      { id: string; transaction_id: string; sales_pic_id: string; overdue_notified_at: Date | null }[]
    >`
      select i.id, i.transaction_id, c.sales_pic_id, i.overdue_notified_at
      from installments i
      join transactions t on t.id = i.transaction_id
      join clients c on c.id = t.client_id
      where i.status = ${INST_BELUM} and i.due_date is not null and i.due_date < ${today}::date
      order by i.due_date, i.id
      for update of i`;
    for (const row of overdue) {
      const r = await instTransition(ex.sm, row.id, INST_JATUH_TEMPO, SYSTEM_ACTOR);
      if (!r.ok) {
        throw new NotFoundError(`installment ${row.id} -> [Jatuh Tempo] failed: ${r.message}`);
      }
      await tx`update installments set jatuh_tempo = true where id = ${row.id}`;
      summary.markedOverdue++;
      if (row.overdue_notified_at === null) {
        await notification.emit(ex.notify, {
          event: notification.EVENTS.InstallmentDue,
          entityType: 'installment', entityId: row.id, actor: 'SYSTEM',
          division: FINANCE_DIVISION, explicitRecipients: [row.sales_pic_id], notifyActor: false,
          deepLink: `/transactions/${row.transaction_id}`,
        });
        await tx`update installments set overdue_notified_at = ${now} where id = ${row.id}`;
        summary.overdueNotified++;
      }
    }

    // 2) Upcoming (H-N): [Belum Jatuh Tempo], due within the horizon, not yet sent.
    const upcoming = await tx<{ id: string; transaction_id: string; sales_pic_id: string }[]>`
      select i.id, i.transaction_id, c.sales_pic_id
      from installments i
      join transactions t on t.id = i.transaction_id
      join clients c on c.id = t.client_id
      where i.status = ${INST_BELUM} and i.reminder_h3_sent_at is null and i.due_date is not null
        and i.due_date >= ${today}::date
        and i.due_date <= (${today}::date + ${REMINDER_HORIZON_DAYS}::int)
      order by i.due_date, i.id
      for update of i`;
    for (const row of upcoming) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.InstallmentDue,
        entityType: 'installment', entityId: row.id, actor: 'SYSTEM',
        division: FINANCE_DIVISION, explicitRecipients: [row.sales_pic_id], notifyActor: false,
        deepLink: `/transactions/${row.transaction_id}`,
      });
      await tx`update installments set reminder_h3_sent_at = ${now} where id = ${row.id}`;
      summary.upcomingNotified++;
    }

    // 3) Soft 7-day contract flag: routed > grace days ago, no contract, not flagged.
    const contract = await tx<{ id: string }[]>`
      select id from transactions
      where released_to_account_at is not null and contract_attachment is null
        and contract_overdue_flagged_at is null
        and released_to_account_at < ${now}::timestamptz - (${CONTRACT_GRACE_DAYS}::int * interval '1 day')
      order by id
      for update`;
    for (const row of contract) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.ContractNotReceived,
        entityType: 'transaction', entityId: row.id, actor: 'SYSTEM',
        division: FINANCE_DIVISION, notifyActor: false, deepLink: `/transactions/${row.id}`,
      });
      await tx`update transactions set contract_overdue_flagged_at = ${now} where id = ${row.id}`;
      summary.contractFlagged++;
    }

    return summary;
  });
}

/** One overdue / upcoming installment on the reminder dashboard (M5 §6). */
export interface ReminderRow {
  installmentId: string;
  transactionId: string;
  clientId: string;
  toko: string;
  installmentNo: number;
  amount: string;
  dueDate: Date;
  daysOverdue: number;
  salesPicId: string;
  status: string;
  /** overdue rows only: `[jatuh tempo X hari, segera tindak lanjuti]` (§6 flow 2). */
  label: string;
}

/** One open-ended Bayar Sebagian remainder (no due date — §6 Rule 4). */
export interface OutstandingRow {
  transactionId: string;
  clientId: string;
  toko: string;
  amountOutstanding: string;
  salesPicId: string;
}

/** The reminder dashboard (M5 §6): overdue-first, upcoming, and the no-due list. */
export interface ReminderDashboard {
  overdue: ReminderRow[];
  upcoming: ReminderRow[];
  outstandingNoDueDate: OutstandingRow[];
}

/** overdueLabel renders the §6 flow-2 Bahasa Indonesia overdue prompt. */
export function overdueLabel(daysOverdue: number): string {
  return `[jatuh tempo ${daysOverdue} hari, segera tindak lanjuti]`;
}

/**
 * reminderDashboard is a PURE READ (M5 §6): every unverified installment with a
 * due date that is overdue (most-overdue first) or upcoming within the horizon,
 * plus the open-ended "Outstanding, No Due Date" list (Bayar Sebagian remainders
 * that have at least one payment but no schedule — §6 Rule 4). Days overdue and
 * the BI label are derived, never stored.
 */
export async function reminderDashboard(sql: Queryable, now: Date = new Date()): Promise<ReminderDashboard> {
  const today = tz.date(now);
  const todayStr = tz.dateString(now);

  const rows = await sql<
    {
      id: string; transaction_id: string; client_id: string; toko: string; installment_no: number;
      amount: string; due_date: Date; status: string; sales_pic_id: string;
    }[]
  >`
    select i.id, i.transaction_id, t.client_id, c.toko, i.installment_no, i.amount, i.due_date,
           i.status, c.sales_pic_id
    from installments i
    join transactions t on t.id = i.transaction_id
    join clients c on c.id = t.client_id
    where i.status <> ${INST_TERVERIFIKASI} and i.due_date is not null
      and i.due_date <= (${todayStr}::date + ${REMINDER_HORIZON_DAYS}::int)
    order by i.due_date, i.id`;

  const overdue: ReminderRow[] = [];
  const upcoming: ReminderRow[] = [];
  for (const r of rows) {
    const daysOverdue = tz.daysBetween(r.due_date, today);
    const base: ReminderRow = {
      installmentId: r.id, transactionId: r.transaction_id, clientId: r.client_id, toko: r.toko,
      installmentNo: r.installment_no, amount: r.amount, dueDate: r.due_date, daysOverdue,
      salesPicId: r.sales_pic_id, status: r.status, label: '',
    };
    if (daysOverdue > 0) {
      overdue.push({ ...base, label: overdueLabel(daysOverdue) });
    } else {
      upcoming.push(base);
    }
  }
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue); // most overdue first

  // Outstanding, no-due-date: Bayar Sebagian with a payment in but not settled —
  // and no scheduled claim on the remainder yet. Once Finance dates the shortfall
  // (scheduleOutstanding) the row belongs to the reminder lists above instead, so
  // the same money is never chased from two places.
  const outRows = await sql<
    { id: string; client_id: string; toko: string; total_agreed_value: string; verified: string | null; sales_pic_id: string }[]
  >`
    select t.id, t.client_id, c.toko, t.total_agreed_value, c.sales_pic_id,
           (select coalesce(sum(pv.amount), 0)::text from payment_verifications pv where pv.transaction_id = t.id) as verified
    from transactions t
    join clients c on c.id = t.client_id
    where t.payment_intent_scheme = ${SCHEME_SEBAGIAN} and t.payment_status = ${PAYMENT_SEBAGIAN}
      and not exists (
        select 1 from installments i
        where i.transaction_id = t.id and i.status <> ${INST_TERVERIFIKASI})
    order by t.id`;
  const outstandingNoDueDate: OutstandingRow[] = outRows.map((r) => ({
    transactionId: r.id, clientId: r.client_id, toko: r.toko,
    amountOutstanding: money.decimal(money.parse(r.total_agreed_value) - money.parse(r.verified ?? '0')),
    salesPicId: r.sales_pic_id,
  }));

  return { overdue, upcoming, outstandingNoDueDate };
}

// ---------------------------------------------------------------------------
// [Bermasalah] dispute flag + joint-resolution voting (M5 §5 Rule 5 / M5-OA-5).
// ---------------------------------------------------------------------------

/** A vote's decision on a [Bermasalah] cycle. */
export const VOTE_APPROVE = 'approve';
export const VOTE_REJECT = 'reject';
const VOTE_VALUES = new Set<string>([VOTE_APPROVE, VOTE_REJECT]);

/**
 * flagBermasalah raises the [Bermasalah] override flag on a Transaction (M5 §5
 * Rule 5): a verified payment was disputed/reversed. This does NOT change Payment
 * Status nor auto-pull work from Account — it opens a joint-resolution cycle
 * (M5-OA-5). A re-flag after a prior resolution starts a fresh cycle (0012).
 * Admin & Finance / Director only; a reason is mandatory.
 */
export async function flagBermasalah(sql: Sql, actor: Actor, transactionId: string, note: string): Promise<void> {
  if (!canVerifyPayment(actor)) {
    throw new ForbiddenError();
  }
  const reason = (note ?? '').trim();
  if (reason === '') {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const trx = await loadTransaction(tx, transactionId, true);
    await tx`update transactions set bermasalah = true, bermasalah_flagged_at = ${new Date()} where id = ${trx.id}`;
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'bermasalah_flagged', beforeJson: { bermasalah: trx.paymentStatus },
      afterJson: { bermasalah: true, note: reason }, createdBy: actor.employeeId,
    });
  });
}

/** The outcome of a [Bermasalah] vote. */
export interface BermasalahVoteResult {
  resolved: boolean;
}

/**
 * resolveBermasalah records one SPV Finance / SPV Account / Director vote on the
 * current [Bermasalah] cycle (M5-OA-5). The flag clears (resolved) when BOTH SPV
 * divisions have approved in this cycle, or when a Director approves (final
 * authority / escalation). Votes are append-only (transaction_issue_approvals);
 * only votes cast since the current bermasalah_flagged_at count.
 */
export async function resolveBermasalah(
  sql: Sql,
  actor: Actor,
  transactionId: string,
  decision: string,
  note = '',
): Promise<BermasalahVoteResult> {
  if (!canVoteBermasalah(actor)) {
    throw new ForbiddenError();
  }
  if (!VOTE_VALUES.has(decision)) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ bermasalah: boolean; bermasalah_flagged_at: Date | null }[]>`
      select bermasalah, bermasalah_flagged_at from transactions where id = ${transactionId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    if (!rows[0].bermasalah || rows[0].bermasalah_flagged_at === null) {
      throw new IncompleteError(); // nothing to resolve — not currently flagged
    }
    const flaggedAt = rows[0].bermasalah_flagged_at;
    // 'Director' (not the actor's real division, and not 'Management') — the
    // literal bermasalahStatus keys directorVote on, matching Go. See
    // DIRECTOR_VOTE_DIVISION for why this changed.
    const division = actor.role.director ? DIRECTOR_VOTE_DIVISION : actor.role.division;

    await tx`
      insert into transaction_issue_approvals (transaction_id, division, decision, note, created_by)
      values (${transactionId}, ${division}, ${decision}, ${nullString(note)}, ${actor.employeeId})`;

    // Resolution: a Director approval is final; otherwise both SPV divisions must
    // have approved in the current cycle.
    let resolved = actor.role.director && decision === VOTE_APPROVE;
    if (!resolved) {
      const latest = await tx<{ division: string; decision: string }[]>`
        select distinct on (division) division, decision
        from transaction_issue_approvals
        where transaction_id = ${transactionId} and created_at >= ${flaggedAt}
          and division in (${FINANCE_DIVISION}, ${ACCOUNT_DIVISION})
        order by division, created_at desc`;
      const approved = new Set(latest.filter((v) => v.decision === VOTE_APPROVE).map((v) => v.division));
      resolved = approved.has(FINANCE_DIVISION) && approved.has(ACCOUNT_DIVISION);
    }

    if (resolved) {
      await tx`update transactions set bermasalah = false where id = ${transactionId}`;
    }
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: transactionId, actorEmployeeId: actor.employeeId,
      action: 'bermasalah_vote', beforeJson: null,
      afterJson: { division, decision, note, resolved }, createdBy: actor.employeeId,
    });
    return { resolved };
  });
}

// ---------------------------------------------------------------------------
// Scheme change (M5 §4 Rule 5 / M5-OA-6) — pre-verification edit only.
// ---------------------------------------------------------------------------

/** One installment of a replacement schedule. */
export interface ScheduleInput {
  amount: string;
  dueDate: string; // YYYY-MM-DD
}

/**
 * changeScheme switches a Transaction's Payment Intent scheme with a logged
 * reason (M5 §4 Rule 5 / M5-OA-6) — never deleting the Transaction. It requires
 * SPV/Head Finance or Director, and is a PRE-VERIFICATION edit only: once any
 * payment is verified the schedule is locked (SchemeLockedError) because
 * reconciling verified installments against a new schedule is out of scope. A
 * scheduled scheme must carry a schedule summing to the agreed total
 * (ScheduleTotalError); Lunas / Bayar Sebagian carry none.
 */
export async function changeScheme(
  sql: Sql,
  actor: Actor,
  transactionId: string,
  newScheme: string,
  reason: string,
  schedule: ScheduleInput[] = [],
  now: Date = new Date(),
): Promise<void> {
  if (!canManageScheme(actor)) {
    throw new ForbiddenError();
  }
  const why = (reason ?? '').trim();
  if (why === '' || !PAYMENT_SCHEMES_VALID.has(newScheme)) {
    throw new IncompleteError();
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const trx = await loadTransaction(tx, transactionId, true);

    // Pre-verification only: any money in locks the scheme.
    const verified = await sumVerified(tx, trx.id);
    if (verified > 0n || trx.paymentStatus !== PAYMENT_MENUNGGU) {
      throw new SchemeLockedError();
    }

    const scheduled = SCHEDULED_SCHEMES.has(newScheme);
    validateSchedule(newScheme, scheduled, schedule, trx.totalAgreed);

    // Replace the (all-unverified) installment schedule.
    await tx`delete from installments where transaction_id = ${trx.id}`;
    for (let i = 0; i < schedule.length; i++) {
      const instId = await ex.ident.identNext('INST', now);
      await tx`
        insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
        values (${instId}, ${trx.id}, ${i + 1}, ${money.decimal(money.parse(schedule[i].amount))},
                ${schedule[i].dueDate}, ${INST_BELUM}, ${actor.employeeId})`;
    }

    await tx`update transactions set payment_intent_scheme = ${newScheme} where id = ${trx.id}`;
    await tx`update clients set payment_intent = ${newScheme} where id = ${trx.clientId}`;
    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'scheme_changed', beforeJson: { payment_intent_scheme: trx.scheme },
      afterJson: { payment_intent_scheme: newScheme, installments: schedule.length, reason: why },
      createdBy: actor.employeeId,
    });
  });
}

/** All four valid payment schemes. */
const PAYMENT_SCHEMES_VALID = new Set<string>([SCHEME_LUNAS, SCHEME_SEBAGIAN, SCHEME_TERMIN, SCHEME_DI_BELAKANG]);

/** validateSchedule enforces the scheme ↔ schedule shape + Σ = total (M5 §4). */
function validateSchedule(scheme: string, scheduled: boolean, schedule: ScheduleInput[], total: money.Money): void {
  if (!scheduled) {
    if (schedule.length !== 0) {
      throw new IncompleteError();
    }
    return;
  }
  if (scheme === SCHEME_DI_BELAKANG && schedule.length !== 1) {
    throw new IncompleteError(); // post-paid = exactly one installment (M0 §6 / M5 §4)
  }
  if (schedule.length === 0) {
    throw new IncompleteError();
  }
  let sum = 0n;
  for (const s of schedule) {
    let amt: money.Money;
    try {
      amt = money.parse(s.amount);
    } catch {
      throw new IncompleteError();
    }
    if (amt <= 0n || (s.dueDate ?? '').trim() === '') {
      throw new IncompleteError();
    }
    sum += amt;
  }
  if (sum !== total) {
    throw new ScheduleTotalError();
  }
}

// ---------------------------------------------------------------------------
// M5 §8.1 read models: the finance queue + the Transaction aggregate (O41).
//
// VISIBILITY IS ENFORCED TWICE, ON PURPOSE. RLS (`transactions_select`) is the
// outer net; the predicate below is the app-layer port of Go's `trxVisibility`,
// per the O37 decision ("RLS fondasi + gate app-layer endpoint"). Two arms of
// Go's rule are NOT expressible in the current policy, which is why the
// app-layer copy exists rather than leaning on RLS alone:
//
//   - Account may read a Transaction only AFTER release (M5 §5 Rule 2);
//     `transactions_select` has no such arm, so an assigned AM would otherwise
//     see pre-verification money.
//   - a bare role gate must 403, not silently return an empty list — RLS alone
//     turns "not allowed" into "nothing here", which reads as a data bug.
//
// One divergence is deliberately NOT papered over here: Go let a **Sales Lead**
// see every sales client's transaction, while `transactions_select` grants only
// per-person ownership. That makes the TS stack NARROWER than Go, never wider.
// Loosening it is an RLS change with a security blast radius, so it is logged as
// an open question instead of being decided inside a read model.
// ---------------------------------------------------------------------------

/** The Sales division (owns the pre-verification side of a Transaction). */
export const SALES_DIVISION = 'Sales';

/**
 * canReadFinanceQueue gates GET /finance/queue (M5 §8.1): Finance at any level,
 * OD, or Director. Everyone else gets 403 — the queue is Finance's worklist, not
 * a general report.
 */
export function canReadFinanceQueue(actor: Actor): boolean {
  return actor.role.director || actor.role.od || actor.role.division === FINANCE_DIVISION;
}

/**
 * canReadTransaction is the role half of Go's `trxVisibility`: which divisions
 * have Module 5 read access at all. The ROW half (which transactions of that
 * division) is applied per query — see accountReleasedOnly.
 */
export function canReadTransaction(actor: Actor): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  const d = actor.role.division;
  return d === FINANCE_DIVISION || d === SALES_DIVISION || d === ACCOUNT_DIVISION;
}

/**
 * Account sees Payment Status only once the Client Record has been released to
 * them (M5 §5 Rule 2) — pre-verification transactions stay invisible even for
 * the assigned AM. Director/OD/Finance/Sales are unaffected.
 */
function accountReleasedOnly(actor: Actor): boolean {
  return !actor.role.director && !actor.role.od && actor.role.division === ACCOUNT_DIVISION;
}

/** The Transaction aggregate M5 read endpoints return (Go TransactionRecord). */
export interface TransactionAggregate {
  id: string;
  clientId: string;
  scheme: string;
  totalAgreedValue: string;
  amountVerified: string;
  amountOutstanding: string;
  paymentStatus: string;
  bermasalah: boolean;
  contractAttachment: string | null;
  releasedToAccountAt: Date | null;
  installments: InstallmentRow[];
}

/** Raw transactions row shared by the queue and single-transaction reads. */
interface TransactionDbRow {
  id: string;
  client_id: string;
  payment_intent_scheme: string;
  total_agreed_value: string;
  payment_status: string;
  bermasalah: boolean;
  contract_attachment: string | null;
  released_to_account_at: Date | null;
}

/** Raw installments row (column list kept identical across every read). */
interface InstallmentDbRow {
  id: string;
  installment_no: number;
  amount: string;
  amount_verified: string;
  due_date: Date | null;
  status: string;
  jatuh_tempo: boolean;
  verified_date: Date | null;
  verified_by: string | null;
  proof_of_payment: string | null;
}

function toInstallmentRow(i: InstallmentDbRow): InstallmentRow {
  return {
    id: i.id, installmentNo: i.installment_no, amount: i.amount,
    amountVerified: i.amount_verified, dueDate: i.due_date,
    status: i.status, jatuhTempo: i.jatuh_tempo, verifiedDate: i.verified_date,
    verifiedBy: i.verified_by, proofOfPayment: i.proof_of_payment,
  };
}

/**
 * The one installment projection every M5 read uses. `amount_verified` is a
 * correlated Σ over the verification log rather than a column, so it can never
 * drift from the events (house rule #4).
 */
function selectInstallments(sql: Queryable, transactionId: string): Promise<InstallmentDbRow[]> {
  return sql<InstallmentDbRow[]>`
    select i.id, i.installment_no, i.amount, i.due_date, i.status, i.jatuh_tempo,
           i.verified_date, i.verified_by, i.proof_of_payment,
           (select coalesce(sum(pv.amount), 0)::text
              from payment_verifications pv where pv.installment_id = i.id) as amount_verified
    from installments i where i.transaction_id = ${transactionId} order by i.installment_no`;
}

/**
 * hydrateAggregate derives Amount Verified / Outstanding from the immutable
 * verification log (house rule #4 — never stored) and attaches the schedule.
 * One query pair per transaction; the queue is small by construction (it holds
 * only [Menunggu Verifikasi] rows).
 */
async function hydrateAggregate(sql: Queryable, r: TransactionDbRow): Promise<TransactionAggregate> {
  const total = money.parse(r.total_agreed_value);
  const verified = await sumVerified(sql, r.id);
  const instRows = await selectInstallments(sql, r.id);
  return {
    id: r.id,
    clientId: r.client_id,
    scheme: r.payment_intent_scheme,
    totalAgreedValue: money.decimal(total),
    amountVerified: money.decimal(verified),
    amountOutstanding: money.decimal(total - verified),
    paymentStatus: r.payment_status,
    bermasalah: r.bermasalah,
    contractAttachment: r.contract_attachment,
    releasedToAccountAt: r.released_to_account_at,
    installments: instRows.map(toInstallmentRow),
  };
}

/**
 * financeQueue lists every Transaction with money still to collect — both
 * [Menunggu Verifikasi] and [Terverifikasi - Sebagian] — awaiting-verification
 * first, then oldest id first. Finance's worklist (M5 §8.1).
 *
 * It used to list [Menunggu Verifikasi] ONLY (Go `Service.Queue`), which meant
 * the first partial verification made a Transaction vanish from the only page
 * Finance has: the client had already routed to Account (§5 releases on the FIRST
 * payment), so Finance lost the row exactly when the remaining balance became
 * their job to chase. A Transaction leaves this queue when it is settled, not
 * when it is touched — the queue's subject is Amount Outstanding, and §6 makes
 * chasing the remainder Finance's work. [Lunas] is the only exit (it is the
 * terminal state, §2), so the list still shrinks on its own.
 */
export async function financeQueue(sql: Queryable, actor: Actor): Promise<TransactionAggregate[]> {
  if (!canReadFinanceQueue(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<TransactionDbRow[]>`
    select id, client_id, payment_intent_scheme, total_agreed_value, payment_status,
           bermasalah, contract_attachment, released_to_account_at
    from transactions
    where payment_status <> ${PAYMENT_LUNAS}
    order by case when payment_status = ${PAYMENT_MENUNGGU} then 0 else 1 end, id`;
  const out: TransactionAggregate[] = [];
  for (const r of rows) {
    out.push(await hydrateAggregate(sql, r));
  }
  return out;
}

/**
 * loadTransactionAggregate returns one Transaction with its derived amounts and
 * schedule, subject to M5 visibility. Ports Go `Service.LoadTransaction`: a role
 * with no Module 5 access at all → ForbiddenError; a transaction the actor may
 * not see → NotFoundError (never "forbidden", which would leak its existence).
 */
export async function loadTransactionAggregate(
  sql: Queryable,
  actor: Actor,
  transactionId: string,
): Promise<TransactionAggregate> {
  if (!canReadTransaction(actor)) {
    throw new ForbiddenError();
  }
  const releasedOnly = accountReleasedOnly(actor);
  const rows = await sql<TransactionDbRow[]>`
    select id, client_id, payment_intent_scheme, total_agreed_value, payment_status,
           bermasalah, contract_attachment, released_to_account_at
    from transactions
    where id = ${transactionId}
      and (${!releasedOnly} or released_to_account_at is not null)`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return hydrateAggregate(sql, rows[0]);
}

// ---------------------------------------------------------------------------
// Installment schedule creation (M5 §4 / M5 §8.4) — O41.
// ---------------------------------------------------------------------------

/** A scheme carries no schedule ([Bayar Penuh] / [Bayar Sebagian]) → 409. */
export const MSG_SCHEME_NO_SCHEDULE = '[skema pembayaran ini tidak memakai termin]';
export class SchemeNoScheduleError extends Error {
  constructor() {
    super(MSG_SCHEME_NO_SCHEDULE);
    this.name = 'SchemeNoScheduleError';
  }
}

/** A schedule already exists (or money already came in) → 409, never silent. */
export const MSG_SCHEDULE_EXISTS = '[jadwal termin sudah dibuat untuk transaksi ini]';
export class ScheduleExistsError extends Error {
  constructor() {
    super(MSG_SCHEDULE_EXISTS);
    this.name = 'ScheduleExistsError';
  }
}

/**
 * canCreateSchedule ports Go `canManageIntent`: Director and Finance always;
 * Sales at lead level, or the client's own sales PIC, or a member of its Sales
 * Allocation. NOTE this is deliberately NOT `client.canSetPaymentIntent` — that
 * one is the M4 §5 handoff authority and excludes Sales Lead.
 */
export function canCreateSchedule(actor: Actor, salesPicId: string, allocationMember: boolean): boolean {
  if (actor.role.director) {
    return true;
  }
  switch (actor.role.division) {
    case FINANCE_DIVISION:
      return true;
    case SALES_DIVISION:
      return actor.role.level === permission.LevelLead ||
        actor.employeeId === salesPicId ||
        allocationMember;
    default:
      return false;
  }
}

/**
 * createSchedule mints the Installment schedule for a scheduled Transaction
 * (M5 §4). Ports Go `Service.CreateSchedule`:
 *
 *   - only [Termin] / [Bayar di Belakang] carry a schedule (SchemeNoSchedule);
 *     [Bayar di Belakang] is exactly one installment (M5 §4 Rule 4).
 *   - amounts must sum EXACTLY to the agreed total (ScheduleTotalError) and
 *     every item needs a positive amount + due date (M5 §8.4).
 *   - it is NOT an upsert: an existing schedule or ANY existing verification
 *     makes it fail (ScheduleExistsError) rather than silently replacing rows
 *     that money is already reconciled against. Re-scheduling mid-flight is
 *     `changeScheme`'s job, and that one is pre-verification only.
 *
 * Each INST- id is minted only after validation passes (house rule #1), and
 * rows are inserted at the machine's initial state [Belum Jatuh Tempo]; later
 * moves go through the engine (house rule #2).
 */
export async function createSchedule(
  sql: Sql,
  actor: Actor,
  transactionId: string,
  items: ScheduleInput[],
  now: Date = new Date(),
): Promise<InstallmentRow[]> {
  if (items.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<
      { id: string; payment_intent_scheme: string; total_agreed_value: string; client_id: string; sales_pic_id: string | null }[]
    >`
      select t.id, t.payment_intent_scheme, t.total_agreed_value, t.client_id, c.sales_pic_id
      from transactions t join clients c on c.id = t.client_id
      where t.id = ${transactionId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const trx = rows[0];

    const memberRows = await tx<{ one: number }[]>`
      select 1 as one from client_sales_allocations
      where client_id = ${trx.client_id} and salesperson_id = ${actor.employeeId} limit 1`;
    if (!canCreateSchedule(actor, trx.sales_pic_id ?? '', memberRows.length > 0)) {
      throw new ForbiddenError();
    }

    if (!SCHEDULED_SCHEMES.has(trx.payment_intent_scheme)) {
      throw new SchemeNoScheduleError();
    }

    // Idempotency guard BEFORE minting ids: an existing schedule or any verified
    // money means this is a re-schedule, which this endpoint must refuse.
    const existing = await tx<{ inst: string; ver: string }[]>`
      select (select count(*) from installments where transaction_id = ${trx.id})::text as inst,
             (select count(*) from payment_verifications where transaction_id = ${trx.id})::text as ver`;
    if (existing[0].inst !== '0' || existing[0].ver !== '0') {
      throw new ScheduleExistsError();
    }

    const total = money.parse(trx.total_agreed_value);
    validateSchedule(trx.payment_intent_scheme, true, items, total);

    const created: InstallmentRow[] = [];
    for (let i = 0; i < items.length; i++) {
      const instId = await ex.ident.identNext('INST', now);
      const inserted = await tx<InstallmentDbRow[]>`
        insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
        values (${instId}, ${trx.id}, ${i + 1}, ${money.decimal(money.parse(items[i].amount))},
                ${items[i].dueDate}, ${INST_BELUM}, ${actor.employeeId})
        returning id, installment_no, amount, '0.00'::text as amount_verified, due_date, status,
                  jatuh_tempo, verified_date, verified_by, proof_of_payment`;
      created.push(toInstallmentRow(inserted[0]));
    }

    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'schedule_created', beforeJson: null,
      afterJson: { installments: created.length, scheme: trx.payment_intent_scheme },
      createdBy: actor.employeeId,
    });
    return created;
  });
}

// ---------------------------------------------------------------------------
// Collection schedule for the shortfall (M5 §6 + deviation from M5-OA-2).
// ---------------------------------------------------------------------------

/**
 * scheduleOutstanding schedules the collection of what a Transaction still owes:
 * Finance enters the shortfall as one or more dated installments, which then
 * surface on the reminder dashboard (§6) like any other due amount.
 *
 * DEVIATION FROM THE PRD, logged in DECISIONS.md (2026-08-04): M5-OA-2 declared a
 * `Bayar Sebagian` remainder "genuinely open-ended — no automatic reminder, no due
 * date; manual AM follow-up only", parked on the awareness-only "Outstanding, No
 * Due Date" list. The owner asked for the opposite in QA: Finance must be able to
 * *put a date on* a shortfall and have the system chase it. This does not weaken
 * anything — the remainder keeps its no-due-date behavior until Finance chooses to
 * schedule it, and the open-ended list still holds the ones they have not.
 *
 * Guards:
 *   - Admin & Finance / Director only (same authority as verification, §8.1).
 *   - nothing outstanding → NoOutstandingError; the schedule must sum EXACTLY to
 *     Amount Outstanding → OutstandingTotalError.
 *   - an OPEN installment already covers the remainder → ScheduleExistsError,
 *     never a silent second schedule for money that is already tracked.
 *
 * The scheme is deliberately NOT rewritten: changing Payment Intent is
 * `changeScheme`'s job and needs SPV/Head Finance (M5-OA-6). Scheduling a
 * collection is a Finance follow-up on a fact, not a renegotiation of the deal.
 */
export async function scheduleOutstanding(
  sql: Sql,
  actor: Actor,
  transactionId: string,
  items: ScheduleInput[],
  now: Date = new Date(),
): Promise<InstallmentRow[]> {
  if (!canVerifyPayment(actor)) {
    throw new ForbiddenError();
  }
  if (items.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const trx = await loadTransaction(tx, transactionId, true);

    const verified = await sumVerified(tx, trx.id);
    const outstanding = trx.totalAgreed - verified;
    if (outstanding <= 0n) {
      throw new NoOutstandingError();
    }

    // Any still-open installment already carries a claim on the remainder;
    // adding a second schedule would double-count it against the agreed total.
    const open = await tx<{ n: number }[]>`
      select count(*)::int as n from installments
      where transaction_id = ${trx.id} and status <> ${INST_TERVERIFIKASI}`;
    if (open[0].n > 0) {
      throw new ScheduleExistsError();
    }

    // Validate BEFORE minting ids (house rule #1: no burnt INST- numbers).
    let sum = 0n;
    for (const it of items) {
      let amt: money.Money;
      try {
        amt = money.parse(it.amount);
      } catch {
        throw new IncompleteError();
      }
      if (amt <= 0n || (it.dueDate ?? '').trim() === '') {
        throw new IncompleteError();
      }
      sum += amt;
    }
    if (sum !== outstanding) {
      throw new OutstandingTotalError();
    }

    // Numbering continues the existing schedule — verified installments keep
    // their numbers, so #1 never means two different things on one Transaction.
    const seq = await tx<{ next_no: number }[]>`
      select coalesce(max(installment_no), 0)::int + 1 as next_no
      from installments where transaction_id = ${trx.id}`;
    const firstNo = seq[0].next_no;

    const created: InstallmentRow[] = [];
    for (let i = 0; i < items.length; i++) {
      const instId = await ex.ident.identNext('INST', now);
      const inserted = await tx<InstallmentDbRow[]>`
        insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
        values (${instId}, ${trx.id}, ${firstNo + i}, ${money.decimal(money.parse(items[i].amount))},
                ${items[i].dueDate}, ${INST_BELUM}, ${actor.employeeId})
        returning id, installment_no, amount, '0.00'::text as amount_verified, due_date, status,
                  jatuh_tempo, verified_date, verified_by, proof_of_payment`;
      created.push(toInstallmentRow(inserted[0]));
    }

    await ex.audit.insertAudit({
      entityType: 'transaction', entityId: trx.id, actorEmployeeId: actor.employeeId,
      action: 'outstanding_schedule_created', beforeJson: null,
      afterJson: {
        installments: created.length, amount_outstanding: money.decimal(outstanding),
        scheme: trx.scheme, from_installment_no: firstNo,
      },
      createdBy: actor.employeeId,
    });
    return created;
  });
}

// ---------------------------------------------------------------------------
// [Bermasalah] status read (M5-OA-5) — O41.
// ---------------------------------------------------------------------------

/** One recorded vote in the current [Bermasalah] cycle. */
export interface BermasalahVoteRow {
  division: string;
  decision: string;
  note: string;
  actor: string;
  createdAt: Date;
}

/** The dispute flag plus the current cycle's votes and escalation state. */
export interface BermasalahStatusView {
  transactionId: string;
  flagged: boolean;
  financeVote: string;
  accountVote: string;
  directorVote: string;
  escalated: boolean;
  votes: BermasalahVoteRow[];
}

/**
 * The division literal a Director's vote is stored under. Go writes "Director"
 * (a pseudo-division, not the actor's real one) and its reader keys on that.
 * `resolveBermasalah` used to write 'Management' instead, so a Director ruling
 * could never populate directorVote — which silently kept `escalated` true after
 * a Director had already ruled against. Aligned to Go; safe to change because
 * `transaction_issue_approvals` was empty in every environment at the time
 * (verified on CDPS SG), so no rows needed migrating.
 */
export const DIRECTOR_VOTE_DIVISION = 'Director';

/** Pre-alignment rows stored a Director's vote as 'Management' — still counted. */
const DIRECTOR_VOTE_LEGACY = 'Management';

/**
 * bermasalahStatus reports the flag, the votes cast in the CURRENT cycle only
 * (a re-flag starts a fresh cycle — votes before `bermasalah_flagged_at` are
 * history, not standing opinions), and whether the case is escalated: both SPV
 * divisions voted, they disagree, and no Director has ruled. Visibility follows
 * Transaction visibility, so it 404s exactly where the transaction read does.
 * Ports Go `Service.GetBermasalahStatus`.
 */
export async function bermasalahStatus(
  sql: Queryable,
  actor: Actor,
  transactionId: string,
): Promise<BermasalahStatusView> {
  const trx = await loadTransactionAggregate(sql, actor, transactionId);

  const flaggedRows = await sql<{ bermasalah_flagged_at: Date | null }[]>`
    select bermasalah_flagged_at from transactions where id = ${trx.id}`;
  const flaggedAt = flaggedRows[0]?.bermasalah_flagged_at ?? null;

  const voteRows = await sql<
    { division: string; decision: string; note: string | null; created_by: string; created_at: Date }[]
  >`
    select division, decision, note, created_by, created_at
    from transaction_issue_approvals
    where transaction_id = ${trx.id}
      and (${flaggedAt === null} or created_at >= ${flaggedAt ?? new Date(0)})
    order by id`;

  const view: BermasalahStatusView = {
    transactionId: trx.id, flagged: trx.bermasalah,
    financeVote: '', accountVote: '', directorVote: '', escalated: false, votes: [],
  };
  for (const v of voteRows) {
    view.votes.push({
      division: v.division, decision: v.decision, note: v.note ?? '',
      actor: v.created_by, createdAt: v.created_at,
    });
    if (v.division === FINANCE_DIVISION) {
      view.financeVote = v.decision;
    } else if (v.division === ACCOUNT_DIVISION) {
      view.accountVote = v.decision;
    } else if (v.division === DIRECTOR_VOTE_DIVISION || v.division === DIRECTOR_VOTE_LEGACY) {
      view.directorVote = v.decision;
    }
  }
  view.escalated = view.flagged && view.directorVote === '' &&
    view.financeVote !== '' && view.accountVote !== '' && view.financeVote !== view.accountVote;
  return view;
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
