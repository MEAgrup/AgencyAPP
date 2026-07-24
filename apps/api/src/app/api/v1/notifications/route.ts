/**
 * GET /api/v1/notifications[?unread=1] — the signed-in employee's in-app inbox
 * (house convention #8). Returns their notifications newest-first plus the
 * unread total for the header bell badge; `?unread=1` narrows the rows to unread
 * only (the count stays the full unread total). Own inbox only — the domain
 * scopes every read to recipient_employee_id = actor (Phase 0 §4).
 */
import { notifications } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { notificationRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const unreadOnly = new URL(request.url).searchParams.get('unread') === '1';
    const inbox = await notifications.list(db(), actor, unreadOnly);
    return json({ data: inbox.rows.map(notificationRowToWire), unread_count: inbox.unreadCount });
  });
}
