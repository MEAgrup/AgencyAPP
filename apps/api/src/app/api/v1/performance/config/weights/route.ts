/** GET|PUT /api/v1/performance/config/weights — KPI Profile weights (M14 §5.2 / OA-5; PUT Director-only, Σ=100). */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { perfWeightToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await performance.listWeights(db(), actor);
    return json({ data: list.map(perfWeightToWire) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{ role_type?: string; weights?: Record<string, number> }>(request);
    await performance.setWeights(db(), actor, b.role_type ?? '', b.weights ?? {});
    return json({ ok: true });
  });
}
