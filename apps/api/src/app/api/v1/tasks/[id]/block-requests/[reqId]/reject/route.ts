/**
 * POST /api/v1/tasks/{id}/block-requests/{reqId}/reject — reject a pending block
 * request without touching the Task status (M12 §5.3a, SPV/Lead only). Ports Go's
 * handleRejectTaskBlock.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, reqId } = await ctx.params;
    await task.rejectBlockRequest(db(), actor, id, reqId);
    return json({ id, request_id: reqId, status: 'rejected' });
  });
}
