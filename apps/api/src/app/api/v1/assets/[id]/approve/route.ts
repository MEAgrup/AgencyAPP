/**
 * POST /api/v1/assets/{id}/approve — the AM approves an Asset under review
 * ([In Review] → [Approved], M7 §4 Flow 3). When it is the last Asset, the Brief
 * roll-up reaches [Approved]. Owning AM or Director. Ports Go's handleApproveAsset.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await creative.approveAsset(db(), actor, id));
  });
}
