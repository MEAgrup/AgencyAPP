/**
 * POST /api/v1/tasks/{id}/submit — the division-side brief_task submit edge (M12 §3).
 * Ports Go's handleSubmitTask. Returns the transition result.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await task.submitTask(db(), actor, id));
  });
}
