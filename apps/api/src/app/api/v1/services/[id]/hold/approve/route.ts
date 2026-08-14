/**
 * POST /api/v1/services/{id}/hold/approve — T-2b: Head of Account APPROVES a
 * hold request ([Hold Requested] → [On Hold]). Account lead / Director. Notifies
 * the owning AM. Forbidden → 403, NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await client.approveHold(db(), actor, id);
    return json({ ok: true });
  });
}
