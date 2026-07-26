/**
 * GET /api/v1/dependencies/{id} — one M11 Dependency with its derived status, if
 * the actor may see the underlying Client (§5.3). Ports Go's handleGetDependency.
 */
import { board } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { dependencyToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const dep = await board.getDependency(db(), actor, id);
    return json(dependencyToWire(dep));
  });
}
