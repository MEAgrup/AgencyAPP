/**
 * /api/v1/demo-tasks/{id} — fetch one demo task (GET), ported from Go's
 * handleGetDemoTask. NotFoundError → 404 via the shared error mapper.
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const task = await readAs(actor, (tx) => demo.get(tx, id));
    return json({ task });
  });
}
