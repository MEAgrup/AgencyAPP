/**
 * /api/v1/performance/config/weights — M14 §5.2 / OA-5: the admin KPI-Profile
 * weights surface.
 *
 * GET: every configured (role_type, component) weight (read-gated: any CDPS actor
 * may inspect the profile definition). Ports Go's handleListPerfWeights.
 *
 * PUT: replace one role's full weight set (Σ=100 validated server-side; Director
 * only; appended to the immutable audit_log). Ports Go's handleSetPerfWeights.
 */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { perfWeightToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await readAsActor(actor, (sql) => performance.listWeights(sql, actor));
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
