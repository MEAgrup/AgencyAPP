/**
 * Demo-task domain service (Sprint 0 demo path S0-12), ported to the Supabase
 * stack from Go's `internal/demo`.
 *
 * A `demo_tasks` entity (prefix DEMO-) running on the canonical brief_task state
 * machine, plus the staff-submits / SPV-approves block-request flow. It is the
 * reference vertical that exercises ALL FOUR core executors — ident_next,
 * sm_transition, notify_emit, audit — through a single @cdps/db transaction, so
 * an @cdps/api route handler is a thin shell over these functions.
 *
 * House rules honored here (CLAUDE.md §Non-negotiable):
 *   - IDs minted ONLY after mandatory-field validation passes (title/reason gate
 *     with the exact BI message, BEFORE ident_next).
 *   - Status is written ONLY through sm_transition (never a raw UPDATE).
 *   - Every mutation appends to the audit log; block events emit catalog notifs.
 *
 * Reference: backend/internal/demo/task.go.
 */

import { bi, ident, notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** brief_task machine (seeded in 20260723055732_statemachine.sql). */
export const DEMO_MACHINE = 'brief_task';
/** brief_task initial state. */
export const DEMO_INITIAL_STATUS = '[To Do]';

/** A demo task row. */
export interface Task {
  id: string;
  title: string;
  description: string;
  division: string;
  status: string;
  createdBy: string;
  createdAt: Date;
}

/** Error thrown when a mandatory-field gate fails (carries the exact BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'IncompleteError';
  }
}

/** Error thrown when the requested entity does not exist. */
export class NotFoundError extends Error {
  constructor(message = 'demo task not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Error thrown when the actor lacks the role for a restricted action. */
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * create validates mandatory fields, then (only after validation passes)
 * allocates a DEMO- id and inserts the task in [To Do] — ident + insert + audit
 * in one transaction. Division is the actor's CDPS division (falling back to raw
 * HRIS divisi, then empty).
 */
export async function create(
  sql: Sql,
  actor: Actor,
  input: { title: string; description?: string },
): Promise<Task> {
  const title = input.title?.trim() ?? '';
  if (title === '') {
    throw new IncompleteError();
  }
  const description = input.description ?? '';
  const division = actor.role.division || actor.divisi || '';
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const id = await ident.nextId(ex.ident, 'DEMO', now);
    await tx`
      insert into demo_tasks (id, title, description, division, status, created_by)
      values (${id}, ${title}, ${description}, ${division}, ${DEMO_INITIAL_STATUS}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'demo_task', entityId: id, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null,
      afterJson: { status: DEMO_INITIAL_STATUS, title }, createdBy: actor.employeeId,
    });
    return {
      id, title, description, division,
      status: DEMO_INITIAL_STATUS, createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/** list returns all demo tasks, newest first. */
export async function list(sql: Queryable): Promise<Task[]> {
  const rows = await sql<
    {
      id: string; title: string; description: string | null; division: string;
      status: string; created_by: string; created_at: Date;
    }[]
  >`
    select id, title, description, division, status, created_by, created_at
    from demo_tasks order by id desc`;
  return rows.map(toTask);
}

/** get returns one task by id (throws NotFoundError if absent). */
export async function get(sql: Queryable, id: string): Promise<Task> {
  const rows = await sql<
    {
      id: string; title: string; description: string | null; division: string;
      status: string; created_by: string; created_at: Date;
    }[]
  >`
    select id, title, description, division, status, created_by, created_at
    from demo_tasks where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return toTask(rows[0]);
}

function toTask(r: {
  id: string; title: string; description: string | null; division: string;
  status: string; created_by: string; created_at: Date;
}): Task {
  return {
    id: r.id, title: r.title, description: r.description ?? '', division: r.division,
    status: r.status, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/**
 * transition drives the brief_task machine for a demo task via sm_transition
 * (the only status-writing path). Role-restricted edges (e.g. [Blocked]) are
 * enforced inside the SQL function; the result discriminates blocked vs
 * role_denied. Throws NotFoundError if the id does not exist.
 */
export async function transition(
  sql: Sql,
  actor: Actor,
  id: string,
  to: string,
): Promise<statemachine.TransitionResult> {
  // Fail fast with a clear 404 rather than a generic transition error.
  await get(sql, id);
  return withTransaction(sql, async (tx) => {
    return statemachine.transition(executors(tx).sm, {
      machine: DEMO_MACHINE,
      entityType: 'demo_task',
      table: 'demo_tasks',
      entityId: id,
      to,
      actor,
    });
  });
}

/**
 * submitBlockRequest lets a staff/AM submit a block request (they cannot set
 * [Blocked] themselves). Validates the reason, mints a DBR- id, records the
 * pending request, audits it, and notifies the division leads (M12 catalog:
 * block request submitted). ident + insert + audit + notify, one transaction.
 */
export async function submitBlockRequest(
  sql: Sql,
  actor: Actor,
  taskId: string,
  reason: string,
): Promise<{ id: string; taskId: string; reason: string; status: 'pending' }> {
  if (!reason || reason.trim() === '') {
    throw new IncompleteError();
  }
  const task = await get(sql, taskId);
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const reqId = await ex.ident.identNext('DBR', now);
    await tx`
      insert into demo_task_block_requests (id, task_id, reason, status, requested_by, created_by)
      values (${reqId}, ${taskId}, ${reason}, 'pending', ${actor.employeeId}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'demo_task', entityId: taskId, actorEmployeeId: actor.employeeId,
      action: 'block_request_submitted', beforeJson: null,
      afterJson: { request_id: reqId, reason }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestSubmitted,
      entityType: 'demo_task', entityId: taskId, actor: actor.employeeId,
      division: task.division, deepLink: `/demo-tasks/${taskId}`,
    });
    return { id: reqId, taskId, reason, status: 'pending' as const };
  });
}

/**
 * approveBlockRequest lets a division lead (or Director) approve a pending block
 * request: it verifies lead authority for the task's division, drives the task
 * into [Blocked] via sm_transition (SPV/Lead-only edge), marks the request
 * approved, audits, and notifies the requester (M12: block decided). The request
 * row is locked FOR UPDATE and must still be pending.
 */
export async function approveBlockRequest(
  sql: Sql,
  actor: Actor,
  taskId: string,
  reqId: string,
): Promise<statemachine.TransitionResult> {
  const task = await get(sql, taskId);
  if (!permission.isLead(actor, task.division)) {
    throw new ForbiddenError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ status: string; requested_by: string }[]>`
      select status, requested_by from demo_task_block_requests
      where id = ${reqId} and task_id = ${taskId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError('block request not found');
    }
    if (rows[0].status !== 'pending') {
      throw new NotFoundError('block request already resolved');
    }

    const result = await statemachine.transition(ex.sm, {
      machine: DEMO_MACHINE,
      entityType: 'demo_task',
      table: 'demo_tasks',
      entityId: taskId,
      to: '[Blocked]',
      actor,
    });
    if (!result.ok) {
      // Surface the transition rejection to the caller without committing.
      return result;
    }

    await tx`
      update demo_task_block_requests
      set status = 'approved', resolved_by = ${actor.employeeId}, resolved_at = now()
      where id = ${reqId}`;
    await ex.audit.insertAudit({
      entityType: 'demo_task', entityId: taskId, actorEmployeeId: actor.employeeId,
      action: 'block_request_approved', beforeJson: null,
      afterJson: { request_id: reqId }, createdBy: actor.employeeId,
    });
    await notification.emit(ex.notify, {
      event: notification.EVENTS.BlockRequestDecided,
      entityType: 'demo_task', entityId: taskId, actor: actor.employeeId,
      explicitRecipients: [rows[0].requested_by], deepLink: `/demo-tasks/${taskId}`,
    });
    return result;
  });
}

// Re-export narrowing helpers so handlers can classify a rejection without a
// second @cdps/core import.
export const isBlocked = statemachine.isBlocked;
export const isRoleDenied = statemachine.isRoleDenied;

