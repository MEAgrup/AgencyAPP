/**
 * Module 11 — Project Management / Kanban. Ported from Go's
 * `internal/module11_board/{board,gate,views}.go`.
 *
 * Two cross-division views ON TOP of the per-division machines (M6–M10, M12),
 * with NO machine of its own:
 *
 *   - Dependency (DEP-): a formal, AM/SPV-declared link between two Briefs of the
 *     same Client (§2/§5.1). Its STATUS (Pending/Blocking/Satisfied) is DERIVED
 *     from the Source Brief's live status — never stored (house rule #4). A Blocking
 *     Dependency locks the Target Brief's FINAL transition ([In Review] → [Approved])
 *     until the Source reaches its terminal status; enforced as a CODE guard the
 *     Brief-approval paths call (account.approveBrief, task/kol recomputeBriefRollup).
 *     When the Source reaches terminal the Dependency turns Satisfied and
 *     DependencySatisfied fires once to the Target Brief's PIC.
 *
 *   - Read-models: the Client Board (all Briefs of one Client, grouped by Universal
 *     Column, §5.3) and My Tasks (the actor's own work units across Clients, §5.4).
 *     Both computed on read; nothing stored.
 *
 * House rules: the DEP- id is minted ONLY after create-time validation (same Client,
 * no duplicate pair, no cycle, valid types); every create appends an immutable audit
 * row; there is NO cancel/delete path in v1; the Dependency status and every
 * board/My-Tasks column are DERIVED on read from live statuses, never stored.
 *
 * Integration note: Go centralises the emission hook in the engine's post-transition
 * hook (httpapi.onTransition). The TS engine (notify_emit SQL fn) has no per-machine
 * hook, so validateBriefApproval / onBriefReachedTerminal are called INLINE from each
 * of the three Brief-approval paths (account.ts, task.ts, kol.ts), in the same
 * transaction. board.ts imports none of those modules (one-way — no import cycle).
 */

import { bi, deeplink, notification, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The CDPS division that owns the Client relationship. */
export const ACCOUNT_DIVISION = 'Account';

// Dependency types (§2 Rule 5 / §5.1).
export const TYPE_BLOCKING = 'Blocking';
export const TYPE_INFORMATIONAL = 'Informational';

// Derived Dependency status labels (§5.1 / STATE_MACHINES §12). NOT stored.
export const STATUS_PENDING = 'Pending'; // Source not started
export const STATUS_BLOCKING = 'Blocking'; // Source unfinished & type=Blocking
export const STATUS_SATISFIED = 'Satisfied'; // Source reached terminal

/** The only sanctioned source/target entity type (§5.1 — Brief ↔ Brief). */
const ENTITY_BRIEF = 'brief';
/** The Source's terminal status that satisfies a Dependency (§5.1). A voided Brief does NOT satisfy. */
const BRIEF_TERMINAL = '[Approved]';
/** The "not started" status distinguishing Pending from Blocking. */
const BRIEF_TODO = '[To Do]';

// --- Verbatim BI messages (each mirrors a Go sentinel 1:1). ---

export const MSG_DEP_CREATE_FORBIDDEN =
  '[hanya Account Manager pemilik klien atau SPV/Lead Account yang dapat membuat Dependency]';
export const MSG_DEP_INCOMPLETE = bi.INCOMPLETE_DATA;
export const MSG_DEP_INVALID_TYPE = '[tipe dependency tidak valid: harus Blocking atau Informational]';
export const MSG_DEP_INVALID_ENTITY = '[dependency hanya dapat dibuat antar Brief]';
export const MSG_DEP_SELF = '[Source dan Target Dependency tidak boleh Brief yang sama]';
export const MSG_DEP_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_DEP_CROSS_CLIENT = '[dependency hanya bisa dibuat antar Brief dalam Client yang sama]';
export const MSG_DEP_DUPLICATE = '[dependency untuk pasangan Brief ini sudah ada]';
export const MSG_DEP_CYCLE = '[dependency ini membentuk siklus (circular dependency) dan ditolak]';
export const MSG_DEP_NOT_FOUND = '[dependency tidak ditemukan]';
export const MSG_DEP_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';

// --- Errors (board-scoped; mapped in apps/api http.ts). ---

/** Bad/missing input (→ 400): incomplete, invalid type/entity, self-reference. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardForbiddenError';
  }
}
/** A referenced Brief / Dependency does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardNotFoundError';
  }
}
/** A lifecycle/constraint conflict (→ 409): cross-Client, duplicate, cycle, or a Blocking gate. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardConflictError';
  }
}

// --- Types ---

/** One DEP- row plus its DERIVED status (never stored). */
export interface Dependency {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  type: string;
  note: string;
  clientId: string;
  status: string; // DERIVED: Pending | Blocking | Satisfied (§5.1)
  createdBy: string;
  createdAt: Date;
}

/** The create fields (§5.1). sourceType/targetType default to "brief". */
export interface DependencyInput {
  sourceType?: string;
  sourceId: string;
  targetType?: string;
  targetId: string;
  type: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// CreateDependency (§3 step 2 / §5.1).
// ---------------------------------------------------------------------------

/**
 * createDependency declares a cross-Brief Dependency. All validation is
 * server-side and runs BEFORE the DEP- id is minted (house rule 1): entity types
 * (Brief only), self-reference, both Briefs exist, same Client (§2 Rule 4), no
 * duplicate active pair, no cycle (§2 Rule 6). Authority: owning AM / Account lead
 * / Director (§6.1). No approval gate — it takes effect immediately (§6.2).
 */
export async function createDependency(sql: Sql, actor: Actor, input: DependencyInput): Promise<Dependency> {
  const srcType = normEntity(input.sourceType);
  const tgtType = normEntity(input.targetType);
  const srcId = (input.sourceId ?? '').trim();
  const tgtId = (input.targetId ?? '').trim();
  const depType = (input.type ?? '').trim();
  const note = (input.note ?? '').trim();

  if (srcId === '' || tgtId === '' || depType === '') {
    throw new ValidationError(MSG_DEP_INCOMPLETE);
  }
  if (depType !== TYPE_BLOCKING && depType !== TYPE_INFORMATIONAL) {
    throw new ValidationError(MSG_DEP_INVALID_TYPE);
  }
  if (srcType !== ENTITY_BRIEF || tgtType !== ENTITY_BRIEF) {
    throw new ValidationError(MSG_DEP_INVALID_ENTITY);
  }
  if (srcId === tgtId) {
    throw new ValidationError(MSG_DEP_SELF);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Both Briefs must exist; capture each Client + the Target's owning AM (for the gate).
    const { clientId: srcClient } = await lockBriefClient(tx, srcId);
    const { clientId: tgtClient, ownerAm: tgtOwnerAm } = await lockBriefClient(tx, tgtId);
    if (srcClient !== tgtClient) {
      throw new ConflictError(MSG_DEP_CROSS_CLIENT); // §2 Rule 4
    }
    if (!canCreateDependency(actor, tgtOwnerAm)) {
      throw new ForbiddenError(MSG_DEP_CREATE_FORBIDDEN); // §6.1
    }
    if (await pairExists(tx, srcId, tgtId)) {
      throw new ConflictError(MSG_DEP_DUPLICATE); // §5.1 one active pair
    }
    // §2 Rule 6: adding source→target forms a cycle iff source is already reachable FROM target.
    if (await reachable(tx, tgtId, srcId)) {
      throw new ConflictError(MSG_DEP_CYCLE);
    }

    const now = new Date();
    const id = await ex.ident.identNext('DEP', now);
    await tx`
      insert into dependencies
        (id, source_type, source_id, target_type, target_id, dependency_type, note, client_id, created_by)
      values (${id}, ${srcType}, ${srcId}, ${tgtType}, ${tgtId}, ${depType}, ${note === '' ? null : note},
        ${srcClient}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'dependency', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null, afterJson: { source_id: srcId, target_id: tgtId, type: depType, client_id: srcClient },
      createdBy: actor.employeeId,
    });

    // Status derived from the Source's live status (unchanged inside this tx).
    const srcStatus = await briefStatusOf(tx, srcId);
    return {
      id, sourceType: srcType, sourceId: srcId, targetType: tgtType, targetId: tgtId,
      type: depType, note, clientId: srcClient, status: derivedStatus(srcStatus, depType),
      createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * derivedStatus computes a Dependency's status from the Source Brief's live status
 * and the type (§5.1): Source terminal → Satisfied; type=Blocking & Source started
 * (not [To Do]) → Blocking; otherwise (not started, or Informational) → Pending.
 * The gate (whether the Target may be approved) is a STRICTER, separate predicate
 * (blockingSourcesUnsatisfied): a Blocking Dependency holds the Target back while
 * the Source is not terminal, even a Source still in [To Do] (shown Pending).
 */
export function derivedStatus(sourceStatus: string, depType: string): string {
  if (sourceStatus === BRIEF_TERMINAL) {
    return STATUS_SATISFIED;
  }
  if (depType === TYPE_BLOCKING && sourceStatus !== BRIEF_TODO) {
    return STATUS_BLOCKING;
  }
  return STATUS_PENDING;
}

/**
 * canCreateDependency is the §6.1 authority gate: Director, an Account lead/SPV, or
 * the owning AM of the Client (Account staff whose id is the Client's assigned AM).
 * Division staff and non-owning AMs are denied.
 */
export function canCreateDependency(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (permission.isLead(actor, ACCOUNT_DIVISION)) {
    return true;
  }
  return (
    actor.role.division === ACCOUNT_DIVISION &&
    actor.role.level === permission.LevelStaff &&
    ownerAm !== '' &&
    actor.employeeId === ownerAm
  );
}

// ---- brief lookups ------------------------------------------------------------

/** lockBriefClient row-locks a Brief and returns its Client id + the Client's owning AM. */
async function lockBriefClient(tx: Queryable, briefId: string): Promise<{ clientId: string; ownerAm: string }> {
  const rows = await tx<{ client_id: string; assigned_am_id: string | null }[]>`
    select sv.client_id, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_DEP_BRIEF_NOT_FOUND);
  }
  return { clientId: rows[0].client_id, ownerAm: rows[0].assigned_am_id ?? '' };
}

/** briefStatusOf reads a Brief's live status (no lock). */
async function briefStatusOf(sql: Queryable, briefId: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from briefs where id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_DEP_BRIEF_NOT_FOUND);
  }
  return rows[0].status;
}

/** pairExists reports whether an active Dependency already links (source → target). */
async function pairExists(tx: Queryable, sourceId: string, targetId: string): Promise<boolean> {
  const rows = await tx<{ n: string }[]>`
    select count(*)::int as n from dependencies where source_id = ${sourceId} and target_id = ${targetId}`;
  return Number(rows[0].n) > 0;
}

/**
 * reachable reports whether `to` is reachable FROM `from` by following active
 * Dependency edges (source → target). Used for the cycle check: adding s→t is safe
 * unless s is already reachable from t. Bounded BFS; the visited set terminates
 * even on a pre-existing (malformed) cycle.
 */
async function reachable(tx: Queryable, from: string, to: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) {
      return true;
    }
    if (visited.has(cur)) {
      continue;
    }
    visited.add(cur);
    const rows = await tx<{ target_id: string }[]>`select target_id from dependencies where source_id = ${cur}`;
    for (const r of rows) {
      queue.push(r.target_id);
    }
  }
  return false;
}

// ---- read APIs ----------------------------------------------------------------

/** getDependency returns one Dependency with its derived status, if the actor may see the Client (§5.3). */
export async function getDependency(sql: Queryable, actor: Actor, depId: string): Promise<Dependency> {
  const d = await loadDependency(sql, depId);
  if (!(await canSeeClient(sql, actor, d.clientId))) {
    throw new ForbiddenError(MSG_DEP_VIEW_FORBIDDEN);
  }
  d.status = derivedStatus(await briefStatusOf(sql, d.sourceId), d.type);
  return d;
}

/**
 * listDependencies returns Dependencies filtered by source and/or target Brief
 * (either may be empty), each with its derived status. Only rows whose Client the
 * actor may see are returned. The implicit M8 Asset→Launch guardrail is never a row
 * here (it is hardcoded in ads.ts and never declared), so it never appears.
 */
export async function listDependencies(
  sql: Queryable,
  actor: Actor,
  sourceId = '',
  targetId = '',
): Promise<Dependency[]> {
  const src = sourceId.trim();
  const tgt = targetId.trim();
  const rows = await sql<DepRow[]>`
    select id, source_type, source_id, target_type, target_id, dependency_type,
           coalesce(note,'') as note, client_id, created_by, created_at
      from dependencies
     where (${src === ''} or source_id = ${src})
       and (${tgt === ''} or target_id = ${tgt})
     order by id asc`;

  const out: Dependency[] = [];
  const allow = new Map<string, boolean>();
  for (const row of rows) {
    const d = rowToDependency(row);
    if (!allow.has(d.clientId)) {
      allow.set(d.clientId, await canSeeClient(sql, actor, d.clientId));
    }
    if (!allow.get(d.clientId)) {
      continue;
    }
    d.status = derivedStatus(await briefStatusOf(sql, d.sourceId), d.type);
    out.push(d);
  }
  return out;
}

interface DepRow {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  dependency_type: string;
  note: string;
  client_id: string;
  created_by: string;
  created_at: Date;
}

function rowToDependency(r: DepRow): Dependency {
  return {
    id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id,
    type: r.dependency_type, note: r.note, clientId: r.client_id, status: '',
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

async function loadDependency(sql: Queryable, depId: string): Promise<Dependency> {
  const rows = await sql<DepRow[]>`
    select id, source_type, source_id, target_type, target_id, dependency_type,
           coalesce(note,'') as note, client_id, created_by, created_at
      from dependencies where id = ${depId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_DEP_NOT_FOUND);
  }
  return rowToDependency(rows[0]);
}

/**
 * canSeeClient is the §5.3 read predicate: AM/SPV/OD/Director see every Client; a
 * staff member sees a Client only where they are PIC of at least one of that
 * Client's work units (Brief / Asset / Booking). Live Stream Sessions carry no
 * per-session PIC, so LS ownership is via the Brief's assigned PIC (covered by the
 * Brief PIC count).
 */
export async function canSeeClient(sql: Queryable, actor: Actor, clientId: string): Promise<boolean> {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead/SPV
  }
  const owner = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (owner.length === 0) {
    return false;
  }
  if ((owner[0].assigned_am_id ?? '') === actor.employeeId) {
    return true; // owning AM
  }
  // Division staff/lead who is PIC of some unit of this Client.
  const rows = await sql<{ n: string }[]>`
    select (
        (select count(*) from briefs b join services sv on sv.id = b.service_id
          where sv.client_id = ${clientId} and b.assigned_pic = ${actor.employeeId})
      + (select count(*) from assets a join briefs b on b.id = a.brief_id
           join services sv on sv.id = b.service_id
          where sv.client_id = ${clientId} and a.assigned_pic = ${actor.employeeId})
      + (select count(*) from creator_bookings k join briefs b on b.id = k.brief_id
           join services sv on sv.id = b.service_id
          where sv.client_id = ${clientId} and k.assigned_coordinator = ${actor.employeeId})
    )::int as n`;
  return Number(rows[0].n) > 0;
}

// ---------------------------------------------------------------------------
// Blocking gate + emission hook (§2 Rule 7/8 / §6.3 / §5.5). Called inline from
// the Brief-approval paths (account.ts, task.ts, kol.ts).
// ---------------------------------------------------------------------------

/** gateMessage is the STATE_MACHINES §12 Blocking-gate template (verbatim format). */
function gateMessage(targetStatus: string, sourceIds: string[]): string {
  return `Brief ini belum bisa lanjut ke ${targetStatus} karena menunggu ${sourceIds.join(', ')} selesai Approved.`;
}

/**
 * validateBriefApproval is the Blocking-gate guard (§2 Rule 7 / §6.3). Call it
 * inside the caller's transaction, immediately before a Target Brief is driven
 * [In Review] → [Approved]. If any active Blocking Dependency targets this Brief
 * whose Source has NOT reached terminal, it throws a ConflictError carrying the §12
 * template message and the caller's transaction must abort. Informational
 * Dependencies never block; a Brief with no Blocking Dependency passes cheaply.
 */
export async function validateBriefApproval(tx: Queryable, briefId: string): Promise<void> {
  const unsatisfied = await blockingSourcesUnsatisfied(tx, briefId);
  if (unsatisfied.length === 0) {
    return;
  }
  throw new ConflictError(gateMessage(BRIEF_TERMINAL, unsatisfied));
}

/**
 * blockingSourcesUnsatisfied returns the Source Brief ids of every active Blocking
 * Dependency targeting briefId whose Source has not reached terminal ([Approved]).
 * A Blocking Dependency holds the Target back for the whole time its Source is
 * unfinished — regardless of whether the Source has started (§2 Rule 8).
 */
async function blockingSourcesUnsatisfied(sql: Queryable, briefId: string): Promise<string[]> {
  const rows = await sql<{ source_id: string }[]>`
    select d.source_id
      from dependencies d
      join briefs sb on sb.id = d.source_id
     where d.target_id = ${briefId}
       and d.dependency_type = ${TYPE_BLOCKING}
       and sb.status <> ${BRIEF_TERMINAL}
     order by d.source_id asc`;
  return rows.map((r) => r.source_id);
}

/**
 * onBriefReachedTerminal fires DependencySatisfied for every Dependency sourced by
 * briefId, once each, to the Target Brief's assigned PIC (§2 Rule 8 / §5.5). Call
 * it inside the triggering transition's transaction (atomic with the Source's move
 * to [Approved]). Fire-once is enforced by stamping satisfied_notified_at under a
 * row lock, so re-entry (a re-run roll-up) never double-sends. Only Blocking
 * Dependencies notify a "now unblocked" PIC; Informational ones simply stamp the row
 * (no recipient), keeping the fire-once bookkeeping uniform.
 */
export async function onBriefReachedTerminal(tx: Queryable, actor: Actor, briefId: string): Promise<void> {
  const ex = executors(tx);
  const deps = await tx<{ id: string; target_id: string; dependency_type: string }[]>`
    select id, target_id, dependency_type
      from dependencies
     where source_id = ${briefId} and satisfied_notified_at is null
     for update`;
  for (const d of deps) {
    // Stamp fire-once first (same tx / row lock) so a concurrent or re-entrant call cannot double-emit.
    await tx`update dependencies set satisfied_notified_at = now() where id = ${d.id} and satisfied_notified_at is null`;
    if (d.dependency_type !== TYPE_BLOCKING) {
      continue; // Informational: no "unblocked" recipient (§2 Rule 5).
    }
    const target = await briefPIC(tx, d.target_id);
    if (target.pic === '') {
      continue; // no PIC assigned yet — nothing to notify.
    }
    await notification.emit(ex.notify, {
      event: notification.EVENTS.DependencySatisfied, entityType: 'dependency', entityId: d.id,
      actor: actor.employeeId, explicitRecipients: [target.pic], notifyActor: false,
      // O51: the recipient is the TARGET Brief's PIC (Phase 0 §9 catalog), so the
      // link goes to the Brief they were waiting on — not to the `dependency` row,
      // which has no page at all.
      deepLink: deeplink.brief(d.target_id, target.division),
    });
  }
}

/** briefPIC returns a Brief's assigned PIC + division (PIC empty if unassigned/missing). */
async function briefPIC(tx: Queryable, briefId: string): Promise<{ pic: string; division: string }> {
  const rows = await tx<{ assigned_pic: string | null; assigned_division: string }[]>`
    select assigned_pic, assigned_division from briefs where id = ${briefId}`;
  if (rows.length === 0) {
    return { pic: '', division: '' };
  }
  return { pic: rows[0].assigned_pic ?? '', division: rows[0].assigned_division };
}

// ---------------------------------------------------------------------------
// Universal Column mapping (§5.2) + Client Board (§5.3) + My Tasks (§5.4).
// ---------------------------------------------------------------------------

/** The five Universal Column buckets every division maps into (§5.2). */
export const UC_TODO = 'To Do';
export const UC_IN_PROGRESS = 'In Progress';
export const UC_AWAITING_REV = 'Awaiting Review';
export const UC_BLOCKED_REV = 'Blocked/Revision';
export const UC_DONE = 'Done';
const UC_UNKNOWN = ''; // status outside the mapping (defensive)

/** One work unit on a board — a Brief (Client Board) or Brief/Asset/Booking/Session (My Tasks). */
export interface Card {
  id: string;
  type: string; // brief|asset|booking|session
  division: string;
  clientId: string;
  briefId: string; // owning Brief (== id for a brief card)
  pic: string;
  nativeStatus: string; // the unit's own live status
  universalColumn: string; // §5.2 mapping
  dueDate: string; // "YYYY-MM-DD" or ""
  overdue: boolean;
  dependencyBadge: string; // "Menunggu Dependency" / informational link / ""
  createdAt: Date | null;
}

/** Maps a §7 brief_task status (Creative/Ads Brief, and any Asset) to a Universal Column. */
export function briefTaskUniversal(status: string): string {
  switch (status) {
    case '[To Do]':
      return UC_TODO;
    case '[In Progress]':
      return UC_IN_PROGRESS;
    case '[Submitted]':
    case '[In Review]':
      return UC_AWAITING_REV;
    case '[Revision Requested]':
    case '[Blocked]':
      return UC_BLOCKED_REV;
    case '[Approved]':
      return UC_DONE;
    default:
      return UC_UNKNOWN;
  }
}

/**
 * kolUniversal maps a set of Creator Booking statuses to a Universal Column via the
 * §5.2 KOL roll-up rules (worst-case, §2 Rule 3). [Dropped] bookings are excluded;
 * an all-Dropped brief maps to To Do defensively.
 */
export function kolUniversal(statuses: string[]): string {
  const active = statuses.filter((st) => st !== '[Dropped]');
  if (active.length === 0) {
    return UC_TODO;
  }
  let anyEscalated = false;
  let anyRevision = false;
  let allQCPassed = true;
  let anyEarly = false;
  let anyMidReview = false;
  for (const st of active) {
    switch (st) {
      case '[Escalated - Creator Unresponsive]':
        anyEscalated = true;
        break;
      case '[QC Failed - Revision Requested]':
        anyRevision = true;
        break;
      case '[QC Passed]':
        break; // terminal-good
      case '[Sourcing]':
      case '[Booked]':
      case '[Content In Progress]':
        anyEarly = true;
        break;
      case '[Content Submitted]':
      case '[QC Review]':
        anyMidReview = true;
        break;
    }
    if (st !== '[QC Passed]') {
      allQCPassed = false;
    }
  }
  if (anyEscalated || anyRevision) {
    return UC_BLOCKED_REV;
  }
  if (allQCPassed) {
    return UC_DONE;
  }
  if (anyEarly) {
    return UC_IN_PROGRESS;
  }
  if (anyMidReview) {
    return UC_AWAITING_REV;
  }
  return UC_IN_PROGRESS;
}

/** lsUniversal maps a Live Stream Session status to a Universal Column (§5.2 LS row). */
export function lsUniversal(status: string): string {
  switch (status) {
    case '[Requested]':
      return UC_TODO;
    case '[Confirmed by Vendor]':
      return UC_IN_PROGRESS;
    case '[Completed]':
      return UC_AWAITING_REV;
    case '[Reconciled]':
      return UC_DONE;
    case '[Discrepancy Flagged]':
      return UC_BLOCKED_REV; // non-blocking flag, still shown (§5.2)
    default:
      return UC_UNKNOWN;
  }
}

/** ucRank orders the Universal Columns least→most advanced, for the §2 Rule 3 worst-case roll-up. */
function ucRank(uc: string): number {
  switch (uc) {
    case UC_TODO:
      return 0;
    case UC_IN_PROGRESS:
      return 1;
    case UC_AWAITING_REV:
      return 2;
    case UC_BLOCKED_REV:
      return 2; // "not done" — ranked with Awaiting Review so it dominates only once forward work reached review.
    case UC_DONE:
      return 3;
    default:
      return -1;
  }
}

/** lsBriefUniversal rolls up a Live Stream Brief's Sessions worst-case (§2 Rule 3). */
export function lsBriefUniversal(sessionStatuses: string[]): string {
  if (sessionStatuses.length === 0) {
    return UC_TODO;
  }
  let worst = UC_DONE;
  let worstR = ucRank(UC_DONE);
  let anyBlocked = false;
  for (const st of sessionStatuses) {
    const uc = lsUniversal(st);
    if (uc === UC_BLOCKED_REV) {
      anyBlocked = true;
    }
    const r = ucRank(uc);
    if (r >= 0 && r < worstR) {
      worstR = r;
      worst = uc;
    }
  }
  if (worst === UC_DONE && anyBlocked) {
    return UC_BLOCKED_REV;
  }
  return worst;
}

/**
 * clientBoard returns every Brief of one Client as a Card, grouped implicitly by
 * Universal Column (§5.3). Client filter mandatory. Read scope (§5.3): AM/SPV/OD/
 * Director see any Client; a staff member only a Client where they PIC a unit.
 */
export async function clientBoard(sql: Queryable, actor: Actor, clientId: string): Promise<Card[]> {
  const cid = (clientId ?? '').trim();
  if (cid === '') {
    throw new ValidationError(MSG_DEP_INCOMPLETE);
  }
  if (!(await canSeeClient(sql, actor, cid))) {
    throw new ForbiddenError(MSG_DEP_VIEW_FORBIDDEN);
  }
  const today = tz.dateString(new Date());
  const rows = await sql<
    { id: string; assigned_division: string; assigned_pic: string; native_status: string; due_date: string | null; client_id: string; created_at: Date }[]
  >`
    select b.id, b.assigned_division, coalesce(b.assigned_pic,'') as assigned_pic, b.status as native_status,
           to_char(b.due_date, 'YYYY-MM-DD') as due_date, sv.client_id, b.created_at
      from briefs b
      join services sv on sv.id = b.service_id
     where sv.client_id = ${cid}
     order by b.id asc`;

  const cards: Card[] = [];
  for (const r of rows) {
    const c: Card = {
      id: r.id, type: ENTITY_BRIEF, division: r.assigned_division, clientId: r.client_id, briefId: r.id,
      pic: r.assigned_pic, nativeStatus: r.native_status, universalColumn: '', dueDate: r.due_date ?? '',
      overdue: false, dependencyBadge: '', createdAt: r.created_at,
    };
    await fillBriefCard(sql, c, today);
    cards.push(c);
  }
  return cards;
}

/** fillBriefCard computes a Brief card's Universal Column (rolling up KOL/LS children) + badge (§5.3). */
async function fillBriefCard(sql: Queryable, c: Card, today: string): Promise<void> {
  switch (c.division) {
    case 'KOL': {
      const statuses = await childStatuses(sql, 'creator_bookings', c.briefId);
      c.universalColumn = kolUniversal(statuses);
      break;
    }
    case 'Live Stream': {
      const statuses = await childStatuses(sql, 'live_stream_sessions', c.briefId);
      c.universalColumn = lsBriefUniversal(statuses);
      break;
    }
    default: // Creative / Ads — brief.status already reflects the Asset roll-up.
      c.universalColumn = briefTaskUniversal(c.nativeStatus);
  }
  // Overdue vs Brief due date (§5.3 / §6.5): due date passed (WIB) and the Brief is not Done.
  if (c.dueDate !== '' && c.dueDate < today && c.universalColumn !== UC_DONE) {
    c.overdue = true;
  }
  if (c.universalColumn === UC_DONE) {
    c.overdue = false; // a finished Brief is never "overdue".
  }
  c.dependencyBadge = await dependencyBadge(sql, c.briefId);
}

/**
 * dependencyBadge returns the board badge for a Target Brief (§2 Rule 7): any
 * unsatisfied Blocking Dependency → "Menunggu Dependency"; else an Informational
 * target → a short link note; else empty.
 */
async function dependencyBadge(sql: Queryable, briefId: string): Promise<string> {
  const unsatisfied = await blockingSourcesUnsatisfied(sql, briefId);
  if (unsatisfied.length > 0) {
    return 'Menunggu Dependency';
  }
  const info = await sql<{ source_id: string }[]>`
    select source_id from dependencies
     where target_id = ${briefId} and dependency_type = ${TYPE_INFORMATIONAL}
     order by id asc limit 1`;
  if (info.length > 0) {
    return `Informational (link ke ${info[0].source_id})`;
  }
  return '';
}

/** childStatuses returns every child row's status for a Brief. `table` is a fixed, package-controlled identifier. */
async function childStatuses(sql: Queryable, table: 'creator_bookings' | 'live_stream_sessions', briefId: string): Promise<string[]> {
  const rows = await sql<{ status: string }[]>`select status from ${sql(table)} where brief_id = ${briefId}`;
  return rows.map((r) => r.status);
}

/**
 * myTasks returns the actor's own work units across all Clients (§5.4): Brief-as-task
 * rows they PIC, Creative Assets they PIC, KOL Bookings they coordinate, and Live
 * Stream Sessions of Briefs they PIC. Each unit's native status maps to a Universal
 * Column (§5.2). Read scope is intrinsically "own"; OD/Director/Account-lead may pass
 * a target employee to view that person's tasks.
 */
export async function myTasks(sql: Queryable, actor: Actor, forEmployee = ''): Promise<Card[]> {
  let target = (forEmployee ?? '').trim();
  if (target === '' || target === actor.employeeId) {
    target = actor.employeeId;
  } else if (!(permission.canReadAll(actor) || permission.canReadDivision(actor, ACCOUNT_DIVISION))) {
    throw new ForbiddenError(MSG_DEP_VIEW_FORBIDDEN); // Staff = own tasks only (§5.4 / Role Matrix).
  }

  const today = tz.dateString(new Date());
  const cards: Card[] = [];

  // Brief-as-task units the actor PICs (Ads and any single-unit Brief).
  const briefRows = await sql<{ id: string; division: string; status: string; due_date: string | null; client_id: string }[]>`
    select b.id, b.assigned_division as division, b.status, to_char(b.due_date,'YYYY-MM-DD') as due_date, sv.client_id
      from briefs b join services sv on sv.id = b.service_id
     where b.assigned_pic = ${target} order by b.id asc`;
  for (const r of briefRows) {
    cards.push(makeUnitCard(r.id, ENTITY_BRIEF, r.id, r.division, r.client_id, r.status, briefTaskUniversal(r.status), r.due_date, today));
  }

  // Creative Assets the actor PICs.
  const assetRows = await sql<{ id: string; division: string; status: string; due_date: string | null; client_id: string; brief_id: string }[]>`
    select a.id, b.assigned_division as division, a.status, to_char(b.due_date,'YYYY-MM-DD') as due_date, sv.client_id, a.brief_id
      from assets a join briefs b on b.id = a.brief_id join services sv on sv.id = b.service_id
     where a.assigned_pic = ${target} order by a.id asc`;
  for (const r of assetRows) {
    cards.push(makeUnitCard(r.id, 'asset', r.brief_id, r.division, r.client_id, r.status, briefTaskUniversal(r.status), r.due_date, today));
  }

  // KOL Bookings the actor coordinates.
  const bkgRows = await sql<{ id: string; division: string; status: string; due_date: string | null; client_id: string; brief_id: string }[]>`
    select k.id, b.assigned_division as division, k.status, to_char(b.due_date,'YYYY-MM-DD') as due_date, sv.client_id, k.brief_id
      from creator_bookings k join briefs b on b.id = k.brief_id join services sv on sv.id = b.service_id
     where k.assigned_coordinator = ${target} order by k.id asc`;
  for (const r of bkgRows) {
    cards.push(makeUnitCard(r.id, 'booking', r.brief_id, r.division, r.client_id, r.status, kolUniversal([r.status]), r.due_date, today));
  }

  // Live Stream Sessions of Briefs the actor PICs (LS has no per-session PIC; the AM on the LS Brief owns them).
  const lssRows = await sql<{ id: string; division: string; status: string; due_date: string | null; client_id: string; brief_id: string }[]>`
    select l.id, b.assigned_division as division, l.status, to_char(b.due_date,'YYYY-MM-DD') as due_date, sv.client_id, l.brief_id
      from live_stream_sessions l join briefs b on b.id = l.brief_id join services sv on sv.id = b.service_id
     where b.assigned_pic = ${target} order by l.id asc`;
  for (const r of lssRows) {
    cards.push(makeUnitCard(r.id, 'session', r.brief_id, r.division, r.client_id, r.status, lsUniversal(r.status), r.due_date, today));
  }

  for (const c of cards) {
    c.pic = target; // stamp each card's PIC so the row is self-describing.
  }
  return cards;
}

/** makeUnitCard builds a My-Tasks Card, computing overdue vs the Brief due date (WIB). */
function makeUnitCard(
  id: string, type: string, briefId: string, division: string, clientId: string,
  nativeStatus: string, universalColumn: string, dueDate: string | null, today: string,
): Card {
  const due = dueDate ?? '';
  const overdue = due !== '' && due < today && universalColumn !== UC_DONE;
  return {
    id, type, division, clientId, briefId, pic: '', nativeStatus, universalColumn,
    dueDate: due, overdue, dependencyBadge: '', createdAt: null,
  };
}

// ---- helpers ------------------------------------------------------------------

function normEntity(t: string | undefined): string {
  const v = (t ?? '').trim().toLowerCase();
  return v === '' ? ENTITY_BRIEF : v;
}
