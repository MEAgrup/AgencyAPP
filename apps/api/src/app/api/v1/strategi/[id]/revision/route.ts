/**
 * POST /api/v1/strategi/{id}/revision — open version n+1 in `Draft Revisi`.
 *
 * Rule 13 requires three things and the domain refuses without all of them: a
 * trigger from the H-2 list, a written reason, and which D-8 assumptions broke.
 * That triple is what makes the §9 metric ("% revisions with a declared trigger
 * + broken assumption", target 100%) measurable rather than aspirational.
 *
 * Version n keeps running as `Aktif` — it is archived only when n+1 is approved.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiRevisionFromWire, strategiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const created = await strategi.openRevision(db(), actor, id, strategiRevisionFromWire(b));
    return json(strategiToWire(created), 201);
  });
}
