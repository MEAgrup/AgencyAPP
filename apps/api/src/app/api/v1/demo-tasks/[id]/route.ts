/**
 * /api/v1/demo-tasks/{id} — fetch one demo task (GET), ported from Go's
 * handleGetDemoTask. NotFoundError → 404 via the shared error mapper.
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const task = await readAsActor(actor, (sql) => demo.get(sql, id));
    return json({ task });
  });
}
