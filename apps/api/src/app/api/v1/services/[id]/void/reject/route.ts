/**
 * POST /api/v1/services/{id}/void/reject — T-2d: Head of Account REJECTS a
 * void request ([Void Requested] → whichever of [In Execution] / [On Hold] it
 * came from — recovered from the audit log, see `client.rejectVoid`). Account
 * lead / Director. Notifies the owning AM. Forbidden → 403, NotFound → 404,
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
    await client.rejectVoid(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
