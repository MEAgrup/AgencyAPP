/**
 * GET /api/v1/sessions/{id} — read one Live Stream Session (M10 §6.1). Read gate =
 * OD/Director + Account lead/SPV (division-wide) + owning AM. Ports Go's
 * handleGetSession. Forbidden → 403, NotFound → 404.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const session = await livestream.getSession(db(), actor, id);
    return json(session);
  });
}
