/**
 * POST /api/v1/assets/{id}/rework — the Asset's division-side brief_task rework edge
 * (M12 §3 / M7 §4). Ports Go's reworkAsset. Returns the transition result.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await task.reworkAsset(db(), actor, id));
  });
}
