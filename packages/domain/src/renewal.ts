/**
 * Kinerja Sales R-03 — Renewal & Cross-Sell, arah (a) disetujui pemilik
 * (`docs/DECISIONS.md` "Kinerja Sales #4"). See `docs/STATE_MACHINES.md` §20
 * for the full machine + design rationale.
 *
 * `sales.close()` always mints a fresh `CLI-` — selling again to an EXISTING
 * client would duplicate it, and there is no lead/attempt for a renewal at
 * all ("nol LEAD-/PRSP- palsu", owner decision). This module is therefore a
 * PARALLEL stateful entity (`renewal_requests`, mirrors `prospect_attempts`)
 * + versioned line-item snapshots (`renewal_proposals`/`renewal_proposal_lines`,
 * mirrors `negotiation_proposals`/`negotiation_proposal_lines` exactly, anchor
 * = `client_id` instead of `attempt_id`) — NOT a reuse of the attempt-anchored
 * negotiation tables, and NOT a new `PRSP-`.
 *
 * Pricing/validation is reused verbatim from `sales.ts` (one engine, not two
 * that could drift): `resolveProposalLine` (MSL calculator + custom-term
 * gate), `validateShape`/`validateScheduleTotal`/`validateParties` (the exact
 * M0 §6 allocation + payment-schedule rules), `resolvePIC`. Execution births
 * `SVC-`/`TRX-`/`INST-` with the SAME status constants and table shapes
 * `sales.close()` births them with. `CTR-` is the one exception: `close()`
 * never mints a Contract at all (Services stay contract-less until the AM
 * groups them via `contract.ensureContractForService`, M6A) — a renewal has
 * exactly one natural grouping (this request's own lines), so execution
 * mints the Contract directly and pre-attaches the Services to it. This is
 * also how R-03 sidesteps the GARIS STOP `DECISIONS.md` Kinerja Sales #4
 * recorded: it never calls `contract.canWriteContract` (that gate, and the
 * Account-side Strategi/Plan-per-Contract cycle behind it, are untouched —
 * see Kinerja Sales #5) — `contract.ensureContractForService` already
 * accepts a Service's existing non-null `contract_id` and reuses it as-is,
 * so the AM's normal Strategi-opening flow picks up an R-03 Service exactly
 * like it picks up a fresh closing's.
 *
 * KS-2 (kredit alokasi, keputusan pemilik 2026-08-29): credit moves ENTIRELY
 * to the salesperson executing the renewal. `client_sales_allocations` is
 * scoped per CLIENT (not per transaction) and read live by
 * `finance.commissionAchievement` — so execution REPLACES the client's whole
 * allocation set rather than adding to it. Recorded consequence: because
 * nothing is snapshotted (house rule #4, purely derived-on-read), a later
 * read of `commissionAchievement` for an OLDER transaction of this client
 * will also show the new allocation — this is not a retroactive change to
 * money already paid, but there is no frozen record of who owned a past
 * transaction's commission at the time it was recognized. Owner explicitly
 * accepted this trade-off; see DECISIONS.md Kinerja Sales #5. Commission
 * itself carries no special renewal rule — `services.commission_rule` (MSL)
 * is used as-is (KS-2's second answer).
 *
 * Strategi/Plan are NOT created here. `contract.ensureContractForService`
 * (already built, M6A) is the one door that mints Strategi/Plan for a
 * Service — this module hands it a `CTR-`/`SVC-` exactly like a fresh
 * closing does, and the AM picks it up through the existing flow.
 */
import { money, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { effectiveAt } from './msl';
import {
  AllocationTotalError,
  CustomTermRequiresNegotiationError,
  ForbiddenError,
  hasCustomLine,
  IncompleteError,
  INST_STATUS_BELUM_JATUH_TEMPO,
  MAX_SERVICES,
  NotClosableError,
  NotFoundError,
  resolveProposalLine,
  resolvePIC,
  SALES_DIVISION,
  SERVICE_STATUS_AWAITING_ONBOARDING,
  TooManyServicesError,
  TRX_STATUS_MENUNGGU,
  validateParties,
  validateScheduleTotal,
  validateShape,
  type ClosingParties,
  type InstallmentInput,
  type ProposalLine,
} from './sales';

export type Actor = permission.Actor;

const MACHINE = 'renewal_request';
const ENTITY = 'renewal_request';
const TABLE = 'renewal_requests';

export const STATUS_PENDING = 'Pending Approval';
export const STATUS_AUTO_APPROVED = 'Auto Approved';
export const STATUS_APPROVED = 'Approved';
export const STATUS_REJECTED = 'Rejected';
export const STATUS_EXECUTED = 'Executed';

/** Mirrors `contracts.jenis` minus 'baru' — this entity never produces a first-time contract. */
export const JENIS_PERPANJANGAN = 'perpanjangan';
export const JENIS_CROSS_SELL = 'cross_sell';

export const DECISION_APPROVE = 'approve';
export const DECISION_REJECT = 'reject';

/** A renewal proposal line has the exact same shape as a negotiation one (masterServiceId + optional custom price/rule, or standard qty/amount). */
export type RenewalLine = ProposalLine;

/** BI message for a client id that does not resolve. */
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
/** BI message for a renewal request id that does not resolve. */
export const MSG_RENEWAL_NOT_FOUND = '[permintaan perpanjangan tidak ditemukan]';

export interface RenewalRequest {
  id: string;
  clientId: string;
  jenis: string;
  proposedBy: string;
  status: string;
  decisionNote: string | null;
  contractId: string | null;
  transactionId: string | null;
  createdAt: Date;
  createdBy: string;
}

interface RenewalRow {
  id: string;
  client_id: string;
  jenis: string;
  proposed_by: string;
  status: string;
  decision_note: string | null;
  contract_id: string | null;
  transaction_id: string | null;
  created_at: Date;
  created_by: string;
}

function rowToRenewal(r: RenewalRow): RenewalRequest {
  return {
    id: r.id, clientId: r.client_id, jenis: r.jenis, proposedBy: r.proposed_by, status: r.status,
    decisionNote: r.decision_note, contractId: r.contract_id, transactionId: r.transaction_id,
    createdAt: r.created_at, createdBy: r.created_by,
  };
}

// ---------------------------------------------------------------------------
// Permission — mirrors `sales.canWriteAttempt`'s shape (Director everywhere;
// Sales lead division-wide; Sales staff = own client only), keyed to the
// client's `sales_pic_id` instead of an attempt owner (there is no attempt).
// ---------------------------------------------------------------------------

/** canWriteRenewal: Director; Sales lead (any); the client's own Sales PIC. */
export function canWriteRenewal(actor: Actor, salesPicId: string | null): boolean {
  if (actor.role.director) return true;
  if (actor.role.division !== SALES_DIVISION) return false;
  if (actor.role.level === permission.LevelLead) return true;
  return salesPicId !== null && salesPicId === actor.employeeId;
}

/** canReadRenewal: the write set, plus every read-all role (OD / Director). */
export function canReadRenewal(actor: Actor, salesPicId: string | null): boolean {
  return canWriteRenewal(actor, salesPicId) || permission.canReadAll(actor);
}

async function salesPicOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ sales_pic_id: string }[]>`select sales_pic_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].sales_pic_id;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadRenewalRow(sql: Queryable, id: string, forUpdate = false): Promise<RenewalRow> {
  const rows = forUpdate
    ? await sql<RenewalRow[]>`select * from renewal_requests where id = ${id} for update`
    : await sql<RenewalRow[]>`select * from renewal_requests where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_RENEWAL_NOT_FOUND);
  return rows[0];
}

/** getRenewal loads one renewal/cross-sell request. */
export async function getRenewal(sql: Queryable, actor: Actor, id: string): Promise<RenewalRequest> {
  const row = await loadRenewalRow(sql, id);
  const picId = await salesPicOfClient(sql, row.client_id);
  if (!canReadRenewal(actor, picId)) {
    throw new ForbiddenError();
  }
  return rowToRenewal(row);
}

/** A renewal request plus its latest priced proposal lines — what the R-04 review/decide/execute screens read. */
export interface RenewalDetail extends RenewalRequest {
  lines: { masterServiceId: string; proposedPrice: string; commissionRule: string }[];
}

/** getRenewalDetail loads one renewal/cross-sell request with its newest proposal version's priced lines. */
export async function getRenewalDetail(sql: Queryable, actor: Actor, id: string): Promise<RenewalDetail> {
  const row = await loadRenewalRow(sql, id);
  const picId = await salesPicOfClient(sql, row.client_id);
  if (!canReadRenewal(actor, picId)) {
    throw new ForbiddenError();
  }
  const lines = await loadLatestLines(sql, id);
  return { ...rowToRenewal(row), lines };
}

/** listRenewalsForClient returns every renewal/cross-sell offer ever made on one client, newest first. */
export async function listRenewalsForClient(sql: Queryable, actor: Actor, clientId: string): Promise<RenewalRequest[]> {
  const picId = await salesPicOfClient(sql, clientId);
  if (!canReadRenewal(actor, picId)) {
    throw new ForbiddenError();
  }
  const rows = await sql<RenewalRow[]>`
    select * from renewal_requests where client_id = ${clientId} order by created_at desc, id desc`;
  return rows.map(rowToRenewal);
}

// ---------------------------------------------------------------------------
// Proposal — pricing reused VERBATIM from sales.ts (resolveProposalLine).
// ---------------------------------------------------------------------------

async function nextVersion(tx: Queryable, renewalRequestId: string): Promise<number> {
  const rows = await tx<{ max: number | null }[]>`
    select max(version_no) as max from renewal_proposals where renewal_request_id = ${renewalRequestId}`;
  return Number(rows[0]?.max ?? 0) + 1;
}

/** writeRenewalProposal appends a new immutable version + its priced lines (same duplicate/cap guards as `sales.ts`'s writeProposal). */
async function writeRenewalProposal(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  actor: Actor,
  renewalRequestId: string,
  lines: RenewalLine[],
  now: Date,
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
  const resolved: { line: RenewalLine; price: string; rule: string }[] = [];
  for (const l of lines) {
    const { price, rule } = await resolveProposalLine(tx, l, now);
    resolved.push({ line: l, price, rule });
  }

  const version = await nextVersion(tx, renewalRequestId);
  const proposalRows = await tx<{ id: number }[]>`
    insert into renewal_proposals (renewal_request_id, version_no, proposed_by, created_by)
    values (${renewalRequestId}, ${version}, ${actor.employeeId}, ${actor.employeeId})
    returning id`;
  const proposalId = proposalRows[0].id;
  for (const { line: l, price, rule } of resolved) {
    await tx`
      insert into renewal_proposal_lines
        (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms, created_by)
      values (${proposalId}, ${l.masterServiceId}, ${price}, ${rule}, ${nullString(l.paymentTerms)}, ${actor.employeeId})`;
  }
  await ex.audit.insertAudit({
    entityType: ENTITY, entityId: renewalRequestId, actorEmployeeId: actor.employeeId,
    action: 'proposal_version', beforeJson: null,
    afterJson: {
      proposal_id: proposalId, version_no: version, lines: lines.length,
      services: resolved.map((r) => r.line.masterServiceId),
    },
    createdBy: actor.employeeId,
  });
}

/** loadLatestLines reads the newest proposal version's priced lines. */
async function loadLatestLines(sql: Queryable, renewalRequestId: string): Promise<{ masterServiceId: string; proposedPrice: string; commissionRule: string }[]> {
  const rows = await sql<{ master_service_id: string; proposed_price: string; commission_rule: string }[]>`
    select l.master_service_id, l.proposed_price, l.commission_rule
      from renewal_proposal_lines l
      join renewal_proposals p on p.id = l.proposal_id
     where p.renewal_request_id = ${renewalRequestId}
       and p.version_no = (select max(version_no) from renewal_proposals where renewal_request_id = ${renewalRequestId})
     order by l.id`;
  return rows.map((r) => ({ masterServiceId: r.master_service_id, proposedPrice: r.proposed_price, commissionRule: r.commission_rule }));
}

async function renewalTransition(sm: statemachine.SmExecutor, id: string, to: string, actor: Actor): Promise<statemachine.TransitionResult> {
  return statemachine.transition(sm, { machine: MACHINE, entityType: ENTITY, table: TABLE, entityId: id, to, actor });
}

/** emitPendingApproval notifies the Sales division leads — mirrors `sales.ts`'s helper of the same name, one event per proposed/resubmitted CUSTOM version. */
async function emitPendingApproval(
  notify: notification.NotifyExecutor,
  actor: Actor,
  renewalRequestId: string,
  clientId: string,
): Promise<void> {
  await notification.emit(notify, {
    event: notification.EVENTS.RenewalPendingApproval,
    entityType: ENTITY, entityId: renewalRequestId, actor: actor.employeeId,
    division: SALES_DIVISION, deepLink: `/clients/${clientId}#renewal`,
  });
}

/** emitDecision notifies the request's proposer of the superior's call — mirrors `sales.ts`'s helper of the same name. */
async function emitDecision(
  notify: notification.NotifyExecutor,
  actor: Actor,
  renewalRequestId: string,
  clientId: string,
  proposedBy: string,
): Promise<void> {
  await notification.emit(notify, {
    event: notification.EVENTS.RenewalDecision,
    entityType: ENTITY, entityId: renewalRequestId, actor: actor.employeeId,
    explicitRecipients: [proposedBy], deepLink: `/clients/${clientId}#renewal`,
  });
}

/**
 * proposeRenewal opens a NEW renewal/cross-sell offer on an existing client
 * (the "Perpanjangan / Cross Sell" button, R-04). `noNego=true` mirrors M0 §5
 * non-negotiation: every line must be standard MSL terms (a custom one is
 * refused with CustomTermRequiresNegotiationError), and the request is born
 * `Auto Approved` — otherwise it is born `Pending Approval` and needs a
 * Sales Head/SPV decision. Owner (the client's Sales PIC) / Sales Lead /
 * Director only.
 */
export async function proposeRenewal(
  sql: Sql,
  actor: Actor,
  clientId: string,
  jenis: string,
  lines: RenewalLine[],
  noNego: boolean,
  now: Date = new Date(),
): Promise<RenewalRequest> {
  if (jenis !== JENIS_PERPANJANGAN && jenis !== JENIS_CROSS_SELL) {
    throw new IncompleteError();
  }
  if (noNego && hasCustomLine(lines)) {
    throw new CustomTermRequiresNegotiationError();
  }
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const picId = await salesPicOfClient(tx, clientId);
    if (!canWriteRenewal(actor, picId)) {
      throw new ForbiddenError();
    }
    const id = await ex.ident.identNext('RNW', now);
    const status = noNego ? STATUS_AUTO_APPROVED : STATUS_PENDING;
    await tx`
      insert into renewal_requests (id, client_id, jenis, proposed_by, status, created_by)
      values (${id}, ${clientId}, ${jenis}, ${actor.employeeId}, ${status}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY, entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { client_id: clientId, jenis, status }, createdBy: actor.employeeId,
    });
    await writeRenewalProposal(tx, ex, actor, id, lines, now);
    if (status === STATUS_PENDING) {
      await emitPendingApproval(ex.notify, actor, id, clientId);
    }
    return rowToRenewal(await loadRenewalRow(tx, id));
  });
}

/** resubmitRenewal sends a fresh proposal version after a Reject, back to Pending Approval — the SAME `RNW-`, never a new one (mirrors `sales.resubmitNegotiation`). */
export async function resubmitRenewal(
  sql: Sql,
  actor: Actor,
  id: string,
  lines: RenewalLine[],
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await loadRenewalRow(tx, id, true);
    const picId = await salesPicOfClient(tx, row.client_id);
    if (!canWriteRenewal(actor, picId)) {
      throw new ForbiddenError();
    }
    const result = await renewalTransition(ex.sm, id, STATUS_PENDING, actor);
    if (!result.ok) {
      return result;
    }
    await writeRenewalProposal(tx, ex, actor, id, lines, now);
    await emitPendingApproval(ex.notify, actor, id, row.client_id);
    return result;
  });
}

/**
 * decideRenewal is the superior's call on a Pending Approval request — the
 * `renewal_request` machine's `require_lead=true` edges enforce Lead/Director
 * only (mirrors `sales.decideNegotiation`). Reject requires a note.
 */
export async function decideRenewal(
  sql: Sql,
  actor: Actor,
  id: string,
  decision: string,
  note = '',
): Promise<statemachine.TransitionResult> {
  let to: string;
  if (decision === DECISION_APPROVE) {
    to = STATUS_APPROVED;
  } else if (decision === DECISION_REJECT) {
    to = STATUS_REJECTED;
  } else {
    throw new IncompleteError();
  }
  if (decision === DECISION_REJECT && note.trim() === '') {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const result = await renewalTransition(ex.sm, id, to, actor);
    if (!result.ok) {
      return result;
    }
    if (note.trim() !== '') {
      await tx`update renewal_requests set decision_note = ${note} where id = ${id}`;
    }
    const row = await loadRenewalRow(tx, id);
    await emitDecision(ex.notify, actor, id, row.client_id, row.proposed_by);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Execution — births CTR-/SVC-/TRX-/INST- on the EXISTING client, the same
// shapes `sales.close()` births on a brand-new one.
// ---------------------------------------------------------------------------

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The contract window + closing parties an Approved/Auto Approved renewal is executed with. */
export interface ExecuteRenewalInput {
  durasiBulan: number;
  tanggalMulai: string;
  tanggalAkhir: string;
  parties: ClosingParties;
  paymentScheme: string;
  installments?: InstallmentInput[];
}

export interface ExecuteRenewalResult {
  contractId: string;
  transactionId: string;
}

function nullString(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

/**
 * executeRenewal is the separate step after approval (mirrors `sales.close()`
 * sitting after `Negotiation - Approved` — approving pricing and deciding
 * payment terms are different moments). Births `CTR-` (jenis = this
 * request's, `contract_sebelumnya_id` = the client's latest contract when
 * `perpanjangan`) + one `SVC-` per proposal line + `TRX-` (+ `INST-` for
 * scheduled schemes) — then REPLACES `client_sales_allocations` for the
 * client with the input parties (KS-2: credit moves entirely to whoever
 * executes) and updates `clients.sales_pic_id`/`commission_payment_pic_id`
 * to match. Owner / Sales Lead / Director only.
 */
export async function executeRenewal(
  sql: Sql,
  actor: Actor,
  id: string,
  input: ExecuteRenewalInput,
  now: Date = new Date(),
): Promise<ExecuteRenewalResult> {
  validateShape({ parties: input.parties, paymentScheme: input.paymentScheme, installments: input.installments });
  const mulai = (input.tanggalMulai ?? '').trim();
  const akhir = (input.tanggalAkhir ?? '').trim();
  const durasi = Number(input.durasiBulan);
  if (!RE_DATE.test(mulai) || !RE_DATE.test(akhir) || akhir <= mulai) {
    throw new IncompleteError();
  }
  if (!Number.isInteger(durasi) || durasi < 1 || durasi > 36) {
    throw new IncompleteError();
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await loadRenewalRow(tx, id, true);
    const picId = await salesPicOfClient(tx, row.client_id);
    if (!canWriteRenewal(actor, picId)) {
      throw new ForbiddenError();
    }
    if (row.status !== STATUS_APPROVED && row.status !== STATUS_AUTO_APPROVED) {
      throw new NotClosableError();
    }

    const lines = await loadLatestLines(tx, id);
    if (lines.length === 0) {
      throw new IncompleteError();
    }
    let total = 0n;
    for (const l of lines) {
      total += money.parse(l.proposedPrice);
    }
    validateScheduleTotal({ parties: input.parties, paymentScheme: input.paymentScheme, installments: input.installments }, total);

    const primary = input.parties.primarySalespersonId;
    const pic = resolvePIC(input.parties);

    // 1) Contract (CTR-) — jenis dicatat sekali, rantai perpanjangan diisi
    //    dari kontrak TERAKHIR klien ini (jika ada).
    const prevContract = await tx<{ id: string }[]>`
      select id from contracts where client_id = ${row.client_id} order by created_at desc, id desc limit 1`;
    const contractSebelumnyaId = row.jenis === JENIS_PERPANJANGAN && prevContract.length > 0 ? prevContract[0].id : null;
    const contractId = await ex.ident.identNext('CTR', now);
    await tx`
      insert into contracts
        (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, contract_sebelumnya_id, created_by)
      values
        (${contractId}, ${row.client_id}, ${durasi}, ${mulai}, ${akhir}, ${row.jenis}, ${contractSebelumnyaId}, ${actor.employeeId})`;

    // 2) Services (SVC- per line, born [Awaiting Onboarding]) under this
    //    Contract — same birth status as sales.close(), attached from day 1
    //    (unlike a fresh closing, whose Services start contract-less until an
    //    AM groups them — here the Contract already exists, so attach now).
    //    name/requires_strategy_plan/plan_tier come from the MSL catalog
    //    (effectiveAt) — the proposal only ever pinned price/commission_rule,
    //    same enrichment sales.close() does via loadApprovedLines.
    const today = tz.dateString(now);
    for (const l of lines) {
      const view = await effectiveAt(tx, l.masterServiceId, today);
      const svcId = await ex.ident.identNext('SVC', now);
      await tx`
        insert into services
          (id, client_id, contract_id, master_service_id, master_version_no, name, standard_price,
           commission_rule, status, requires_strategy_plan, plan_tier, created_by)
        values
          (${svcId}, ${row.client_id}, ${contractId}, ${l.masterServiceId}, ${view.versionNo}, ${view.name}, ${l.proposedPrice},
           ${l.commissionRule}, ${SERVICE_STATUS_AWAITING_ONBOARDING}, ${view.requiresStrategyPlan}, ${view.planTier},
           ${actor.employeeId})`;
    }

    // 3) Transaction (TRX-) born awaiting Finance verification.
    const trxId = await ex.ident.identNext('TRX', now);
    await tx`
      insert into transactions
        (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
      values
        (${trxId}, ${row.client_id}, ${input.paymentScheme}, ${money.decimal(total)}, ${TRX_STATUS_MENUNGGU}, ${actor.employeeId})`;

    // 4) Installments (INST-) for scheduled schemes.
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

    // 5) Allocation credit (KS-2): REPLACE, not add — the whole client's
    //    allocation set moves to whoever executed this renewal.
    const before = await tx<{ salesperson_id: string; basis_points: number }[]>`
      select salesperson_id, basis_points from client_sales_allocations where client_id = ${row.client_id}`;
    await tx`delete from client_sales_allocations where client_id = ${row.client_id}`;
    for (const al of input.parties.allocations) {
      await tx`
        insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
        values (${row.client_id}, ${al.salespersonId}, ${al.basisPoints}, ${actor.employeeId})`;
    }
    await tx`
      update clients set sales_pic_id = ${primary}, commission_payment_pic_id = ${pic}
       where id = ${row.client_id}`;

    // 6) Link the renewal request to what it produced, transition to Executed.
    await tx`update renewal_requests set contract_id = ${contractId}, transaction_id = ${trxId} where id = ${id}`;
    const result = await renewalTransition(ex.sm, id, STATUS_EXECUTED, actor);
    if (!result.ok) {
      // Should not happen (status pre-checked above) — surface as a lifecycle conflict.
      throw new NotClosableError();
    }

    await ex.audit.insertAudit({
      entityType: ENTITY, entityId: id, actorEmployeeId: actor.employeeId, action: 'execute',
      beforeJson: { allocations: before },
      afterJson: {
        contract_id: contractId, transaction_id: trxId, total_agreed_value: money.decimal(total),
        payment_scheme: input.paymentScheme, allocations: input.parties.allocations,
      },
      createdBy: actor.employeeId,
    });

    return { contractId, transactionId: trxId };
  });
}
