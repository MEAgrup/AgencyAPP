/** POST /api/v1/bookings/{id}/escalate — Booking QC edge with mandatory notes (M9 §5). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ qc_notes?: string }>(request);
    return transitionResponse(await kol.escalate(db(), actor, id, b.qc_notes ?? ''));
  });
}
