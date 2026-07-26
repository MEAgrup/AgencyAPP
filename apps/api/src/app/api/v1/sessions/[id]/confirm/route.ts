/**
 * POST /api/v1/sessions/{id}/confirm — [Requested] → [Confirmed by Vendor] (M10 §3
 * Rule 3): the AM records the vendor accepting the schedule. Owning AM / Director.
 * Ports Go's handleConfirmByVendor.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await livestream.confirmByVendor(db(), actor, id);
    return transitionResponse(result);
  });
}
