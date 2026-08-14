/**
 * Creative domain service (M7). Ported from Go's `internal/module7_creative/*`.
 *
 * Introduces the Asset (AST-), Creative's actual unit of work: one row per
 * individual output toward a Brief's Quantity/Target (M7 §2 — "12 Product Videos"
 * is one Brief but twelve Assets).
 *
 * Division of responsibility with Module 12 (the canonical Task engine, task.ts):
 *   - THIS module owns the Asset ENTITY: creation (Brief breakdown, §4), the
 *     AM-side review edges at Asset granularity (§4 Flow 3 / §6), the manual Hours
 *     Logged field (§5 Rule 2), and the Asset reads.
 *   - `task` owns the DIVISION-side execution edges (start/submit/rework/block),
 *     the SLA/PIC writes, the recompute-from-log metrics, and the Brief→Asset
 *     roll-up. The parent Brief's status is a roll-up of its Assets (M7 §2),
 *     recomputed via task.recomputeBriefRollup after every Asset transition
 *     (execution edges there, review edges here).
 *
 * House rules honoured here:
 *   - the AST- id is minted only after mandatory-field validation (house rule 1);
 *   - the birth status [To Do] is set at INSERT (a creation, not a transition);
 *     every later status move goes through the engine (house rule 2);
 *   - Revision Count is DERIVED from the immutable audit log, never stored (3/4).
 *
 * Reference: backend/internal/module7_creative/{asset,review,hours,asset_read}.go.
 */

import { bi, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { recomputeBriefRollup } from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const CREATIVE_DIVISION = 'Creative';
export const ACCOUNT_DIVISION = 'Account';

// Asset status labels — the canonical brief_task machine (STATE_MACHINES §7), per-row.
const STATUS_TODO = '[To Do]';
const STATUS_IN_REVIEW = '[In Review]';
const STATUS_APPROVED = '[Approved]';
const STATUS_REVISION_REQ = '[Revision Requested]';
/** Paused on an external dependency (M11/M12) — excluded from the Hours reminder sweep. */
const STATUS_BLOCKED = '[Blocked]';
const SERVICE_VOIDED = '[Cancelled — Service Voided]';

const MACHINE_BRIEF_TASK = 'brief_task';
/** §6 Rule 4: a single Asset crossing 3 revisions flags the Team Leader. */
const ASSET_REVISION_FLAG_THRESHOLD = 3;

// --- Verbatim BI messages (M7). Each mirrors a Go sentinel 1:1. ---

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_ASSET_NOT_FOUND = '[aset tidak ditemukan]';
export const MSG_ASSET_FORBIDDEN = '[anda tidak memiliki akses ke aset ini]';
export const MSG_NOT_CREATIVE_BRIEF = '[brief ini bukan brief divisi Creative]';
export const MSG_ASSET_CREATE_FORBIDDEN = '[anda tidak memiliki akses untuk membuat aset pada brief ini]';
export const MSG_BRIEF_NOT_ASSETABLE = '[aset tidak dapat dibuat untuk brief pada status ini]';
export const MSG_INVALID_SEQUENCE = '[nomor urut aset harus antara 1 dan jumlah target brief]';
export const MSG_DUPLICATE_SEQUENCE = '[nomor urut aset sudah digunakan pada brief ini]';
/** Fan-out by quantity (§3 Rule 4): each assignment line needs a whole positive count. */
export const MSG_INVALID_QUANTITY = '[jumlah aset yang di-assign harus lebih dari 0]';
/** The batch asks for more units than the Brief's Quantity/Target still has free (§9.3). */
export const MSG_QUANTITY_EXCEEDS_TARGET = '[jumlah aset melebihi sisa target brief]';
export const MSG_INVALID_PIC = '[PIC tidak valid: harus staff divisi Creative yang aktif]';
export const MSG_REVIEW_FORBIDDEN = '[hanya Account Manager pemilik klien yang dapat mereview aset ini]';
export const MSG_REVISION_FEEDBACK_REQUIRED = '[feedback revisi wajib diisi]';
export const MSG_HOURS_FORBIDDEN = '[anda tidak memiliki akses untuk mencatat Hours Logged aset ini]';
export const MSG_INVALID_HOURS = '[jumlah Hours Logged harus lebih dari 0]';
/** Daily Output read gate (§9.1): PIC / Creative lead / OD / Director only. */
export const MSG_DAILY_OUTPUT_FORBIDDEN = '[anda tidak memiliki akses ke Daily Output ini]';
/** Hours Logged reminder scan gate (§9.1): Creative division (any level) / Director. */
export const MSG_HOURS_REMINDER_SCAN_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan pemindaian pengingat Hours Logged]';

// --- Errors (creative-scoped; mapped in apps/api http.ts). ---

/** Bad/missing input (→ 400): incomplete, bad sequence, invalid PIC/hours, missing feedback. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeForbiddenError';
  }
}
/** The referenced brief / asset does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_ASSET_NOT_FOUND) {
    super(message);
    this.name = 'CreativeNotFoundError';
  }
}
/** A lifecycle conflict (→ 409): non-Creative brief, not assetable, duplicate sequence. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeConflictError';
  }
}

// --- Types ---

/** The caller-supplied Asset fields (§9.3). Asset Type is inherited from the Brief. */
export interface AssetInput {
  sequenceNo: number;
  assignedPic?: string;
}

/**
 * One line of a fan-out batch: HOW MANY units of the Brief go to WHICH PIC
 * (M7 §3 Rule 4 — "a 12-video Brief split between two Videographers"). The
 * Sequence #s are allocated by the server from the Brief's free slots, because
 * the position within the Quantity/Target is bookkeeping, not an assignment
 * decision — nobody assigning 10 videos to Rian is choosing which ten.
 * An empty `assignedPic` keeps the §4 Flow 1 self-claim behaviour.
 */
export interface AssetAssignment {
  assignedPic?: string;
  quantity: number;
}

/** One Asset record (AST-). */
export interface Asset {
  id: string;
  briefId: string;
  assetType: string;
  sequenceNo: number;
  assignedPic: string;
  outputLink: string;
  status: string;
  slaTargetHours: number | null;
  revisionSlaHours: number | null;
  hoursLogged: number | null;
  attributedGmv: number | null;
  revisionCount: number;
  revisionFlagged: boolean;
  createdBy: string;
  createdAt: Date;
}

// --- Authorization predicates ---

/** canCreateAsset: the Brief's Creative division staff/lead (self-claim/Team Leader) or Director. */
export function canCreateAsset(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return (
    actor.role.division === CREATIVE_DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

/** canSeeAsset is the §9.1 read predicate (mirrors account.canSeeBrief). */
export function canSeeAsset(actor: Actor, ownerAm: string, division: string): boolean {
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

/** canLogHours: the assigned PIC (self-report), the Creative division lead, or Director. */
export function canLogHours(actor: Actor, division: string, assignedPic: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (permission.isLead(actor, division)) {
    return true;
  }
  return assignedPic !== '' && actor.employeeId === assignedPic;
}

/**
 * validateCreativeStaff enforces that picId is an ACTIVE employee whose resolved
 * CDPS division is Creative and whose level is staff (§2 Rule 1). Mirrors
 * task.validatePicForDivision.
 */
async function validateCreativeStaff(tx: Queryable, picId: string): Promise<void> {
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
  if (!active || r.division !== CREATIVE_DIVISION || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_PIC);
  }
}

// --- Create ---

/**
 * createAsset breaks one unit of a Creative Brief into an Asset row (M7 §4). Assets
 * are created incrementally (§4 Rule 1 / M7-OA-6): the caller supplies the next
 * Sequence #. Creatable by the Brief's Creative staff/lead (self-claim / Team
 * Leader) or Director. Asset Type is inherited read-only from the Brief's
 * Deliverable Type. A self-claiming staff member becomes the PIC by default.
 */
export async function createAsset(sql: Sql, actor: Actor, briefId: string, input: AssetInput): Promise<Asset> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const brief = await lockAssetableBrief(tx, actor, briefId);
    // §9.3 Sequence # mandatory, within 1..Quantity/Target.
    if ((input.sequenceNo ?? 0) <= 0) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (input.sequenceNo > brief.quantityTarget) {
      throw new ValidationError(MSG_INVALID_SEQUENCE);
    }
    const dup = await tx<{ id: string }[]>`select id from assets where brief_id = ${briefId} and sequence_no = ${input.sequenceNo}`;
    if (dup.length > 0) {
      throw new ConflictError(MSG_DUPLICATE_SEQUENCE);
    }
    const picId = await resolveAssetPic(tx, actor, input.assignedPic);
    return insertAsset(tx, actor, briefId, brief.deliverableType, input.sequenceNo, picId, now);
  });
}

/**
 * createAssetBatch is the fan-out door as the work is actually handed out (M7 §3
 * Rule 4): one line per PIC saying HOW MANY units they take — "10 videos to Rian,
 * 10 to Dita" or all 30 to one person — instead of one submit per Sequence #.
 *
 * The Sequence #s come from the Brief's still-free slots in ascending order, so
 * §9.3's mandatory, unique-per-Brief Sequence # holds without anyone typing it.
 * Everything happens in ONE transaction under the Brief's row lock: two leads
 * fanning out the same Brief concurrently cannot be handed the same slot, and a
 * batch that overruns the Quantity/Target creates nothing at all.
 *
 * A line with an empty PIC keeps §4 Flow 1's self-claim (a Creative staffer
 * becomes the PIC of their own rows); a lead may leave it unassigned for the
 * general queue.
 */
export async function createAssetBatch(sql: Sql, actor: Actor, briefId: string, lines: AssetAssignment[]): Promise<Asset[]> {
  const now = new Date();
  if (lines.length === 0) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError(MSG_INVALID_QUANTITY);
    }
  }
  return withTransaction(sql, async (tx) => {
    const brief = await lockAssetableBrief(tx, actor, briefId);
    // The free slots of 1..Quantity/Target — Assets are created incrementally
    // (§4 Rule 1 / M7-OA-6), so earlier batches have already taken some.
    const taken = await tx<{ sequence_no: number }[]>`select sequence_no from assets where brief_id = ${briefId}`;
    const used = new Set(taken.map((r) => Number(r.sequence_no)));
    const free: number[] = [];
    for (let n = 1; n <= brief.quantityTarget; n += 1) {
      if (!used.has(n)) {
        free.push(n);
      }
    }
    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    if (total > free.length) {
      throw new ValidationError(MSG_QUANTITY_EXCEEDS_TARGET);
    }

    const out: Asset[] = [];
    let next = 0;
    for (const line of lines) {
      // Validated once per line, not once per unit: same PIC, same answer.
      const picId = await resolveAssetPic(tx, actor, line.assignedPic);
      for (let i = 0; i < line.quantity; i += 1) {
        out.push(await insertAsset(tx, actor, briefId, brief.deliverableType, free[next], picId, now));
        next += 1;
      }
    }
    return out;
  });
}

/** The Brief fields both Asset-creation doors need, read under a row lock. */
interface AssetableBrief {
  deliverableType: string;
  quantityTarget: number;
}

/**
 * lockAssetableBrief row-locks the parent Brief and enforces the shared §4 gate:
 * the Brief exists, belongs to Creative, is not already closed out, and the actor
 * may break it down. The lock is what makes Sequence # allocation safe.
 */
async function lockAssetableBrief(tx: Queryable, actor: Actor, briefId: string): Promise<AssetableBrief> {
  const rows = await tx<{ assigned_division: string; status: string; deliverable_type: string; quantity_target: number }[]>`
    select assigned_division, status, deliverable_type, quantity_target from briefs where id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  const brief = rows[0];
  if (brief.assigned_division !== CREATIVE_DIVISION) {
    throw new ConflictError(MSG_NOT_CREATIVE_BRIEF);
  }
  if (brief.status === STATUS_APPROVED || brief.status === SERVICE_VOIDED) {
    throw new ConflictError(MSG_BRIEF_NOT_ASSETABLE);
  }
  if (!canCreateAsset(actor)) {
    throw new ForbiddenError(MSG_ASSET_CREATE_FORBIDDEN);
  }
  return { deliverableType: brief.deliverable_type, quantityTarget: Number(brief.quantity_target) };
}

/**
 * resolveAssetPic resolves one assignment target: an explicit value is validated
 * as active Creative staff; a self-claiming staff member defaults to themselves
 * (§4 Flow 1); a lead may leave it unassigned ('' → NULL, general queue).
 */
async function resolveAssetPic(tx: Queryable, actor: Actor, assignedPic?: string): Promise<string> {
  let picId = (assignedPic ?? '').trim();
  if (picId === '' && actor.role.division === CREATIVE_DIVISION && actor.role.level === permission.LevelStaff) {
    picId = actor.employeeId; // self-claim (§4 Flow 1)
  }
  if (picId !== '') {
    await validateCreativeStaff(tx, picId);
  }
  return picId;
}

/**
 * insertAsset mints the AST- id (house rule 1: only after validation passes),
 * writes the row born `[To Do]` (a creation, not a transition — house rule 2) and
 * appends its immutable creation audit line (house rule 3).
 */
async function insertAsset(
  tx: Queryable, actor: Actor, briefId: string, assetType: string, sequenceNo: number, picId: string, now: Date,
): Promise<Asset> {
  const ex = executors(tx);
  const id = await ex.ident.identNext('AST', now);
  await tx`
    insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
    values (${id}, ${briefId}, ${assetType}, ${sequenceNo}, ${picId || null}, ${STATUS_TODO}, ${actor.employeeId})`;
  await ex.audit.insertAudit({
    entityType: 'asset', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
    beforeJson: null,
    afterJson: { status: STATUS_TODO, brief_id: briefId, sequence_no: sequenceNo, asset_type: assetType },
    createdBy: actor.employeeId,
  });
  return {
    id, briefId, assetType, sequenceNo, assignedPic: picId,
    outputLink: '', status: STATUS_TODO, slaTargetHours: null, revisionSlaHours: null, hoursLogged: null,
    attributedGmv: null, revisionCount: 0, revisionFlagged: false, createdBy: actor.employeeId, createdAt: now,
  };
}

// --- AM-side review edges (§4 Flow 3 / §6) ---

/** reviewAsset pulls a [Submitted] Asset into [In Review] (§4 Flow 3). Owning AM or Director. */
export function reviewAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, assetId, STATUS_IN_REVIEW, '');
}

/** approveAsset approves an Asset under review ([In Review] → [Approved], §4 Flow 3). Owning AM or Director. */
export function approveAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, assetId, STATUS_APPROVED, '');
}

/**
 * requestAssetRevision sends an Asset under review back to the PIC with mandatory
 * feedback ([In Review] → [Revision Requested], §6 Rule 1). Owning AM or Director.
 * The revision count derives from the log; on the exact 3rd revision the per-Asset
 * Team-Leader flag fires (§6 Rule 4).
 */
export async function requestAssetRevision(sql: Sql, actor: Actor, assetId: string, feedback: string): Promise<statemachine.TransitionResult> {
  const why = (feedback ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REVISION_FEEDBACK_REQUIRED);
  }
  return driveReviewEdge(sql, actor, assetId, STATUS_REVISION_REQ, why);
}

/**
 * driveReviewEdge is the shared owner-gated engine driver for the AM review edges.
 * It locks the Asset, enforces the owning-AM gate, drives the edge, records the
 * mandatory feedback (revision only), fires the §6 Rule 4 flag on the 3rd revision,
 * and recomputes the parent Brief's roll-up — all in one transaction.
 */
async function driveReviewEdge(sql: Sql, actor: Actor, assetId: string, to: string, feedback: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { briefId, division } = await lockAssetOwner(tx, actor, assetId);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'asset', table: 'assets', entityId: assetId, to, actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }
    if (to === STATUS_REVISION_REQ) {
      // §6 Rule 1: mandatory feedback recorded immutably in the audit log.
      await ex.audit.insertAudit({
        entityType: 'asset', entityId: assetId, actorEmployeeId: actor.employeeId, action: 'revision_feedback',
        beforeJson: null, afterJson: { feedback }, createdBy: actor.employeeId,
      });
      // §6 Rule 4: fire the per-Asset Quality flag on the exact 3rd revision (once).
      if (await deriveAssetRevisionCount(tx, assetId) === ASSET_REVISION_FLAG_THRESHOLD) {
        await notification.emit(ex.notify, {
          event: notification.EVENTS.RevisionCountFlag, entityType: 'asset', entityId: assetId,
          actor: actor.employeeId, division,
        });
      }
    }
    // M7 §2: recompute the parent Brief's roll-up after every Asset status change.
    await recomputeBriefRollup(tx, actor, briefId);
    return res;
  });
}

/**
 * lockAssetOwner row-locks an Asset and returns its (parent Brief id, Creative
 * division), enforcing the §4 Flow 3 review gate: owning AM or Director only.
 */
async function lockAssetOwner(tx: Queryable, actor: Actor, assetId: string): Promise<{ briefId: string; division: string }> {
  const rows = await tx<{ brief_id: string; assigned_division: string; assigned_am_id: string | null }[]>`
    select a.brief_id, b.assigned_division, c.assigned_am_id
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where a.id = ${assetId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_ASSET_NOT_FOUND);
  }
  if (!actor.role.director && rows[0].assigned_am_id !== actor.employeeId) {
    throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  }
  return { briefId: rows[0].brief_id, division: rows[0].assigned_division };
}

// --- Hours Logged (§5 Rule 2) ---

/**
 * logHours sets the Asset's Hours Logged (§5 Rule 2) — a manual, self-reported,
 * NON-punitive effort figure (never folded into KPI scoring). Must be > 0.
 * Allowed for the assigned PIC, the Creative lead, or Director. Audited.
 */
export async function logHours(sql: Sql, actor: Actor, assetId: string, hours: number): Promise<void> {
  if (!(hours > 0)) {
    throw new ValidationError(MSG_INVALID_HOURS);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ assigned_division: string; assigned_pic: string | null; hours_logged: string | null }[]>`
      select b.assigned_division, a.assigned_pic, a.hours_logged
        from assets a join briefs b on b.id = a.brief_id
       where a.id = ${assetId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_ASSET_NOT_FOUND);
    }
    const r = rows[0];
    if (!canLogHours(actor, r.assigned_division, r.assigned_pic ?? '')) {
      throw new ForbiddenError(MSG_HOURS_FORBIDDEN);
    }
    const before = r.hours_logged === null ? null : Number(r.hours_logged);
    await tx`update assets set hours_logged = ${hours} where id = ${assetId}`;
    await ex.audit.insertAudit({
      entityType: 'asset', entityId: assetId, actorEmployeeId: actor.employeeId, action: 'hours_logged',
      beforeJson: { hours_logged: before }, afterJson: { hours_logged: hours }, createdBy: actor.employeeId,
    });
  });
}

// --- Reads ---

/**
 * getAsset returns one Asset with its derived Revision Count / flag, if the actor
 * may see it (§9.1: OD/Director, Account lead, owning AM, Creative division staff/lead).
 */
export async function getAsset(sql: Queryable, actor: Actor, assetId: string): Promise<Asset> {
  const rows = await sql<AssetRow[]>`${assetSelect(sql)} where a.id = ${assetId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_ASSET_NOT_FOUND);
  }
  if (!canSeeAsset(actor, rows[0].assigned_am_id ?? '', rows[0].assigned_division)) {
    throw new ForbiddenError(MSG_ASSET_FORBIDDEN);
  }
  const asset = rowToAsset(rows[0]);
  asset.revisionCount = await deriveAssetRevisionCount(sql, assetId);
  asset.revisionFlagged = asset.revisionCount >= ASSET_REVISION_FLAG_THRESHOLD;
  return asset;
}

/**
 * listBriefAssets returns all Assets of a Brief (progress: "5 of 12 created",
 * §4 Rule 1), ordered by Sequence #. Same read gate as getAsset.
 */
export async function listBriefAssets(sql: Queryable, actor: Actor, briefId: string): Promise<Asset[]> {
  // O52: same read-path fix as assetSelect — the client join used to erase the
  // row for the Brief's own division.
  const owner = await sql<{ assigned_division: string; assigned_am_id: string | null }[]>`
    select b.assigned_division, private.brief_owner_am(b.id) as assigned_am_id
      from briefs b
     where b.id = ${briefId}`;
  if (owner.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  if (!canSeeAsset(actor, owner[0].assigned_am_id ?? '', owner[0].assigned_division)) {
    throw new ForbiddenError(MSG_ASSET_FORBIDDEN);
  }
  const rows = await sql<AssetRow[]>`${assetSelect(sql)} where a.brief_id = ${briefId} order by a.sequence_no asc`;
  return rows.map(rowToAsset);
}

// --- Helpers ---

interface AssetRow {
  id: string;
  brief_id: string;
  asset_type: string;
  sequence_no: number;
  assigned_pic: string | null;
  output_link: string | null;
  status: string;
  sla_target_hours: string | null;
  revision_sla_target_hours: string | null;
  hours_logged: string | null;
  attributed_gmv: string | null;
  created_by: string;
  created_at: Date;
  assigned_division: string;
  assigned_am_id: string | null;
}

/**
 * assetSelect is the shared Asset read model.
 *
 * O52: the owning AM arrives through `private.brief_owner_am`, not through
 * `join services join clients`. Neither policy has an execution-division arm, so
 * that join returned zero rows for Creative staff/lead and `GET /assets/{id}`
 * answered **404 `[aset tidak ditemukan]`** for the division doing the work.
 * `assets` and `briefs` both survive RLS on their own; only `assigned_am_id`
 * ever needed a door.
 */
function assetSelect(sql: Queryable) {
  return sql`
    select a.id, a.brief_id, a.asset_type, a.sequence_no, a.assigned_pic, a.output_link, a.status,
           a.sla_target_hours, a.revision_sla_target_hours, a.hours_logged, a.attributed_gmv,
           a.created_by, a.created_at, b.assigned_division,
           private.brief_owner_am(a.brief_id) as assigned_am_id
      from assets a
      join briefs b on b.id = a.brief_id`;
}

const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

function rowToAsset(r: AssetRow): Asset {
  return {
    id: r.id, briefId: r.brief_id, assetType: r.asset_type, sequenceNo: r.sequence_no,
    assignedPic: r.assigned_pic ?? '', outputLink: r.output_link ?? '', status: r.status,
    slaTargetHours: numOrNull(r.sla_target_hours), revisionSlaHours: numOrNull(r.revision_sla_target_hours),
    hoursLogged: numOrNull(r.hours_logged), attributedGmv: numOrNull(r.attributed_gmv),
    revisionCount: 0, revisionFlagged: false, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** deriveAssetRevisionCount counts [In Review] → [Revision Requested] transitions (§6 Rule 2). */
async function deriveAssetRevisionCount(sql: Queryable, assetId: string): Promise<number> {
  const action = `transition:${STATUS_IN_REVIEW}->${STATUS_REVISION_REQ}`;
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from audit_log where entity_type = 'asset' and entity_id = ${assetId} and action = ${action}`;
  return Number(rows[0].n);
}

// ---------------------------------------------------------------------------
// Daily Output (M7 §7) — auto-logged, no double entry.
//
// PRD §7 Rule 1: "Every Asset status transition auto-creates a Daily Output
// record for the PIC — no separate manual sheet, no double entry." Every Asset
// transition ALREADY appends an immutable `transition:[X]->[Y]` audit row (actor
// + timestamp). So Daily Output is NOT a typed-in table and NOT a nightly
// snapshot — it is a PURE DERIVED read-model over that immutable log (house rule
// #4: computed, read-only, always recomputable). Nothing is written here.
//
// Interpretations (mirrors the Go port, logged DECISIONS W2-M7-C2):
//   - Attribution ("for the PIC"): each entry is attributed to the Asset's
//     CURRENT Assigned PIC (§8 Rule 2 confirms — the Output Quantity KPI counts
//     [Approved] Assets per PIC even though the AM drives the approval). A
//     transition on an unassigned Asset belongs to no PIC and surfaces once claimed.
//   - Output Unit Type (§7 Rule 2 / §9.4): the Asset Type (the reliable per-row
//     "what output unit this is" signal); sub-team role granularity stays deferred.
//   - End-of-day lock (§7 Rule 3, "locks at 23:59 local" = WIB, O20): a DERIVED
//     boolean, true once the current WIB date has moved past the entry's WIB day.
//     Past days are immutable BY CONSTRUCTION (append-only log — no edit path).
//   - Output ID (§9.4, "auto-generated per transition"): the audit row's own id.
// ---------------------------------------------------------------------------

/** Milliseconds in one day — WIB has no DST, so +DAY_MS from a WIB midnight lands the next. */
const DAY_MS = 24 * 3600 * 1000;

/** One auto-logged Daily Output record (§9.4), derived from one Asset-transition audit row. */
export interface OutputEntry {
  outputId: number; // audit row id — one auto id per transition (§9.4)
  pic: string; // Asset's current Assigned PIC (§7 Rule 1)
  outputUnitType: string; // = Asset Type (§7 Rule 2 / §9.4)
  assetId: string;
  briefId: string;
  clientId: string;
  transition: string; // destination status, e.g. "[Approved]"
  timestamp: Date; // transition timestamp (absolute, UTC storage)
  dateWib: string; // WIB calendar-day bucket "YYYY-MM-DD" (O20)
  locked: boolean; // §7 Rule 3: the WIB day has ended
}

/** One PIC's auto-logged output for one WIB calendar day (the §7 Flow 2 dashboard view). */
export interface DailyOutputDay {
  pic: string;
  dateWib: string;
  locked: boolean;
  total: number; // all transition outputs that day
  approved: number; // [Approved] outputs — the Output Quantity KPI feed (§8 Rule 2)
  entries: OutputEntry[];
}

/**
 * dailyOutput returns one PIC's auto-logged Daily Output for the WIB calendar day
 * containing `day` (M7 §7). Recomputed entirely from the immutable audit log; it
 * writes nothing. Read gate (§9.1): the PIC themselves, the Creative Team Leader
 * (division-wide), OD, or Director — deliberately narrower than the client-facing
 * Asset read gate (Account / owning AM are NOT Daily-Output viewers). `now` is the
 * clock for the end-of-day lock (injectable for deterministic tests).
 */
export async function dailyOutput(
  sql: Queryable,
  actor: Actor,
  pic: string,
  day: Date = new Date(),
  now: Date = new Date(),
): Promise<DailyOutputDay> {
  const p = (pic ?? '').trim();
  if (p === '') {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  if (!canSeeDailyOutput(actor, p)) {
    throw new ForbiddenError(MSG_DAILY_OUTPUT_FORBIDDEN);
  }

  // Bucket the target day to WIB (O20). The UTC window for WIB day D is
  // [D 00:00 WIB, D+1 00:00 WIB) — so a transition at 01:30 WIB (the previous UTC
  // date) still lands in day D, the 00:00–07:00 WIB edge the bucketing must get right.
  const dayMid = tz.date(day);
  const nextMid = new Date(dayMid.getTime() + DAY_MS);
  const dateWib = tz.dateString(day);
  const locked = dayLocked(dayMid, now);

  const rows = await sql<
    { id: string; action: string; created_at: Date; asset_id: string; brief_id: string; asset_type: string; client_id: string }[]
  >`
    select al.id, al.action, al.created_at, a.id as asset_id, a.brief_id, a.asset_type, sv.client_id
      from audit_log al
      join assets a on a.id = al.entity_id
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
     where al.entity_type = 'asset'
       and al.action like 'transition:%'
       and a.assigned_pic = ${p}
       and al.created_at >= ${dayMid} and al.created_at < ${nextMid}
     order by al.created_at asc, al.id asc`;

  const out: DailyOutputDay = { pic: p, dateWib, locked, total: 0, approved: 0, entries: [] };
  for (const r of rows) {
    const to = transitionTo(r.action);
    if (to === null) {
      continue;
    }
    out.entries.push({
      outputId: Number(r.id), pic: p, outputUnitType: r.asset_type,
      assetId: r.asset_id, briefId: r.brief_id, clientId: r.client_id,
      transition: to, timestamp: r.created_at, dateWib, locked,
    });
    out.total++;
    if (to === STATUS_APPROVED) {
      out.approved++;
    }
  }
  return out;
}

/**
 * canSeeDailyOutput is the §9.1 Daily-Output read gate: the PIC themselves, the
 * Creative Team Leader (division-wide), OD, or Director. Narrower than canSeeAsset
 * — Daily Output is a Creative-internal production feed, not client-facing.
 */
export function canSeeDailyOutput(actor: Actor, pic: string): boolean {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.isLead(actor, CREATIVE_DIVISION)) {
    return true; // Creative Team Leader
  }
  return actor.employeeId === pic; // own
}

/**
 * dayLocked reports whether the WIB day whose midnight is dayMid has ended
 * relative to now (§7 Rule 3): locked once the current WIB date is past that day.
 * Today's day is still open; future days are not locked.
 */
function dayLocked(dayMid: Date, now: Date): boolean {
  return tz.date(now).getTime() > dayMid.getTime();
}

/** transitionTo extracts the destination state from a "transition:A->B" audit action. */
function transitionTo(action: string): string | null {
  const prefix = 'transition:';
  if (!action.startsWith(prefix)) {
    return null;
  }
  const rest = action.slice(prefix.length);
  const idx = rest.indexOf('->');
  if (idx < 0) {
    return null;
  }
  return rest.slice(idx + 2);
}

// ---------------------------------------------------------------------------
// Hours Logged end-of-day reminder (M7 §5 Rule 2 / M7-OA-2, DECISIONS O29 /
// W3-CAT-1 — the one event the catalog freeze opened for). Hours Logged stays
// optional and non-punitive — this sweep only nudges completion, never blocks or
// scores. Pattern mirrored field-for-field from finance.scanReminders (M5 §6): a
// sweep safe on every dashboard load AND a nightly cron, each candidate re-checked
// and fire-once-guarded inside its own row-locked transaction so concurrent scans
// never double-emit.
//
// "Active" (per the cluster brief): the Asset has an assigned PIC AND its status
// is neither terminal ([Approved]) nor [Blocked] (paused on an external dependency
// — no work happening to log hours against). Every other status counts as active.
//
// "Logged today": Hours Logged (logHours) is a single overwrite-and-audit figure,
// not a per-day table — so "logged today" is read like Daily Output, from the
// immutable log: at least one `hours_logged` audit row inside the target WIB day.
//
// Dedup: assets.hours_reminder_sent_at (migration 0031) stores the last reminder's
// timestamp. A candidate is skipped only while that timestamp's WIB day is still
// today's; once the WIB day moves on, the guard reopens — a PIC who still hasn't
// logged gets reminded again the next day, but never twice within one WIB day.
// ---------------------------------------------------------------------------

/** The synthetic actor id the automated sweep records (never a recipient — notifyActor false). */
const HOURS_REMINDER_SYSTEM_ACTOR = 'SYSTEM';

/** Active for the reminder sweep: not terminal ([Approved]), not paused ([Blocked]). */
function isHoursReminderActiveStatus(status: string): boolean {
  return status !== STATUS_APPROVED && status !== STATUS_BLOCKED;
}

/** What one scanHoursReminders pass fired. */
export interface ScanHoursReminderResult {
  remindersSent: number;
}

/**
 * scanHoursReminders finds every active Asset (assigned PIC, non-terminal,
 * non-blocked) whose PIC has not logged Hours on it for the WIB calendar day
 * containing `now`, and emits HoursLoggedReminder to that PIC — at most once per
 * (Asset, WIB day). Safe on every dashboard load and on a nightly cron. Each
 * candidate is re-checked and fired inside its own row-locked transaction.
 */
export async function scanHoursReminders(sql: Sql, now: Date = new Date()): Promise<ScanHoursReminderResult> {
  const today = tz.date(now);
  const res: ScanHoursReminderResult = { remindersSent: 0 };

  const candidates = await sql<{ id: string }[]>`
    select id from assets
     where assigned_pic is not null and assigned_pic <> ''
       and status not in (${STATUS_APPROVED}, ${STATUS_BLOCKED})`;
  for (const { id } of candidates) {
    if (await fireHoursReminder(sql, id, now, today)) {
      res.remindersSent++;
    }
  }
  return res;
}

/**
 * fireHoursReminder re-checks and fires one Asset's reminder inside a row-locked
 * transaction (finance fireOverdue precedent). It stamps hours_reminder_sent_at
 * with the scan's own `now` (not SQL now()) so the fire-once day comparison stays
 * consistent with the clock the scan was run against (deterministic under tests).
 * Returns true iff a reminder was emitted.
 */
async function fireHoursReminder(sql: Sql, assetId: string, now: Date, today: Date): Promise<boolean> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ status: string; assigned_pic: string | null; hours_reminder_sent_at: Date | null }[]>`
      select status, assigned_pic, hours_reminder_sent_at from assets where id = ${assetId} for update`;
    if (rows.length === 0) {
      return false; // raced away (no asset delete path exists, so this is defensive)
    }
    const r = rows[0];
    if (!isHoursReminderActiveStatus(r.status) || !r.assigned_pic) {
      return false; // moved to approved/blocked or unassigned since candidates were listed
    }
    if (r.hours_reminder_sent_at !== null && tz.date(r.hours_reminder_sent_at).getTime() >= today.getTime()) {
      return false; // already reminded for this WIB day (or a later one)
    }
    if (await hoursLoggedOnDay(tx, assetId, today)) {
      return false; // PIC already logged Hours today — nothing to nudge
    }

    await notification.emit(ex.notify, {
      event: notification.EVENTS.HoursLoggedReminder,
      entityType: 'asset', entityId: assetId, actor: HOURS_REMINDER_SYSTEM_ACTOR,
      explicitRecipients: [r.assigned_pic], notifyActor: false,
    });
    await tx`update assets set hours_reminder_sent_at = ${now} where id = ${assetId}`;
    return true;
  });
}

/**
 * hoursLoggedOnDay reports whether the PIC logged Hours (logHours' audit action
 * "hours_logged") on this Asset within the WIB calendar day containing `day` — the
 * same UTC window as dailyOutput (O20): [day 00:00 WIB, day+1 00:00 WIB).
 */
async function hoursLoggedOnDay(tx: Queryable, assetId: string, day: Date): Promise<boolean> {
  const dayMid = tz.date(day);
  const nextMid = new Date(dayMid.getTime() + DAY_MS);
  const rows = await tx<{ n: string }[]>`
    select count(*) as n from audit_log
     where entity_type = 'asset' and entity_id = ${assetId} and action = 'hours_logged'
       and created_at >= ${dayMid} and created_at < ${nextMid}`;
  return Number(rows[0].n) > 0;
}

/** canRunHoursReminderScan: Creative (any level) or Director may trigger the scan on demand. */
export function canRunHoursReminderScan(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === CREATIVE_DIVISION;
}

/**
 * runHoursReminderScan is the authorised entry point for the scan endpoint: it
 * applies the §9.1 gate (Creative division / Director) then runs the sweep.
 */
export async function runHoursReminderScan(sql: Sql, actor: Actor, now: Date = new Date()): Promise<ScanHoursReminderResult> {
  if (!canRunHoursReminderScan(actor)) {
    throw new ForbiddenError(MSG_HOURS_REMINDER_SCAN_FORBIDDEN);
  }
  return scanHoursReminders(sql, now);
}
