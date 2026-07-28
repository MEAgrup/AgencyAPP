/**
 * POST /api/v1/notifications/{id}/read — ack ONE of the caller's notifications.
 * Same verb and path as Go's `POST /api/v1/notifications/{id}/read`.
 *
 * This is the ONLY mutation a notification ever gets (house rule §8: never
 * deletable, only read/unread) and it runs through the `mark_notification_read`
 * RPC, the single UPDATE path onto the table. Idempotent and silent, like Go: an
 * unknown id, someone else's id, or an already-read one all return 200 having
 * changed nothing — a 404/403 here would reveal whether another employee's
 * notification id exists.
 *
 * Write path ⇒ `db()` (service role); the recipient predicate is the ACTOR's
 * employee id, never a request value.
 */
import { notification } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await notification.markRead(db(), actor, id);
    return json({ status: 'ok' });
  });
}
