/**
 * KOL domain service (M9). Ported from Go's `internal/module9_kol/*`.
 *
 * Introduces the Creator Booking (BKG-), KOL's unit of work: one row per creator
 * secured to produce content for a client's campaign (M9 §2 — a "Book 5 Micro
 * KOLs" Brief fans out into up to 5 Bookings). Because the creator is an EXTERNAL
 * party, a Booking runs its OWN native 8-state lifecycle (STATE_MACHINES §8,
 * creator_booking) with sourcing/negotiation and a real failure path (escalate →
 * drop → re-source). It is therefore NOT a `task` source; for Speed Score its 8
 * native states are MAPPED onto the canonical 6-state machine (§11) and fed
 * through `task.computeMetrics`.
 *
 * This module owns the Booking entity end-to-end: creation (§4), the native
 * lifecycle incl. QC done by KOL itself (§5 — NOT the AM), coordinator assignment
 * (§3), the Creator Payment Request (§8, requested here / executed by Finance),
 * the compiled Creator List (§6), the Brief↔Booking roll-up (§2), and Attributed
 * GMV write-back (M9-OA-4). `account.onBriefLeavesToDo` is called when the KOL
 * Brief first leaves [To Do] via the roll-up.
 *
 * House rules: BKG-/CPR- ids minted after validation (rule 1); birth status set at
 * INSERT, later moves through the engine (rule 2); Revision Count / turnarounds /
 * Speed Score / Payment Status derived from the immutable log (rules 3/4); money
 * renders "Rp. X.XXX.XXX,00" (rule 7).
 *
 * Reference: backend/internal/module9_kol/*.go.
 */

import { bi, money, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { onBriefLeavesToDo } from './account';
import { onBriefReachedTerminal, validateBriefApproval } from './board';
import { computeMetrics, STATUS_APPROVED, STATUS_BLOCKED, STATUS_IN_PROGRESS, STATUS_IN_REVIEW, STATUS_REVISION_REQ, STATUS_SUBMITTED, type Transition } from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const KOL_DIVISION = 'KOL';
export const ACCOUNT_DIVISION = 'Account';
export const FINANCE_DIVISION = 'Finance';

// Creator Booking statuses — the creator_booking machine (STATE_MACHINES §8).
export const BKG_SOURCING = '[Sourcing]';
export const BKG_BOOKED = '[Booked]';
export const BKG_CONTENT_IN_PROG = '[Content In Progress]';
export const BKG_CONTENT_SUBMIT = '[Content Submitted]';
export const BKG_QC_REVIEW = '[QC Review]';
export const BKG_QC_PASSED = '[QC Passed]';
export const BKG_QC_FAILED = '[QC Failed - Revision Requested]';
export const BKG_ESCALATED = '[Escalated - Creator Unresponsive]';
export const BKG_DROPPED = '[Dropped]';

// Creator Payment Request statuses — the creator_payment_request machine (§9).
export const CPR_REQUESTED = '[Requested]';
export const CPR_RECEIVED = '[Received by Finance]';
export const CPR_PAID = '[Paid]';
export const CPR_REJECTED = '[Rejected]';

const MACHINE_BOOKING = 'creator_booking';
const MACHINE_CPR = 'creator_payment_request';

const SOURCE_POOLS = new Set(['MCN MEA Roster', 'KOL External Pool', 'Ad-hoc New']);
const BRIEF_APPROVED = '[Approved]';
const SERVICE_VOIDED = '[Cancelled — Service Voided]';
/** M9-OA-2: 1 revision round per Booking before it must be escalated. */
const REVISION_CAP = 1;

// --- Verbatim BI messages (M9). Each mirrors a Go sentinel 1:1. ---

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_NOT_KOL_BRIEF = '[brief ini bukan brief divisi KOL]';
export const MSG_BRIEF_NOT_BOOKABLE = '[booking tidak dapat dibuat untuk brief pada status ini]';
export const MSG_INVALID_SOURCE_POOL = '[source pool tidak valid]';
export const MSG_INVALID_QTY = '[jumlah video/live harus bilangan bulat tidak negatif]';
export const MSG_BOOKING_NOT_FOUND = '[booking tidak ditemukan]';
export const MSG_BOOKING_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke booking ini]';
export const MSG_EXEC_FORBIDDEN = '[anda tidak memiliki akses untuk mengerjakan booking ini]';
export const MSG_ESCALATE_FORBIDDEN = '[anda tidak memiliki akses untuk mengeskalasi booking ini]';
export const MSG_DROP_FORBIDDEN = '[anda tidak memiliki akses untuk men-drop booking ini]';
export const MSG_ASSIGN_FORBIDDEN =
  '[anda tidak memiliki akses untuk menugaskan Coordinator atau menetapkan SLA booking ini]';
export const MSG_INVALID_COORDINATOR = '[Coordinator tidak valid: harus staff divisi KOL yang aktif]';
export const MSG_REASSIGN_REASON_REQUIRED = '[alasan reassignment wajib diisi]';
export const MSG_INVALID_SLA = '[target SLA harus lebih dari 0 jam]';
export const MSG_CONTENT_LINK_REQUIRED = '[link konten wajib diisi sebelum submit]';
export const MSG_QC_NOTES_REQUIRED = '[catatan QC wajib diisi]';
export const MSG_DROP_REASON_REQUIRED = '[alasan drop wajib diisi]';
export const MSG_REVISION_CAP_REACHED = '[batas revisi kreator tercapai, silakan eskalasi booking]';
export const MSG_PAYMENT_BOOKING_NOT_PASSED = '[permintaan pembayaran hanya dapat dibuat setelah booking QC Passed]';
export const MSG_PAYMENT_DETAILS_REQUIRED = '[detail pembayaran kreator wajib diisi]';
export const MSG_PAYMENT_AMOUNT_MISMATCH = '[jumlah pembayaran harus sama dengan Agreed Rate booking]';
export const MSG_PAYMENT_ALREADY_REQUESTED = '[permintaan pembayaran untuk booking ini sudah ada]';
export const MSG_PAYMENT_REQUEST_NOT_FOUND = '[permintaan pembayaran tidak ditemukan]';
export const MSG_PAYMENT_MANAGE_FORBIDDEN = '[anda tidak memiliki akses untuk membuat permintaan pembayaran booking ini]';
export const MSG_FINANCE_FORBIDDEN = '[anda tidak memiliki akses untuk memproses permintaan pembayaran ini]';
export const MSG_REJECTION_REASON_REQUIRED = '[alasan penolakan wajib diisi]';
export const MSG_CREATOR_LIST_FORBIDDEN = '[anda tidak memiliki akses untuk menyusun Creator List brief ini]';
export const MSG_CREATOR_LIST_LINK_REQUIRED = '[link Creator List wajib diisi]';
export const MSG_BAD_AMOUNT = '[nilai uang tidak valid]';
export const MSG_GMV_BOOKING_NOT_PASSED = '[GMV teratribusi hanya dapat dicatat setelah booking QC Passed]';

// --- Errors (kol-scoped; mapped in apps/api http.ts). ---

/** Bad/missing input (→ 400). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KolValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KolForbiddenError';
  }
}
/** The referenced brief / booking / payment request does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_BOOKING_NOT_FOUND) {
    super(message);
    this.name = 'KolNotFoundError';
  }
}
/** A lifecycle conflict (→ 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KolConflictError';
  }
}

// --- Authorization predicates ---

interface BookingRow {
  id: string;
  briefId: string;
  serviceId: string;
  division: string;
  coordinator: string;
  status: string;
  ownerAm: string;
}

/** canCreateBooking: the Brief's KOL staff/lead (self-claim / Team Leader) or Director. */
export function canCreateBooking(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === KOL_DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/** canExecute is the §10.1 execution/QC gate (claim model). */
export function canExecute(actor: Actor, r: { division: string; coordinator: string }): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.division !== KOL_DIVISION ||
    (actor.role.level !== permission.LevelStaff && actor.role.level !== permission.LevelLead)) {
    return false;
  }
  if (r.coordinator !== '') {
    return actor.employeeId === r.coordinator || actor.role.level === permission.LevelLead;
  }
  return true;
}

/**
 * canEscalate is the §10.1 escalate gate: the assigned Coordinator, the KOL
 * Team Leader, or Director (B2, DECISIONS 2026-08-18). §10.1 gives the
 * Coordinator "escalate when needed" — this is exactly `canExecute` (the
 * claim/QC gate), so escalate reuses it directly rather than the old lead-only
 * predicate.
 */
export function canEscalate(actor: Actor, r: { division: string; coordinator: string }): boolean {
  return canExecute(actor, r);
}

/** escalationTier annotates who an escalation surfaces to (audit-only, §10.1 / M9-OA-6):
 * a Coordinator escalates to the SPV (KOL Team Leader); a Lead/Director takes it to the Director. */
function escalationTier(actor: Actor): string {
  return permission.isLead(actor, KOL_DIVISION) || actor.role.director ? 'Director' : 'SPV';
}

/** canDrop: KOL Team Leader, Account lead (SPV tie-breaker, M9-OA-6), or Director. */
export function canDrop(actor: Actor): boolean {
  return permission.isLead(actor, KOL_DIVISION) || permission.isLead(actor, ACCOUNT_DIVISION);
}

/** canContinueEscalation: the owning AM, the Booking's Coordinator/lead, or Director. */
export function canContinueEscalation(actor: Actor, r: { division: string; coordinator: string; ownerAm: string }): boolean {
  return actor.employeeId === r.ownerAm || canExecute(actor, r);
}

/** canManageBooking is the §3 Rule 3 assign/SLA gate: the KOL Team Leader or Director. */
export function canManageBooking(actor: Actor): boolean {
  return permission.isLead(actor, KOL_DIVISION);
}

/** canLogHours: the assigned Coordinator, the KOL lead, or Director. */
export function canLogHours(actor: Actor, r: { coordinator: string }): boolean {
  if (actor.role.director) {
    return true;
  }
  if (permission.isLead(actor, KOL_DIVISION)) {
    return true;
  }
  return r.coordinator !== '' && actor.employeeId === r.coordinator;
}

/** canFinance: Admin & Finance (any level) or Director (§8 Rule 1). */
export function canFinance(actor: Actor): boolean {
  return actor.role.director || actor.role.division === FINANCE_DIVISION;
}

/** canSeeBooking is the §10.1 read predicate. */
export function canSeeBooking(actor: Actor, ownerAm: string, division: string): boolean {
  if (permission.canReadAll(actor)) {
    return true;
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true;
  }
  if (actor.employeeId === ownerAm) {
    return true;
  }
  return actor.role.division === division &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/** canManageCreatorList: the Brief's KOL staff/lead, the owning AM, or Director (§6). */
export function canManageCreatorList(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.employeeId === ownerAm) {
    return true;
  }
  return actor.role.division === KOL_DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/**
 * validateKOLStaff enforces that id is an ACTIVE employee whose resolved CDPS
 * division is KOL and whose level is staff (a single accountable Coordinator, §3).
 */
async function validateKolStaff(tx: Queryable, id: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${id}`;
  if (rows.length === 0) {
    throw new ValidationError(MSG_INVALID_COORDINATOR);
  }
  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  if (!active || r.division !== KOL_DIVISION || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_COORDINATOR);
  }
}

// --- Types ---

/** The caller-supplied §10.3 Booking fields. */
export interface BookingInput {
  creatorName: string;
  creatorHandle?: string;
  platform: string;
  niche?: string;
  sourcePool: string;
  poolReference?: string;
  agreedRate: string; // decimal string
  assignedCoordinator?: string;
  qtyVideo?: number; // per-creator video deliverables (>= 0 integer); absent => 0
  qtyLive?: number; // per-creator live-session deliverables (>= 0 integer); absent => 0
}

/** One Creator Booking (BKG-) with its derived read-only fields. */
export interface Booking {
  id: string;
  briefId: string;
  creatorName: string;
  creatorHandle: string;
  platform: string;
  niche: string;
  sourcePool: string;
  poolReference: string;
  agreedRate: number;
  agreedRateDisplay: string;
  status: string;
  contentLink: string;
  qcNotes: string;
  slaTargetHours: number | null;
  hoursLogged: number | null;
  assignedCoordinator: string;
  attributedGmv: number | null;
  qtyVideo: number; // per-creator video deliverables (>= 0)
  qtyLive: number; // per-creator live-session deliverables (>= 0)
  revisionCount: number;
  paymentStatus: string; // reflection of the linked CPR (§8 Rule 4); "" if none
  createdBy: string;
  createdAt: Date;
}

/** One Creator Payment Request (CPR-). */
export interface PaymentRequest {
  id: string;
  bookingId: string;
  amount: number;
  amountDisplay: string;
  paymentDetails: string;
  status: string;
  rejectionReason: string;
  requestedBy: string;
  paidBy: string;
  createdBy: string;
  createdAt: Date;
}

// --- Create ---

/**
 * createBooking breaks one creator engagement out of a KOL Brief (§4). Creatable
 * by the Brief's KOL staff/lead (self-claim / Team Leader) or Director while the
 * Brief is live. Born [Sourcing].
 */
export async function createBooking(sql: Sql, actor: Actor, briefId: string, input: BookingInput): Promise<Booking> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const briefRows = await tx<{ assigned_division: string; status: string }[]>`
      select assigned_division, status from briefs where id = ${briefId} for update`;
    if (briefRows.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    if (briefRows[0].assigned_division !== KOL_DIVISION) {
      throw new ConflictError(MSG_NOT_KOL_BRIEF);
    }
    if (briefRows[0].status === BRIEF_APPROVED || briefRows[0].status === SERVICE_VOIDED) {
      throw new ConflictError(MSG_BRIEF_NOT_BOOKABLE);
    }
    if (!canCreateBooking(actor)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    const creatorName = (input.creatorName ?? '').trim();
    const platform = (input.platform ?? '').trim();
    const pool = (input.sourcePool ?? '').trim();
    if (creatorName === '' || platform === '' || pool === '' || (input.agreedRate ?? '').trim() === '') {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!SOURCE_POOLS.has(pool)) {
      throw new ValidationError(MSG_INVALID_SOURCE_POOL);
    }
    let rate: money.Money;
    try {
      rate = money.parse(input.agreedRate);
    } catch {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (rate <= 0n) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    const qtyVideo = normQty(input.qtyVideo);
    const qtyLive = normQty(input.qtyLive);
    let coord = (input.assignedCoordinator ?? '').trim();
    if (coord === '' && actor.role.division === KOL_DIVISION && actor.role.level === permission.LevelStaff) {
      coord = actor.employeeId; // self-claim (§3)
    }
    if (coord !== '') {
      await validateKolStaff(tx, coord);
    }

    const id = await ex.ident.identNext('BKG', now);
    await tx`
      insert into creator_bookings (id, brief_id, creator_name, creator_handle, platform, niche, source_pool,
        pool_reference, agreed_rate, status, assigned_coordinator, qty_video, qty_live, created_by)
      values (${id}, ${briefId}, ${creatorName}, ${orNull(input.creatorHandle)}, ${platform}, ${orNull(input.niche)},
        ${pool}, ${orNull(input.poolReference)}, ${money.decimal(rate)}, ${BKG_SOURCING}, ${coord || null},
        ${qtyVideo}, ${qtyLive}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { status: BKG_SOURCING, brief_id: briefId, source_pool: pool, agreed_rate: money.decimal(rate) },
      createdBy: actor.employeeId,
    });
    return {
      id, briefId, creatorName, creatorHandle: (input.creatorHandle ?? '').trim(), platform,
      niche: (input.niche ?? '').trim(), sourcePool: pool, poolReference: (input.poolReference ?? '').trim(),
      agreedRate: Number(rate) / 100, agreedRateDisplay: money.format(rate), status: BKG_SOURCING,
      contentLink: '', qcNotes: '', slaTargetHours: null, hoursLogged: null, assignedCoordinator: coord,
      attributedGmv: null, qtyVideo, qtyLive, revisionCount: 0, paymentStatus: '', createdBy: actor.employeeId, createdAt: now,
    };
  });
}

// --- Native lifecycle (§4/§5) ---

/** book confirms terms: [Sourcing] → [Booked] (§4 Flow 1). First Booking advances the Brief. */
export function book(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_SOURCING, BKG_BOOKED, canExecute, MSG_EXEC_FORBIDDEN);
}
/** startContent: [Booked] → [Content In Progress] (§4 Flow 2). */
export function startContent(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_BOOKED, BKG_CONTENT_IN_PROG, canExecute, MSG_EXEC_FORBIDDEN);
}
/** submitContent attaches the content link and moves to [Content Submitted] (§4 Rule 3). */
export function submitContent(sql: Sql, actor: Actor, id: string, contentLink: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_CONTENT_IN_PROG, BKG_CONTENT_SUBMIT, canExecute, MSG_EXEC_FORBIDDEN, setContentLink(contentLink, true));
}
/** sendToQCReview: [Content Submitted] → [QC Review] (§5, QC done by KOL itself). */
export function sendToQCReview(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_CONTENT_SUBMIT, BKG_QC_REVIEW, canExecute, MSG_EXEC_FORBIDDEN);
}
/** passQC: [QC Review] → [QC Passed] (terminal, §5 Rule 2). */
export function passQC(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_QC_REVIEW, BKG_QC_PASSED, canExecute, MSG_EXEC_FORBIDDEN);
}
/** resubmit re-attaches revised content: [QC Failed] → [Content Submitted] (§5 Rule 2). */
export function resubmit(sql: Sql, actor: Actor, id: string, contentLink: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_QC_FAILED, BKG_CONTENT_SUBMIT, canExecute, MSG_EXEC_FORBIDDEN, setContentLink(contentLink, true));
}

/**
 * failQC requests a revision with mandatory feedback: [QC Review] → [QC Failed]
 * (§5 Rule 2). The M9-OA-2 cap (1 round) is enforced from the derived count — once
 * reached, only escalation remains (ConflictError).
 */
export function failQC(sql: Sql, actor: Actor, id: string, qcNotes: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_QC_REVIEW, BKG_QC_FAILED, canExecute, MSG_EXEC_FORBIDDEN, async (tx, r) => {
    if ((qcNotes ?? '').trim() === '') {
      throw new ValidationError(MSG_QC_NOTES_REQUIRED);
    }
    if (await deriveRevisionCount(tx, id) >= REVISION_CAP) {
      throw new ConflictError(MSG_REVISION_CAP_REACHED);
    }
    await setQcNotes(tx, id, qcNotes);
    void r;
  });
}

/**
 * escalate: [QC Review] → [Escalated] (§5 Rule 3 / §10.1). The assigned
 * Coordinator, KOL Team Leader, or Director; notes mandatory. Per B2
 * (DECISIONS 2026-08-18) the Coordinator — not only the lead — may escalate
 * "when needed" (§10.1): a Coordinator's escalation surfaces to the SPV (KOL
 * Team Leader), who under M9-OA-6 may take it up to the Director. The tier is
 * written to the immutable audit log (companion `escalated` row) so both the
 * escalation and its later resolution (continue / drop) are reviewable.
 */
export function escalate(sql: Sql, actor: Actor, id: string, qcNotes: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_QC_REVIEW, BKG_ESCALATED, canEscalate, MSG_ESCALATE_FORBIDDEN, async (tx) => {
    if ((qcNotes ?? '').trim() === '') {
      throw new ValidationError(MSG_QC_NOTES_REQUIRED);
    }
    await setQcNotes(tx, id, qcNotes);
    await executors(tx).audit.insertAudit({
      entityType: 'creator_booking', entityId: id, actorEmployeeId: actor.employeeId, action: 'escalated',
      beforeJson: null, afterJson: { escalated_to: escalationTier(actor), notes: qcNotes.trim() }, createdBy: actor.employeeId,
    });
  });
}

/** continueFromEscalation: [Escalated] → [Content Submitted] (§5 Rule 4). AM/Coordinator/lead/Director. */
export function continueFromEscalation(sql: Sql, actor: Actor, id: string, contentLink: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, BKG_ESCALATED, BKG_CONTENT_SUBMIT, canContinueEscalation, MSG_EXEC_FORBIDDEN, setContentLink(contentLink, false));
}

/**
 * drop terminally excludes a Booking (§5 Rule 4). Valid from [Escalated] /
 * [Content In Progress] / [Booked] / [Sourcing]. KOL lead / Account lead /
 * Director; reason mandatory (logged). The [Content In Progress] path (B1,
 * DECISIONS 2026-08-18) unblocks a creator who goes unresponsive AFTER terms
 * are agreed but BEFORE ever submitting content — otherwise the Booking is
 * stuck (it can reach neither [QC Review] nor [Escalated]). A dropped-for-
 * unresponsiveness creator is recorded to the blacklist (manual Google-Sheet
 * for now — no CDPS table yet); the drop reason stays in the immutable log.
 */
export async function drop(sql: Sql, actor: Actor, id: string, reason: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, id);
    if (!canDrop(actor)) {
      throw new ForbiddenError(MSG_DROP_FORBIDDEN);
    }
    if (r.status !== BKG_ESCALATED && r.status !== BKG_CONTENT_IN_PROG && r.status !== BKG_BOOKED && r.status !== BKG_SOURCING) {
      throw new ConflictError(bi.TRANSITION_NOT_ALLOWED);
    }
    if ((reason ?? '').trim() === '') {
      throw new ValidationError(MSG_DROP_REASON_REQUIRED);
    }
    await setQcNotes(tx, id, reason);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BOOKING, entityType: 'creator_booking', table: 'creator_bookings', entityId: id, to: BKG_DROPPED, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: id, actorEmployeeId: actor.employeeId, action: 'drop_reason',
      beforeJson: null, afterJson: { reason: reason.trim() }, createdBy: actor.employeeId,
    });
    await recomputeBriefRollup(tx, actor, r.briefId);
    return res;
  });
}

/**
 * edge is the shared, gated engine driver for one Booking transition: lock, gate,
 * pin the source state, run an optional `mutate` (persist link / QC notes, enforce
 * the revision cap) BEFORE the status change, drive the engine, recompute the Brief
 * roll-up — all atomically. Throws on gate/pin/mutate/engine failure; returns the ok result.
 */
async function edge(
  sql: Sql,
  actor: Actor,
  id: string,
  from: string,
  to: string,
  gate: (a: Actor, r: BookingRow) => boolean,
  forbiddenMsg: string,
  mutate?: (tx: Queryable, r: BookingRow) => Promise<void>,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, id);
    if (!gate(actor, r)) {
      throw new ForbiddenError(forbiddenMsg);
    }
    if (r.status !== from) {
      throw new ConflictError(bi.TRANSITION_NOT_ALLOWED); // pin the source state
    }
    if (mutate) {
      await mutate(tx, r);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BOOKING, entityType: 'creator_booking', table: 'creator_bookings', entityId: id, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    await recomputeBriefRollup(tx, actor, r.briefId);
    return res;
  });
}

/** setContentLink returns a mutate persisting the content link before [Content Submitted]. */
function setContentLink(link: string, required: boolean): (tx: Queryable, r: BookingRow) => Promise<void> {
  return async (tx, r) => {
    const l = (link ?? '').trim();
    if (l === '') {
      if (required) {
        throw new ValidationError(MSG_CONTENT_LINK_REQUIRED);
      }
      const existing = (await tx<{ content_link: string | null }[]>`select content_link from creator_bookings where id = ${r.id}`)[0]?.content_link;
      if (!existing || existing.trim() === '') {
        throw new ValidationError(MSG_CONTENT_LINK_REQUIRED);
      }
      return;
    }
    await tx`update creator_bookings set content_link = ${l} where id = ${r.id}`;
  };
}

/** setQcNotes writes the Booking's QC Notes display column (immutable history is in the log). */
async function setQcNotes(tx: Queryable, id: string, notes: string): Promise<void> {
  await tx`update creator_bookings set qc_notes = ${(notes ?? '').trim()} where id = ${id}`;
}

// --- Coordinator / SLA / Hours (§3 / §7) ---

/**
 * assignCoordinator sets the Booking's owning Coordinator (§3 Flow 2). KOL Team
 * Leader/Director only; the Coordinator must be active KOL staff. A reassignment
 * (already assigned to a different Coordinator) requires a mandatory reason.
 */
export async function assignCoordinator(sql: Sql, actor: Actor, bookingId: string, coordId: string, reason: string): Promise<void> {
  const coord = (coordId ?? '').trim();
  if (coord === '') {
    throw new ValidationError(MSG_INVALID_COORDINATOR);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, bookingId);
    if (!canManageBooking(actor)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    await validateKolStaff(tx, coord);
    const reassign = r.coordinator !== '' && r.coordinator !== coord;
    if (reassign && (reason ?? '').trim() === '') {
      throw new ValidationError(MSG_REASSIGN_REASON_REQUIRED);
    }
    await tx`update creator_bookings set assigned_coordinator = ${coord} where id = ${bookingId}`;
    const after: Record<string, unknown> = { assigned_coordinator: coord, assigned_by: actor.employeeId };
    if (reassign) {
      after.reason = reason.trim();
    }
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: bookingId, actorEmployeeId: actor.employeeId,
      action: reassign ? 'coordinator_reassigned' : 'coordinator_assigned',
      beforeJson: { assigned_coordinator: r.coordinator || null }, afterJson: after, createdBy: actor.employeeId,
    });
  });
}

/** setSlaTarget sets the Booking-level SLA Target in hours (DATA_MODEL §3). KOL lead/Director; > 0. */
export async function setSlaTarget(sql: Sql, actor: Actor, bookingId: string, hours: number): Promise<void> {
  if (!(hours > 0)) {
    throw new ValidationError(MSG_INVALID_SLA);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await lockBooking(tx, bookingId);
    if (!canManageBooking(actor)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    const prev = (await tx<{ sla_target_hours: string | null }[]>`select sla_target_hours from creator_bookings where id = ${bookingId}`)[0].sla_target_hours;
    await tx`update creator_bookings set sla_target_hours = ${hours} where id = ${bookingId}`;
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: bookingId, actorEmployeeId: actor.employeeId, action: 'sla_target_set',
      beforeJson: { sla_target_hours: prev === null ? null : Number(prev) }, afterJson: { sla_target_hours: hours }, createdBy: actor.employeeId,
    });
  });
}

/** logHours sets the Booking's Hours Logged (§7 Rule 2, non-punitive). Coordinator/lead/Director; > 0. */
export async function logHours(sql: Sql, actor: Actor, bookingId: string, hours: number): Promise<void> {
  if (!(hours > 0)) {
    throw new ValidationError(MSG_INVALID_SLA);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, bookingId);
    if (!canLogHours(actor, r)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    const prev = (await tx<{ hours_logged: string | null }[]>`select hours_logged from creator_bookings where id = ${bookingId}`)[0].hours_logged;
    await tx`update creator_bookings set hours_logged = ${hours} where id = ${bookingId}`;
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: bookingId, actorEmployeeId: actor.employeeId, action: 'hours_logged',
      beforeJson: { hours_logged: prev === null ? null : Number(prev) }, afterJson: { hours_logged: hours }, createdBy: actor.employeeId,
    });
  });
}

/**
 * recordAttributedGmv writes back a Booking's Attributed GMV (§10.3 / M9-OA-4).
 * Coordinator/lead/Director; only once [QC Passed]. Zero is legitimate; negative/
 * unparseable rejected. Returns the stored rupiah value + house display.
 */
export async function recordAttributedGmv(sql: Sql, actor: Actor, bookingId: string, gmvStr: string): Promise<{ value: number; display: string }> {
  let gmv: money.Money;
  try {
    gmv = money.parse(gmvStr);
  } catch {
    throw new ValidationError(MSG_BAD_AMOUNT);
  }
  if (gmv < 0n) {
    throw new ValidationError(MSG_BAD_AMOUNT);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, bookingId);
    if (!canLogHours(actor, r)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    if (r.status !== BKG_QC_PASSED) {
      throw new ConflictError(MSG_GMV_BOOKING_NOT_PASSED);
    }
    const prev = (await tx<{ attributed_gmv: string | null }[]>`select attributed_gmv from creator_bookings where id = ${bookingId}`)[0].attributed_gmv;
    await tx`update creator_bookings set attributed_gmv = ${money.decimal(gmv)} where id = ${bookingId}`;
    await ex.audit.insertAudit({
      entityType: 'creator_booking', entityId: bookingId, actorEmployeeId: actor.employeeId, action: 'attributed_gmv_recorded',
      beforeJson: { attributed_gmv: prev === null ? null : Number(prev) }, afterJson: { attributed_gmv: Number(gmv) / 100 }, createdBy: actor.employeeId,
    });
    return { value: Number(gmv) / 100, display: money.format(gmv) };
  });
}

// --- Creator Payment Request (§8) ---

/**
 * createPaymentRequest opens a CPR once a Booking is [QC Passed] (§8 Rule 2). The
 * Amount MUST equal the Booking's Agreed Rate; details mandatory. Coordinator/
 * Director. Blocks if an active (non-[Rejected]) request already exists.
 */
export async function createPaymentRequest(sql: Sql, actor: Actor, bookingId: string, amountStr: string, paymentDetails: string): Promise<PaymentRequest> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBooking(tx, bookingId);
    if (!canExecute(actor, r)) {
      throw new ForbiddenError(MSG_PAYMENT_MANAGE_FORBIDDEN);
    }
    if (r.status !== BKG_QC_PASSED) {
      throw new ConflictError(MSG_PAYMENT_BOOKING_NOT_PASSED);
    }
    if ((paymentDetails ?? '').trim() === '') {
      throw new ValidationError(MSG_PAYMENT_DETAILS_REQUIRED);
    }
    const rateStr = (await tx<{ agreed_rate: string }[]>`select agreed_rate from creator_bookings where id = ${bookingId}`)[0].agreed_rate;
    const rate = money.parse(rateStr);
    let amount: money.Money;
    try {
      amount = money.parse(amountStr);
    } catch {
      throw new ValidationError(MSG_BAD_AMOUNT);
    }
    if (amount !== rate) {
      throw new ValidationError(MSG_PAYMENT_AMOUNT_MISMATCH);
    }
    const active = Number((await tx<{ n: string }[]>`
      select count(*) as n from creator_payment_requests where booking_id = ${bookingId} and status <> ${CPR_REJECTED}`)[0].n);
    if (active > 0) {
      throw new ConflictError(MSG_PAYMENT_ALREADY_REQUESTED);
    }

    const id = await ex.ident.identNext('CPR', now);
    const details = paymentDetails.trim();
    await tx`
      insert into creator_payment_requests (id, booking_id, amount, payment_details, status, requested_by, created_by)
      values (${id}, ${bookingId}, ${money.decimal(amount)}, ${details}, ${CPR_REQUESTED}, ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'creator_payment_request', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { status: CPR_REQUESTED, booking_id: bookingId, amount: money.decimal(amount) }, createdBy: actor.employeeId,
    });
    return {
      id, bookingId, amount: Number(amount) / 100, amountDisplay: money.format(amount), paymentDetails: details,
      status: CPR_REQUESTED, rejectionReason: '', requestedBy: actor.employeeId, paidBy: '', createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/** receiveByFinance: [Requested] → [Received by Finance] (§8 Flow 2). Finance/Director. */
export function receiveByFinance(sql: Sql, actor: Actor, requestId: string): Promise<statemachine.TransitionResult> {
  return driveCpr(sql, actor, requestId, CPR_RECEIVED, '');
}
/** markPaid: [Received by Finance] → [Paid] (§8 Flow 2). Finance/Director; records the paying PIC. */
export function markPaid(sql: Sql, actor: Actor, requestId: string): Promise<statemachine.TransitionResult> {
  return driveCpr(sql, actor, requestId, CPR_PAID, '');
}
/** reject: [Received by Finance] → [Rejected] (§8 Rule 3). Finance/Director; reason mandatory. */
export async function reject(sql: Sql, actor: Actor, requestId: string, reason: string): Promise<statemachine.TransitionResult> {
  if ((reason ?? '').trim() === '') {
    throw new ValidationError(MSG_REJECTION_REASON_REQUIRED);
  }
  return driveCpr(sql, actor, requestId, CPR_REJECTED, reason);
}

async function driveCpr(sql: Sql, actor: Actor, requestId: string, to: string, reason: string): Promise<statemachine.TransitionResult> {
  if (!canFinance(actor)) {
    throw new ForbiddenError(MSG_FINANCE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ status: string }[]>`select status from creator_payment_requests where id = ${requestId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_PAYMENT_REQUEST_NOT_FOUND);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_CPR, entityType: 'creator_payment_request', table: 'creator_payment_requests', entityId: requestId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    if (to === CPR_PAID) {
      await tx`update creator_payment_requests set paid_by = ${actor.employeeId} where id = ${requestId}`;
    } else if (to === CPR_REJECTED) {
      await tx`update creator_payment_requests set rejection_reason = ${reason.trim()} where id = ${requestId}`;
      await ex.audit.insertAudit({
        entityType: 'creator_payment_request', entityId: requestId, actorEmployeeId: actor.employeeId, action: 'rejection_reason',
        beforeJson: null, afterJson: { reason: reason.trim() }, createdBy: actor.employeeId,
      });
    }
    return res;
  });
}

// --- Brief → Booking roll-up (§2) ---

const ROLLUP_CHAIN = ['[To Do]', STATUS_IN_PROGRESS, STATUS_SUBMITTED, STATUS_IN_REVIEW, STATUS_APPROVED];

function chainRank(status: string): number {
  return ROLLUP_CHAIN.indexOf(status);
}

/**
 * recomputeBriefRollup recomputes a KOL Brief's roll-up status from its Bookings
 * and drives it forward through the engine (§2). Idempotent, forward-only; when the
 * Brief first leaves [To Do] the parent Service advances via account.onBriefLeavesToDo.
 */
async function recomputeBriefRollup(tx: Queryable, actor: Actor, briefId: string): Promise<void> {
  if (briefId === '') {
    return;
  }
  const rows = await tx<{ status: string; service_id: string; quantity_target: number }[]>`
    select status, service_id, quantity_target from briefs where id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  let cur = chainRank(rows[0].status);
  if (cur < 0) {
    return;
  }
  const statuses = (await tx<{ status: string }[]>`select status from creator_bookings where brief_id = ${briefId}`).map((b) => b.status);
  if (statuses.length === 0) {
    return;
  }
  const tgt = chainRank(rollupTarget(statuses, rows[0].quantity_target));
  const ex = executors(tx);
  while (cur < tgt) {
    const from = ROLLUP_CHAIN[cur];
    const to = ROLLUP_CHAIN[cur + 1];
    // M11 §6.3 Blocking gate on the final [Approved] edge (aborts the roll-up tx if blocked).
    if (to === STATUS_APPROVED) {
      await validateBriefApproval(tx, briefId);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: 'brief_task', entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    if (from === '[To Do]') {
      await onBriefLeavesToDo(tx, actor, rows[0].service_id);
    }
    // M11 §5.5: on reaching terminal, fire EvDependencySatisfied once per sourced Dependency.
    if (to === STATUS_APPROVED) {
      await onBriefReachedTerminal(tx, actor, briefId);
    }
    cur++;
  }
}

/** rollupTarget maps the Booking statuses (+ expected count) to the Brief's target (§2). */
function rollupTarget(statuses: string[], expected: number): string {
  const created = statuses.length;
  let anyStarted = false;
  let allResolved = true;
  let allDeliveredOrDropped = true;
  let allExactlySubmittedOrDropped = true;
  for (const st of statuses) {
    if (st !== BKG_SOURCING) anyStarted = true;
    if (!bkgResolved(st)) allResolved = false;
    if (!(bkgDelivered(st) || st === BKG_DROPPED)) allDeliveredOrDropped = false;
    if (!(st === BKG_CONTENT_SUBMIT || st === BKG_DROPPED)) allExactlySubmittedOrDropped = false;
  }
  const allExist = expected > 0 && created >= expected;
  if (allExist && allResolved) {
    return STATUS_APPROVED;
  }
  if (allExist && allDeliveredOrDropped) {
    return allExactlySubmittedOrDropped ? STATUS_SUBMITTED : STATUS_IN_REVIEW;
  }
  if (anyStarted) {
    return STATUS_IN_PROGRESS;
  }
  return '[To Do]';
}

/** bkgDelivered: has the Booking delivered content at least once (in/past [Content Submitted]). */
function bkgDelivered(st: string): boolean {
  return st === BKG_CONTENT_SUBMIT || st === BKG_QC_REVIEW || st === BKG_QC_PASSED || st === BKG_QC_FAILED || st === BKG_ESCALATED;
}
/** bkgResolved: a terminal outcome for the roll-up ([QC Passed] or [Dropped]). */
function bkgResolved(st: string): boolean {
  return st === BKG_QC_PASSED || st === BKG_DROPPED;
}

// --- Reads (§10.1) ---

/** getBooking returns one Booking with its derived Revision Count + Payment Status reflection. */
export async function getBooking(sql: Queryable, actor: Actor, bookingId: string): Promise<Booking> {
  const rows = await sql<BookingDbRow[]>`${bookingSelect(sql)} where bk.id = ${bookingId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BOOKING_NOT_FOUND);
  }
  if (!canSeeBooking(actor, rows[0].assigned_am_id ?? '', rows[0].assigned_division)) {
    throw new ForbiddenError(MSG_BOOKING_VIEW_FORBIDDEN);
  }
  const b = rowToBooking(rows[0]);
  b.revisionCount = await deriveRevisionCount(sql, bookingId);
  b.paymentStatus = await paymentReflection(sql, bookingId);
  return b;
}

/** listBriefBookings returns all Bookings of a KOL Brief in id order, view-gated. */
export async function listBriefBookings(sql: Queryable, actor: Actor, briefId: string): Promise<Booking[]> {
  const owner = await sql<{ assigned_division: string; assigned_am_id: string | null }[]>`
    select b.assigned_division, private.brief_owner_am(b.id) as assigned_am_id from briefs b where b.id = ${briefId}`;
  if (owner.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  if (!canSeeBooking(actor, owner[0].assigned_am_id ?? '', owner[0].assigned_division)) {
    throw new ForbiddenError(MSG_BOOKING_VIEW_FORBIDDEN);
  }
  const rows = await sql<BookingDbRow[]>`${bookingSelect(sql)} where bk.brief_id = ${briefId} order by bk.id asc`;
  // P-1: the two derived reads per booking used to run strictly one after another,
  // so N bookings cost 2N sequential round-trips. They are independent read-only
  // lookups — issue them together and let the driver pipeline them. Order and
  // values are unchanged.
  const out = rows.map(rowToBooking);
  await Promise.all(
    out.map(async (b) => {
      const [revisionCount, paymentStatus] = await Promise.all([
        deriveRevisionCount(sql, b.id),
        paymentReflection(sql, b.id),
      ]);
      b.revisionCount = revisionCount;
      b.paymentStatus = paymentStatus;
    }),
  );
  return out;
}

/** getPaymentRequest returns one CPR if the actor is Finance or may see the parent Booking. */
export async function getPaymentRequest(sql: Queryable, actor: Actor, requestId: string): Promise<PaymentRequest> {
  const rows = await sql<
    { id: string; booking_id: string; amount: string; payment_details: string; status: string; rejection_reason: string | null; requested_by: string; paid_by: string | null; created_by: string; created_at: Date; assigned_division: string; assigned_am_id: string | null }[]
  >`
    select cpr.id, cpr.booking_id, cpr.amount, cpr.payment_details, cpr.status, cpr.rejection_reason,
           cpr.requested_by, cpr.paid_by, cpr.created_by, cpr.created_at, b.assigned_division,
           private.brief_owner_am(bk.brief_id) as assigned_am_id
      from creator_payment_requests cpr
      join creator_bookings bk on bk.id = cpr.booking_id
      join briefs b on b.id = bk.brief_id
     where cpr.id = ${requestId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_PAYMENT_REQUEST_NOT_FOUND);
  }
  const r = rows[0];
  if (!(canFinance(actor) || canSeeBooking(actor, r.assigned_am_id ?? '', r.assigned_division))) {
    throw new ForbiddenError(MSG_BOOKING_VIEW_FORBIDDEN);
  }
  const amt = money.parse(r.amount);
  return {
    id: r.id, bookingId: r.booking_id, amount: Number(amt) / 100, amountDisplay: money.format(amt),
    paymentDetails: r.payment_details, status: r.status, rejectionReason: r.rejection_reason ?? '',
    requestedBy: r.requested_by, paidBy: r.paid_by ?? '', createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** paymentReflection = the status of a Booking's most recent CPR (§8 Rule 4), "" if none. */
async function paymentReflection(sql: Queryable, bookingId: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`
    select status from creator_payment_requests where booking_id = ${bookingId} order by id desc limit 1`;
  return rows.length > 0 ? rows[0].status : '';
}

/** deriveRevisionCount counts [QC Review] → [QC Failed] transitions in the log (§5 Rule 5). */
async function deriveRevisionCount(sql: Queryable, bookingId: string): Promise<number> {
  const action = `transition:${BKG_QC_REVIEW}->${BKG_QC_FAILED}`;
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from audit_log where entity_type = 'creator_booking' and entity_id = ${bookingId} and action = ${action}`;
  return Number(rows[0].n);
}

// --- Creator List (§6) ---

/** The Brief-level compiled Creator List output (§10.5). */
export interface CreatorList {
  briefId: string;
  creatorListLink: string;
  includedBookings: string[];
  lastCompiled: Date | null;
  eligibleBookings: string[];
}

/**
 * generateCreatorList compiles/refreshes the Brief's Creator List (§6 / M9-OA-3):
 * the Coordinator supplies the Drive link; the system snapshots the currently-
 * eligible ([QC Passed]) Bookings + records the compile time. KOL staff/lead / owning
 * AM / Director. Upserts the single per-Brief row.
 */
export async function generateCreatorList(sql: Sql, actor: Actor, briefId: string, link: string): Promise<CreatorList> {
  if ((link ?? '').trim() === '') {
    throw new ValidationError(MSG_CREATOR_LIST_LINK_REQUIRED);
  }
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const owner = await tx<{ assigned_division: string; assigned_am_id: string | null }[]>`
      select b.assigned_division, c.assigned_am_id from briefs b join services sv on sv.id = b.service_id join clients c on c.id = sv.client_id where b.id = ${briefId} for update`;
    if (owner.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    if (owner[0].assigned_division !== KOL_DIVISION) {
      throw new ConflictError(MSG_NOT_KOL_BRIEF);
    }
    if (!canManageCreatorList(actor, owner[0].assigned_am_id ?? '')) {
      throw new ForbiddenError(MSG_CREATOR_LIST_FORBIDDEN);
    }
    const eligible = await eligibleBookings(tx, briefId);
    const l = link.trim();
    await tx`
      insert into creator_lists (brief_id, creator_list_link, included_bookings, last_compiled, created_by)
      values (${briefId}, ${l}, ${JSON.stringify(eligible)}, ${now}, ${actor.employeeId})
      on conflict (brief_id) do update set creator_list_link = excluded.creator_list_link,
        included_bookings = excluded.included_bookings, last_compiled = excluded.last_compiled`;
    await ex.audit.insertAudit({
      entityType: 'creator_list', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'compiled',
      beforeJson: null, afterJson: { link: l, included_bookings: eligible }, createdBy: actor.employeeId,
    });
    return { briefId, creatorListLink: l, includedBookings: eligible, lastCompiled: now, eligibleBookings: eligible };
  });
}

/** getCreatorList returns the compiled list + the LIVE eligible set, view-gated. */
export async function getCreatorList(sql: Queryable, actor: Actor, briefId: string): Promise<CreatorList> {
  const owner = await sql<{ assigned_division: string; assigned_am_id: string | null }[]>`
    select b.assigned_division, private.brief_owner_am(b.id) as assigned_am_id from briefs b where b.id = ${briefId}`;
  if (owner.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  if (owner[0].assigned_division !== KOL_DIVISION) {
    throw new ConflictError(MSG_NOT_KOL_BRIEF);
  }
  if (!canSeeBooking(actor, owner[0].assigned_am_id ?? '', owner[0].assigned_division)) {
    throw new ForbiddenError(MSG_BOOKING_VIEW_FORBIDDEN);
  }
  const cl: CreatorList = { briefId, creatorListLink: '', includedBookings: [], lastCompiled: null, eligibleBookings: [] };
  const rows = await sql<{ creator_list_link: string | null; included_bookings: string | null; last_compiled: Date | null }[]>`
    select creator_list_link, included_bookings, last_compiled from creator_lists where brief_id = ${briefId}`;
  if (rows.length > 0) {
    cl.creatorListLink = rows[0].creator_list_link ?? '';
    if (rows[0].included_bookings) {
      try {
        cl.includedBookings = JSON.parse(rows[0].included_bookings) as string[];
      } catch {
        cl.includedBookings = [];
      }
    }
    cl.lastCompiled = rows[0].last_compiled;
  }
  cl.eligibleBookings = await eligibleBookings(sql, briefId);
  return cl;
}

/** eligibleBookings returns every [QC Passed] Booking id under a Brief, in id order (§6 Rule 2). */
async function eligibleBookings(sql: Queryable, briefId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from creator_bookings where brief_id = ${briefId} and status = ${BKG_QC_PASSED} order by id asc`;
  return rows.map((r) => r.id);
}

// --- Metrics (§7 + §11 mapping) ---

/** The read-only computed view of one Booking's time-tracking. */
export interface BookingMetrics {
  bookingId: string;
  status: string;
  slaTargetHours: number | null;
  sourcingTurnaroundHours: number | null;
  deliveryTurnaroundHours: number | null;
  overallTurnaroundHours: number | null;
  speedScorePct: number | null;
  speedScoreDisplay: string;
  revisionCount: number;
  excludedFromSpeedScore: boolean;
  approvedPeriodWib: string;
}

/** bookingMetrics returns a Booking's recomputed-from-log metrics, view-gated. */
export async function bookingMetrics(sql: Queryable, actor: Actor, bookingId: string): Promise<BookingMetrics> {
  const rows = await sql<{ assigned_division: string; status: string; created_at: Date; sla_target_hours: string | null; assigned_am_id: string | null }[]>`
    select b.assigned_division, bk.status, bk.created_at, bk.sla_target_hours,
           private.brief_owner_am(bk.brief_id) as assigned_am_id
      from creator_bookings bk
      join briefs b on b.id = bk.brief_id
     where bk.id = ${bookingId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BOOKING_NOT_FOUND);
  }
  const row = rows[0];
  if (!canSeeBooking(actor, row.assigned_am_id ?? '', row.assigned_division)) {
    throw new ForbiddenError(MSG_BOOKING_VIEW_FORBIDDEN);
  }
  const entries = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log where entity_type = 'creator_booking' and entity_id = ${bookingId} order by id asc`;
  const evs: { to: string; at: Date }[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      evs.push({ to, at: e.created_at });
    }
  }
  const sla = row.sla_target_hours === null ? null : Number(row.sla_target_hours);
  return computeBookingMetrics(bookingId, row.status, row.created_at, sla, evs);
}

/**
 * computeBookingMetrics is the pure metric core (§7 / §11), exported for unit
 * testing. `evs` MUST be chronologically ascending; `createdAt` is the birth
 * ([Sourcing]) timestamp used as the Sourcing-Turnaround start and the injected
 * first canonical [In Progress] for the §11-mapped overall turnaround.
 */
export function computeBookingMetrics(
  bookingId: string,
  status: string,
  createdAt: Date,
  sla: number | null,
  evs: { to: string; at: Date }[],
): BookingMetrics {
  const m: BookingMetrics = {
    bookingId, status, slaTargetHours: sla, sourcingTurnaroundHours: null, deliveryTurnaroundHours: null,
    overallTurnaroundHours: null, speedScorePct: null, speedScoreDisplay: 'N/A', revisionCount: countBkg(evs, BKG_QC_FAILED),
    excludedFromSpeedScore: false, approvedPeriodWib: '',
  };
  const MS_PER_HOUR = 3_600_000;
  const booked = firstBkg(evs, BKG_BOOKED);
  const submitted = firstBkg(evs, BKG_CONTENT_SUBMIT);
  if (booked !== null) {
    m.sourcingTurnaroundHours = (booked.getTime() - createdAt.getTime()) / MS_PER_HOUR;
  }
  if (booked !== null && submitted !== null) {
    m.deliveryTurnaroundHours = (submitted.getTime() - booked.getTime()) / MS_PER_HOUR;
  }
  if (status === BKG_DROPPED) {
    m.excludedFromSpeedScore = true; // §11: excluded entirely, not scored 0/100
    return m;
  }
  const cm = computeMetrics(mapToCanonical(createdAt, evs), sla);
  m.overallTurnaroundHours = cm.turnaroundHours;
  m.speedScorePct = cm.speedScorePct;
  m.speedScoreDisplay = cm.speedScoreDisplay;
  m.approvedPeriodWib = cm.approvedPeriodWib;
  return m;
}

/** mapToCanonical builds the §11-mapped canonical transition list ([Sourcing] birth → [In Progress]). */
function mapToCanonical(createdAt: Date, evs: { to: string; at: Date }[]): Transition[] {
  const out: Transition[] = [{ to: STATUS_IN_PROGRESS, at: createdAt }];
  for (const e of evs) {
    const c = nativeToCanonical(e.to);
    if (c !== null) {
      out.push({ to: c, at: e.at });
    }
  }
  return out;
}

/** nativeToCanonical maps a native Booking state to its canonical Task label (§11). */
function nativeToCanonical(native: string): string | null {
  switch (native) {
    case BKG_SOURCING:
    case BKG_BOOKED:
    case BKG_CONTENT_IN_PROG:
      return STATUS_IN_PROGRESS;
    case BKG_CONTENT_SUBMIT:
      return STATUS_SUBMITTED;
    case BKG_QC_REVIEW:
      return STATUS_IN_REVIEW;
    case BKG_QC_PASSED:
      return STATUS_APPROVED;
    case BKG_QC_FAILED:
      return STATUS_REVISION_REQ;
    case BKG_ESCALATED:
      return STATUS_BLOCKED;
    default: // BKG_DROPPED
      return null;
  }
}

function transitionTarget(action: string): string | null {
  const prefix = 'transition:';
  if (!action.startsWith(prefix)) {
    return null;
  }
  const idx = action.indexOf('->', prefix.length);
  return idx < 0 ? null : action.slice(idx + 2);
}

function firstBkg(evs: { to: string; at: Date }[], to: string): Date | null {
  for (const e of evs) {
    if (e.to === to) {
      return e.at;
    }
  }
  return null;
}

function countBkg(evs: { to: string; at: Date }[], to: string): number {
  return evs.filter((e) => e.to === to).length;
}

// --- Helpers ---

async function lockBooking(tx: Queryable, id: string): Promise<BookingRow> {
  const rows = await tx<{ id: string; brief_id: string; service_id: string; assigned_division: string; assigned_coordinator: string | null; status: string; assigned_am_id: string | null }[]>`
    select bk.id, bk.brief_id, b.service_id, b.assigned_division, bk.assigned_coordinator, bk.status, c.assigned_am_id
      from creator_bookings bk
      join briefs b on b.id = bk.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where bk.id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BOOKING_NOT_FOUND);
  }
  const r = rows[0];
  return {
    id: r.id, briefId: r.brief_id, serviceId: r.service_id, division: r.assigned_division,
    coordinator: r.assigned_coordinator ?? '', status: r.status, ownerAm: r.assigned_am_id ?? '',
  };
}

interface BookingDbRow {
  id: string;
  brief_id: string;
  creator_name: string;
  creator_handle: string | null;
  platform: string;
  niche: string | null;
  source_pool: string;
  pool_reference: string | null;
  agreed_rate: string;
  status: string;
  content_link: string | null;
  qc_notes: string | null;
  sla_target_hours: string | null;
  hours_logged: string | null;
  assigned_coordinator: string | null;
  attributed_gmv: string | null;
  qty_video: number | string | null;
  qty_live: number | string | null;
  created_by: string;
  created_at: Date;
  assigned_division: string;
  assigned_am_id: string | null;
}

function bookingSelect(sql: Queryable) {
  return sql`
    select bk.id, bk.brief_id, bk.creator_name, bk.creator_handle, bk.platform, bk.niche, bk.source_pool,
           bk.pool_reference, bk.agreed_rate, bk.status, bk.content_link, bk.qc_notes, bk.sla_target_hours,
           bk.hours_logged, bk.assigned_coordinator, bk.attributed_gmv, bk.qty_video, bk.qty_live,
           bk.created_by, bk.created_at,
           b.assigned_division, private.brief_owner_am(bk.brief_id) as assigned_am_id
      from creator_bookings bk
      join briefs b on b.id = bk.brief_id`;
}

const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

function rowToBooking(r: BookingDbRow): Booking {
  const rate = money.parse(r.agreed_rate);
  return {
    id: r.id, briefId: r.brief_id, creatorName: r.creator_name, creatorHandle: r.creator_handle ?? '',
    platform: r.platform, niche: r.niche ?? '', sourcePool: r.source_pool, poolReference: r.pool_reference ?? '',
    agreedRate: Number(rate) / 100, agreedRateDisplay: money.format(rate), status: r.status,
    contentLink: r.content_link ?? '', qcNotes: r.qc_notes ?? '', slaTargetHours: numOrNull(r.sla_target_hours),
    hoursLogged: numOrNull(r.hours_logged), assignedCoordinator: r.assigned_coordinator ?? '',
    attributedGmv: numOrNull(r.attributed_gmv), qtyVideo: Number(r.qty_video ?? 0), qtyLive: Number(r.qty_live ?? 0),
    revisionCount: 0, paymentStatus: '',
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

function orNull(s: string | undefined): string | null {
  return s && s.trim() !== '' ? s.trim() : null;
}

/** normQty coerces an optional deliverable count to a non-negative integer (absent => 0). */
function normQty(v: number | undefined): number {
  if (v === undefined || v === null) {
    return 0;
  }
  if (!Number.isInteger(v) || v < 0) {
    throw new ValidationError(MSG_INVALID_QTY);
  }
  return v;
}

function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}
