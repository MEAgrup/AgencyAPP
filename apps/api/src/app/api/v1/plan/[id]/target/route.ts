/**
 * POST /api/v1/plan/{id}/target — adjust a Section P-B channel target (Rule 9).
 * The adjustment classifier (naik/turun/tetap, > 10% → SPV approval + evidence),
 * the reason/evidence gates and the pending-hold live in the domain; this route
 * carries the body across and shapes the response through `planTargetToWire`.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planTargetToWire } from '@/lib/wire';

interface AdjustBody {
  channel?: string;
  metric?: string;
  nilai_dipakai?: number;
  alasan?: string;
  bukti_file?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<AdjustBody>(request);
    const target = await plan.adjustPlanTarget(
      db(),
      actor,
      id,
      b.channel ?? '',
      b.metric ?? '',
      b.nilai_dipakai as number,
      { alasan: b.alasan, buktiFile: b.bukti_file },
    );
    return json(planTargetToWire(target));
  });
}
