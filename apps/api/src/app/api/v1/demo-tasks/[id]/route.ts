/**
 * /api/v1/demo-tasks/{id} — fetch one demo task (GET), ported from Go's
 * handleGetDemoTask. NotFoundError → 404 via the shared error mapper.
 */
import { demo } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const task = await demo.get(db(), id);
    return json({ task });
  });
}
