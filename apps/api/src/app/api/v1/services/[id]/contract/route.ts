/**
 * DELETE /api/v1/services/{id}/contract — take a Service out of its agreement.
 *
 * Keyed by Service rather than by contract because that is the screen it is
 * invoked from, and because a Service belongs to at most one agreement — the
 * id is enough to name the pair. Refused while a Strategi exists for the
 * agreement: it was approved over a specific set of Services.
 */
import { contract } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await contract.detachService(db(), actor, id);
    return json({ ok: true });
  });
}
