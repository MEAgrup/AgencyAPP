/**
 * POST /api/v1/interview/{id}/riset-awal — submit **Riset Awal**, langkah 1 of
 * "Kelola Klien" (owner QA 2026-08-12).
 *
 * The step starts on its own the moment the AM opens Kelola Klien (the row is
 * created with the interview), so this route only records the END of it. The
 * duration is derived from the two anchors on read — nothing here accepts a
 * duration, and there is no field that could carry one.
 *
 * A second submit is a 409, not a silent no-op: the finish line does not move.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { interviewRisetAwalToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const r = await interview.submitRisetAwal(db(), actor, id);
    return json(interviewRisetAwalToWire(r));
  });
}
