/**
 * POST /api/v1/complaints/{id}/close — move a Complaint [Resolved] → [Closed]
 * (M6 §8 Rule 5, the AM confirms the client is satisfied). Owning AM, Account
 * lead/SPV or Director. Ports Go's handleCloseComplaint.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await account.closeComplaint(db(), actor, id));
  });
}
