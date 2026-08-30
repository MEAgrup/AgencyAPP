/**
 * POST /api/v1/renewals/{id}/negotiation/accept — the salesperson accepts the
 * superior's counter-offer on a renewal (R-03): Negotiation - Revision
 * Required → Negotiation - Approved. Mirrors `/attempts/{id}/negotiation/accept`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await renewal.acceptRenewalCounter(db(), actor, id);
    return transitionResponse(result);
  });
}
