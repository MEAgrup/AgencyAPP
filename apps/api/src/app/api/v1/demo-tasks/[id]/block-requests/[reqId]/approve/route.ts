/**
 * /api/v1/demo-tasks/{id}/block-requests/{reqId}/approve — a division lead (or
 * Director) approves a pending block request (POST). Ported from Go's
 * handleApproveBlockRequest. Drives the task into [Blocked] via sm_transition
 * (SPV/Lead-only edge) and notifies the requester. A non-lead → 403; a rejected
 * transition surfaces the engine's BI message.
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; reqId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, reqId } = await ctx.params;
    const result = await demo.approveBlockRequest(db(), actor, id, reqId);
    return transitionResponse(result);
  });
}
