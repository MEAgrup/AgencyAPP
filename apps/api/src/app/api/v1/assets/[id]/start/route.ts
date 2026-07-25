/**
 * POST /api/v1/assets/{id}/start — the Asset's division-side brief_task start edge
 * (M12 §3 / M7 §4). Ports Go's startAsset. Returns the transition result.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await task.startAsset(db(), actor, id));
  });
}
