/**
 * GET /api/v1/plan/{id}/rekap-rollup — RM-E read-only rollup (D-08): the closed
 * recaps linked to a Plan period consolidated into per-week + cumulative
 * evidence. NEVER writes plan_actual (GMV single-source; `gmv_interim` is
 * interim only). Scope-gated in the domain (`getPlanRekapRollup`: owning AM /
 * Account lead / read-all).
 *
 * The payload is the snake_case JSON that `wrr_plan_rollup(plan_id)` builds in
 * SQL — passed through verbatim, not a camelCase domain object, so this is not
 * the O43 shape.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(await recap.getPlanRekapRollup(db(), actor, id));
  });
}
