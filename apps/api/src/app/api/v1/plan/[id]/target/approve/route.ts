/**
 * POST /api/v1/plan/{id}/target/approve — SPV approves a pending `Turun >10%`
 * target-adjustment request (PH-3): the reduced figure stands. It does NOT
 * activate the period (the 00:00 WIB job does). SPV / Head of Account gate is
 * enforced in the domain.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planTargetToWire } from '@/lib/wire';

interface ApproveTargetBody {
  channel?: string;
  metric?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<ApproveTargetBody>(request);
    const target = await plan.approveTargetAdjustment(db(), actor, id, b.channel ?? '', b.metric ?? '');
    return json(planTargetToWire(target));
  });
}
