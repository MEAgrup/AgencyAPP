/**
 * POST /api/v1/briefs/{id}/review — the AM pulls a [Submitted] Brief into
 * [In Review] (M6 §6 Rule 1). Owning AM or Director; a wrong-state edge → 409.
 * Ports Go's handleReviewBrief.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await account.reviewBrief(db(), actor, id));
  });
}
