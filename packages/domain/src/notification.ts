/**
 * Notification inbox domain service (Phase 0 v2 §9), ported to the Supabase
 * stack from Go's `internal/core/notification` inbox half (List / UnreadCount /
 * MarkRead) plus `internal/httpapi/notification_handlers.go`.
 *
 * This is the READ+ACK side of the notification engine only. Producing
 * notifications lives in `@cdps/core` `notification.emit()` → the SQL function
 * `notify_emit`, called inside the same transaction as the change that triggered
 * it. Nothing here emits, and the event CATALOG stays FROZEN at 15 events —
 * this module never introduces one.
 *
 * House rules honored here (CLAUDE.md §8 + §3):
 *   - In-app only, derived from the audit-log-adjacent event stream.
 *   - **Never deletable.** There is no delete function and no route; the table
 *     also carries a BEFORE DELETE trigger (`notifications_no_delete`) and
 *     `authenticated` has UPDATE/DELETE revoked (20260102000003 §6).
 *   - The ONLY mutation is mark-as-read, and it goes through the
 *     `mark_notification_read` RPC — the single UPDATE path, idempotent by
 *     construction (`AND read_at IS NULL`).
 *
 * Scoping note (why this module DOES carry an explicit recipient predicate,
 * unlike the deliberately-not-ported Go `canReadLead`): DECISIONS 2026-07-28
 * (O37) keeps row visibility in RLS because `leads_select` is a multi-arm
 * predicate two implementations would drift on. `notifications_select` is a
 * single equality — `recipient_employee_id = jwt_employee_id()` — which is the
 * definition of ownership, not a policy choice that can evolve. Restating it in
 * SQL costs nothing, matches Go 1:1, and keeps `markRead` correct on the write
 * path, which runs as service-role (RLS bypassed) and therefore has no policy
 * to lean on at all.
 *
 * Reference: backend/internal/core/notification/notification.go (inbox half),
 * backend/internal/httpapi/notification_handlers.go.
 */

import { permission } from '@cdps/core';
import type { Queryable } from '@cdps/db';

/** Authenticated employee + resolved role (from @cdps/core permission). */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Verbatim BI message (ported from Go handleMarkRead — not a new string).
// ---------------------------------------------------------------------------

/** Path id that is not a positive integer (Go: strconv.ParseInt failure). */
export const MSG_INVALID_ID = '[id tidak valid]';

/** 400 — malformed notification id. */
export class ValidationError extends Error {
  constructor(message: string = MSG_INVALID_ID) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * One inbox row. `id` is a string because the column is `bigint GENERATED
 * ALWAYS AS IDENTITY` and postgres.js hands int8 back as a string (a JS number
 * cannot hold the full range) — which is also what web-internal's
 * `NotificationItem.id: string` expects.
 */
export interface Notification {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  deepLink: string;
  actor: string;
  createdAt: Date;
  readAt: Date | null;
}

/** The inbox response: the rows asked for + the ALWAYS-total unread count. */
export interface Inbox {
  items: Notification[];
  unreadCount: number;
}

interface Row {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor_employee_id: string;
  created_at: Date;
  read_at: Date | null;
}

function toNotification(r: Row): Notification {
  return {
    id: String(r.id),
    eventType: r.event_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    deepLink: r.deep_link,
    actor: r.actor_employee_id,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

/**
 * list returns the actor's own notifications, newest first (Go `List`).
 * `unreadOnly` narrows to un-acked rows; it never widens the recipient scope.
 * The filter is a parameter no-op when off (`'' = ''` short-circuits, the same
 * idiom as `leadsDatabase`), so there is no dynamic SQL to inject into.
 */
export async function list(
  sql: Queryable,
  actor: Actor,
  unreadOnly = false,
): Promise<Notification[]> {
  const unreadFlag = unreadOnly ? '1' : '';
  const rows = await sql<Row[]>`
    select id, event_type, entity_type, entity_id, deep_link, actor_employee_id,
           created_at, read_at
      from notifications
     where recipient_employee_id = ${actor.employeeId}
       and (${unreadFlag} = '' or read_at is null)
     order by id desc`;
  return rows.map(toNotification);
}

/**
 * unreadCount returns the actor's TOTAL unread count (Go `UnreadCount`) — it is
 * deliberately independent of the list filter, because the header badge shows
 * the same number whether or not the page is filtered.
 */
export async function unreadCount(sql: Queryable, actor: Actor): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*) as n
      from notifications
     where recipient_employee_id = ${actor.employeeId}
       and read_at is null`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * inbox composes the two reads Go's `handleListNotifications` performs, so the
 * route can serve `{ data, unread_count }` from one call (and, under
 * `readAsActor`, from one transaction — a consistent snapshot of both).
 */
export async function inbox(sql: Queryable, actor: Actor, unreadOnly = false): Promise<Inbox> {
  const [items, unread] = await Promise.all([list(sql, actor, unreadOnly), unreadCount(sql, actor)]);
  return { items, unreadCount: unread };
}

// ---------------------------------------------------------------------------
// The one permitted mutation
// ---------------------------------------------------------------------------

/** parseId validates a path id, mirroring Go's strconv.ParseInt gate. */
export function parseId(raw: string): string {
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new ValidationError();
  }
  return raw.trim();
}

/**
 * markRead acks ONE of the actor's own notifications (Go `MarkRead`).
 *
 * Idempotent and silent by design, exactly like Go: an id that does not exist,
 * belongs to someone else, or is already read updates zero rows and still
 * returns ok. That is not a swallowed error — a 404/403 here would tell a
 * caller whether another employee's notification id exists.
 *
 * Goes through the `mark_notification_read(p_id, p_recipient)` RPC, the single
 * UPDATE path onto `notifications` (migration 20260102000002). The recipient is
 * always the ACTOR: it is never taken from the request.
 */
export async function markRead(sql: Queryable, actor: Actor, id: string): Promise<void> {
  const notifId = parseId(id);
  await sql`select mark_notification_read(${notifId}::bigint, ${actor.employeeId})`;
}
