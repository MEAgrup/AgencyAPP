/**
 * POST /api/v1/strategies/{id}/submit — move the Plan [Strategy Drafting] →
 * [Strategy Submitted for Approval] (M6 §4 Rule 3). Owning AM (or Director).
 * Driven through the transition engine; an invalid edge → 409 (nothing written).
 * Ports Go's handleSubmitStrategy.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await account.submitStrategy(db(), actor, id);
    return transitionResponse(result);
  });
}
