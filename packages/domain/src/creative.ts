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
 * Reference: archive/backend-go/internal/module7_creative/{asset,review,hours,asset_read}.go.
 */

import { bi, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { recomputeBriefRollup, STATUS_SUBMITTED, type AssetExecBatchReport, type AssetExecRowResult } from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

export const CREATIVE_DIVISION = 'Creative';
export const ACCOUNT_DIVISION = 'Account';
/**
 * B-5 / K-3: the Ads division reads Creative Assets. Declared here as a literal
 * for the same reason the two above are — `packages/core/src/division.ts` has no
 * by-code accessor, and `ads.ADS_DIVISION` cannot be imported without making the
 * Creative module depend on the Ads module for a permission constant.
 */
export const ADS_DIVISION = 'Ads';

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
/** B-5: the client whose Approved Assets were asked for does not exist. */
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
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
/**
 * B-4 / K-1: `[Submitted]` → `[In Review]` is now the INTERNAL QC pass, so two
 * roles may drive it. MSG_REVIEW_FORBIDDEN stays on the doors that really are
 * the AM's alone (approve, and the AM's own revision request) — reusing it here
 * would tell a Creative lead that only an AM can do what they just did.
 */
export const MSG_REVIEW_START_FORBIDDEN =
  '[hanya lead divisi pelaksana atau Account Manager pemilik klien yang dapat memulai review aset ini]';
/** B-4 / K-1: `[Submitted]` → `[Revision Requested]` is the lead's internal-QC reject. */
export const MSG_QC_REJECT_FORBIDDEN = '[hanya lead divisi pelaksana yang dapat menolak aset ini pada QC internal]';
/** B-4 / K-1: handing units OUT to other PICs is the lead's job; self-claim is not. */
export const MSG_BATCH_ASSIGN_FORBIDDEN = '[hanya lead divisi Creative yang dapat membagi aset ke PIC lain]';
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

/**
 * canAssignAssetBatch: only the Creative lead (or Director) hands units OUT.
 *
 * K-1 (owner's ruling 2026-09-07, option B): the AM picks the DIVISION, the
 * LEADER splits the Brief across PICs. `canCreateAsset` stays as it is — it
 * still guards the §4 Flow 1 self-claim, which any Creative staffer may do —
 * but the fan-out door (`createAssetBatch`) is the one that decides someone
 * ELSE's workload, and that is the leader's call now.
 */
export function canAssignAssetBatch(actor: Actor): boolean {
  return permission.isLead(actor, CREATIVE_DIVISION);
}

/**
 * canDriveReviewEdge is the per-edge review gate (M7 §4 Flow 3 / §6, widened by
 * B-4 / K-1). Pure so the three doors can be asserted without a database — the
 * bug this shape prevents is a UI that shows a button the server then refuses.
 *
 *   [Submitted]  → [In Review]           internal QC PASS  · division lead OR owning AM
 *   [Submitted]  → [Revision Requested]  internal QC FAIL  · division lead ONLY
 *   [In Review]  → [Approved]            client verdict    · owning AM ONLY
 *   [In Review]  → [Revision Requested]  client verdict    · owning AM ONLY
 *
 * `[In Review] → [Approved]` deliberately does NOT widen: the AM is the client's
 * proxy, and K-1 says so in as many words ("AM tetap pemegang approval akhir").
 * A leader who could approve would be signing off on their own division's work.
 *
 * `division` is the Brief's `assigned_division`, not a literal 'Creative': the
 * same three edges carry every division's Assets, so the leader who may QC is
 * whichever division is actually executing the Brief.
 */
export function canDriveReviewEdge(
  actor: Actor, from: string, to: string, ownerAm: string, division: string,
): boolean {
  if (actor.role.director) {
    return true;
  }
  const isOwningAm = ownerAm !== '' && actor.employeeId === ownerAm;
  const isDivisionLead = permission.isLead(actor, division);
  if (to === STATUS_IN_REVIEW) {
    return isOwningAm || isDivisionLead;
  }
  if (to === STATUS_REVISION_REQ && from === STATUS_SUBMITTED) {
    return isDivisionLead;
  }
  return isOwningAm;
}

/** The exact BI refusal for the edge `canDriveReviewEdge` just denied. */
export function reviewEdgeForbiddenMessage(from: string, to: string): string {
  if (to === STATUS_IN_REVIEW) {
    return MSG_REVIEW_START_FORBIDDEN;
  }
  if (to === STATUS_REVISION_REQ && from === STATUS_SUBMITTED) {
    return MSG_QC_REJECT_FORBIDDEN;
  }
  return MSG_REVIEW_FORBIDDEN;
}

/**
 * canSeeAsset is the §9.1 read predicate (mirrors account.canSeeBrief).
 *
 * B-5/K-3 adds the Ads arm. PRD M8 §9.1 already gives the Advertiser the
 * capability "link Creative Assets" — but this gate was never widened to match,
 * so an Advertiser who guessed the right `AST-` id still got 403 and the Ads
 * campaign page shipped a free-text "type the AST- from memory" box instead of a
 * picker. READ ONLY: nothing in the write paths (`lockAssetOwner`,
 * `canDriveReviewEdge`, `canLogHours`, `lockAssetableBrief`) consults this
 * predicate, so opening it cannot let Ads move an Asset's status.
 */
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
  if (isDivisionStaffOrLead(actor, ADS_DIVISION)) {
    return true; // B-5/K-3: Ads reads the Assets it has to put into campaigns
  }
  return isDivisionStaffOrLead(actor, division);
}

/** The "works in this division, at either level" shape these predicates share. */
function isDivisionStaffOrLead(actor: Actor, division: string): boolean {
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
 *
 * EXPORTED for M19 (`dailyops.ts`), which assigns the same people to production
 * slots. Deliberately shared rather than re-implemented: two definitions of
 * "an active Creative staff member" are two answers waiting to drift, and the
 * one that drifts is the one nobody is looking at. It is also what closes the
 * HRIS chain with no extra code — an employee deactivated in HRIS stops being
 * schedulable on the next sync, because `status_aktif` is checked here.
 */
export async function validateCreativeStaff(tx: Queryable, picId: string): Promise<void> {
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
 *
 * B-4/K-1 narrows WHO may fan out: deciding ANOTHER person's workload is the
 * leader's job now. A non-lead Creative staffer keeps the §4 Flow 1 self-claim
 * untouched, which is why this is a shape check on the lines rather than a flat
 * `canAssignAssetBatch` gate on the whole door.
 *
 * The line drawn is "for someone else", NOT "more than one unit". A staffer
 * taking three of their own Brief's slots in one call is not the complaint K-1
 * answers (Account #2 — the AM picking staff names), and it is existing tested
 * behaviour: `createAssetBatch` is the only door that reuses a Sequence # gap,
 * so capping it at one unit would have quietly cost the self-claimer that. See
 * `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md` — the plan's wording ("self-claim
 * satu aset tetap boleh") reads as the reassurance that the door stays open, and
 * that reading is flagged there for the owner rather than decided here.
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
  if (!canAssignAssetBatch(actor)) {
    // Checked AFTER the quantity validation on purpose: a malformed line is a
    // 400 for everybody, and turning it into a 403 for staff would hide the
    // real complaint behind a permission message.
    const forOthers = lines.some((line) => {
      const pic = (line.assignedPic ?? '').trim();
      return pic !== '' && pic !== actor.employeeId;
    });
    if (forOthers) {
      throw new ForbiddenError(MSG_BATCH_ASSIGN_FORBIDDEN);
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

/**
 * reviewAsset pulls a [Submitted] Asset into [In Review] (§4 Flow 3) — the
 * internal-QC PASS since B-4/K-1. Executing division's lead, owning AM, or
 * Director.
 */
export function reviewAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, assetId, STATUS_IN_REVIEW, '');
}

/** approveAsset approves an Asset under review ([In Review] → [Approved], §4 Flow 3). Owning AM or Director. */
export function approveAsset(sql: Sql, actor: Actor, assetId: string): Promise<statemachine.TransitionResult> {
  return driveReviewEdge(sql, actor, assetId, STATUS_APPROVED, '');
}

/**
 * requestAssetRevision sends an Asset back to the PIC with mandatory feedback
 * (§6 Rule 1). ONE function, TWO doors since B-4/K-1 — the source state decides
 * whose call it is:
 *
 *   from [In Review]  the AM's client-side verdict (owning AM / Director), and
 *                     the only one that counts toward Revision Count + the §6
 *                     Rule 4 flag on the exact 3rd revision;
 *   from [Submitted]  the executing division lead's internal-QC reject, which
 *                     never reaches the AM and therefore never counts as a
 *                     client revision.
 *
 * Feedback is mandatory on both — a reject with no reason is the silent failure
 * house rule 5 exists to prevent.
 */
export async function requestAssetRevision(sql: Sql, actor: Actor, assetId: string, feedback: string): Promise<statemachine.TransitionResult> {
  const why = (feedback ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REVISION_FEEDBACK_REQUIRED);
  }
  return driveReviewEdge(sql, actor, assetId, STATUS_REVISION_REQ, why);
}

/**
 * reviewEdgeTx is the shared owner-gated engine driver BODY for the AM review
 * edges — locks the Asset, enforces the owning-AM gate, drives the edge, records
 * the mandatory feedback (revision only), fires the §6 Rule 4 flag on the 3rd
 * revision, and (unless `opts.propagate` is `false`) recomputes the parent
 * Brief's roll-up. Split from its transaction wrapper the same way C1 split
 * `task.execEdgeTx` from `driveExecEdge` — C4's batch review/approve drive many
 * edges inside ONE transaction and recompute the roll-up once at the end.
 */
async function reviewEdgeTx(
  tx: Queryable, actor: Actor, assetId: string, to: string, feedback: string,
  opts?: { propagate?: boolean },
): Promise<statemachine.TransitionResult> {
  const ex = executors(tx);
  const { briefId, division, from } = await lockAssetOwner(tx, actor, assetId, to);
  const res = await statemachine.transition(ex.sm, {
    machine: MACHINE_BRIEF_TASK, entityType: 'asset', table: 'assets', entityId: assetId, to, actor,
  });
  if (!res.ok) {
    throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
  }
  if (to === STATUS_REVISION_REQ) {
    // §6 Rule 1: mandatory feedback recorded immutably in the audit log. Written
    // for BOTH doors — the PIC needs to read the leader's QC note as much as the
    // AM's, and the FE's latestRevisionFeedback() finds it by this one action.
    await ex.audit.insertAudit({
      entityType: 'asset', entityId: assetId, actorEmployeeId: actor.employeeId, action: 'revision_feedback',
      beforeJson: null, afterJson: { feedback }, createdBy: actor.employeeId,
    });
    // §6 Rule 4: fire the per-Asset Quality flag on the exact 3rd revision (once).
    //
    // ONLY on the AM door. Revision Count derives from
    // `transition:[In Review]->[Revision Requested]` alone, so the leader's
    // internal QC reject leaves the count untouched — running this check after
    // one would re-fire the flag every time a QC reject happened at count 3,
    // breaking the "once" that Rule 4 is built on.
    if (from === STATUS_IN_REVIEW && await deriveAssetRevisionCount(tx, assetId) === ASSET_REVISION_FLAG_THRESHOLD) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.RevisionCountFlag, entityType: 'asset', entityId: assetId,
        actor: actor.employeeId, division,
      });
    }
  }
  // M7 §2: recompute the parent Brief's roll-up after every Asset status change.
  //
  // The roll-up is ALSO where the AM gets told (B-1b `notifyAmOnRollupEdge`):
  // a lead's QC pass on the LAST outstanding Asset moves the Brief to
  // [In Review], and that edge is what fires `BriefSiapReviewAm`. Deliberately
  // not emitted per-Asset here — twelve QC passes on one Brief is one handoff to
  // the AM, not twelve notifications.
  if (opts?.propagate ?? true) {
    await recomputeBriefRollup(tx, actor, briefId);
  }
  return res;
}

/** driveReviewEdge opens its own transaction around reviewEdgeTx — reviewAsset/approveAsset/requestAssetRevision are unchanged. */
function driveReviewEdge(sql: Sql, actor: Actor, assetId: string, to: string, feedback: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, (tx) => reviewEdgeTx(tx, actor, assetId, to, feedback));
}

/**
 * lockAssetOwner row-locks an Asset and returns its (parent Brief id, executing
 * division, current status), enforcing the §4 Flow 3 / B-4 review gate for the
 * requested target state via `canDriveReviewEdge`.
 *
 * It reads `a.status` because the gate is not the same on both doors into
 * `[Revision Requested]`: from `[Submitted]` it is the lead's internal QC
 * reject, from `[In Review]` it is the AM's client-side verdict. The engine
 * re-reads and re-locks the row itself, so this status is used for the GATE
 * only — never to decide whether the transition is legal (that stays
 * `sm_edges`' job, house rule 2).
 */
async function lockAssetOwner(
  tx: Queryable, actor: Actor, assetId: string, to: string,
): Promise<{ briefId: string; division: string; from: string }> {
  const rows = await tx<{ brief_id: string; status: string; assigned_division: string; assigned_am_id: string | null }[]>`
    select a.brief_id, a.status, b.assigned_division, c.assigned_am_id
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where a.id = ${assetId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_ASSET_NOT_FOUND);
  }
  const r = rows[0];
  if (!canDriveReviewEdge(actor, r.status, to, r.assigned_am_id ?? '', r.assigned_division)) {
    throw new ForbiddenError(reviewEdgeForbiddenMessage(r.status, to));
  }
  return { briefId: r.brief_id, division: r.assigned_division, from: r.status };
}

// ---------------------------------------------------------------------------
// AM review batch (C4, Revisi Sales/Creative/Performa) — "cek, hitung & acc":
// review/approve many Assets of one Brief at once. Two SEPARATE doors, not one
// click to [Approved] — [Submitted]->[In Review]->[Approved] are two engine
// edges, and M16 §6 / LT-30 derive waktuAmBelumBukaHours/waktuAmReviewHours
// from those two timestamps; collapsing them would grind both to ~0 forever.
// No bulk request-revision: M7 §6 Rule 1 requires feedback tied to one
// specific Asset, so that edge stays single-Asset (requestAssetRevision) — and
// B-4's internal-QC reject is the SAME edge, so it stays single-Asset too.
//
// B-4/K-1: the first door ([Submitted]->[In Review]) is now the internal QC
// pass, so the executing division's lead may drive the BATCH as well as the
// single Asset — the gate is one shared predicate (`canDriveReviewEdge`), never
// two copies. The second door ([In Review]->[Approved]) stays the AM's alone.
// ---------------------------------------------------------------------------

/** One locked Asset row, as read for the batch verdict + execution. */
interface BatchReviewAssetRow {
  assetId: string;
  sequenceNo: number;
  status: string;
  ownerAm: string;
  /** The Brief's `assigned_division` — the lead who may QC (B-4) is ITS lead. */
  division: string;
}

/**
 * lockBriefAssetsForReviewBatch locks the Brief first (`for update` — same
 * first-lock as the exec batch in task.ts, and as `lockAssetableBrief`), then
 * the requested Assets in `sequence_no` order — the one lock order every batch
 * primitive in the system uses.
 */
async function lockBriefAssetsForReviewBatch(
  tx: Queryable,
  briefId: string,
  assetIds: readonly string[],
): Promise<{ briefStatus: string; assets: Map<string, BatchReviewAssetRow> }> {
  const brief = await tx<{ status: string }[]>`select status from briefs where id = ${briefId} for update`;
  if (brief.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  const rows = await tx<{
    id: string; sequence_no: number; status: string; assigned_division: string; assigned_am_id: string | null;
  }[]>`
    select a.id, a.sequence_no, a.status, b.assigned_division, c.assigned_am_id
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where a.brief_id = ${briefId} and a.id = any(${assetIds})
     order by a.sequence_no asc
     for update`;
  const assets = new Map<string, BatchReviewAssetRow>();
  for (const r of rows) {
    assets.set(r.id, {
      assetId: r.id, sequenceNo: Number(r.sequence_no), status: r.status,
      ownerAm: r.assigned_am_id ?? '', division: r.assigned_division,
    });
  }
  return { briefStatus: brief[0].status, assets };
}

/** verdictForReview is the pure-read judgment shared by review/approve: does
 *  this Asset (belonging to the Brief) exist, may the actor drive THIS edge on
 *  it (`canDriveReviewEdge` — so the batch and the single-Asset door can never
 *  disagree), and is it in the expected source state? */
function verdictForReview(
  actor: Actor, asset: BatchReviewAssetRow | undefined, requireFrom: string, to: string,
): { ok: true } | { ok: false; reason: string } {
  if (asset === undefined) {
    return { ok: false, reason: MSG_ASSET_NOT_FOUND };
  }
  if (!canDriveReviewEdge(actor, requireFrom, to, asset.ownerAm, asset.division)) {
    return { ok: false, reason: reviewEdgeForbiddenMessage(requireFrom, to) };
  }
  if (asset.status !== requireFrom) {
    return { ok: false, reason: bi.TRANSITION_NOT_ALLOWED };
  }
  return { ok: true };
}

/**
 * reviewAssetBatch/approveAssetBatch share this three-phase engine (same shape
 * as task.execAssetBatch): judge every row under lock (pure reads), any
 * rejection -> return the report as-is with nothing written, all clean ->
 * drive every edge with propagate:false and recompute the Brief roll-up once.
 */
async function reviewApproveAssetBatch(
  sql: Sql, actor: Actor, briefId: string, requireFrom: string, to: string, assetIds: readonly string[],
): Promise<AssetExecBatchReport> {
  if (assetIds.length === 0) {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  return withTransaction(sql, async (tx) => {
    const { briefStatus, assets } = await lockBriefAssetsForReviewBatch(tx, briefId, assetIds);

    const rows: AssetExecRowResult[] = assetIds.map((assetId, i) => {
      const asset = assets.get(assetId);
      const verdict = verdictForReview(actor, asset, requireFrom, to);
      return {
        rowNumber: i + 1,
        assetId,
        sequenceNo: asset?.sequenceNo ?? 0,
        applied: verdict.ok,
        fromStatus: asset?.status ?? '',
        toStatus: verdict.ok ? to : '',
        reason: verdict.ok ? '' : verdict.reason,
      };
    });
    const rejections = rows.filter((r) => !r.applied);
    if (rejections.length > 0) {
      return { applied: 0, rejected: rejections.length, briefId, briefStatus, rows, rejections };
    }

    for (const assetId of assetIds) {
      await reviewEdgeTx(tx, actor, assetId, to, '', { propagate: false });
    }
    await recomputeBriefRollup(tx, actor, briefId);
    const after = await tx<{ status: string }[]>`select status from briefs where id = ${briefId}`;
    return { applied: rows.length, rejected: 0, briefId, briefStatus: after[0].status, rows, rejections: [] };
  });
}

/** reviewAssetBatch pulls many [Submitted] Assets of one Brief into [In Review]
 *  at once — the batch internal-QC pass. Division lead, owning AM, or Director. */
export function reviewAssetBatch(sql: Sql, actor: Actor, briefId: string, assetIds: readonly string[]): Promise<AssetExecBatchReport> {
  return reviewApproveAssetBatch(sql, actor, briefId, STATUS_SUBMITTED, STATUS_IN_REVIEW, assetIds);
}

/** approveAssetBatch approves many [In Review] Assets of one Brief at once.
 *  Owning AM or Director ONLY — K-1 leaves final approval with the AM. */
export function approveAssetBatch(sql: Sql, actor: Actor, briefId: string, assetIds: readonly string[]): Promise<AssetExecBatchReport> {
  return reviewApproveAssetBatch(sql, actor, briefId, STATUS_IN_REVIEW, STATUS_APPROVED, assetIds);
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

// ---------------------------------------------------------------------------
// Personal Asset queue (M7 §3 Rule 2 / §9.1 — "own Asset queue").
//
// §3 Rule 2 verbatim: "Each Creative staff member sees a personal queue: all
// Assets assigned to them, across all Briefs/clients, sorted by due date." Until
// now M7 had no cross-Brief read for this — the FE workspace even said so ("M7
// tidak punya endpoint agregat lintas-Brief untuk personal queue") — so a PIC had
// to open each Brief to find their own work. listMyAssets closes that gap.
//
// SELF-SCOPED, so it does NOT reuse assetSelect's `private.brief_owner_am` door:
// the caller only ever sees rows where `assigned_pic = actor.employeeId`, and the
// display needs the client shop name (`clients.toko`) + Brief context. Joining
// `services`/`clients` under RLS would erase the PIC's own rows (the O52 trap —
// neither policy has an execution-division arm). The route therefore runs this on
// the service-role client (RLS bypassed), exactly like recap.getRecapDetail: the
// hard `assigned_pic = ${actor.employeeId}` filter is the scope, so no row the
// caller may not see is ever returned. No new gate is needed — there is no target
// parameter, so a caller can only ever read their OWN queue (empty for non-PICs).
// ---------------------------------------------------------------------------

/** One row of a PIC's personal Asset queue (§3 Rule 2) — the Asset plus the Brief/client context the queue view needs. */
export interface MyAssetQueueItem {
  id: string; // AST-
  briefId: string;
  briefTitle: string;
  serviceId: string; // SVC-
  clientId: string; // CLI-
  clientName: string; // clients.toko (the store name shown to staff)
  assetType: string;
  sequenceNo: number;
  status: string;
  priority: string; // Brief priority (High/Medium/Low, free-text per M6)
  dueDate: string | null; // Brief Due Date (SLA), YYYY-MM-DD or null
  slaTargetHours: number | null;
  revisionSlaHours: number | null;
  createdAt: Date;
}

interface MyAssetQueueRow {
  id: string;
  brief_id: string;
  brief_title: string;
  service_id: string;
  client_id: string;
  client_name: string;
  asset_type: string;
  sequence_no: number;
  status: string;
  priority: string;
  due_date: string | Date | null;
  sla_target_hours: string | null;
  revision_sla_target_hours: string | null;
  created_at: Date;
}

/**
 * listMyAssets returns every Asset assigned to `actor`, across all Briefs/clients,
 * sorted by the Brief's Due Date (§3 Rule 2). No status filter — the PRD says "all
 * Assets assigned to them", so a done ([Approved]) Asset still appears (its status
 * badge tells the PIC it is finished). Due-date NULLs sort last; ties break by
 * creation order then Sequence #.
 *
 * MUST be given the service-role client (see the section header): the query is
 * hard-scoped to the caller's own `assigned_pic`, so service-role is safe and
 * avoids the O52 client-join row erasure that RLS would cause for Creative staff.
 */
export async function listMyAssets(sql: Queryable, actor: Actor): Promise<MyAssetQueueItem[]> {
  const rows = await sql<MyAssetQueueRow[]>`
    select a.id, a.brief_id, b.title as brief_title, sv.id as service_id, sv.client_id,
           c.toko as client_name, a.asset_type, a.sequence_no, a.status, b.priority, b.due_date,
           a.sla_target_hours, a.revision_sla_target_hours, a.created_at
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where a.assigned_pic = ${actor.employeeId}
     order by (b.due_date is null) asc, b.due_date asc, a.created_at asc, a.sequence_no asc`;
  return rows.map((r) => ({
    id: r.id, briefId: r.brief_id, briefTitle: r.brief_title, serviceId: r.service_id,
    clientId: r.client_id, clientName: r.client_name, assetType: r.asset_type, sequenceNo: r.sequence_no,
    status: r.status, priority: r.priority,
    dueDate: r.due_date === null ? null : (r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : String(r.due_date).slice(0, 10)),
    slaTargetHours: numOrNull(r.sla_target_hours), revisionSlaHours: numOrNull(r.revision_sla_target_hours),
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Approved Assets of one client (B-5 / K-3) — what the Ads picker reads.
//
// The Ads campaign page used to ask an Advertiser to TYPE `AST-202607-0001`
// from memory, and there was no way for them to find it: no list endpoint
// existed, and `canSeeAsset` refused the Ads division outright, so even the
// right id answered 403. Three locks, opened together (the picker is useless
// with any one of them still shut).
//
// SERVICE-ROLE, like listMyAssets — and for the same O52 reason: `assets` and
// `briefs` survive RLS on their own, but the `services`→`clients` join needed to
// scope by client has no execution-division arm and would erase every row for
// exactly the divisions that need this read. The difference from listMyAssets is
// that the scope here is a CALLER-SUPPLIED clientId, not the caller's own id, so
// the permission gate cannot be implicit: `canSeeAsset` is evaluated explicitly
// against the client's owning AM BEFORE any Asset row is read, and a caller who
// fails it gets 403 rather than an empty list (an empty list is indistinguishable
// from "this client has no approved Assets", and that ambiguity is what sends
// people back to the spreadsheet).
// ---------------------------------------------------------------------------

/** One selectable Approved Asset of a client — the picker's row (B-5). */
export interface ClientAssetOption {
  id: string; // AST-
  briefId: string; // the Creative Brief it came out of
  briefTitle: string;
  assetType: string;
  sequenceNo: number;
  outputLink: string;
  approvedAt: Date | null; // from the immutable log, never stored (house rule 4)
}

interface ClientAssetRow {
  id: string;
  brief_id: string;
  brief_title: string;
  asset_type: string;
  sequence_no: number;
  output_link: string | null;
  approved_at: Date | null;
}

/**
 * listApprovedAssetsForClient returns every `[Approved]` Asset belonging to a
 * client, newest approval first, optionally narrowed to ONE source Creative
 * Brief.
 *
 * `sourceBriefId` is how K-3's "the Ads brief points at the Creative brief it
 * came from" reaches this read: the caller passes the Ads Brief's
 * `source_creative_brief_id`, and an empty/absent value falls back to ALL of the
 * client's approved Assets — the fallback is deliberate, because a narrowed
 * picker that silently shows nothing is worse than a wide one.
 *
 * `approvedAt` is derived from the audit log (`transition:…->[Approved]`), not
 * stored — house rule 4. NULL only for a row approved before the log existed.
 *
 * MUST be given the service-role client (see the section header).
 */
export async function listApprovedAssetsForClient(
  sql: Queryable, actor: Actor, clientId: string, sourceBriefId?: string,
): Promise<ClientAssetOption[]> {
  const owner = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (owner.length === 0) {
    throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  }
  // The Asset's own division is Creative by construction (`lockAssetableBrief`
  // refuses to break down a non-Creative Brief), so that is what the division
  // arm of canSeeAsset is asked about here.
  if (!canSeeAsset(actor, owner[0].assigned_am_id ?? '', CREATIVE_DIVISION)) {
    throw new ForbiddenError(MSG_ASSET_FORBIDDEN);
  }
  const src = (sourceBriefId ?? '').trim();
  const rows = await sql<ClientAssetRow[]>`
    select a.id, a.brief_id, b.title as brief_title, a.asset_type, a.sequence_no, a.output_link,
           (select max(l.created_at) from audit_log l
             where l.entity_type = 'asset' and l.entity_id = a.id
               and l.action like ${'transition:%->' + STATUS_APPROVED}) as approved_at
      from assets a
      join briefs b on b.id = a.brief_id
      join services sv on sv.id = b.service_id
     where sv.client_id = ${clientId}
       and a.status = ${STATUS_APPROVED}
       and (${src}::text = '' or a.brief_id = ${src}::text)
     order by approved_at desc nulls last, a.brief_id asc, a.sequence_no asc`;
  return rows.map((r) => ({
    id: r.id, briefId: r.brief_id, briefTitle: r.brief_title, assetType: r.asset_type,
    sequenceNo: Number(r.sequence_no), outputLink: r.output_link ?? '', approvedAt: r.approved_at,
  }));
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
