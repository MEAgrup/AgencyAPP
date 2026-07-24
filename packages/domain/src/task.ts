/**
 * Task Execution domain service (M12). Ported from Go's
 * `internal/module12_task/*`.
 *
 * "Task" is a ROLE, not an entity (DATA_MODEL §1): today the Brief itself plays
 * it for single-unit divisions (Ads / BRF-as-task, M12 §5.3b). M7's Creative
 * Asset (AST-) and M9's Creator Booking (BKG-) become additional task sources
 * when those modules are ported — they plug their rows into this SAME engine
 * (the canonical brief_task machine, STATE_MACHINES §7). This port wires the
 * Brief-as-task source; the Asset/Booking sources are deferred with M7/M9.
 *
 * Module 12 owns the DIVISION-side execution edges of the brief_task machine that
 * M6 deliberately left undriven (W2-M6-C4 deferral):
 *   [To Do]              → [In Progress]   (PIC starts — startTask)
 *   [In Progress]        → [Submitted]     (PIC submits — submitTask)
 *   [Revision Requested] → [In Progress]   (PIC reworks — reworkTask)
 *   [In Progress]        → [Blocked]       (SPV/Lead only — approveBlockRequest)
 *   [Blocked]            → [In Progress]   (SPV/Lead only — resumeTask)
 * The AM-side review edges ([Submitted]→[In Review]→[Approved]/[Revision
 * Requested]) stay in `account` (M6 §7) — this module never drives them.
 *
 * House rules honoured here:
 *   - a status column is ONLY ever written through the transition engine (never a
 *     raw UPDATE); when a Brief FIRST leaves [To Do], its parent Service advances
 *     [Briefed] → [In Execution] in the same transaction via account.onBriefLeavesToDo
 *     (M6 §5 Flow 3);
 *   - PIC and SLA Target are plain audited field writes (a relationship / input,
 *     not a lifecycle status), mirroring the AM-assignment pattern;
 *   - every computed field (turnaround, speed score, revision count) is DERIVED
 *     from the immutable transition log, never stored (house rules 3/4).
 *
 * Reference: backend/internal/module12_task/{source,task,assign,block,metrics}.go.
 */

import { bi, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { onBriefLeavesToDo } from './account';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const ACCOUNT_DIVISION = 'Account';
export const DIVISION_LIVE_STREAM = 'Live Stream';

// brief_task status labels (STATE_MACHINES §7).
export const STATUS_TODO = '[To Do]';
export const STATUS_IN_PROGRESS = '[In Progress]';
export const STATUS_SUBMITTED = '[Submitted]';
export const STATUS_REVISION_REQ = '[Revision Requested]';
export const STATUS_BLOCKED = '[Blocked]';
export const STATUS_VENDOR_DISPATCHED = '[Dispatched to Vendor]';

const MACHINE_BRIEF_TASK = 'brief_task';

/** §2 Rule 15 Quality-review auto-flag threshold (working default, O8). */
const REVISION_FLAG_THRESHOLD = 3;

// --- Verbatim BI messages (M12). Each mirrors a Go sentinel 1:1. ---

export const MSG_TASK_NOT_FOUND = '[task tidak ditemukan]';
export const MSG_TASK_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke task ini]';
export const MSG_EXEC_FORBIDDEN = '[anda tidak memiliki akses untuk mengerjakan task ini]';
export const MSG_ASSIGN_FORBIDDEN =
  '[anda tidak memiliki akses untuk menugaskan PIC atau menetapkan SLA task ini]';
export const MSG_NOT_A_TASK = '[brief ini bukan task yang dieksekusi, di-dispatch ke vendor]';
export const MSG_INVALID_PIC = '[PIC tidak valid: harus staff divisi tujuan yang aktif]';
export const MSG_INVALID_SLA = '[target SLA harus lebih dari 0 jam]';
export const MSG_BLOCK_REQUEST_FORBIDDEN = '[anda tidak memiliki akses untuk mengajukan permintaan block task ini]';
export const MSG_BLOCK_DECIDE_FORBIDDEN = '[anda tidak memiliki akses untuk memutuskan permintaan block]';
export const MSG_BLOCK_REASON_REQUIRED = '[alasan permintaan block wajib diisi]';
export const MSG_BLOCK_REQUEST_NOT_FOUND = '[permintaan block tidak ditemukan]';
export const MSG_BLOCK_REQUEST_CLOSED = '[permintaan block sudah diproses]';

// --- Errors (task-scoped; mapped in apps/api http.ts). ---

/** Bad/missing input (→ 400): invalid PIC, non-positive SLA, missing block reason. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskForbiddenError';
  }
}
/** The referenced task / block request does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_TASK_NOT_FOUND) {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}
/** A lifecycle conflict (→ 409): off-machine brief, closed block request, blocked edge. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskConflictError';
  }
}

// ---------------------------------------------------------------------------
// Authorization predicates.
// ---------------------------------------------------------------------------

interface TaskRow {
  serviceId: string;
  division: string;
  assignedPic: string;
  status: string;
  ownerAm: string;
}

/**
 * canExecute is the §2 Rule 1 execution gate: Director always; otherwise the
 * actor must belong to the Brief's target division (staff or lead). Where a PIC
 * is assigned, only that PIC or the division lead may drive it; an unassigned
 * Task may be driven by any staff/lead of the division (claim model). The AM and
 * other divisions are denied — the AM's authority is the review edges (M6 §7).
 */
export function canExecute(actor: Actor, r: { division: string; assignedPic: string }): boolean {
  if (actor.role.director) {
    return true;
  }
  if (
    actor.role.division !== r.division ||
    (actor.role.level !== permission.LevelStaff && actor.role.level !== permission.LevelLead)
  ) {
    return false;
  }
  if (r.assignedPic !== '') {
    return actor.employeeId === r.assignedPic || actor.role.level === permission.LevelLead;
  }
  return true;
}

/** canManageTask is the §5.3 write gate: the target division's Lead/SPV, or Director. */
export function canManageTask(actor: Actor, division: string): boolean {
  return permission.isLead(actor, division);
}

/** canRequestBlock (§5.3a): the target division's staff/lead, the owning AM, or Director. */
export function canRequestBlock(actor: Actor, r: { division: string; ownerAm: string }): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.employeeId === r.ownerAm) {
    return true;
  }
  return (
    actor.role.division === r.division &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

/** canViewTask is the §6/§9.1 read predicate (mirrors account.canSeeBrief). */
export function canViewTask(actor: Actor, ownerAm: string, division: string): boolean {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead (division-wide)
  }
  if (actor.employeeId === ownerAm) {
    return true; // owning AM
  }
  return (
    actor.role.division === division &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

// ---------------------------------------------------------------------------
// Row locking.
// ---------------------------------------------------------------------------

/** lockTask row-locks a Brief-as-task and returns the fields the gates need. */
async function lockTask(tx: Queryable, briefId: string): Promise<TaskRow> {
  const rows = await tx<
    { service_id: string; assigned_division: string; assigned_pic: string | null; status: string; assigned_am_id: string | null }[]
  >`
    select b.service_id, b.assigned_division, b.assigned_pic, b.status, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    serviceId: r.service_id, division: r.assigned_division, assignedPic: r.assigned_pic ?? '',
    status: r.status, ownerAm: r.assigned_am_id ?? '',
  };
}

/**
 * transitionError maps a rejected engine transition to the task error taxonomy:
 * a role gate → ForbiddenError (403), any other rejection → ConflictError (409).
 */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

// ---------------------------------------------------------------------------
// Execution edges (§3) — startTask / submitTask / reworkTask.
// ---------------------------------------------------------------------------

/**
 * startTask drives a Brief-as-task [To Do] → [In Progress] (§3 step 2, the moment
 * the Turnaround clock starts, §2 Rule 4). This is the only edge that makes a
 * Brief leave [To Do], so the parent Service advances [Briefed] → [In Execution]
 * (M6 §5 Flow 3) atomically here.
 */
export function startTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, briefId, STATUS_TODO, STATUS_IN_PROGRESS);
}

/** submitTask drives a Brief-as-task [In Progress] → [Submitted] (§3 step 3). */
export function submitTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, briefId, STATUS_IN_PROGRESS, STATUS_SUBMITTED);
}

/**
 * reworkTask drives a Brief-as-task [Revision Requested] → [In Progress] (§3 step
 * 5). The cumulative Turnaround timer keeps running (Rule 5 — revision rounds
 * never reset it); the Service is already [In Execution], so no hook fires.
 */
export function reworkTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, briefId, STATUS_REVISION_REQ, STATUS_IN_PROGRESS);
}

/**
 * driveExecEdge is the shared, gated engine driver for the division-side edges.
 * requireFrom pins the expected current state so Start and Rework stay distinct
 * even though both target [In Progress]; a wrong source state is rejected (nothing
 * changes). A Brief leaving [To Do] advances its Service via account.onBriefLeavesToDo.
 * (The M8 Ads pre-[Submitted] submit guard is deferred until M8 is ported — nil-safe.)
 */
async function driveExecEdge(
  sql: Sql,
  actor: Actor,
  briefId: string,
  requireFrom: string,
  to: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (r.status === STATUS_VENDOR_DISPATCHED) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canExecute(actor, r)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    if (r.status !== requireFrom) {
      throw new ConflictError(bi.TRANSITION_NOT_ALLOWED); // pin the source state
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    // §5 Flow 3: only the [To Do] departure advances the Service (idempotent).
    if (r.status === STATUS_TODO) {
      await onBriefLeavesToDo(tx, actor, r.serviceId);
    }
    return res;
  });
}

// ---------------------------------------------------------------------------
// Assign PIC + Set SLA (§5.3 / §2 Rule 10) — plain audited field writes.
// ---------------------------------------------------------------------------

/**
 * assignPic sets the Task's accountable staff member (§5.3, §2 Rule 1). Target
 * division Lead/SPV (or Director) only. The PIC must be an active STAFF member of
 * the Brief's target division. A Live Stream / vendor-dispatched Brief is not an
 * execution Task and is rejected.
 */
export async function assignPic(sql: Sql, actor: Actor, briefId: string, picId: string): Promise<void> {
  const pic = (picId ?? '').trim();
  if (pic === '') {
    throw new ValidationError(MSG_INVALID_PIC);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (r.status === STATUS_VENDOR_DISPATCHED || r.division === DIVISION_LIVE_STREAM) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canManageTask(actor, r.division)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    await validatePicForDivision(tx, pic, r.division);
    await tx`update briefs set assigned_pic = ${pic} where id = ${briefId}`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'pic_assigned',
      beforeJson: { assigned_pic: r.assignedPic || null },
      afterJson: { assigned_pic: pic, assigned_by: actor.employeeId }, createdBy: actor.employeeId,
    });
  });
}

/**
 * setSlaTarget sets the Task-level SLA Target in hours (§2 Rule 10, §5.3). Target
 * division Lead/SPV (or Director) only; must be > 0. Distinct from the Brief-level
 * due_date (client-facing DATE); this is the internal yardstick Speed Score
 * measures against. Never auto-defaulted or backfilled; changes are audited.
 */
export async function setSlaTarget(sql: Sql, actor: Actor, briefId: string, hours: number): Promise<void> {
  if (!(hours > 0)) {
    throw new ValidationError(MSG_INVALID_SLA);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (r.status === STATUS_VENDOR_DISPATCHED || r.division === DIVISION_LIVE_STREAM) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canManageTask(actor, r.division)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    const prev = await tx<{ sla_target_hours: string | null }[]>`
      select sla_target_hours from briefs where id = ${briefId}`;
    const before = prev[0].sla_target_hours === null ? null : Number(prev[0].sla_target_hours);
    await tx`update briefs set sla_target_hours = ${hours} where id = ${briefId}`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'sla_target_set',
      beforeJson: { sla_target_hours: before }, afterJson: { sla_target_hours: hours }, createdBy: actor.employeeId,
    });
  });
}

/**
 * validatePicForDivision enforces the chosen PIC is an ACTIVE employee whose
 * resolved CDPS division equals the Brief's target division and whose level is
 * staff (§2 Rule 1). Mirrors auth.ResolveActor's divisi+jabatan → division join.
 */
async function validatePicForDivision(tx: Queryable, picId: string, division: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${picId}`;
  if (rows.length === 0) {
    throw new ValidationError(MSG_INVALID_PIC);
  }
  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  if (!active || r.division !== division || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_PIC);
  }
}

// ---------------------------------------------------------------------------
// [Blocked] workflow (§2 Rule 8 / §5.3a) — request/approval queue.
// ---------------------------------------------------------------------------

/** One pending/resolved block request on a Task. */
export interface BlockRequest {
  id: string;
  entityId: string;
  reason: string;
  status: string;
  requestedBy: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/**
 * submitBlockRequest files a pending block request on a Brief-as-task (§5.3a).
 * Staff / the AM may request; only SPV/Lead may action it. Does NOT change the
 * Task status. Division leads are notified (EvBlockRequestSubmitted).
 */
export async function submitBlockRequest(sql: Sql, actor: Actor, briefId: string, reason: string): Promise<BlockRequest> {
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_BLOCK_REASON_REQUIRED);
  }
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (r.status === STATUS_VENDOR_DISPATCHED) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canRequestBlock(actor, r)) {
      throw new ForbiddenError(MSG_BLOCK_REQUEST_FORBIDDEN);
    }
    const reqId = await ex.ident.identNext('BBR', now);
    await tx`
      insert into brief_block_requests (id, brief_id, reason, status, requested_by, created_by)
      values (${reqId}, ${briefId}, ${why}, 'pending', ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'block_request_submitted',
      beforeJson: null, afterJson: { request_id: reqId, reason: why }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestSubmitted, entityType: 'brief', entityId: briefId,
      actor: actor.employeeId, division: r.division,
    });
    return { id: reqId, entityId: briefId, reason: why, status: 'pending', requestedBy: actor.employeeId, resolvedBy: null, resolvedAt: null, createdAt: now };
  });
}

/**
 * approveBlockRequest approves a pending request and drives the Brief-as-task into
 * [Blocked] via the engine (SPV/Lead-only edge, §2 Rule 8) — the clock pauses on
 * entry (Rule 7). The requester is notified (EvBlockRequestDecided).
 */
export function approveBlockRequest(sql: Sql, actor: Actor, briefId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, briefId, reqId, true);
}

/** rejectBlockRequest rejects a pending request without touching the Task status. */
export function rejectBlockRequest(sql: Sql, actor: Actor, briefId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, briefId, reqId, false);
}

async function decideBlockRequest(sql: Sql, actor: Actor, briefId: string, reqId: string, approve: boolean): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (!permission.isLead(actor, r.division)) {
      throw new ForbiddenError(MSG_BLOCK_DECIDE_FORBIDDEN);
    }
    const reqRows = await tx<{ status: string; requested_by: string }[]>`
      select status, requested_by from brief_block_requests
       where id = ${reqId} and brief_id = ${briefId} for update`;
    if (reqRows.length === 0) {
      throw new NotFoundError(MSG_BLOCK_REQUEST_NOT_FOUND);
    }
    if (reqRows[0].status !== 'pending') {
      throw new ConflictError(MSG_BLOCK_REQUEST_CLOSED);
    }
    const newStatus = approve ? 'approved' : 'rejected';
    if (approve) {
      const res = await statemachine.transition(ex.sm, {
        machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId, to: STATUS_BLOCKED, actor,
      });
      if (!res.ok) {
        throw transitionError(res);
      }
    }
    await tx`
      update brief_block_requests set status = ${newStatus}, resolved_by = ${actor.employeeId}, resolved_at = now()
       where id = ${reqId}`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: `block_request_${newStatus}`,
      beforeJson: null, afterJson: { request_id: reqId }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestDecided, entityType: 'brief', entityId: briefId,
      actor: actor.employeeId, explicitRecipients: [reqRows[0].requested_by],
    });
  });
}

/**
 * resumeTask drives a Brief-as-task [Blocked] → [In Progress] (§3 step 6),
 * resuming the clock. SPV/Lead-only (Director allowed). Blocked time is excluded
 * from Turnaround (Rule 7).
 */
export async function resumeTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, briefId);
    if (!permission.isLead(actor, r.division)) {
      throw new ForbiddenError(MSG_BLOCK_DECIDE_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId, to: STATUS_IN_PROGRESS, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    return res;
  });
}

/** One open block request surfaced in the SPV/Lead approval queue (§6.2). */
export interface PendingBlockRequest {
  id: string;
  source: string; // "brief" (asset source plugs in with M7)
  entityId: string;
  division: string;
  clientId: string;
  reason: string;
  requestedBy: string;
  createdAt: Date;
}

/**
 * pendingBlockRequests returns every pending block request the actor may ACTION as
 * SPV/Lead. A division lead sees only their own division's pending requests, a
 * Director sees all, and any other actor sees an empty queue. (The Asset-source
 * union is deferred with M7.)
 */
export async function pendingBlockRequests(sql: Queryable, actor: Actor): Promise<PendingBlockRequest[]> {
  const rows = await sql<
    { id: string; brief_id: string; assigned_division: string; client_id: string; reason: string; requested_by: string; created_at: Date }[]
  >`
    select r.id, r.brief_id, b.assigned_division, sv.client_id, r.reason, r.requested_by, r.created_at
      from brief_block_requests r
      join briefs b on b.id = r.brief_id
      join services sv on sv.id = b.service_id
     where r.status = 'pending'
     order by r.created_at asc, r.id asc`;
  return rows
    .filter((r) => permission.isLead(actor, r.assigned_division))
    .map((r) => ({
      id: r.id, source: 'brief', entityId: r.brief_id, division: r.assigned_division, clientId: r.client_id,
      reason: r.reason, requestedBy: r.requested_by, createdAt: r.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Computed metrics (§5.1/§5.2) — DERIVED purely from the transition log.
// ---------------------------------------------------------------------------

/** The read-only computed view of one Task (§5.1). Nulls = Not-Applicable. */
export interface Metrics {
  briefId: string;
  status: string;
  slaTargetHours: number | null;
  turnaroundHours: number | null;
  revisionTurnaroundHours: number | null;
  speedScorePct: number | null;
  speedScoreDisplay: string; // "112.50%" | "N/A" | "—"
  revisionCount: number;
  revisionFlagged: boolean;
  approvedAt: Date | null;
  approvedPeriodWib: string; // "YYYY-MM" (WIB), "" if not approved
}

/** One status change: the state entered and when. */
export interface Transition {
  to: string;
  at: Date;
}

const MS_PER_HOUR = 3_600_000;

/**
 * computeMetrics is the pure core (exported for exhaustive unit testing). `evs`
 * MUST be in chronological (ascending) order; `sla` is the SLA Target in hours or
 * null. Turnaround = first [In Progress] → first [Approved], minus every [Blocked]
 * interval (Rule 7). Speed Score = turnaround ÷ SLA, uncapped (Rule 12); null SLA
 * → "N/A", zero SLA → "—" (house convention 7).
 */
export function computeMetrics(evs: Transition[], sla: number | null): Omit<Metrics, 'briefId' | 'status'> {
  let firstInProg: Date | null = null;
  let firstApproved: Date | null = null;
  let revisionCount = 0;
  for (const e of evs) {
    if (e.to === STATUS_IN_PROGRESS && firstInProg === null) {
      firstInProg = e.at;
    } else if (e.to === '[Approved]' && firstApproved === null) {
      firstApproved = e.at;
    } else if (e.to === STATUS_REVISION_REQ) {
      revisionCount++;
    }
  }
  let turnaroundHours: number | null = null;
  let approvedAt: Date | null = null;
  let approvedPeriodWib = '';
  if (firstInProg !== null && firstApproved !== null) {
    const totalMs = firstApproved.getTime() - firstInProg.getTime() - blockedMs(evs, firstInProg, firstApproved);
    turnaroundHours = totalMs / MS_PER_HOUR;
    approvedAt = firstApproved;
    approvedPeriodWib = tz.dateString(firstApproved).slice(0, 7); // "YYYY-MM" (WIB), matches Go's "2006-01"
  }
  const revisionTurnaroundHours = revisionTurnaround(evs);
  const [speedScorePct, speedScoreDisplay] = speedScore(turnaroundHours, sla);
  return {
    slaTargetHours: sla, turnaroundHours, revisionTurnaroundHours, speedScorePct, speedScoreDisplay,
    revisionCount, revisionFlagged: revisionCount >= REVISION_FLAG_THRESHOLD, approvedAt, approvedPeriodWib,
  };
}

/** blockedMs sums every [Blocked] → [In Progress] interval beginning within [start, end). */
function blockedMs(evs: Transition[], start: Date, end: Date): number {
  let sum = 0;
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].to !== STATUS_BLOCKED) {
      continue;
    }
    const tb = evs[i].at;
    if (tb.getTime() < start.getTime() || tb.getTime() >= end.getTime()) {
      continue;
    }
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j].to === STATUS_IN_PROGRESS) {
        const tr = evs[j].at.getTime() > end.getTime() ? end.getTime() : evs[j].at.getTime();
        sum += tr - tb.getTime();
        break;
      }
    }
  }
  return sum;
}

/** revisionTurnaround returns the hours from the LATEST [Revision Requested] to the next [Submitted]. */
function revisionTurnaround(evs: Transition[]): number | null {
  let lastRev = -1;
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].to === STATUS_REVISION_REQ) {
      lastRev = i;
    }
  }
  if (lastRev < 0) {
    return null;
  }
  for (let j = lastRev + 1; j < evs.length; j++) {
    if (evs[j].to === STATUS_SUBMITTED) {
      return (evs[j].at.getTime() - evs[lastRev].at.getTime()) / MS_PER_HOUR;
    }
  }
  return null;
}

/** speedScore applies Rule 12 with the house-convention rendering. */
function speedScore(turnaround: number | null, sla: number | null): [number | null, string] {
  if (sla === null || turnaround === null) {
    return [null, 'N/A']; // no SLA set (§5.3), or not yet approved
  }
  if (sla === 0) {
    return [null, '—']; // division-by-zero (house convention 7)
  }
  const pct = (turnaround / sla) * 100;
  return [pct, `${pct.toFixed(2)}%`];
}

/** transitionTarget extracts the destination state from a "transition:A->B" action. */
function transitionTarget(action: string): string | null {
  const prefix = 'transition:';
  if (!action.startsWith(prefix)) {
    return null;
  }
  const idx = action.indexOf('->', prefix.length);
  return idx < 0 ? null : action.slice(idx + 2);
}

/**
 * taskMetrics loads a Brief-as-task and returns its metrics, recomputed purely
 * from the immutable transition log (house rule 4), if the actor may view it
 * (§6/§9.1 read gate).
 */
export async function taskMetrics(sql: Queryable, actor: Actor, briefId: string): Promise<Metrics> {
  const rows = await sql<
    { assigned_division: string; status: string; sla_target_hours: string | null; assigned_am_id: string | null }[]
  >`
    select b.assigned_division, b.status, b.sla_target_hours, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const { assigned_division, status, sla_target_hours, assigned_am_id } = rows[0];
  if (!canViewTask(actor, assigned_am_id ?? '', assigned_division)) {
    throw new ForbiddenError(MSG_TASK_VIEW_FORBIDDEN);
  }
  const entries = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = 'brief' and entity_id = ${briefId} order by id asc`;
  const evs: Transition[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      evs.push({ to, at: e.created_at });
    }
  }
  const sla = sla_target_hours === null ? null : Number(sla_target_hours);
  const m = computeMetrics(evs, sla);
  return { briefId, status, ...m };
}
