/**
 * POST /api/v1/briefs/{id}/approve — the AM approves a Brief under review
 * ([In Review] → [Approved], M6 §6 Flow 3). Owning AM or Director. Ports Go's
 * handleApproveBrief.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await account.approveBrief(db(), actor, id));
  });
}
