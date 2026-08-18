/**
 * POST /api/v1/plan/{id}/activate — periods 2…n `Terjadwal → Aktif`. The same
 * move the 00:00 WIB sweep drives; here the owning AM / lead triggers it. The
 * ownership gate and the weekly-distribution derivation happen in the domain.
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
    return json(planToWire(await plan.activatePlanPeriode(db(), actor, id)));
  });
}
