/**
 * POST /api/v1/services/{id}/close — O75: the Account/AM REQUESTS closure
 * ([In Execution] → [Closure Requested]). Owning AM / Account lead / Director,
 * reason mandatory. Director then approves/rejects (separate endpoints).
 * Notifies Directors. Incomplete → 400, Forbidden → 403, NotFound → 404,
 * wrong state or an active Brief not yet [Approved] → 409.
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
    await client.requestClosure(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
