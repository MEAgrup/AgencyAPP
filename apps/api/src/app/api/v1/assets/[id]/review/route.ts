/**
 * POST /api/v1/assets/{id}/review — the AM pulls a [Submitted] Asset into [In
 * Review] (M7 §4 Flow 3). Owning AM or Director. Ports Go's handleReviewAsset.
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
