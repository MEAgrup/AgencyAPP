/**
 * Prospect activity log (ACT-) — the effort trail a salesperson leaves between
 * `Qualified` and closing.
 *
 * WHY THIS EXISTS (permintaan pemilik 2026-08-06, dicatat di docs/DECISIONS.md).
 * M0 §4 records exactly ONE piece of sales effort: the `Contacted` transition.
 * Everything after `Qualified` — the follow-ups, the meeting that got scheduled,
 * the online meet, the two visits to the warehouse — left no trace at all, so a
 * deal closed after six touches and a deal closed after one looked identical in
 * the system, and "berapa banyak effort sampai closing" was unanswerable.
 *
 * This is a DEVIATION from the PRD (no PRD module defines an activity entity),
 * hence the DECISIONS entry. It is deliberately the smallest shape that answers
 * the question:
 *
 *   - It is a LOG, not a lifecycle. There is no status column and nothing here
 *     ever touches `prospect_attempts.status` — recording a visit is not a
 *     transition, so the engine is not involved (house rule #2 stays intact).
 *   - It is APPEND-ONLY. `prospect_activities` refuses UPDATE and DELETE at the
 *     trigger level, so a mistyped summary is corrected by logging another
 *     activity, never by rewriting history (house rule #3).
 *   - Effort counts are DERIVED. Nothing caches a total; every number here is a
 *     `count(*)` over the log and is recomputable from it (house rule #4).
 *
 * Row visibility is `prospect_activities_select` (RLS, migration 20260806050000),
 * which mirrors `prospect_attempts_select`: whoever may see the attempt may see
 * its effort. This module does NOT re-implement that predicate — the write gate
 * below is a different question (who may ADD effort to someone's attempt), and
 * it reuses `sales.canWriteAttempt` so there is one answer, not two.
 */

import { bi, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ForbiddenError as SalesForbiddenError,
  NotFoundError as SalesNotFoundError,
  STATUS_QUALIFIED,
  STATUS_NEG_APPROVED,
  STATUS_NEG_AUTO_APPROVE,
  STATUS_NEG_PENDING,
  STATUS_NEG_REJECTED,
  STATUS_NEG_REVISION,
  canWriteAttempt,
} from './sales';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/**
 * The CLOSED activity taxonomy (permintaan pemilik 2026-08-06). Mirrored by the
 * `ck_act_type` CHECK constraint in migration 20260806050000 — the DB is the
 * authority, this list is what the UI and the validator read. Adding a type
 * means a migration AND a DECISIONS entry, exactly like the NQ-reason list.
 */
export const ACTIVITY_TYPES: readonly string[] = [
  'Follow Up',
  'Jadwal Meeting',
  'Online Meeting',
  'Visit',
  'Lainnya',
];

/**
 * Statuses at which effort may be logged: `Qualified` and every negotiation
 * state up to (but not including) a terminal one.
 *
 * The floor is `Qualified` because that is what the owner asked for ("setelah
 * status prospek berubah menjadi qualified") and because it is the M1-OA-2 bar
 * for a lead being real: effort spent before that is already summarised by the
 * `Contacted` transition, and counting it would let a salesperson inflate effort
 * on leads that never qualified.
 *
 * The ceiling is terminal status. A `Closed-Success` / `Closed-Lost` /
 * `[Closed - Kalah Kompetisi]` attempt is finished, and appending to a finished
 * attempt would silently change a metric (effort-to-closing) that is supposed to
 * be settled by the closing timestamp.
 */
export const ACTIVITY_ALLOWED_STATUSES: readonly string[] = [
  STATUS_QUALIFIED,
  STATUS_NEG_PENDING,
  STATUS_NEG_REVISION,
  STATUS_NEG_APPROVED,
  STATUS_NEG_AUTO_APPROVE,
  STATUS_NEG_REJECTED,
];

/**
 * Refusal when the attempt is not (yet) at a status that accepts effort. New
 * string, not from the PRD — introduced together with this module and frozen by
 * the DECISIONS entry of 2026-08-06, as the delete-door messages were.
 */
export const MSG_ACTIVITY_STAGE = '[aktivitas hanya bisa dicatat setelah lead qualified]';

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'ActivityIncompleteError';
  }
}

/** The attempt does not exist. */
export class NotFoundError extends SalesNotFoundError {}

/** Actor may not write to this attempt (role matrix) — HTTP 403. */
export class ForbiddenError extends SalesForbiddenError {}

/** The attempt's status does not accept activity — HTTP 409 (verbatim BI). */
export class StageError extends Error {
  constructor() {
    super(MSG_ACTIVITY_STAGE);
    this.name = 'ActivityStageError';
  }
}

/** One logged activity. */
export interface Activity {
  id: string;
  attemptId: string;
  leadId: string;
  activityType: string;
  occurredAt: Date;
  summary: string;
  createdBy: string;
  createdByNama: string;
  createdAt: Date;
}

/** Fields a salesperson supplies when logging one activity. */
export interface LogInput {
  activityType: string;
  /** ISO-8601 instant; empty means "now". */
  occurredAt?: string;
  /** Ringkasan hasil — MANDATORY (that is the whole point of the log). */
  summary: string;
}

/** isAllowedStage reports whether an attempt status accepts new activity. */
export function isAllowedStage(status: string): boolean {
  return ACTIVITY_ALLOWED_STATUSES.includes(status);
}

/** isKnownType reports whether `t` is in the closed taxonomy. */
export function isKnownType(t: string): boolean {
  return ACTIVITY_TYPES.includes((t ?? '').trim());
}

/**
 * parseOccurredAt resolves the client-supplied instant, defaulting to `now`.
 * An unparseable value is a mandatory-field failure, not a silent `now`: a
 * meeting logged at the Unix epoch would poison every duration metric derived
 * from this log.
 */
function parseOccurredAt(raw: string | undefined, now: Date): Date {
  const s = (raw ?? '').trim();
  if (s === '') {
    return now;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new IncompleteError();
  }
  return d;
}

/**
 * log records one activity on an attempt (ACT- minted only after the gate
 * passes, house rule #1) and appends the matching audit row.
 *
 * Gates, in order — cheapest and most-specific first, so the caller always gets
 * the message that actually explains the refusal:
 *   1. mandatory fields + known type  → `[data tidak lengkap, …]`;
 *   2. attempt exists                 → 404;
 *   3. role matrix (`canWriteAttempt`)→ 403 `[anda tidak memiliki akses …]`;
 *   4. stage                          → 409 `[aktivitas hanya bisa dicatat …]`.
 *
 * The whole thing is one transaction, so a refused activity consumes no ACT
 * sequence number.
 */
export async function log(
  sql: Sql,
  actor: Actor,
  attemptId: string,
  input: LogInput,
  now: Date = new Date(),
): Promise<Activity> {
  const activityType = (input.activityType ?? '').trim();
  const summary = (input.summary ?? '').trim();
  if (activityType === '' || summary === '' || !isKnownType(activityType)) {
    throw new IncompleteError();
  }
  const occurredAt = parseOccurredAt(input.occurredAt, now);

  return withTransaction(sql, async (tx) => {
    const rows = await tx<{ id: string; lead_id: string; owner_employee_id: string; status: string }[]>`
      select id, lead_id, owner_employee_id, status
      from prospect_attempts where id = ${attemptId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const a = rows[0];
    if (!canWriteAttempt(actor, a.owner_employee_id)) {
      throw new ForbiddenError();
    }
    if (!isAllowedStage(a.status)) {
      throw new StageError();
    }

    const ex = executors(tx);
    const id = await ex.ident.identNext('ACT', now);
    await tx`
      insert into prospect_activities
        (id, attempt_id, lead_id, activity_type, occurred_at, summary, created_by)
      values
        (${id}, ${attemptId}, ${a.lead_id}, ${activityType}, ${occurredAt}, ${summary},
         ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'prospect_activity', entityId: id, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null,
      afterJson: {
        attempt_id: attemptId, lead_id: a.lead_id, activity_type: activityType,
        attempt_status: a.status,
      },
      createdBy: actor.employeeId,
    });

    const nameRows = await tx<{ nama: string }[]>`
      select nama from employees where employee_id = ${actor.employeeId}`;
    return {
      id, attemptId, leadId: a.lead_id, activityType, occurredAt, summary,
      createdBy: actor.employeeId,
      createdByNama: nameRows.length > 0 ? nameRows[0].nama : actor.employeeId,
      createdAt: now,
    };
  });
}

interface ActivityRow {
  id: string; attempt_id: string; lead_id: string; activity_type: string;
  occurred_at: Date; summary: string; created_by: string; created_by_nama: string;
  created_at: Date;
}

function toActivity(r: ActivityRow): Activity {
  return {
    id: r.id, attemptId: r.attempt_id, leadId: r.lead_id, activityType: r.activity_type,
    occurredAt: r.occurred_at, summary: r.summary, createdBy: r.created_by,
    createdByNama: r.created_by_nama, createdAt: r.created_at,
  };
}

/**
 * listByAttempt returns one attempt's activity log, newest first. Row scope is
 * RLS's (`prospect_activities_select`) — an actor who may not see the attempt
 * gets an empty list from the policy, not a curated one from here.
 */
export async function listByAttempt(sql: Queryable, attemptId: string): Promise<Activity[]> {
  const rows = await sql<ActivityRow[]>`
    select a.id, a.attempt_id, a.lead_id, a.activity_type, a.occurred_at, a.summary,
           a.created_by, coalesce(e.nama, a.created_by) as created_by_nama, a.created_at
    from prospect_activities a
    left join employees e on e.employee_id = a.created_by
    where a.attempt_id = ${attemptId}
    order by a.occurred_at desc, a.id desc`;
  return rows.map(toActivity);
}

/**
 * listByLead returns every activity across ALL attempts on one lead, newest
 * first — the contested-lead view (M1 §6: several salespeople may work the same
 * pool lead, and comparing their effort is the point of keeping every attempt).
 */
export async function listByLead(sql: Queryable, leadId: string): Promise<Activity[]> {
  const rows = await sql<ActivityRow[]>`
    select a.id, a.attempt_id, a.lead_id, a.activity_type, a.occurred_at, a.summary,
           a.created_by, coalesce(e.nama, a.created_by) as created_by_nama, a.created_at
    from prospect_activities a
    left join employees e on e.employee_id = a.created_by
    where a.lead_id = ${leadId}
    order by a.occurred_at desc, a.id desc`;
  return rows.map(toActivity);
}

/** Effort rollup for one attempt: the total plus the per-type breakdown. */
export interface EffortSummary {
  attemptId: string;
  total: number;
  /** counts keyed by activity type; types with zero activity are omitted. */
  byType: Record<string, number>;
  lastActivityAt: Date | null;
}

/**
 * effortByAttempt returns the derived effort rollup for one attempt. Nothing is
 * stored: this recomputes from the log every time (house rule #4), which is why
 * the number can never drift from the activities that produced it.
 */
export async function effortByAttempt(sql: Queryable, attemptId: string): Promise<EffortSummary> {
  const rows = await sql<{ activity_type: string; n: string; last_at: Date }[]>`
    select activity_type, count(*) as n, max(occurred_at) as last_at
    from prospect_activities
    where attempt_id = ${attemptId}
    group by activity_type`;
  const byType: Record<string, number> = {};
  let total = 0;
  let lastActivityAt: Date | null = null;
  for (const r of rows) {
    const n = Number(r.n);
    byType[r.activity_type] = n;
    total += n;
    if (lastActivityAt === null || r.last_at > lastActivityAt) {
      lastActivityAt = r.last_at;
    }
  }
  return { attemptId, total, byType, lastActivityAt };
}

/**
 * effortCounts returns `attemptId -> total activities` for the given attempts,
 * in ONE query — the list-view companion of `effortByAttempt`, so a workspace
 * showing N prospects does not fire N+1 rollups. Attempts with no activity are
 * absent from the map (the caller reads them as 0).
 */
export async function effortCounts(sql: Queryable, attemptIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (attemptIds.length === 0) {
    return out;
  }
  const rows = await sql<{ attempt_id: string; n: string }[]>`
    select attempt_id, count(*) as n
    from prospect_activities
    where attempt_id = any(${attemptIds})
    group by attempt_id`;
  for (const r of rows) {
    out[r.attempt_id] = Number(r.n);
  }
  return out;
}
