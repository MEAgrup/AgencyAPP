/**
 * /api/v1/performance/config/targets — M14 §2 Rule 2 / OA-2 / O9: the admin
 * period-target surface (normalisation basis for the raw-value components).
 *
 * GET: every configured target, newest-period first (read-gated by canScope).
 * Ports Go's handleListPerfTargets.
 *
 * PUT: upsert one period target (Director only; appended to the immutable
 * audit_log). Entering a real target sets is_placeholder=false (O9). period_start
 * "" applies to every period. Ports Go's handleSetPerfTarget.
 */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { perfTargetToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await readAsActor(actor, (sql) => performance.listTargets(sql, actor));
    return json({ data: list.map(perfTargetToWire) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{
      role_type?: string;
      component?: string;
      period_start?: string;
      target_value?: number;
      is_placeholder?: boolean;
    }>(request);
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
