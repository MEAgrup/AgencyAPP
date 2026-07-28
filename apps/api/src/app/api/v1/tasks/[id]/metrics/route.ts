/**
 * GET /api/v1/tasks/{id}/metrics — a Brief-as-task's computed metrics (M12 §5.1),
 * recomputed purely from the immutable transition log, if the actor may view it
 * (§6/§9.1 read gate). Ports Go's handleTaskMetrics.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { metricsToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const m = await readAsActor(actor, (sql) => task.taskMetrics(sql, actor, id));
    return json(metricsToWire(m));
  });
}
