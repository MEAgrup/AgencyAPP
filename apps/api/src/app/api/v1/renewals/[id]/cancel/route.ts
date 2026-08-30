/**
 * POST /api/v1/renewals/{id}/cancel — abandon a not-yet-closed renewal/
 * cross-sell request (R-03): Draft / Pending / Revision Required / Rejected →
 * Cancelled. No exit like this exists on `prospect_attempt` (there, "batal"
 * always routes through a lost lead) — see `renewal.ts` header comment.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await renewal.cancelRenewal(db(), actor, id);
    return transitionResponse(result);
  });
}
