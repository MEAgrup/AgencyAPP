/**
 * Task Execution domain service (M12). Ported from Go's
 * `internal/module12_task/*`.
 *
 * "Task" is a ROLE, not an entity (DATA_MODEL §1): the Brief itself plays it for
 * single-unit divisions (Ads / BRF-as-task, M12 §5.3b), and M7's Creative Asset
 * (AST-) plugs into this SAME engine as a second task source (the canonical
 * brief_task machine, STATE_MACHINES §7 — an Asset is not a different lifecycle,
 * only a different row it is stored on). M9's Creator Booking becomes a third
 * source when M9 is ported. Storage/shape differences are captured in a
 * `TaskSource`; the lifecycle, gates, block queue and metric math are shared.
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
import { validateBriefSubmit } from './ads';
import { ConflictError as BoardConflictError, onBriefReachedTerminal, validateBriefApproval } from './board';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const ACCOUNT_DIVISION = 'Account';
export const DIVISION_LIVE_STREAM = 'Live Stream';

// brief_task status labels (STATE_MACHINES §7).
export const STATUS_TODO = '[To Do]';
export const STATUS_IN_PROGRESS = '[In Progress]';
export const STATUS_SUBMITTED = '[Submitted]';
export const STATUS_IN_REVIEW = '[In Review]';
export const STATUS_APPROVED = '[Approved]';
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
/** An Asset cannot be submitted without an output link (M7 §4 Rule 3, verbatim PRD). */
export const MSG_OUTPUT_LINK_REQUIRED = '[link output wajib diisi sebelum submit]';
/** M16 §2 Rule 11 / LT-26 — a Brief may not enter [Submitted] before its stage pipeline reaches a terminal state. */
export const MSG_STAGE_NOT_COMPLETE = '[tahapan produksi brief ini belum mencapai tahap akhir]';

// ---------------------------------------------------------------------------
// Task sources (§ source.go). One registered canonical-Task row type each; only
// storage/shape differs, the lifecycle + gates + metrics are shared.
// ---------------------------------------------------------------------------

/** A registered canonical-Task row type (Brief-as-task or Creative Asset). */
export interface TaskSource {
  entityType: 'brief' | 'asset';
  table: 'briefs' | 'assets';
  /** A column that MUST be non-empty before the row may enter [Submitted] (Asset output link, §4 Rule 3). */
  submitLinkCol?: string;
  /** Block-request queue backing this source. */
  blockTable: string;
  blockFkCol: string;
  blockIdPrefix: string;
}

/** The Brief-as-task source (Ads / single-unit). Parent = Service. */
export const SOURCE_BRIEF: TaskSource = {
  entityType: 'brief', table: 'briefs', blockTable: 'brief_block_requests', blockFkCol: 'brief_id', blockIdPrefix: 'BBR',
};
/** The Creative Asset source (M7). Parent = Brief (roll-up, M7 §2); submit requires an output link. */
export const SOURCE_ASSET: TaskSource = {
  entityType: 'asset', table: 'assets', submitLinkCol: 'output_link',
  blockTable: 'asset_block_requests', blockFkCol: 'asset_id', blockIdPrefix: 'ABR',
};

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
  entityId: string;
  serviceId: string;
  parentBriefId: string; // "" for a Brief-as-task; the parent Brief for an Asset
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

/**
 * lockTask row-locks a Task row of the given source and returns the fields the
 * gates need. For a Brief-as-task parentBriefId is "" and serviceId is the
 * Brief's own Service; for an Asset parentBriefId is the owning Brief (roll-up
 * target), division/ownerAM are inherited from that Brief, and status is the
 * Asset's own. A missing row is NotFoundError.
 */
async function lockTask(tx: Queryable, src: TaskSource, id: string): Promise<TaskRow> {
  if (src.table === 'assets') {
    const rows = await tx<
      { service_id: string; brief_id: string; assigned_division: string; assigned_pic: string | null; status: string; assigned_am_id: string | null }[]
    >`
      select b.service_id, a.brief_id, b.assigned_division, a.assigned_pic, a.status, c.assigned_am_id
        from assets a
        join briefs b on b.id = a.brief_id
        join services sv on sv.id = b.service_id
        join clients c on c.id = sv.client_id
       where a.id = ${id} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const r = rows[0];
    return {
      entityId: id, serviceId: r.service_id, parentBriefId: r.brief_id, division: r.assigned_division,
      assignedPic: r.assigned_pic ?? '', status: r.status, ownerAm: r.assigned_am_id ?? '',
    };
  }
  const rows = await tx<
    { service_id: string; assigned_division: string; assigned_pic: string | null; status: string; assigned_am_id: string | null }[]
  >`
    select b.service_id, b.assigned_division, b.assigned_pic, b.status, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    entityId: id, serviceId: r.service_id, parentBriefId: '', division: r.assigned_division,
    assignedPic: r.assigned_pic ?? '', status: r.status, ownerAm: r.assigned_am_id ?? '',
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
  return driveExecEdge(sql, actor, SOURCE_BRIEF, briefId, STATUS_TODO, STATUS_IN_PROGRESS, '');
}

/** submitTask drives a Brief-as-task [In Progress] → [Submitted] (§3 step 3). */
export function submitTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, SOURCE_BRIEF, briefId, STATUS_IN_PROGRESS, STATUS_SUBMITTED, '');
}

/**
 * reworkTask drives a Brief-as-task [Revision Requested] → [In Progress] (§3 step
 * 5). The cumulative Turnaround timer keeps running (Rule 5 — revision rounds
 * never reset it); the Service is already [In Execution], so no hook fires.
 */
export function reworkTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, SOURCE_BRIEF, briefId, STATUS_REVISION_REQ, STATUS_IN_PROGRESS, '');
}

/** startAsset drives a Creative Asset [To Do] → [In Progress] (M7 §4 Flow 1). */
export function startAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, SOURCE_ASSET, assetId, STATUS_TODO, STATUS_IN_PROGRESS, '');
}

/**
 * submitAsset drives a Creative Asset [In Progress] → [Submitted] (M7 §4 Flow 2).
 * Submission requires an output link (§4 Rule 3) — written atomically with the move.
 */
export function submitAsset(sql: Sql, actor: Actor, assetId: string, outputLink: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, SOURCE_ASSET, assetId, STATUS_IN_PROGRESS, STATUS_SUBMITTED, outputLink);
}

/** reworkAsset drives a Creative Asset [Revision Requested] → [In Progress] (M7 §6 Flow 2). */
export function reworkAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveExecEdge(sql, actor, SOURCE_ASSET, assetId, STATUS_REVISION_REQ, STATUS_IN_PROGRESS, '');
}

/**
 * driveExecEdge is the shared, gated engine driver for the division-side edges of
 * any source. requireFrom pins the expected current state so Start and Rework stay
 * distinct even though both target [In Progress]; a wrong source state is rejected
 * (nothing changes). submitLink is persisted when a link-gated source (Asset)
 * enters [Submitted] (§4 Rule 3). After the move, effects propagate atomically: a
 * Brief-as-task leaving [To Do] advances its Service; an Asset transition recomputes
 * its parent Brief's roll-up (which itself advances the Service). (The M8 Ads
 * pre-[Submitted] submit guard is deferred until M8 is ported — nil-safe.)
 */
async function driveExecEdge(
  sql: Sql,
  actor: Actor,
  src: TaskSource,
  id: string,
  requireFrom: string,
  to: string,
  submitLink: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (r.status === STATUS_VENDOR_DISPATCHED) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canExecute(actor, r)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    if (r.status !== requireFrom) {
      throw new ConflictError(bi.TRANSITION_NOT_ALLOWED); // pin the source state
    }
    // §4 Rule 3 (M8): an Ads Brief-as-task cannot submit until its Ad Campaign is
    // complete (≥1 linked Creative Asset). No-op for non-Ads divisions and Assets.
    if (to === STATUS_SUBMITTED && src.table === 'briefs') {
      await validateBriefSubmit(tx, id, r.division);
      await validateStageComplete(tx, id); // M16 §2 Rule 11 (LT-26) — one-way guard, see comment on the function
    }
    // Link gate: a link-requiring source (Asset) must carry an output link before
    // [Submitted] (§4 Rule 3). Persist it in the same transaction as the move.
    if (to === STATUS_SUBMITTED && src.submitLinkCol) {
      const link = (submitLink ?? '').trim();
      if (link === '') {
        throw new ValidationError(MSG_OUTPUT_LINK_REQUIRED);
      }
      await tx`update ${tx(src.table)} set ${tx(src.submitLinkCol)} = ${link} where id = ${id}`;
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: src.entityType, table: src.table, entityId: id, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    await propagate(tx, actor, src, r);
    return res;
  });
}

/**
 * validateStageComplete is the M16 §2 Rule 11 (LT-26) guard: a Brief may not
 * enter [Submitted] before its `production_stage` reaches the stage pipeline's
 * TERMINAL state (`sm_terminal_states`, keyed by the pipeline's `machine_name`).
 * Enforced ONE-WAY here — the stage machine (`stage.ts`) never drives this
 * `status` column itself (aturan rumah #2); this is the single place the two
 * machines' progress is compared. A Brief with no pipeline at all
 * (`stage_pipeline_code` null — Rule 12, e.g. Store Operation) is unrestricted:
 * there is nothing to finish. Queries `stage_pipeline`/`sm_terminal_states`
 * directly rather than importing `stage.ts`, to keep this module's only
 * dependency on M16 a plain read (no cross-module coupling for one guard).
 */
async function validateStageComplete(tx: Queryable, briefId: string): Promise<void> {
  const rows = await tx<{ stage_pipeline_code: string | null; production_stage: string | null; machine_name: string | null }[]>`
    select b.stage_pipeline_code, b.production_stage, sp.machine_name
      from briefs b
      left join stage_pipeline sp on sp.code = b.stage_pipeline_code
     where b.id = ${briefId}`;
  if (rows.length === 0) {
    return; // not-found is handled by the caller's own lockTask read
  }
  const r = rows[0];
  if (r.stage_pipeline_code === null || r.machine_name === null) {
    return; // Rule 12 — divisi tanpa pipeline, nol tahapan untuk diselesaikan
  }
  const terminal = await tx<{ n: string }[]>`
    select count(*) as n from sm_terminal_states where machine = ${r.machine_name} and state = ${r.production_stage}`;
  if (Number(terminal[0].n) === 0) {
    throw new ConflictError(MSG_STAGE_NOT_COMPLETE);
  }
}

/**
 * propagate fires the parent-side effect of a Task transition, in the same
 * transaction. A Brief-as-task advances its Service on leaving [To Do]; an Asset
 * recomputes its parent Brief's roll-up (which subsumes the Service advance).
 */
async function propagate(tx: Queryable, actor: Actor, src: TaskSource, r: TaskRow): Promise<void> {
  if (src.table === 'assets') {
    await recomputeBriefRollup(tx, actor, r.parentBriefId);
    return;
  }
  if (r.status === STATUS_TODO) {
    await onBriefLeavesToDo(tx, actor, r.serviceId); // §5 Flow 3 (idempotent)
  }
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
export function assignPic(sql: Sql, actor: Actor, briefId: string, picId: string): Promise<void> {
  return assign(sql, actor, SOURCE_BRIEF, briefId, picId);
}

/** assignAssetPic assigns the accountable Creative staff on an Asset (M7 §9.3 / §3 Rule 3). */
export function assignAssetPic(sql: Sql, actor: Actor, assetId: string, picId: string): Promise<void> {
  return assign(sql, actor, SOURCE_ASSET, assetId, picId);
}

async function assign(sql: Sql, actor: Actor, src: TaskSource, id: string, picId: string): Promise<void> {
  const pic = (picId ?? '').trim();
  if (pic === '') {
    throw new ValidationError(MSG_INVALID_PIC);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (r.status === STATUS_VENDOR_DISPATCHED || r.division === DIVISION_LIVE_STREAM) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canManageTask(actor, r.division)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    await validatePicForDivision(tx, pic, r.division);
    await tx`update ${tx(src.table)} set assigned_pic = ${pic} where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: src.entityType, entityId: id, actorEmployeeId: actor.employeeId, action: 'pic_assigned',
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
export function setSlaTarget(sql: Sql, actor: Actor, briefId: string, hours: number): Promise<void> {
  return setSla(sql, actor, SOURCE_BRIEF, briefId, 'sla_target_hours', 'sla_target_set', hours);
}

/** setAssetSla sets an Asset's SLA Target in hours (§5.3). Target division Lead/SPV or Director. */
export function setAssetSla(sql: Sql, actor: Actor, assetId: string, hours: number): Promise<void> {
  return setSla(sql, actor, SOURCE_ASSET, assetId, 'sla_target_hours', 'sla_target_set', hours);
}

/**
 * setAssetRevisionSla sets an Asset's Revision SLA Target (M7-OA-3 / §9.3) — the
 * separate, shorter target each revision round is measured against, feeding
 * revision_speed_score. Distinct from the original SLA; same write gate.
 */
export function setAssetRevisionSla(sql: Sql, actor: Actor, assetId: string, hours: number): Promise<void> {
  return setSla(sql, actor, SOURCE_ASSET, assetId, 'revision_sla_target_hours', 'revision_sla_target_set', hours);
}

async function setSla(
  sql: Sql,
  actor: Actor,
  src: TaskSource,
  id: string,
  col: string,
  action: string,
  hours: number,
): Promise<void> {
  if (!(hours > 0)) {
    throw new ValidationError(MSG_INVALID_SLA);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (r.status === STATUS_VENDOR_DISPATCHED || r.division === DIVISION_LIVE_STREAM) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canManageTask(actor, r.division)) {
      throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
    }
    const prev = await tx<Record<string, string | null>[]>`select ${tx(col)} as v from ${tx(src.table)} where id = ${id}`;
    const before = prev[0].v === null ? null : Number(prev[0].v);
    await tx`update ${tx(src.table)} set ${tx(col)} = ${hours} where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: src.entityType, entityId: id, actorEmployeeId: actor.employeeId, action,
      beforeJson: { [col]: before }, afterJson: { [col]: hours }, createdBy: actor.employeeId,
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
export function submitBlockRequest(sql: Sql, actor: Actor, briefId: string, reason: string): Promise<BlockRequest> {
  return submitBlockReq(sql, actor, SOURCE_BRIEF, briefId, reason);
}

/** submitAssetBlockRequest files a pending block request on a Creative Asset (§5.3a). */
export function submitAssetBlockRequest(sql: Sql, actor: Actor, assetId: string, reason: string): Promise<BlockRequest> {
  return submitBlockReq(sql, actor, SOURCE_ASSET, assetId, reason);
}

async function submitBlockReq(sql: Sql, actor: Actor, src: TaskSource, id: string, reason: string): Promise<BlockRequest> {
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_BLOCK_REASON_REQUIRED);
  }
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (r.status === STATUS_VENDOR_DISPATCHED) {
      throw new ConflictError(MSG_NOT_A_TASK);
    }
    if (!canRequestBlock(actor, r)) {
      throw new ForbiddenError(MSG_BLOCK_REQUEST_FORBIDDEN);
    }
    const reqId = await ex.ident.identNext(src.blockIdPrefix, now);
    await tx`
      insert into ${tx(src.blockTable)} (id, ${tx(src.blockFkCol)}, reason, status, requested_by, created_by)
      values (${reqId}, ${id}, ${why}, 'pending', ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: src.entityType, entityId: id, actorEmployeeId: actor.employeeId, action: 'block_request_submitted',
      beforeJson: null, afterJson: { request_id: reqId, reason: why }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestSubmitted, entityType: src.entityType, entityId: id,
      actor: actor.employeeId, division: r.division,
    });
    return { id: reqId, entityId: id, reason: why, status: 'pending', requestedBy: actor.employeeId, resolvedBy: null, resolvedAt: null, createdAt: now };
  });
}

/**
 * approveBlockRequest approves a pending request and drives the Brief-as-task into
 * [Blocked] via the engine (SPV/Lead-only edge, §2 Rule 8) — the clock pauses on
 * entry (Rule 7). The requester is notified (EvBlockRequestDecided).
 */
export function approveBlockRequest(sql: Sql, actor: Actor, briefId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, SOURCE_BRIEF, briefId, reqId, true);
}

/** rejectBlockRequest rejects a pending request without touching the Task status. */
export function rejectBlockRequest(sql: Sql, actor: Actor, briefId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, SOURCE_BRIEF, briefId, reqId, false);
}

/** approveAssetBlockRequest approves a pending Asset request, driving it into [Blocked] + roll-up. */
export function approveAssetBlockRequest(sql: Sql, actor: Actor, assetId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, SOURCE_ASSET, assetId, reqId, true);
}

/** rejectAssetBlockRequest rejects a pending Asset request without touching its status. */
export function rejectAssetBlockRequest(sql: Sql, actor: Actor, assetId: string, reqId: string): Promise<void> {
  return decideBlockRequest(sql, actor, SOURCE_ASSET, assetId, reqId, false);
}

async function decideBlockRequest(sql: Sql, actor: Actor, src: TaskSource, id: string, reqId: string, approve: boolean): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (!permission.isLead(actor, r.division)) {
      throw new ForbiddenError(MSG_BLOCK_DECIDE_FORBIDDEN);
    }
    const reqRows = await tx<{ status: string; requested_by: string }[]>`
      select status, requested_by from ${tx(src.blockTable)}
       where id = ${reqId} and ${tx(src.blockFkCol)} = ${id} for update`;
    if (reqRows.length === 0) {
      throw new NotFoundError(MSG_BLOCK_REQUEST_NOT_FOUND);
    }
    if (reqRows[0].status !== 'pending') {
      throw new ConflictError(MSG_BLOCK_REQUEST_CLOSED);
    }
    const newStatus = approve ? 'approved' : 'rejected';
    if (approve) {
      const res = await statemachine.transition(ex.sm, {
        machine: MACHINE_BRIEF_TASK, entityType: src.entityType, table: src.table, entityId: id, to: STATUS_BLOCKED, actor,
      });
      if (!res.ok) {
        throw transitionError(res);
      }
      if (src.table === 'assets') {
        await recomputeBriefRollup(tx, actor, r.parentBriefId); // Asset → [Blocked] recomputes the Brief roll-up
      }
    }
    await tx`
      update ${tx(src.blockTable)} set status = ${newStatus}, resolved_by = ${actor.employeeId}, resolved_at = now()
       where id = ${reqId}`;
    await ex.audit.insertAudit({
      entityType: src.entityType, entityId: id, actorEmployeeId: actor.employeeId, action: `block_request_${newStatus}`,
      beforeJson: null, afterJson: { request_id: reqId }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestDecided, entityType: src.entityType, entityId: id,
      actor: actor.employeeId, explicitRecipients: [reqRows[0].requested_by],
    });
  });
}

/**
 * resumeTask drives a Brief-as-task [Blocked] → [In Progress] (§3 step 6),
 * resuming the clock. SPV/Lead-only (Director allowed). Blocked time is excluded
 * from Turnaround (Rule 7).
 */
export function resumeTask(sql: Sql, actor: Actor, briefId: string): Promise<statemachine.TransitionResult> {
  return resume(sql, actor, SOURCE_BRIEF, briefId);
}

/** resumeAsset drives a Creative Asset [Blocked] → [In Progress] and recomputes the Brief roll-up. */
export function resumeAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return resume(sql, actor, SOURCE_ASSET, assetId);
}

async function resume(sql: Sql, actor: Actor, src: TaskSource, id: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockTask(tx, src, id);
    if (!permission.isLead(actor, r.division)) {
      throw new ForbiddenError(MSG_BLOCK_DECIDE_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: src.entityType, table: src.table, entityId: id, to: STATUS_IN_PROGRESS, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    if (src.table === 'assets') {
      await recomputeBriefRollup(tx, actor, r.parentBriefId);
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
  toko: string;
  reason: string;
  requestedBy: string;
  requestedByNama: string;
  createdAt: Date;
}

/**
 * pendingBlockRequests returns every pending block request the actor may ACTION as
 * SPV/Lead. A division lead sees only their own division's pending requests, a
 * Director sees all, and any other actor sees an empty queue. (The Asset-source
 * union is deferred with M7.)
 */
export async function pendingBlockRequests(sql: Queryable, actor: Actor): Promise<PendingBlockRequest[]> {
  const briefRows = await sql<
    { id: string; entity_id: string; division: string; client_id: string; toko: string; reason: string; requested_by: string; requested_by_nama: string | null; created_at: Date }[]
  >`
    select r.id, r.brief_id as entity_id, b.assigned_division as division, sv.client_id, c.toko, r.reason,
           r.requested_by, coalesce(e.nama, r.requested_by) as requested_by_nama, r.created_at
      from brief_block_requests r
      join briefs b on b.id = r.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
      left join employees e on e.employee_id = r.requested_by
     where r.status = 'pending'
     order by r.created_at asc, r.id asc`;
  const assetRows = await sql<
    { id: string; entity_id: string; division: string; client_id: string; toko: string; reason: string; requested_by: string; requested_by_nama: string | null; created_at: Date }[]
  >`
    select r.id, r.asset_id as entity_id, b.assigned_division as division, sv.client_id, c.toko, r.reason,
           r.requested_by, coalesce(e.nama, r.requested_by) as requested_by_nama, r.created_at
      from asset_block_requests r
      join assets a on a.id = r.asset_id
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
      left join employees e on e.employee_id = r.requested_by
     where r.status = 'pending'
     order by r.created_at asc, r.id asc`;
  const rows = [
    ...briefRows.map((r) => ({ ...r, source: 'brief' })),
    ...assetRows.map((r) => ({ ...r, source: 'asset' })),
  ];
  return rows
    .filter((r) => permission.isLead(actor, r.division))
    .map((r) => ({
      id: r.id, source: r.source, entityId: r.entity_id, division: r.division, clientId: r.client_id, toko: r.toko,
      reason: r.reason, requestedBy: r.requested_by, requestedByNama: r.requested_by_nama ?? r.requested_by,
      createdAt: r.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Brief → Asset roll-up (M7 §2). A Creative Brief's status is a roll-up of its
// child Assets, recomputed forward-only through the engine after every Asset move.
// ---------------------------------------------------------------------------

/** The forward brief_task path the roll-up walks (Brief-level revision is per-Asset, so excluded). */
const ROLLUP_CHAIN = [STATUS_TODO, STATUS_IN_PROGRESS, STATUS_SUBMITTED, STATUS_IN_REVIEW, STATUS_APPROVED];

function chainRank(status: string): number {
  return ROLLUP_CHAIN.indexOf(status);
}

/**
 * recomputeBriefRollup recomputes a Brief's roll-up status from its Assets and
 * drives it FORWARD through the engine, inside the caller's transaction (M7 §2).
 * Called after every Asset transition (exec edges here, review edges in creative.ts).
 * Idempotent and forward-only; when the Brief first leaves [To Do] the parent
 * Service advances to [In Execution]. Defensive no-ops on a Brief with no Assets,
 * an off-machine Brief, or one already terminal / off the chain. (The M11
 * Blocking-Dependency gate on the final [Approved] edge is deferred until M11.)
 */
export async function recomputeBriefRollup(tx: Queryable, actor: Actor, briefId: string): Promise<void> {
  if (briefId === '') {
    return;
  }
  const rows = await tx<{ status: string; assigned_division: string; service_id: string; quantity_target: number }[]>`
    select status, assigned_division, service_id, quantity_target from briefs where id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const { status, service_id, quantity_target } = rows[0];
  let cur = chainRank(status);
  if (cur < 0) {
    return; // off the roll-up chain (e.g. [Dispatched to Vendor])
  }
  const statuses = (await tx<{ status: string }[]>`select status from assets where brief_id = ${briefId}`).map((a) => a.status);
  if (statuses.length === 0) {
    return; // no Assets yet
  }
  const tgt = chainRank(rollupTarget(statuses, quantity_target));
  const ex = executors(tx);
  while (cur < tgt) {
    const from = ROLLUP_CHAIN[cur];
    const to = ROLLUP_CHAIN[cur + 1];
    // M11 §2 Rule 7 / §6.3 Blocking gate on the final [Approved] edge. On the
    // roll-up path the gate DEFERS silently: while a Blocking Dependency's Source
    // is not yet terminal, leave the Brief at [In Review] and let the triggering
    // child Asset transition (already applied earlier in this tx) commit — the PIC
    // may keep working the Brief; only the transition to the locked gate is refused
    // (§2 Rule 7). Only the board ConflictError defers; any other error propagates.
    // Mirrors the Go oracle (module12_task/rollup.go: errors.As(BlockedError) →
    // return nil) and DECISIONS W3-M11-C1. The M6 AM explicit-approval path
    // (account.ts) still throws, surfacing the gate to the AM. It resolves
    // naturally on the next Asset event or the AM's approve once the Source closes.
    if (to === STATUS_APPROVED) {
      try {
        await validateBriefApproval(tx, briefId);
      } catch (e) {
        if (e instanceof BoardConflictError) {
          return; // deferred — Brief stays [In Review]; the child transition stays committed.
        }
        throw e;
      }
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    if (from === STATUS_TODO) {
      await onBriefLeavesToDo(tx, actor, service_id); // §5 Flow 3
    }
    // M11 §5.5: on reaching terminal, fire EvDependencySatisfied once per sourced Dependency.
    if (to === STATUS_APPROVED) {
      await onBriefReachedTerminal(tx, actor, briefId);
    }
    cur++;
  }
}

/** rollupTarget maps the child Asset statuses (+ expected count) to the Brief's target status (M7 §2). */
function rollupTarget(statuses: string[], expected: number): string {
  const created = statuses.length;
  let anyStarted = false;
  let allApproved = true;
  let allExactlySubmitted = true;
  let anyWorking = false;
  for (const st of statuses) {
    if (st !== STATUS_TODO) anyStarted = true;
    if (st !== STATUS_APPROVED) allApproved = false;
    if (st !== STATUS_SUBMITTED) allExactlySubmitted = false;
    if (st === STATUS_TODO || st === STATUS_IN_PROGRESS || st === STATUS_BLOCKED) anyWorking = true;
  }
  const allExist = expected > 0 && created >= expected;
  if (allExist && allApproved) {
    return STATUS_APPROVED;
  }
  if (allExist && !anyWorking) {
    return allExactlySubmitted ? STATUS_SUBMITTED : STATUS_IN_REVIEW;
  }
  if (anyStarted) {
    return STATUS_IN_PROGRESS;
  }
  return STATUS_TODO;
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
  // Revision SLA / revision speed score (M7-OA-3): the diagnostic parallel measured
  // against the SEPARATE, shorter revision SLA. Null / "N/A" for a Brief-as-task
  // (no revision SLA) or before any revision round.
  revisionSlaTargetHours: number | null;
  revisionSpeedScorePct: number | null;
  revisionSpeedScoreDisplay: string;
  revisionCount: number;
  revisionFlagged: boolean;
  approvedAt: Date | null;
  approvedPeriodWib: string; // "YYYY-MM" (WIB), "" if not approved
  // --- M16 §6 / LT-30 — AM review latency, split out of turnaroundHours. ---
  // `turnaroundHours` above is UNCHANGED (PRD §6.3 cutover: kept byte-identical
  // so historical PERF- snapshots stay reproducible, and shown side-by-side in
  // FE for 1-2 periods). These three are the new numbers layered on top, all
  // from the SAME log, all null under the same gate as turnaroundHours (no
  // first [In Progress] / first [Approved] pair yet).
  /** turnaroundHours MINUS the AM wait window (waktuAmBelumBuka + waktuAmReview) — division Speed Score basis from now on (§6.2). */
  turnaroundKerjaHours: number | null;
  /** [Submitted] → [In Review] — PURE AM latency (the only one of the three that gets a KPI weight, §6.4). */
  waktuAmBelumBukaHours: number | null;
  /** [In Review] → [Approved] — may include client consultation time; diagnostic, never weighted. */
  waktuAmReviewHours: number | null;
  /** turnaroundKerjaHours ÷ sla (Rule 12 math, same as speedScorePct) — the number M14 division Speed Score components read from now on (§6.2/LT-31). `speedScorePct` above is kept UNCHANGED for the side-by-side display. */
  speedScoreKerjaPct: number | null;
  speedScoreKerjaDisplay: string;
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
export function computeMetrics(
  evs: Transition[],
  sla: number | null,
  revisionSla: number | null = null,
): Omit<Metrics, 'briefId' | 'status'> {
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
  let turnaroundKerjaHours: number | null = null;
  let waktuAmBelumBukaHours: number | null = null;
  let waktuAmReviewHours: number | null = null;
  let approvedAt: Date | null = null;
  let approvedPeriodWib = '';
  if (firstInProg !== null && firstApproved !== null) {
    const blocked = intervalMs(evs, firstInProg, firstApproved, STATUS_BLOCKED);
    const totalMs = firstApproved.getTime() - firstInProg.getTime() - blocked;
    turnaroundHours = totalMs / MS_PER_HOUR;
    approvedAt = firstApproved;
    approvedPeriodWib = tz.dateString(firstApproved).slice(0, 7); // "YYYY-MM" (WIB), matches Go's "2006-01"

    // M16 §6 (LT-30) — same interval-sum SHAPE as blockedMs, on the two windows
    // that make up "waiting on/for the AM" (§6.2 table): [Submitted]→[In Review]
    // is pure AM latency, [In Review]→[Approved] may include client back-and-forth.
    // Both summed across EVERY submit/revision cycle within [firstInProg,
    // firstApproved) — a Brief with revision rounds waits on the AM more than
    // once, and each wait counts (mirrors how blockedMs already sums every
    // [Blocked] interval, not just the first).
    //
    // intervalMs closes each window at the IMMEDIATELY NEXT transition, whatever
    // it is — NOT "search ahead for a specific destination state". [In Review]
    // has two possible next states ([Approved] or [Revision Requested]), so
    // searching ahead for [Approved] specifically would skip straight past an
    // intervening revision round and attribute a much later Approved to an
    // earlier, unrelated review window. [Blocked] doesn't have this ambiguity
    // (its only edge is → [In Progress]), so this is a no-op change for it.
    const amBelumBukaMs = intervalMs(evs, firstInProg, firstApproved, STATUS_SUBMITTED);
    const amReviewMs = intervalMs(evs, firstInProg, firstApproved, STATUS_IN_REVIEW);
    waktuAmBelumBukaHours = amBelumBukaMs / MS_PER_HOUR;
    waktuAmReviewHours = amReviewMs / MS_PER_HOUR;
    turnaroundKerjaHours = (totalMs - amBelumBukaMs - amReviewMs) / MS_PER_HOUR;
  }
  const revisionTurnaroundHours = revisionTurnaround(evs);
  const [speedScorePct, speedScoreDisplay] = speedScore(turnaroundHours, sla);
  // M16 §6.2/LT-31 — the kerja-basis Speed Score division components read from
  // now on. Same `speedScore()` math as the (unchanged) line above, over
  // `turnaroundKerjaHours` instead of `turnaroundHours`.
  const [speedScoreKerjaPct, speedScoreKerjaDisplay] = speedScore(turnaroundKerjaHours, sla);
  // Revision speed score = revision turnaround ÷ revision SLA (M7-OA-3). Null revision
  // SLA (always for a Brief-as-task) → "N/A"; a zero revision SLA → "—".
  const [revisionSpeedScorePct, revisionSpeedScoreDisplay] = speedScore(revisionTurnaroundHours, revisionSla);
  return {
    slaTargetHours: sla, turnaroundHours, revisionTurnaroundHours, speedScorePct, speedScoreDisplay,
    revisionSlaTargetHours: revisionSla, revisionSpeedScorePct, revisionSpeedScoreDisplay,
    revisionCount, revisionFlagged: revisionCount >= REVISION_FLAG_THRESHOLD, approvedAt, approvedPeriodWib,
    turnaroundKerjaHours, waktuAmBelumBukaHours, waktuAmReviewHours, speedScoreKerjaPct, speedScoreKerjaDisplay,
  };
}

/**
 * intervalMs sums every `fromState` → next-transition interval that BEGINS
 * within [start, end) (capped at `end` if the next transition falls after it,
 * or never arrives). "Next transition" is deliberately the IMMEDIATELY
 * following event, not a search ahead for one particular destination state:
 * [Blocked] only ever resumes via [In Progress], so that reduces to the same
 * thing for the original use (turnaround's blocked-time exclusion), but
 * [In Review] can go to EITHER [Approved] or [Revision Requested] (M16 §6,
 * LT-30) — searching ahead for [Approved] specifically would skip straight
 * past an intervening revision round and misattribute a much later approval
 * to an earlier, unrelated review window.
 */
function intervalMs(evs: Transition[], start: Date, end: Date, fromState: string): number {
  let sum = 0;
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].to !== fromState) {
      continue;
    }
    const tFrom = evs[i].at;
    if (tFrom.getTime() < start.getTime() || tFrom.getTime() >= end.getTime()) {
      continue;
    }
    const next = i + 1 < evs.length ? evs[i + 1].at : end;
    const tTo = next.getTime() > end.getTime() ? end.getTime() : next.getTime();
    sum += tTo - tFrom.getTime();
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
export function taskMetrics(sql: Queryable, actor: Actor, briefId: string): Promise<Metrics> {
  return metricsFor(sql, actor, SOURCE_BRIEF, briefId);
}

/**
 * assetMetrics returns a Creative Asset's metrics (§5.1 + the Revision SLA /
 * revision_speed_score of M7-OA-3), recomputed purely from the log. Same read gate.
 */
export function assetMetrics(sql: Queryable, actor: Actor, assetId: string): Promise<Metrics> {
  return metricsFor(sql, actor, SOURCE_ASSET, assetId);
}

async function metricsFor(sql: Queryable, actor: Actor, src: TaskSource, id: string): Promise<Metrics> {
  let division: string;
  let status: string;
  let sla: number | null;
  let revisionSla: number | null = null;
  let ownerAm: string;
  if (src.table === 'assets') {
    const rows = await sql<
      { assigned_division: string; status: string; sla_target_hours: string | null; revision_sla_target_hours: string | null; assigned_am_id: string | null }[]
    >`
      select b.assigned_division, a.status, a.sla_target_hours, a.revision_sla_target_hours, c.assigned_am_id
        from assets a
        join briefs b on b.id = a.brief_id
        join services sv on sv.id = b.service_id
        join clients c on c.id = sv.client_id
       where a.id = ${id}`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    division = rows[0].assigned_division;
    status = rows[0].status;
    sla = rows[0].sla_target_hours === null ? null : Number(rows[0].sla_target_hours);
    revisionSla = rows[0].revision_sla_target_hours === null ? null : Number(rows[0].revision_sla_target_hours);
    ownerAm = rows[0].assigned_am_id ?? '';
  } else {
    const rows = await sql<
      { assigned_division: string; status: string; sla_target_hours: string | null; assigned_am_id: string | null }[]
    >`
      select b.assigned_division, b.status, b.sla_target_hours, c.assigned_am_id
        from briefs b
        join services sv on sv.id = b.service_id
        join clients c on c.id = sv.client_id
       where b.id = ${id}`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    division = rows[0].assigned_division;
    status = rows[0].status;
    sla = rows[0].sla_target_hours === null ? null : Number(rows[0].sla_target_hours);
    ownerAm = rows[0].assigned_am_id ?? '';
  }
  if (!canViewTask(actor, ownerAm, division)) {
    throw new ForbiddenError(MSG_TASK_VIEW_FORBIDDEN);
  }
  const entries = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = ${src.entityType} and entity_id = ${id} order by id asc`;
  const evs: Transition[] = [];
  for (const e of entries) {
    const to = transitionTarget(e.action);
    if (to !== null) {
      evs.push({ to, at: e.created_at });
    }
  }
  const m = computeMetrics(evs, sla, revisionSla);
  return { briefId: id, status, ...m };
}
