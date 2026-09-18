/**
 * POST /api/v1/services/{id}/close/approve — O75: Director APPROVES a closure
 * request ([Closure Requested] → Done, terminal). Director only — narrower than
 * Hold's approve gate. Notifies the owning AM. Forbidden → 403, NotFound → 404,
 * wrong state or an active Brief not yet [Approved] → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await client.approveClosure(db(), actor, id);
    return json({ ok: true });
  });
}
