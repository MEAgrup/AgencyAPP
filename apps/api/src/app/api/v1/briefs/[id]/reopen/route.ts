/**
 * POST /api/v1/briefs/{id}/reopen — reopen an [Approved] Live Stream Brief back to
 * [Dispatched to Vendor] to add Sessions (M10-OA-4 / DECISIONS O27 / W2-M10-C2).
 * Owning AM or Director only. Ports Go's handleReopenBrief.
 *
 * Forbidden → 403, NotFound → 404, Conflict (wrong division / voided / not
 * reopenable) → 409.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await livestream.reopenBrief(db(), actor, id);
    return json({ id, status: livestream.BRIEF_VENDOR_DISPATCHED });
  });
}
