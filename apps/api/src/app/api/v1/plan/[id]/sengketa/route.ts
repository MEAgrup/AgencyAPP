/**
 * POST /api/v1/plan/{id}/sengketa — file a Sengketa Angka (PE-6): an AM's written
 * dispute against an AUTO metric, which notifies the SPV. The auto-only rule and
 * the mandatory reason are enforced in the domain (`fileSengketa`).
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planActualToWire } from '@/lib/wire';

interface SengketaBody {
  channel?: string;
  metric?: string;
  alasan?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<SengketaBody>(request);
    const actual = await plan.fileSengketa(db(), actor, id, b.channel ?? '', b.metric ?? '', b.alasan ?? '');
    return json(planActualToWire(actual));
  });
}
