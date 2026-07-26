/** GET|PUT /api/v1/performance/config/targets — normalisation period targets (M14 §2 Rule 2 / O9; PUT Director-only). */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { perfTargetToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await performance.listTargets(db(), actor);
    return json({ data: list.map(perfTargetToWire) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{ role_type?: string; component?: string; period_start?: string; target_value?: number; is_placeholder?: boolean }>(request);
    await performance.setTarget(db(), actor, {
      roleType: b.role_type ?? '',
      component: b.component ?? '',
      periodStart: b.period_start ?? '',
      targetValue: b.target_value ?? 0,
      isPlaceholder: b.is_placeholder ?? false,
    });
    return json({ ok: true });
  });
}
