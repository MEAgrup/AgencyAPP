/**
 * POST /api/v1/services/{id}/hold — T-2b / RM-2: the AM REQUESTS a hold
 * ([In Execution] → [Hold Requested]). Owning AM / Account lead / Director,
 * reason mandatory. Head of Account then approves/rejects (separate endpoints).
 * Notifies Head of Account. Incomplete → 400, Forbidden → 403, NotFound → 404,
 * wrong state → 409.
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
    await client.requestHold(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
