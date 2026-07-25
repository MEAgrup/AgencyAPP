/** POST /api/v1/bookings/{id}/drop — terminally drop a Booking (M9 §5 Rule 4). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    return transitionResponse(await kol.drop(db(), actor, id, b.reason ?? ''));
  });
}
