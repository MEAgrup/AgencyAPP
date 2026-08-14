/**
 * POST /api/v1/rekap/{id}/metrik/{metrik}/sengketa — RM-C «Sengketa Angka» on an
 * `otomatis` metric figure. The AM flags a wrong auto number instead of typing
 * over it; the figure is unchanged, a note is attached, and the SPV is notified
 * (`rekap_sengketa_angka`). Body: `{ alasan }`. Returns the refreshed bundle.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapDetailToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; metrik: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, metrik } = await ctx.params;
    const b = await readJson<{ alasan?: unknown }>(request);
    const alasan = b.alasan === undefined || b.alasan === null ? '' : String(b.alasan);
    await recap.fileRecapSengketaMetrik(db(), actor, id, metrik, alasan);
    return json(recapDetailToWire(await recap.getRecapDetail(db(), actor, id)));
  });
}
