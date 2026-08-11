/**
 * GET /api/v1/strategi/{id}/diff — J-4 auto-diff vs the previous version
 * (§4 J-4, "Ringkasan perubahan vs versi sebelumnya").
 *
 * Computed on read (Rule 4: derived, never stored). A version 1 answers 200 with
 * `ada_perbandingan: false` rather than 404 — there is simply nothing to compare.
 * Internal only: RA-7 keeps every diff off the client link, and this route is
 * behind the same read permission as the Strategi itself.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiDiffToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(strategiDiffToWire(await strategi.strategiDiff(db(), actor, id)));
  });
}
