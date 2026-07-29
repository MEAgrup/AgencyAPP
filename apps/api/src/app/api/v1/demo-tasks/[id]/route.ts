/**
 * /api/v1/demo-tasks/{id} — fetch one demo task (GET), ported from Go's
 * handleGetDemoTask, including its full envelope: the task, the engine's legal
 * next moves, and the entity's audit trail. The detail page destructures all
 * three and reads `allowed_transitions.length` / `findPendingBlockRequest(audit)`
 * straight away, so a `{task}`-only body crashed it.
 *
 * NotFoundError → 404 via the shared error mapper.
 */
import { audit, demo, engine } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { demoTaskDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const detail = await readAsActor(actor, async (sql) => {
      const task = await demo.get(sql, id);
      return {
        task,
        allowed: await engine.allowedTransitions(sql, demo.DEMO_MACHINE, task.status),
        trail: await audit.auditTrail(sql, { entityType: 'demo_task', entityId: id }),
      };
    });
    return json(demoTaskDetailToWire(detail.task, detail.allowed, detail.trail));
  });
}
