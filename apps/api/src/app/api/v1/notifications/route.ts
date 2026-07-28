/**
 * GET /api/v1/notifications — the in-app inbox (Phase 0 v2 §9). Returns the
 * caller's own notifications newest-first plus their TOTAL unread count, in the
 * `{ data, unread_count }` envelope web-internal's `NotificationsResponse`
 * expects. `?unread=1` narrows the list only; the count stays total, because the
 * header badge shows the same number on either view.
 *
 * Ports Go's handleListNotifications. Read path ⇒ `readAsActor`, so the
 * `notifications_select` policy (recipient-only, not even Director/OD) runs and
 * both queries see one consistent snapshot inside a single transaction.
 */
import { notification } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { inboxToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const unreadOnly = new URL(request.url).searchParams.get('unread') === '1';
    const inbox = await readAsActor(actor, (sql) => notification.inbox(sql, actor, unreadOnly));
    return json(inboxToWire(inbox));
  });
}
