/**
 * Project Management / Kanban domain service (M11). Ported from Go's
 * `internal/module11_board/{board,views,gate}.go`.
 *
 * M11 adds two cross-division views ON TOP of the per-division machines (M6–M10,
 * M12) without a machine of its own:
 *
 *   - Dependency (DEP-): a formal, AM/SPV-declared link between two Briefs of the
 *     same Client (M11 §2/§5.1). Its STATUS (Pending/Blocking/Satisfied) is DERIVED
 *     from the Source Brief's live status — never stored (house rule #4). A Blocking
 *     Dependency locks the Target Brief's FINAL transition ([In Review] → [Approved])
 *     until the Source reaches its terminal status; this is enforced as a CODE guard
 *     the Brief-approval clusters call (account.approveBrief / task.recomputeBriefRollup),
 *     the same precedent as the M8 Ads launch / submit code guards. When the Source
 *     reaches terminal the Dependency turns Satisfied and DependencySatisfied fires
 *     once to the Target Brief's PIC.
 *
 *   - Read-models: the Client Board (all Briefs of one Client grouped by the five
 *     Universal Columns, §5.2–§5.3) and My Tasks (the actor's own work units across
 *     Clients, §5.4). Both are computed on read; nothing is stored.
 *
 * This module OWNS no state machine (the Dependency status is auto-computed,
 * STATE_MACHINES §12) and does NOT rewrite M6/M12 — it plugs into them through the
 * two exported guard/emission functions those modules call inline. To avoid an
 * import cycle it imports NOTHING from `account`/`task` (its gate reads the DB
 * directly); `account` and `task` import from here, never the reverse.
 *
 * House rules honoured here (mirroring the Go source):
 *   - the DEP- id is minted (ident.identNext) ONLY after create-time validation
 *     passes (house rule 1: same Client, no duplicate active pair, no cycle, valid
 *     types);
 *   - every create appends an immutable audit row (house rule 3); there is no
 *     cancel/delete path in v1 (the PRD defines none);
 *   - the Dependency status and every board / My-Tasks column are DERIVED on read
 *     from live statuses (house rule 4), never stored.
 *
 * Reference: backend/internal/module11_board/{board,views,gate}.go.
 */

import { bi, notification, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/**
 * The CDPS division that owns the Client relationship; its lead (SPV/Head Account)
 * may declare Dependencies and read every Client Board.
 */
export const ACCOUNT_DIVISION = 'Account';

/** Dependency types (M11 §2 Rule 5 / §5.1). */
export const TYPE_BLOCKING = 'Blocking';
export const TYPE_INFORMATIONAL = 'Informational';

/** Derived Dependency status labels (M11 §5.1 / STATE_MACHINES §12). NOT stored. */
export const STATUS_PENDING = 'Pending'; // Source not started
export const STATUS_BLOCKING = 'Blocking'; // Source unfinished & type=Blocking
export const STATUS_SATISFIED = 'Satisfied'; // Source reached terminal

/**
 * The only sanctioned source/target entity type (M11 §5.1 — Source Brief ID /
 * Target Brief ID, both ref BRF). Stored lower-case in source_type/target_type; no
 * other type is accepted in v1.
 */
const ENTITY_BRIEF = 'brief';

/**
 * The Source's "status akhir" that satisfies a Dependency (§5.1). A voided Brief
 * ([Cancelled — Service Voided]) does NOT satisfy — only a genuine completion.
 */
const BRIEF_TERMINAL = '[Approved]';
/** The "not started" status used to distinguish Pending from Blocking. */
const BRIEF_TODO = '[To Do]';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M11). Each mirrors a Go sentinel error 1:1. The PRD
// quotes none verbatim except the gate template (STATE_MACHINES §12); the rest
// follow the W1-09 precedent (logged in DECISIONS.md).
// ---------------------------------------------------------------------------

/** Actor may not declare a Dependency — only the owning AM, an Account lead/SPV, or Director (§6.1). */
export const MSG_CREATE_FORBIDDEN =
  '[hanya Account Manager pemilik klien atau SPV/Lead Account yang dapat membuat Dependency]';
/** A mandatory field (source/target/type) is missing. */
export const MSG_INCOMPLETE = bi.INCOMPLETE_DATA;
/** Type is outside Blocking / Informational (§5.1). */
export const MSG_INVALID_TYPE = '[tipe dependency tidak valid: harus Blocking atau Informational]';
/** A source/target entity type other than Brief was supplied (only Brief↔Brief, §5.1). */
export const MSG_INVALID_ENTITY = '[dependency hanya dapat dibuat antar Brief]';
/** Source and target are the same Brief (a Brief cannot depend on itself). */
export const MSG_SELF = '[Source dan Target Dependency tidak boleh Brief yang sama]';
/** A referenced Brief does not exist. */
export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
/** Source and target belong to different Clients (§2 Rule 4). */
export const MSG_CROSS_CLIENT = '[dependency hanya bisa dibuat antar Brief dalam Client yang sama]';
/** An active Dependency already exists for this (Source, Target) pair (§5.1). */
export const MSG_DUPLICATE = '[dependency untuk pasangan Brief ini sudah ada]';
/** Creating this Dependency would form a circular dependency (§2 Rule 6). */
export const MSG_CYCLE = '[dependency ini membentuk siklus (circular dependency) dan ditolak]';
/** The referenced Dependency does not exist. */
export const MSG_DEP_NOT_FOUND = '[dependency tidak ditemukan]';
/** Actor may not read this Dependency / board. */
export const MSG_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';

// ---------------------------------------------------------------------------
// Errors — each carries the verbatim BI message. Status mapping (apps/api
// http.ts): validation → 400, forbidden → 403, not-found → 404, lifecycle
// conflict → 409. A blocked approval (the §12 gate) is also a 409 conflict.
// ---------------------------------------------------------------------------

/** Bad/missing input on a create call (→ 400): incomplete, invalid type/entity, self, duplicate, cycle, cross-client. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyValidationError';
  }
}
/** The actor's role may not perform the requested read/action (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyForbiddenError';
  }
}
/** The referenced Brief / Dependency does not exist (verbatim BI, → 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyNotFoundError';
  }
}
/**
 * A Blocking-gate rejection (→ 409). Raised by validateBriefApproval when a Target
 * Brief's final ([In Review] → [Approved]) transition is attempted while an active
 * Blocking Dependency's Source is not yet terminal. Carries the STATE_MACHINES §12
 * template message (mirror of Go's *statemachine.BlockedError).
 */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** A DEP- row plus its DERIVED status (never stored). */
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

/** The create fields (M11 §5.1). sourceType/targetType default to "brief" when omitted. */
export interface DependencyInput {
  sourceType?: string;
  sourceId: string;
  targetType?: string;
  targetId: string;
  type: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// CreateDependency (M11 §3 step 2 / §5.1).
// ---------------------------------------------------------------------------

/**
 * createDependency declares a cross-Brief Dependency. All validation is server-side
 * and runs BEFORE the DEP- id is minted (house rule 1): entity types (Brief only),
 * self-reference, both Briefs exist, same Client (§2 Rule 4), no duplicate active
 * pair, no cycle (§2 Rule 6). Authority: owning AM / Account lead / Director (§6.1).
 * No approval gate — it takes effect immediately (§6.2).
 */
export async function createDependency(sql: Sql, actor: Actor, input: DependencyInput): Promise<Dependency> {
  const srcType = normEntity(input.sourceType);
  const tgtType = normEntity(input.targetType);
  const srcId = (input.sourceId ?? '').trim();
  const tgtId = (input.targetId ?? '').trim();
  const depType = (input.type ?? '').trim();

  if (srcId === '' || tgtId === '' || depType === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (depType !== TYPE_BLOCKING && depType !== TYPE_INFORMATIONAL) {
    throw new ValidationError(MSG_INVALID_TYPE);
  }
  if (srcType !== ENTITY_BRIEF || tgtType !== ENTITY_BRIEF) {
    throw new ValidationError(MSG_INVALID_ENTITY);
  }
  if (srcId === tgtId) {
    throw new ValidationError(MSG_SELF);
  }
  const note = (input.note ?? '').trim();
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Both Briefs must exist; capture each one's Client + owning AM (for the gate).
    const { clientId: srcClient } = await lockBriefClient(tx, srcId);
    const { clientId: tgtClient, ownerAm: tgtOwnerAm } = await lockBriefClient(tx, tgtId);
    // §2 Rule 4: same Client only.
    if (srcClient !== tgtClient) {
      throw new ValidationError(MSG_CROSS_CLIENT);
    }
    // §6.1 authority: owning AM of the Client, Account lead/SPV, or Director.
    if (!canCreateDependency(actor, tgtOwnerAm)) {
      throw new ForbiddenError(MSG_CREATE_FORBIDDEN);
    }
    // §5.1: one active Dependency per ordered pair.
    if (await pairExists(tx, srcId, tgtId)) {
      throw new ValidationError(MSG_DUPLICATE);
    }
    // §2 Rule 6: reject a cycle. Adding source→target forms a cycle iff source is
    // already reachable FROM target via the existing active edges.
    if (await reachable(tx, tgtId, srcId)) {
      throw new ValidationError(MSG_CYCLE);
    }

    const id = await ex.ident.identNext('DEP', now);
    await tx`
      insert into dependencies
        (id, source_type, source_id, target_type, target_id, dependency_type, note, client_id, created_by)
      values (${id}, ${srcType}, ${srcId}, ${tgtType}, ${tgtId}, ${depType}, ${note === '' ? null : note},
        ${srcClient}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'dependency', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: { source_id: srcId, target_id: tgtId, type: depType, client_id: srcClient },
      createdBy: actor.employeeId,
    });

    // Status derived from the Source's live status (already locked above; unchanged in this tx).
    const srcStatus = await briefStatus(tx, srcId);
    return {
      id, sourceType: srcType, sourceId: srcId, targetType: tgtType, targetId: tgtId, type: depType,
      note, clientId: srcClient, status: derivedStatus(srcStatus, depType), createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * derivedStatus computes a Dependency's status from the Source Brief's live status
 * and the Dependency type (M11 §5.1). Precedence:
 *   - Source terminal ([Approved])                 → Satisfied
 *   - type=Blocking & Source started (not [To Do]) → Blocking
 *   - otherwise (not started, or Informational)    → Pending
 *
 * The gate itself (whether the Target may be approved) is a stricter, separate
 * predicate (blockingSourcesUnsatisfied): a Blocking Dependency blocks the Target
 * while the Source is not terminal REGARDLESS of whether it has started — a Source
 * still in [To Do] is shown Pending but still holds the Target back.
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
export function canCreateDependency(a: Actor, ownerAm: string): boolean {
  if (a.role.director) {
    return true;
  }
  if (permission.isLead(a, ACCOUNT_DIVISION)) {
    return true;
  }
  return (
    a.role.division === ACCOUNT_DIVISION && a.role.level === permission.LevelStaff &&
    ownerAm !== '' && a.employeeId === ownerAm
  );
}

// ---------------------------------------------------------------------------
// Brief lookups.
// ---------------------------------------------------------------------------

/**
 * lockBriefClient row-locks a Brief and returns its Client id and the Client's
 * owning AM. A missing Brief is MSG_BRIEF_NOT_FOUND.
 */
async function lockBriefClient(tx: Queryable, briefId: string): Promise<{ clientId: string; ownerAm: string }> {
  const rows = await tx<{ client_id: string; assigned_am_id: string | null }[]>`
    select sv.client_id, c.assigned_am_id
      from briefs b
      join services sv on sv.id = b.service_id
      join clients c on c.id = sv.client_id
     where b.id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  return { clientId: rows[0].client_id, ownerAm: rows[0].assigned_am_id ?? '' };
}

/** briefStatus reads a Brief's live status (no lock). A missing Brief is MSG_BRIEF_NOT_FOUND. */
async function briefStatus(sql: Queryable, briefId: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from briefs where id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  }
  return rows[0].status;
}

/** pairExists reports whether an active Dependency already links (source → target). */
async function pairExists(tx: Queryable, sourceId: string, targetId: string): Promise<boolean> {
  const rows = await tx<{ n: string }[]>`
    select count(*) as n from dependencies where source_id = ${sourceId} and target_id = ${targetId}`;
  return Number(rows[0].n) > 0;
}

/**
 * reachable reports whether `to` is reachable FROM `from` by following active
 * Dependency edges (source → target). Used for the cycle check: adding s→t is safe
 * unless s is already reachable from t. Bounded BFS over the edge set; the visited
 * set makes it terminate even on pre-existing (malformed) cycles.
 */
async function reachable(tx: Queryable, from: string, to: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
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

// ---------------------------------------------------------------------------
// Read APIs.
// ---------------------------------------------------------------------------

/**
 * getDependency returns one Dependency with its derived status, if the actor may
 * see the underlying Client (§5.3 read scope).
 */
export async function getDependency(sql: Queryable, actor: Actor, depId: string): Promise<Dependency> {
  const d = await loadDependency(sql, depId);
  if (!(await canSeeClient(sql, actor, d.clientId))) {
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }
  d.status = derivedStatus(await briefStatus(sql, d.sourceId), d.type);
  return d;
}

/**
 * listDependencies returns Dependencies filtered by source and/or target Brief
 * (either may be empty), each with its derived status. Only rows whose Client the
 * actor may see are returned. The M8 implicit Asset→Launch guardrail (§2 Rule 9 /
 * §6.4) is NEVER a row here — it is hardcoded in `ads` and never declared, so it
 * can never appear in this listing.
 */
export async function listDependencies(
  sql: Queryable,
  actor: Actor,
  sourceId: string,
  targetId: string,
): Promise<Dependency[]> {
  const src = (sourceId ?? '').trim();
  const tgt = (targetId ?? '').trim();
  const rows = await sql<DependencyRow[]>`
    select id, source_type, source_id, target_type, target_id, dependency_type,
           coalesce(note,'') as note, client_id, created_by, created_at
      from dependencies
     where 1=1
       ${src !== '' ? sql`and source_id = ${src}` : sql``}
       ${tgt !== '' ? sql`and target_id = ${tgt}` : sql``}
     order by id asc`;
  const deps = rows.map(rowToDependency);

  const allow = new Map<string, boolean>();
  const out: Dependency[] = [];
  for (const d of deps) {
    if (!allow.has(d.clientId)) {
      allow.set(d.clientId, await canSeeClient(sql, actor, d.clientId));
    }
    if (!allow.get(d.clientId)) {
      continue;
    }
    d.status = derivedStatus(await briefStatus(sql, d.sourceId), d.type);
    out.push(d);
  }
  return out;
}

async function loadDependency(sql: Queryable, depId: string): Promise<Dependency> {
  const rows = await sql<DependencyRow[]>`
    select id, source_type, source_id, target_type, target_id, dependency_type,
           coalesce(note,'') as note, client_id, created_by, created_at
      from dependencies where id = ${depId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_DEP_NOT_FOUND);
  }
  return rowToDependency(rows[0]);
}

interface DependencyRow {
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

function rowToDependency(r: DependencyRow): Dependency {
  return {
    id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id,
    type: r.dependency_type, note: r.note, clientId: r.client_id, status: STATUS_PENDING,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

/**
 * canSeeClient is the §5.3 read predicate: AM/SPV/OD/Director see every Client; a
 * staff member sees a Client only where they are PIC of at least one of that
 * Client's work units (Brief / Asset / Booking). Live Stream Sessions carry no
 * per-session PIC, so LS ownership is via the Brief's assigned PIC.
 */
export async function canSeeClient(sql: Queryable, actor: Actor, clientId: string): Promise<boolean> {
  if (permission.canReadAll(actor)) {
    return true; // OD / Director
  }
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // Account lead/SPV
  }
  // Owning AM of the Client (Account staff).
  const owner = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (owner.length === 0) {
    return false;
  }
  if (owner[0].assigned_am_id !== null && owner[0].assigned_am_id === actor.employeeId) {
    return true;
  }
  // Division staff/lead who is PIC of some unit of this Client.
  const rows = await sql<{ n: string }[]>`
    select
      (select count(*) from briefs b join services sv on sv.id = b.service_id
        where sv.client_id = ${clientId} and b.assigned_pic = ${actor.employeeId})
    + (select count(*) from assets a join briefs b on b.id = a.brief_id
         join services sv on sv.id = b.service_id
        where sv.client_id = ${clientId} and a.assigned_pic = ${actor.employeeId})
    + (select count(*) from creator_bookings k join briefs b on b.id = k.brief_id
         join services sv on sv.id = b.service_id
        where sv.client_id = ${clientId} and k.assigned_coordinator = ${actor.employeeId}) as n`;
  return Number(rows[0].n) > 0;
}

function normEntity(t: string | undefined): string {
  const v = (t ?? '').trim().toLowerCase();
  return v === '' ? ENTITY_BRIEF : v; // default: Brief (the only sanctioned type)
}

// ===========================================================================
// Cross-module integrations (gate.go) — the two guard/emission functions the
// Brief-approval clusters call inline (no engine onTransition hook in the TS
// stack, so `account`/`task` inject these directly).
// ===========================================================================

/**
 * gateMessage is the STATE_MACHINES §12 Blocking-gate message, verbatim in format:
 * the bracketed target status and the Source Brief id(s) are the dynamic fills. The
 * real fill is always [Approved], the Brief's final transition (§6.3 Resolved). See
 * DECISIONS W3-M11-C1 for the [In Execution] vs [Approved] wording resolution.
 */
export function gateMessage(targetStatus: string, sourceIds: string[]): string {
  return `Brief ini belum bisa lanjut ke ${targetStatus} karena menunggu ${sourceIds.join(', ')} selesai Approved.`;
}

/**
 * validateBriefApproval is the Blocking-gate guard (M11 §2 Rule 7 / §6.3). It is
 * called inside the caller's transaction, immediately before a Target Brief is
 * driven [In Review] → [Approved]. If any active Blocking Dependency targets this
 * Brief whose Source has NOT reached terminal, it throws a BlockedError carrying the
 * §12 template message and the caller must abort the transition (nothing changes).
 * Informational Dependencies never block; a Brief with no Blocking Dependency (the
 * common case) passes cheaply.
 */
export async function validateBriefApproval(tx: Queryable, briefId: string): Promise<void> {
  const unsatisfied = await blockingSourcesUnsatisfied(tx, briefId);
  if (unsatisfied.length === 0) {
    return;
  }
  throw new BlockedError(gateMessage(BRIEF_TERMINAL, unsatisfied));
}

/**
 * blockingSourcesUnsatisfied returns the Source Brief ids of every active Blocking
 * Dependency targeting briefId whose Source has not reached terminal ([Approved]).
 * A Blocking Dependency holds the Target back for the whole time its Source is
 * unfinished — regardless of whether the Source has started (a Source still in
 * [To Do] blocks too), matching §2 Rule 8 ("until the Source reaches its terminal").
 */
async function blockingSourcesUnsatisfied(tx: Queryable, briefId: string): Promise<string[]> {
  const rows = await tx<{ source_id: string }[]>`
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
 * briefId, once each, to the Target Brief's assigned PIC (M11 §2 Rule 8 / §5.5). It
 * runs inside the triggering transition's transaction (atomic with the Source's move
 * to [Approved]). Fire-once is enforced by stamping satisfied_notified_at with a row
 * lock, so re-entry (e.g. a re-run roll-up) never double-sends.
 *
 * Only Blocking Dependencies notify a "now unblocked" PIC; Informational ones carry
 * no gate, so an Informational Source reaching terminal simply stamps the row (no
 * recipient) — keeping the fire-once bookkeeping uniform without sending a spurious
 * nudge for a link that never blocked anything.
 */
export async function onBriefReachedTerminal(tx: Queryable, actor: Actor, briefId: string): Promise<void> {
  const ex = executors(tx);
  const deps = await tx<{ id: string; target_id: string; dependency_type: string }[]>`
    select id, target_id, dependency_type
      from dependencies
     where source_id = ${briefId} and satisfied_notified_at is null
     for update`;
  for (const d of deps) {
    // Stamp fire-once first (inside the same tx / row lock) so a concurrent or
    // re-entrant call cannot double-emit.
    await tx`
      update dependencies set satisfied_notified_at = now()
       where id = ${d.id} and satisfied_notified_at is null`;
    if (d.dependency_type !== TYPE_BLOCKING) {
      continue; // Informational: no "unblocked" recipient (§2 Rule 5).
    }
    const pic = await briefPic(tx, d.target_id);
    if (pic === '') {
      continue; // no PIC assigned yet — nothing to notify.
    }
    await notification.emit(ex.notify, {
      event: notification.EVENTS.DependencySatisfied, entityType: 'dependency', entityId: d.id,
      actor: actor.employeeId, explicitRecipients: [pic],
    });
  }
}

/** briefPic returns a Brief's assigned PIC (empty if unassigned or missing). */
async function briefPic(tx: Queryable, briefId: string): Promise<string> {
  const rows = await tx<{ assigned_pic: string | null }[]>`select assigned_pic from briefs where id = ${briefId}`;
  if (rows.length === 0) {
    return '';
  }
  return rows[0].assigned_pic ?? '';
}

// ===========================================================================
// Computed read-models (views.go) — the Universal Column mapping and the Client
// Board / My Tasks card lists (M11 §5.2–§5.4). Everything here is derived on read
// from live statuses (house rule #4); nothing is stored.
// ===========================================================================

/** Universal Column labels (M11 §5.2). The five buckets every division maps into. */
export const UC_TODO = 'To Do';
export const UC_IN_PROGRESS = 'In Progress';
export const UC_AWAITING_REVIEW = 'Awaiting Review';
export const UC_BLOCKED_REVISION = 'Blocked/Revision';
export const UC_DONE = 'Done';
const UC_UNKNOWN = ''; // status outside the mapping (defensive)

/**
 * Card is one work unit on a board — a Brief on the Client Board (§5.3) or a work
 * unit (Brief/Asset/Booking/Session) on My Tasks (§5.4). All computed fields are
 * derived on read.
 */
export interface Card {
  id: string; // unit id (BRF/AST/BKG/LSS)
  type: string; // entity type: brief|asset|booking|session
  division: string; // Creative/Ads/KOL/Live Stream/...
  clientId: string;
  briefId: string; // owning Brief (== id for a brief card)
  pic: string; // assigned PIC
  nativeStatus: string; // the unit's own live status
  universalColumn: string; // §5.2 mapping
  dueDate: string;
  overdue: boolean; // vs Brief SLA/DueDate (§5.3, §6.5)
  dependencyBadge: string; // "Menunggu Dependency" / informational link
  createdAt: Date | null;
}

// ---- Universal Column mapping (§5.2) ----------------------------------------

/**
 * briefTaskUniversal maps a §7 brief_task status (Creative/Ads Brief, and any
 * Asset, which run the same machine) to a Universal Column (§5.2 Creative/Ads rows).
 */
export function briefTaskUniversal(status: string): string {
  switch (status) {
    case '[To Do]':
      return UC_TODO;
    case '[In Progress]':
      return UC_IN_PROGRESS;
    case '[Submitted]':
    case '[In Review]':
      return UC_AWAITING_REVIEW;
    case '[Revision Requested]':
    case '[Blocked]':
      return UC_BLOCKED_REVISION;
    case '[Approved]':
      return UC_DONE;
    default:
      return UC_UNKNOWN;
  }
}

/**
 * kolUniversal maps a set of Creator Booking statuses to a Universal Column via the
 * §5.2 KOL roll-up rules (worst-case, §2 Rule 3): any [Escalated] → Blocked/Revision;
 * all [QC Passed] → Done; else if any is still Submitted/QC Review → Awaiting Review;
 * else In Progress. [Dropped] bookings are excluded (STATE_MACHINES §8); an
 * all-Dropped brief has no active work → To Do defensively.
 */
export function kolUniversal(statuses: string[]): string {
  const active = statuses.filter((st) => st !== '[Dropped]');
  if (active.length === 0) {
    return UC_TODO;
  }
  let anyEscalated = false;
  let anyRevision = false;
  let allQcPassed = true;
  let anyEarly = false; // Sourcing/Booked/Content In Progress
  let anyMidReview = false; // Content Submitted / QC Review
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
      allQcPassed = false;
    }
  }
  if (anyEscalated || anyRevision) {
    return UC_BLOCKED_REVISION;
  }
  if (allQcPassed) {
    return UC_DONE;
  }
  if (anyEarly) {
    return UC_IN_PROGRESS;
  }
  if (anyMidReview) {
    return UC_AWAITING_REVIEW;
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
      return UC_AWAITING_REVIEW;
    case '[Reconciled]':
      return UC_DONE;
    case '[Discrepancy Flagged]':
      return UC_BLOCKED_REVISION; // non-blocking flag, still shown (§5.2)
    default:
      return UC_UNKNOWN;
  }
}

/**
 * ucRank orders the Universal Columns from least to most advanced, for the §2 Rule 3
 * worst-case roll-up across many sub-entities. A revision/blocked sub-entity is
 * "not done" — ranked between Awaiting Review and Done so it dominates only once all
 * forward work has otherwise reached review (§2 Rule 3 "least-advanced stage").
 */
function ucRank(uc: string): number {
  switch (uc) {
    case UC_TODO:
      return 0;
    case UC_IN_PROGRESS:
      return 1;
    case UC_AWAITING_REVIEW:
      return 2;
    case UC_BLOCKED_REVISION:
      return 2;
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
    if (uc === UC_BLOCKED_REVISION) {
      anyBlocked = true;
    }
    const r = ucRank(uc);
    if (r >= 0 && r < worstR) {
      worstR = r;
      worst = uc;
    }
  }
  if (worst === UC_DONE && anyBlocked) {
    return UC_BLOCKED_REVISION;
  }
  return worst;
}

// ---- Client Board (§5.3) ----------------------------------------------------

/**
 * clientBoard returns every Brief of one Client as a Card, grouped implicitly by
 * Universal Column (§5.3). Client filter is mandatory. Read scope (§5.3): AM/SPV/OD/
 * Director see any Client; a staff member only a Client where they are PIC of a unit.
 */
export async function clientBoard(sql: Queryable, actor: Actor, clientId: string): Promise<Card[]> {
  const id = (clientId ?? '').trim();
  if (id === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!(await canSeeClient(sql, actor, id))) {
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }
  const rows = await sql<
    { id: string; assigned_division: string; assigned_pic: string; status: string; due_date: string | Date | null; client_id: string; created_at: Date }[]
  >`
    select b.id, b.assigned_division, coalesce(b.assigned_pic,'') as assigned_pic, b.status, b.due_date,
           sv.client_id, b.created_at
      from briefs b
      join services sv on sv.id = b.service_id
     where sv.client_id = ${id}
     order by b.id asc`;
  const cards = rows.map(scanBriefCard);
  for (const c of cards) {
    await fillBriefCard(sql, c);
  }
  return cards;
}

/**
 * scanBriefCard reads a Brief row into a Card (native status + due date), leaving the
 * Universal Column / badge to fillBriefCard.
 */
function scanBriefCard(r: {
  id: string; assigned_division: string; assigned_pic: string; status: string;
  due_date: string | Date | null; client_id: string; created_at: Date;
}): Card {
  const c: Card = {
    id: r.id, type: ENTITY_BRIEF, division: r.assigned_division, clientId: r.client_id, briefId: r.id,
    pic: r.assigned_pic, nativeStatus: r.status, universalColumn: UC_UNKNOWN, dueDate: '', overdue: false,
    dependencyBadge: '', createdAt: r.created_at,
  };
  if (r.due_date !== null) {
    c.dueDate = dateStr(r.due_date);
    // Overdue vs Brief SLA (§5.3 / §6.5): due date passed and the Brief is not Done.
    if (beforeToday(r.due_date)) {
      c.overdue = true;
    }
  }
  return c;
}

/**
 * fillBriefCard computes a Brief card's Universal Column (rolling up KOL Bookings /
 * LS Sessions where the Brief's own status does not already reflect them) and its
 * Dependency badge (§5.3).
 */
async function fillBriefCard(sql: Queryable, c: Card): Promise<void> {
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
  if (c.universalColumn === UC_DONE) {
    c.overdue = false; // a finished Brief is never "overdue".
  }
  c.dependencyBadge = await dependencyBadge(sql, c.briefId);
}

/**
 * dependencyBadge returns the board badge for a Target Brief (§2 Rule 7): if any
 * active Blocking Dependency's Source is not yet terminal → "Menunggu Dependency";
 * else if it is an Informational target → a short link note; else empty.
 */
async function dependencyBadge(sql: Queryable, briefId: string): Promise<string> {
  const unsatisfied = await blockingSourcesUnsatisfied(sql, briefId);
  if (unsatisfied.length > 0) {
    return 'Menunggu Dependency';
  }
  const rows = await sql<{ source_id: string }[]>`
    select source_id from dependencies
     where target_id = ${briefId} and dependency_type = ${TYPE_INFORMATIONAL}
     order by id asc limit 1`;
  if (rows.length === 0) {
    return '';
  }
  return `Informational (link ke ${rows[0].source_id})`;
}

// ---- My Tasks (§5.4) --------------------------------------------------------

/**
 * myTasks returns the actor's own work units across all Clients (§5.4): Brief-as-task
 * rows they PIC (single-unit divisions like Ads), Creative Assets they PIC, KOL
 * Bookings they coordinate, and Live Stream Sessions of Briefs they PIC. Each unit is
 * a Card with its native status mapped to a Universal Column (§5.2). Read scope is
 * intrinsically "own" (default filter PIC = self, §5.4); OD/Director/Account-lead may
 * pass a target employee to view that person's tasks (division-wide read, Role Matrix).
 */
export async function myTasks(sql: Queryable, actor: Actor, forEmployee: string): Promise<Card[]> {
  let target = (forEmployee ?? '').trim();
  if (target === '' || target === actor.employeeId) {
    target = actor.employeeId;
  } else if (!(permission.canReadAll(actor) || permission.canReadDivision(actor, ACCOUNT_DIVISION))) {
    // A staff member may only see their OWN tasks (§5.4 / Role Matrix: Staff = own).
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }

  const cards: Card[] = [];

  // Brief-as-task units the actor PICs (Ads and any single-unit Brief).
  const briefRows = await sql<
    { id: string; assigned_division: string; status: string; due_date: string | Date | null; client_id: string }[]
  >`
    select b.id, b.assigned_division, b.status, b.due_date, sv.client_id
      from briefs b join services sv on sv.id = b.service_id
     where b.assigned_pic = ${target} order by b.id asc`;
  for (const r of briefRows) {
    cards.push(unitCard(r.id, ENTITY_BRIEF, r.id, r.assigned_division, r.status, r.due_date, r.client_id, briefTaskUniversal(r.status)));
  }

  // Creative Assets the actor PICs.
  const assetRows = await sql<
    { id: string; assigned_division: string; status: string; due_date: string | Date | null; client_id: string; brief_id: string }[]
  >`
    select a.id, b.assigned_division, a.status, b.due_date, sv.client_id, a.brief_id
      from assets a join briefs b on b.id = a.brief_id join services sv on sv.id = b.service_id
     where a.assigned_pic = ${target} order by a.id asc`;
  for (const r of assetRows) {
    cards.push(unitCard(r.id, 'asset', r.brief_id, r.assigned_division, r.status, r.due_date, r.client_id, briefTaskUniversal(r.status)));
  }

  // KOL Bookings the actor coordinates.
  const bkgRows = await sql<
    { id: string; assigned_division: string; status: string; due_date: string | Date | null; client_id: string; brief_id: string }[]
  >`
    select k.id, b.assigned_division, k.status, b.due_date, sv.client_id, k.brief_id
      from creator_bookings k join briefs b on b.id = k.brief_id join services sv on sv.id = b.service_id
     where k.assigned_coordinator = ${target} order by k.id asc`;
  for (const r of bkgRows) {
    cards.push(unitCard(r.id, 'booking', r.brief_id, r.assigned_division, r.status, r.due_date, r.client_id, kolUniversal([r.status])));
  }

  // Live Stream Sessions of Briefs the actor PICs (LS has no per-session PIC, §6.3;
  // the AM assigned to the LS Brief owns them).
  const lssRows = await sql<
    { id: string; assigned_division: string; status: string; due_date: string | Date | null; client_id: string; brief_id: string }[]
  >`
    select l.id, b.assigned_division, l.status, b.due_date, sv.client_id, l.brief_id
      from live_stream_sessions l join briefs b on b.id = l.brief_id join services sv on sv.id = b.service_id
     where b.assigned_pic = ${target} order by l.id asc`;
  for (const r of lssRows) {
    cards.push(unitCard(r.id, 'session', r.brief_id, r.assigned_division, r.status, r.due_date, r.client_id, lsUniversal(r.status)));
  }

  // Stamp each card's PIC (the target) so the row is self-describing.
  for (const c of cards) {
    c.pic = target;
  }
  return cards;
}

/** unitCard builds a My-Tasks Card, filling due date + overdue against the Universal Column. */
function unitCard(
  id: string,
  type: string,
  briefId: string,
  division: string,
  status: string,
  due: string | Date | null,
  clientId: string,
  uc: string,
): Card {
  const c: Card = {
    id, type, division, clientId, briefId, pic: '', nativeStatus: status, universalColumn: uc,
    dueDate: '', overdue: false, dependencyBadge: '', createdAt: null,
  };
  if (due !== null) {
    c.dueDate = dateStr(due);
    if (uc !== UC_DONE && beforeToday(due)) {
      c.overdue = true;
    }
  }
  return c;
}

/**
 * childStatuses returns every child row's status for a Brief (KOL bookings / LS
 * sessions). `table` is a fixed, package-controlled identifier (never user input).
 */
async function childStatuses(sql: Queryable, table: 'creator_bookings' | 'live_stream_sessions', briefId: string): Promise<string[]> {
  const rows = await sql<{ status: string }[]>`select status from ${sql(table)} where brief_id = ${briefId}`;
  return rows.map((r) => r.status);
}

// ---------------------------------------------------------------------------
// Date helpers.
// ---------------------------------------------------------------------------

/** dateStr normalizes a postgres `date` value (string or Date) to YYYY-MM-DD. */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** beforeToday reports whether a due date is strictly before the start of today (local). */
function beforeToday(v: string | Date): boolean {
  const due = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00`);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < startOfToday.getTime();
}
