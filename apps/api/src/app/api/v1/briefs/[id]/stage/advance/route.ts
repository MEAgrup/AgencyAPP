/**
 * POST /api/v1/briefs/{id}/stage/advance — drives `production_stage` one edge
 * forward (M16 §2/STATE_MACHINES §18). Body: { to }. The CURRENT stage's
 * `gate_pihak` decides who may drive it out: `'AM'` restricts to the owning AM
 * (or Director); otherwise the normal division execute gate. Invalid edges are
 * blocked server-side (`sm_edges`), not just in the client.
 */
import { stage } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ to?: string }>(request);
    return transitionResponse(await stage.advanceStage(db(), actor, id, (b.to ?? '').trim()));
  });
}
