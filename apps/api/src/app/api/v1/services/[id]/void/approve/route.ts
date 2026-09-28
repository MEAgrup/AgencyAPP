/**
 * POST /api/v1/services/{id}/void/approve — T-2d: Head of Account APPROVES a
 * void request ([Void Requested] → [Cancelled — Service Voided]). Account
 * lead / Director. Cascade-cancels child Briefs not yet [Approved] (same
 * cascade the old instant void ran); notifies the owning AM. Forbidden → 403,
 * NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { voidResultToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await client.approveVoid(db(), actor, id);
    return json(voidResultToWire(result));
  });
}
