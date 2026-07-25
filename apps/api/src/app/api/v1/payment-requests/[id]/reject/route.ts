/** POST /api/v1/payment-requests/{id}/reject — Finance rejects a CPR with a reason (M9 §8 Rule 3). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    return transitionResponse(await kol.reject(db(), actor, id, b.reason ?? ''));
  });
}
