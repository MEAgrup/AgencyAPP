// T-4c (RM-11, M6D) — Upcoming Milestones terstruktur.
//
// A per-client list of tonggak (title + target date + status), replacing the
// old RM-C9 free-text note. Status is a real lifecycle: [Upcoming] → [Done] |
// [Cancelled], moved ONLY through the transition engine (house rule #2), each
// move appended to the immutable audit_log (#3). Reads/writes go via the
// service-role connection gated in TS (the D-12 pattern); RLS is the second lock.
//
// Displayed on the client page and as the recap's "Upcoming Milestones" block
// (the still-upcoming ones, soonest first).

import { bi, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

export type Actor = permission.Actor;

const ACCOUNT_DIVISION = 'Account';
const MLS_PREFIX = 'MLS';

export const MILESTONE_UPCOMING = '[Upcoming]';
export const MILESTONE_DONE = '[Done]';
export const MILESTONE_CANCELLED = '[Cancelled]';
/** The states a caller may drive an [Upcoming] milestone to. */
export const MILESTONE_TERMINAL_STATES = [MILESTONE_DONE, MILESTONE_CANCELLED];

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Errors (milestone-scoped; mapped in apps/api http.ts) ---

export class ValidationError extends Error {
  constructor(message = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'MilestoneValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'MilestoneForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = 'milestone not found') {
    super(message);
    this.name = 'MilestoneNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'MilestoneConflictError';
  }
}

// --- Permission gates (mirror M13 client-scoped: AM own / Account lead / OD / Director) ---

/** canView: AM = own clients; Account lead = division-wide; OD/Director = everywhere. */
export function canView(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director || actor.role.od) return true;
  if (actor.role.division === ACCOUNT_DIVISION) {
    if (actor.role.level === permission.LevelLead) return true;
    return actor.employeeId === ownerAm;
  }
  return false;
}

/** canManage: create / mark done / cancel — Account (any level, not read-only OD) or Director. */
export function canManage(actor: Actor): boolean {
  if (actor.role.director) return true;
  if (actor.role.od) return false;
  return actor.role.division === ACCOUNT_DIVISION;
}

// --- Read model ---

export interface Milestone {
  id: string;
  clientId: string;
  title: string;
  targetDate: string; // YYYY-MM-DD
  status: string;
  createdAt: Date;
  createdBy: string;
}

interface MilestoneRow {
  id: string;
  client_id: string;
  title: string;
  target_date: string | Date;
  status: string;
  created_at: Date;
  created_by: string;
}

function dateStr(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}
function toMilestone(r: MilestoneRow): Milestone {
  return {
    id: r.id, clientId: r.client_id, title: r.title, targetDate: dateStr(r.target_date),
    status: r.status, createdAt: r.created_at, createdBy: r.created_by,
  };
}

async function clientOwnerAM(sql: Queryable, clientId: string): Promise<string> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError('client not found');
  return rows[0].assigned_am_id ?? '';
}

// --- Create ---

export interface MilestoneInput {
  title: string;
  targetDate: string; // YYYY-MM-DD
}

/**
 * createMilestone adds one [Upcoming] milestone to a client. Account (own client)
 * / Account lead / Director. Title + a valid target date are mandatory (house
 * rule #1 — the ID is minted only after validation passes). Audited.
 */
export async function createMilestone(sql: Sql, actor: Actor, clientId: string, input: MilestoneInput): Promise<Milestone> {
  if (!canManage(actor)) throw new ForbiddenError();
  const title = (input.title ?? '').trim();
  const targetDate = (input.targetDate ?? '').trim();
  if (title === '' || !RE_DATE.test(targetDate) || Number.isNaN(Date.parse(`${targetDate}T00:00:00Z`))) {
    throw new ValidationError();
  }
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    // Owner-AM gate for a non-lead Account staff: only on own client.
    const ownerAm = await clientOwnerAM(tx, clientId);
    if (!canView(actor, ownerAm)) throw new ForbiddenError();
    const ex = executors(tx);
    const id = await ex.ident.identNext(MLS_PREFIX, now);
    await tx`
      insert into client_milestones (id, client_id, title, target_date, status, created_by)
      values (${id}, ${clientId}, ${title}, ${targetDate}, ${MILESTONE_UPCOMING}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'client_milestone', entityId: id, actorEmployeeId: actor.employeeId, action: 'milestone_created',
      beforeJson: null, afterJson: { client_id: clientId, title, target_date: targetDate, status: MILESTONE_UPCOMING },
      createdBy: actor.employeeId,
    });
    return {
      id, clientId, title, targetDate, status: MILESTONE_UPCOMING, createdAt: now, createdBy: actor.employeeId,
    };
  });
}

// --- Read ---

/** listMilestones returns a client's milestones, soonest target first. Read-gated by canView. */
export async function listMilestones(sql: Queryable, actor: Actor, clientId: string): Promise<Milestone[]> {
  const ownerAm = await clientOwnerAM(sql, clientId);
  if (!canView(actor, ownerAm)) throw new ForbiddenError();
  const rows = await sql<MilestoneRow[]>`
    select id, client_id, title, target_date, status, created_at, created_by
      from client_milestones where client_id = ${clientId}
     order by target_date asc, id asc`;
  return rows.map(toMilestone);
}

// --- Transition ([Upcoming] → [Done] | [Cancelled]) ---

/**
 * transitionMilestone drives an [Upcoming] milestone to [Done] or [Cancelled]
 * through the engine (status is never raw-updated). Account/Director gate; a move
 * to any other target, or from a terminal milestone, is rejected. Audited by the
 * engine's own transition row.
 */
export async function transitionMilestone(sql: Sql, actor: Actor, id: string, to: string): Promise<Milestone> {
  if (!canManage(actor)) throw new ForbiddenError();
  if (!MILESTONE_TERMINAL_STATES.includes(to)) throw new ConflictError();
  return withTransaction(sql, async (tx) => {
    const rows = await tx<MilestoneRow[]>`
      select id, client_id, title, target_date, status, created_at, created_by
        from client_milestones where id = ${id} for update`;
    if (rows.length === 0) throw new NotFoundError();
    const ownerAm = await clientOwnerAM(tx, rows[0].client_id);
    if (!canView(actor, ownerAm)) throw new ForbiddenError();
    const ex = executors(tx);
    const res = await statemachine.transition(ex.sm, {
      machine: 'client_milestone', entityType: 'client_milestone', table: 'client_milestones', entityId: id, to, actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }
    return toMilestone({ ...rows[0], status: to });
  });
}
