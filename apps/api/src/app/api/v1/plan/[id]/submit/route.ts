/**
 * POST /api/v1/plan/{id}/submit — period 1 `Draft → Diajukan` (Rule 3).
 *
 * The `catatan_pembuka` completeness gate + the transition run inside one domain
 * transaction; this route only resolves the actor and hands the id across.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { planToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(planToWire(await plan.submitPlanPeriode(db(), actor, id)));
  });
}
