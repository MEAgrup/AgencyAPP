/**
 * POST /api/v1/assets/{id}/block-requests/{reqId}/approve — approve a pending
 * Asset block request, driving the Asset into [Blocked] and recomputing the Brief
 * roll-up (M12 §5.3a, SPV/Lead only). Ports Go's handleApproveAssetBlock.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, reqId } = await ctx.params;
    await task.approveAssetBlockRequest(db(), actor, id, reqId);
    return json({ id, request_id: reqId, status: 'approved' });
  });
}
