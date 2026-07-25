/** POST /api/v1/bookings/{id}/submit-content — Booking edge with a content link (M9 §4/§5). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ content_link?: string }>(request);
    return transitionResponse(await kol.submitContent(db(), actor, id, b.content_link ?? ''));
  });
}
