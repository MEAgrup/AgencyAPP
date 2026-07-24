/**
 * Account & Service domain service (M6) — Cluster 1: Client intake & AM
 * assignment (M6 §3). Ported from Go's `internal/module6_account/account.go`.
 *
 * Once Finance's routing gate releases a paid client to Account (M5 §5,
 * released_to_account_at IS NOT NULL), the client enters the Unassigned Intake
 * Queue until SPV/Head Account manually assigns an Account Manager (§3 Rule 2 —
 * not round-robin, not self-claim). Exactly one AM owns the whole client
 * relationship (M6-OA-6); reassignment (§3 Rule 3) is the only way to change it
 * and requires a logged reason.
 *
 * House rules honoured here (mirroring the Go source):
 *   - assignment is a RELATIONSHIP (a current-AM pointer on the Client Record),
 *     not a lifecycle status, so it is written by a plain guarded UPDATE, never
 *     the state-machine engine (there is no "assignment" status machine);
 *   - every assignment / reassignment appends an immutable before→after audit
 *     row (house rule #3); the pointer holds only the CURRENT owner, history
 *     lives in the audit log;
 *   - the read/write authority split mirrors M4 §6 / the global role matrix.
 *
 * Deferred to their own clusters (their own files): Strategy & Plan (§4),
 * Briefs (§5/§6), Brief review, and Complaints (§8).
 *
 * Reference: backend/internal/module6_account/account.go.
 */

import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** The CDPS division that owns intake & AM assignment. */
export const ACCOUNT_DIVISION = 'Account';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M6 §3). Each mirrors a Go sentinel error 1:1; the
// strings follow the W1-09 precedent (logged in DECISIONS.md).
// ---------------------------------------------------------------------------

/** Actor may not read the Account intake queue / workload (not SPV/Head Account, OD or Director). */
export const MSG_INTAKE_FORBIDDEN = '[anda tidak memiliki akses ke antrean intake Account]';
/** Actor may not assign/reassign an AM (only SPV/Head Account or Director; §3 Rule 2). */
export const MSG_ASSIGN_FORBIDDEN = '[anda tidak memiliki akses untuk menugaskan Account Manager]';
/** Client does not exist OR is not yet released to Account (M5 §5 Rule 2 → invisible). */
export const MSG_NOT_FOUND = '[klien tidak ditemukan]';
/** AssignAM on a client that already has an AM — use reassignment (§3 Rule 3). */
export const MSG_ALREADY_ASSIGNED = '[klien sudah memiliki Account Manager, gunakan reassignment]';
/** ReassignAM on a client that has no AM yet — assign first. */
export const MSG_NOT_ASSIGNED = '[klien belum memiliki Account Manager]';
/** The chosen assignee is not an active Account-division staff. */
export const MSG_INVALID_AM = '[Account Manager tidak valid: harus staff divisi Account yang aktif]';
/** Reassignment target equals the current AM (no-op rejected). */
export const MSG_SAME_AM = '[Account Manager tujuan sama dengan yang sekarang]';
/** Reassignment reason is mandatory (§3 Rule 3, logged). */
export const MSG_REASON_REQUIRED = '[alasan reassignment wajib diisi]';

// ---------------------------------------------------------------------------
// Errors — each carries the verbatim BI message. Status mapping follows the
// Fase 1 REST-conventional normalization (see apps/api http.ts): validation →
// 400, forbidden → 403, not-found → 404, lifecycle conflict → 409.
// ---------------------------------------------------------------------------

/** Bad/missing input on an assign/reassign call (→ 400): invalid AM, missing reason. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountValidationError';
  }
}

/** The actor's role may not perform the requested read/action (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountForbiddenError';
  }
}

/** The client does not exist or is not yet released to Account (verbatim BI, → 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'AccountNotFoundError';
  }
}

/** The assignment state forbids the action (already/not assigned, same AM) (→ 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountConflictError';
  }
}

// ---------------------------------------------------------------------------
// Authorization predicates (M6 §3).
// ---------------------------------------------------------------------------

/**
 * canManageAssignment is the §3 Rule 2 write gate: SPV/Head Account (Account
 * lead) or Director. OD (read-only) and any staff/AM are denied.
 */
export function canManageAssignment(a: Actor): boolean {
  return permission.isLead(a, ACCOUNT_DIVISION);
}

/**
 * canReadIntake is the §3 Rule 1 read gate: SPV/Head Account, plus OD/Director
 * (read-everywhere). Individual AMs (Account staff) and other divisions cannot
 * see the unassigned queue.
 */
export function canReadIntake(a: Actor): boolean {
  return permission.canReadDivision(a, ACCOUNT_DIVISION);
}

// ---------------------------------------------------------------------------
// Read models (§3 Rule 1 / Rule 5).
// ---------------------------------------------------------------------------

/**
 * IntakeClient is one row of the Unassigned Intake Queue (§3 Rule 1) — the slim
 * projection SPV needs to pick an AM (client profile + when it was released).
 */
export interface IntakeClient {
  clientId: string;
  namaPic: string;
  toko: string;
  kota: string;
  kategori: string;
  serviceCount: number;
  releasedToAccountAt: Date | null;
}

/**
 * AMWorkload is one AM's active-client count for the SPV dashboard (§3 Rule 5).
 * It is a soft signal only — no hard capacity cap (M6-OA-2).
 */
export interface AMWorkload {
  amEmployeeId: string;
  activeClientCount: number;
}

/** Assignment reports the outcome of an assign / reassign action. */
export interface Assignment {
  clientId: string;
  previousAm?: string;
  assignedAm: string;
  assignedBy: string;
  reason?: string;
}

/**
 * intakeQueue returns every released-but-unassigned client (§3 Rule 1), oldest
 * release first so the longest-waiting client surfaces at the top. Read gate:
 * SPV/Head Account or OD/Director.
 */
export async function intakeQueue(sql: Queryable, actor: Actor): Promise<IntakeClient[]> {
  if (!canReadIntake(actor)) {
    throw new ForbiddenError(MSG_INTAKE_FORBIDDEN);
  }
  const rows = await sql<
    {
      id: string; nama_pic: string; toko: string; kota: string; kategori: string;
      service_count: string; released_to_account_at: Date | null;
    }[]
  >`
    select c.id, c.nama_pic, c.toko, c.kota, c.kategori,
           (select count(*) from services s where s.client_id = c.id) as service_count,
           c.released_to_account_at
      from clients c
     where c.released_to_account_at is not null
       and c.assigned_am_id is null
       and c.dormant_at is null
     order by c.released_to_account_at asc, c.id asc`;
  return rows.map((r) => ({
    clientId: r.id, namaPic: r.nama_pic, toko: r.toko, kota: r.kota, kategori: r.kategori,
    serviceCount: Number(r.service_count), releasedToAccountAt: r.released_to_account_at,
  }));
}

/**
 * workload returns each AM's active-client count (§3 Rule 5), highest first.
 * "Active" = a released, non-dormant client currently owned by that AM. Read
 * gate: SPV/Head Account or OD/Director.
 */
export async function workload(sql: Queryable, actor: Actor): Promise<AMWorkload[]> {
  if (!canReadIntake(actor)) {
    throw new ForbiddenError(MSG_INTAKE_FORBIDDEN);
  }
  const rows = await sql<{ assigned_am_id: string; active_count: string }[]>`
    select assigned_am_id, count(*) as active_count
      from clients
     where assigned_am_id is not null
       and released_to_account_at is not null
       and dormant_at is null
     group by assigned_am_id
     order by active_count desc, assigned_am_id asc`;
  return rows.map((r) => ({ amEmployeeId: r.assigned_am_id, activeClientCount: Number(r.active_count) }));
}

// ---------------------------------------------------------------------------
// Assign / reassign (transactional; §3 Rules 2–4).
// ---------------------------------------------------------------------------

/** The row read under lock by the assignment gates. */
interface LockedClient {
  released: boolean;
  current: string | null;
}

/**
 * lockClientForAssignment takes the row lock and reads the two fields the
 * assignment gates need: whether the client is released to Account, and its
 * current AM pointer. A missing client is reported as not-found.
 */
async function lockClientForAssignment(tx: Queryable, clientId: string): Promise<LockedClient> {
  const rows = await tx<{ released_to_account_at: Date | null; assigned_am_id: string | null }[]>`
    select released_to_account_at, assigned_am_id from clients where id = ${clientId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return { released: rows[0].released_to_account_at !== null, current: rows[0].assigned_am_id };
}

/**
 * validateAMCandidate enforces that the chosen assignee is an ACTIVE employee
 * whose resolved CDPS division is Account and whose level is staff (§3 Rule 2 —
 * an AM is Account staff; Lead/SPV are the assigners, not candidates). It
 * mirrors the divisi+jabatan → division join used by auth.ResolveActor.
 */
async function validateAMCandidate(tx: Queryable, amId: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${amId}`;
  if (rows.length === 0) {
    throw new ValidationError(MSG_INVALID_AM);
  }
  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  if (!active || r.division !== ACCOUNT_DIVISION || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_AM);
  }
}

/**
 * assignAM assigns an AM to a released, currently-unassigned client (§3 Rules
 * 2–4). One AM owns the entire client relationship (M6-OA-6). The pointer write
 * and its immutable audit row commit together.
 */
export async function assignAM(sql: Sql, actor: Actor, clientId: string, amId: string): Promise<Assignment> {
  if (!canManageAssignment(actor)) {
    throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
  }
  const am = (amId ?? '').trim();
  if (am === '') {
    throw new ValidationError(MSG_INVALID_AM);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { released, current } = await lockClientForAssignment(tx, clientId);
    if (!released) {
      throw new NotFoundError();
    }
    if (current !== null) {
      throw new ConflictError(MSG_ALREADY_ASSIGNED);
    }
    await validateAMCandidate(tx, am);

    await tx`update clients set assigned_am_id = ${am} where id = ${clientId}`;
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId, action: 'am_assigned',
      beforeJson: { assigned_am_id: null },
      afterJson: { assigned_am_id: am, assigned_by: actor.employeeId },
      createdBy: actor.employeeId,
    });
    return { clientId, assignedAm: am, assignedBy: actor.employeeId };
  });
}

/**
 * reassignAM moves a client from its current AM to a new one (§3 Rule 3,
 * M6-OA-6 coverage mechanism). Reason is mandatory and logged. The target must
 * be a valid, active Account AM and differ from the current owner.
 */
export async function reassignAM(
  sql: Sql,
  actor: Actor,
  clientId: string,
  newAmId: string,
  reason: string,
): Promise<Assignment> {
  if (!canManageAssignment(actor)) {
    throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
  }
  const newAm = (newAmId ?? '').trim();
  if (newAm === '') {
    throw new ValidationError(MSG_INVALID_AM);
  }
  const why = (reason ?? '').trim();
  if (why === '') {
    throw new ValidationError(MSG_REASON_REQUIRED);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const { released, current } = await lockClientForAssignment(tx, clientId);
    if (!released) {
      throw new NotFoundError();
    }
    if (current === null) {
      throw new ConflictError(MSG_NOT_ASSIGNED);
    }
    if (current === newAm) {
      throw new ConflictError(MSG_SAME_AM);
    }
    await validateAMCandidate(tx, newAm);

    await tx`update clients set assigned_am_id = ${newAm} where id = ${clientId}`;
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId, action: 'am_reassigned',
      beforeJson: { assigned_am_id: current },
      afterJson: { assigned_am_id: newAm, assigned_by: actor.employeeId, reason: why },
      createdBy: actor.employeeId,
    });
    return { clientId, previousAm: current, assignedAm: newAm, assignedBy: actor.employeeId, reason: why };
  });
}
