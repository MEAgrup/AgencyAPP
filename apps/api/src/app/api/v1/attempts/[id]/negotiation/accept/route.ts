/**
 * POST /api/v1/attempts/{id}/negotiation/accept — the salesperson accepts the
 * superior's counter-offer (M0 §5): Revision Required → Approved. Owner-driven.
 * Ports Go's handleAcceptCounter.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const result = await sales.acceptCounter(db(), actor, id);
    if (!result.ok) return transitionResponse(result);
    return json({ status: result.to });
  });
}
