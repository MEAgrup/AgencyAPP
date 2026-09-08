/**
 * POST /api/v1/assets/{id}/review — pulls a [Submitted] Asset into [In Review]
 * (M7 §4 Flow 3), which since B-4/K-1 is the INTERNAL QC pass: the executing
 * division's lead, the owning AM, or Director. Ports Go's handleReviewAsset.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await creative.reviewAsset(db(), actor, id));
  });
}
