/**
 * POST /api/v1/notifications/{id}/read — mark one of the actor's own
 * notifications read (house convention #8: read_at is the only mutable field;
 * rows are never deletable). Scoped to recipient_employee_id = actor, so another
 * user's id matches nothing; idempotent on an already-read or unknown id.
 */
import { notifications } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    await notifications.markRead(db(), actor, id);
    return json({ status: 'ok' });
  });
}
