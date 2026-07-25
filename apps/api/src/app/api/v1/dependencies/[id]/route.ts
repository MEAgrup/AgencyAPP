/** GET /api/v1/dependencies/{id} — one Dependency with its derived status (M11 §5.1). */
import { dependency } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { dependencyToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(dependencyToWire(await dependency.getDependency(db(), actor, id)));
  });
}
