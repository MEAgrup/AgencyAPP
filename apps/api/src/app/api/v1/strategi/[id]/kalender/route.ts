/**
 * PUT /api/v1/strategi/{id}/kalender — the whole of Section G except G-0:
 * G-1 work phases · G-2 big dates · G-3 client review cadence · G-4 internal
 * review cadence.
 *
 * G-0 (`tanggal_mulai_siklus`) stays on the header endpoint because Rule 17
 * locks it once period 1 closes — it is not editable on the same terms as the
 * rest of Section G, and giving it the same door would invite it being cleared
 * by an autosave of the phases beside it.
 *
 * The four sub-fields save together because Section G is one screen and one
 * autosave (§7). A partial body is legal; the submit gate reports `G-1`, `G-2`,
 * `G-3` and `G-4` individually.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiKalenderFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveKalender(db(), actor, id, strategiKalenderFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
