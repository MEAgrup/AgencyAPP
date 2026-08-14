/**
 * GET /api/v1/rekap/{id} — the whole M6D Rekap Hasil Mingguan bundle (header +
 * per-division production + metric rows + narrative + division notes).
 *
 * One GET rather than a call per block: the detail page (D-10) renders every
 * section at once. Scope is enforced in the domain (`canReadRecap`): the owning
 * AM / Account lead / OD+Director / the lead of a division that touched the
 * client this week (RM-D6 read arm, O48).
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { recapDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(recapDetailToWire(await recap.getRecapDetail(db(), actor, id)));
  });
}
