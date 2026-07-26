/**
 * POST /api/v1/sessions/{id}/reconcile — → [Reconciled] (terminal, M10 §4 Rule 3):
 * the AM closes the requested-vs-actual review with a match, from [Completed] or
 * from [Discrepancy Flagged]. When every Session of the Brief is reconciled the
 * off-machine Brief closes to [Approved]. Owning AM / Director. Ports Go's
 * handleReconcile.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await livestream.reconcile(db(), actor, id);
    return transitionResponse(result);
  });
}
