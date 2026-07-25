/**
 * POST /api/v1/tasks/{id}/sla — set a Brief-as-task's SLA Target in hours (M12
 * §2 Rule 10, §5.3). Target division Lead/SPV or Director; must be > 0. Body:
 * { hours }. Ports Go's handleSetTaskSLA.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ hours?: number }>(request);
    await task.setSlaTarget(db(), actor, id, b.hours ?? 0);
    return json({ id, sla_target_hours: b.hours ?? 0 });
  });
}
