/**
 * Declarative transition engine — TypeScript wrapper over the SQL function
 * `sm_transition` (migration 20260723055732_statemachine.sql).
 *
 * Ported from archive/backend-go/internal/core/statemachine. The ACTUAL enforcement (row
 * lock, edge validation, role gate, status UPDATE, immutable audit row) lives in
 * `sm_transition` inside a single DB transaction — NOT reimplemented in TS,
 * because "no raw UPDATE ever sets status" and the requireLead gate must hold
 * even for direct service-role calls (SUPABASE_MIGRATION_TECH_APPENDIX §B.2).
 *
 * This wrapper: fills column defaults, derives the two role booleans from a
 * permission.Actor exactly as Go's Transition does, calls the SQL function
 * inside the caller's transaction (the SAME tx as any dependent writes), and
 * returns the structured result. The SQL returns a discriminated `{ok,...}`
 * jsonb (not an exception) so a route handler can map `code` → HTTP 409/403
 * without string-matching Postgres errors.
 */

import { LevelLead, type Actor } from './permission';

/** Failure codes returned by `sm_transition` (mirror the SQL `code` field). */
export type TransitionCode =
  | 'no_actor'
  | 'unknown_machine'
  | 'auto_computed'
  | 'not_found'
  | 'blocked'
  | 'role_denied';

/** Successful transition. */
export interface TransitionOk {
  ok: true;
  from: string;
  to: string;
}

/** Rejected transition, carrying the BI `[...]` (or technical) message. */
export interface TransitionErr {
  ok: false;
  code: TransitionCode;
  message: string;
}

export type TransitionResult = TransitionOk | TransitionErr;

/** Arguments passed straight through to the SQL function `sm_transition`. */
export interface SmTransitionArgs {
  machine: string;
  entityType: string;
  table: string;
  idCol: string;
  statusCol: string;
  entityId: string;
  to: string;
  actorEmployeeId: string;
  roleDirector: boolean;
  roleLead: boolean;
}

/**
 * Executor over the atomic SQL transition. The real implementation wraps
 * postgres.js/drizzle and MUST run inside the caller's transaction:
 *
 *   sql`select sm_transition(${machine}, ${entityType}, ...) as r`.then(r => r[0].r)
 */
export interface SmExecutor {
  smTransition(args: SmTransitionArgs): Promise<TransitionResult>;
}

/** A transition request (mirror of Go's statemachine.Request). */
export interface TransitionRequest {
  machine: string;
  /** Audit entity_type label. */
  entityType: string;
  /** Storage table. */
  table: string;
  entityId: string;
  to: string;
  actor: Actor;
  /** Primary-key column (default "id"). */
  idColumn?: string;
  /** Status column (default "status"). */
  statusColumn?: string;
}

/**
 * transition validates + applies + audits a status change via `sm_transition`,
 * inside the caller's transaction. It is the ONLY path that writes a status
 * column. Role booleans are derived exactly as Go's engine does: the requireLead
 * gate passes for a Director OR anyone at lead level (division-specific checks,
 * where a machine needs them, live in the module layer — not the engine).
 *
 * Invariant: call only AFTER mandatory-field validation has passed (the SQL
 * function performs NO business validation — the BI `[...]` messages for that
 * stay in the route handler, single-sourced).
 */
export async function transition(exec: SmExecutor, req: TransitionRequest): Promise<TransitionResult> {
  return exec.smTransition({
    machine: req.machine,
    entityType: req.entityType,
    table: req.table,
    idCol: req.idColumn ?? 'id',
    statusCol: req.statusColumn ?? 'status',
    entityId: req.entityId,
    to: req.to,
    actorEmployeeId: req.actor.employeeId,
    roleDirector: req.actor.role.director,
    roleLead: req.actor.role.level === LevelLead,
  });
}

/** Narrowing helper: a blocked (invalid-edge) rejection. */
export function isBlocked(r: TransitionResult): r is TransitionErr {
  return r.ok === false && r.code === 'blocked';
}

/** Narrowing helper: a role-restricted rejection. */
export function isRoleDenied(r: TransitionResult): r is TransitionErr {
  return r.ok === false && r.code === 'role_denied';
}
