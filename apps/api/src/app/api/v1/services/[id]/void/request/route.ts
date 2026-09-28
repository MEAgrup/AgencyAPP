/**
 * POST /api/v1/services/{id}/void/request — T-2d: staff REQUESTS a void
 * ([In Execution] → [Void Requested] or [On Hold] → [Void Requested]). Owning
 * AM / Account lead / Director, reason mandatory. Head of Account then
 * approves/rejects (separate endpoints). Notifies Head of Account. A Service
 * in neither origin state → 409. Incomplete → 400, Forbidden → 403,
 * NotFound → 404.
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
    await client.requestVoid(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
