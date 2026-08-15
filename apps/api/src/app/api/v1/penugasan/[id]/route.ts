/**
 * GET /api/v1/penugasan/{id} — one Penugasan Internal, read-gated by canView
 * (mirror of `internal_tasks_select`). 404 (no such row) stays distinct from
 * 403 (exists, not yours).
 */
import { internaltask } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { internalTaskToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const t = await readAsActor(actor, (sql) => internaltask.getTask(sql, actor, id));
    return json(internalTaskToWire(t));
  });
}
