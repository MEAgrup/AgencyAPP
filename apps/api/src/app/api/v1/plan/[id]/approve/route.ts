/**
 * POST /api/v1/plan/{id}/approve — period 1 `Diajukan → Aktif` (Rule 3): the
 * SPV / Head of Account approval that switches the Plan mechanism on for the
 * whole contract. The Account-lead gate is enforced in the domain.
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
    return json(planToWire(await plan.approvePlanPeriode(db(), actor, id)));
  });
}
