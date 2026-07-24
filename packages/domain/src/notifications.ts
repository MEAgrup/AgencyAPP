/**
 * Notifications inbox read/mark-read service (house convention #8: in-app only,
 * v1). Rows are produced by the audit-driven emit engine in @cdps/core
 * `notification` and land in the `notifications` table, one row per recipient.
 *
 * Two house rules shape this slice:
 *   - #8 "Never deletable, only read/unread": the table carries a
 *     notifications_no_delete trigger — there is no delete path. read_at is the
 *     ONLY mutable column, flipped once by markRead; everything else is history.
 *   - #6 "Staff = own data only": a user sees and marks ONLY their own inbox.
 *     `db()` connects as service-role (RLS bypassed — O37), so the
 *     `recipient_employee_id = actor` predicate here IS the access gate; it must
 *     never be dropped.
 *
 * Ported to the TS BFF from the Go notification read handlers.
 */

import { permission } from '@cdps/core';
import type { Queryable } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

/** One inbox row — mirrors web-internal's NotificationItem (lib/types.ts). */
export interface NotificationRow {
  id: string; // bigint identity, serialized as text to avoid precision loss
  eventType: string;
  entityType: string;
  entityId: string;
  deepLink: string;
  /** the employee whose action fired the event (actor_employee_id). */
  actor: string;
  createdAt: Date;
  readAt: Date | null;
}

/** The bell/inbox payload: the actor's rows + their unread total. */
export interface Inbox {
  rows: NotificationRow[];
  unreadCount: number;
}

interface Raw {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor_employee_id: string;
  created_at: Date;
  read_at: Date | null;
}

/**
 * list returns the actor's OWN notifications, newest first, plus the unread
 * count. The count is always the FULL unread total for the actor — independent
 * of `unreadOnly`, which only narrows the returned rows — because the header
 * bell badge must be correct even while the page shows the "unread only" view.
 */
export async function list(sql: Queryable, actor: Actor, unreadOnly = false): Promise<Inbox> {
  const rows = await sql<Raw[]>`
    select id::text as id, event_type, entity_type, entity_id, deep_link,
           actor_employee_id, created_at, read_at
    from notifications
    where recipient_employee_id = ${actor.employeeId}
      and (${unreadOnly} = false or read_at is null)
    order by created_at desc, id desc`;

  const unread = await sql<{ n: string }[]>`
    select count(*)::text as n from notifications
    where recipient_employee_id = ${actor.employeeId} and read_at is null`;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      entityType: r.entity_type,
      entityId: r.entity_id,
      deepLink: r.deep_link,
      actor: r.actor_employee_id,
      createdAt: r.created_at,
      readAt: r.read_at,
    })),
    unreadCount: Number(unread[0]?.n ?? '0'),
  };
}

/**
 * markRead stamps read_at on ONE of the actor's own notifications (house rule
 * #8 — the only sanctioned mutation on the table). Scoped by
 * recipient_employee_id, so another user's id matches nothing. Idempotent: a
 * row already read (or not owned by the actor) is a silent no-op — the bell
 * mark-read must never error on a double click or a stale id.
 */
export async function markRead(sql: Queryable, actor: Actor, id: string): Promise<void> {
  // Notification ids are bigint identities; a non-numeric path segment can never
  // match one, so skip the query (and avoid a bigint-cast parse error) rather
  // than 500 on a malformed id.
  if (!/^\d+$/.test(id)) {
    return;
  }
  await sql`
    update notifications set read_at = now()
    where id = ${id}::bigint and recipient_employee_id = ${actor.employeeId} and read_at is null`;
}
