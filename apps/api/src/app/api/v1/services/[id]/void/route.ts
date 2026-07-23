/**
 * POST /api/v1/services/{id}/void — M4-OA-5: void a Service (SPV/Account Lead or
 * Director, reason mandatory) and cascade-cancel its child Briefs not yet
 * [Approved]. The Transaction total stays immutable; the voided Service is
 * excluded from commission achievement. Ports Go's handleVoidService.
 * Incomplete → 400, Forbidden → 403, NotFound → 404, LockedField (already
 * voided/done) → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    const result = await client.voidService(db(), actor, id, b.reason ?? '');
    return json(result);
  });
}
