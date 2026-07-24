/**
 * POST /api/v1/complaints/{id}/start — move a Complaint [Open] → [In Progress]
 * (M6 §8 Rule 5). Owning AM, Account lead/SPV or Director. Ports Go's
 * handleStartComplaint.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await account.startComplaint(db(), actor, id));
  });
}
