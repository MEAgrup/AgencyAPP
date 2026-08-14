/**
 * POST /api/v1/rekap/{id}/divisi/{divisi}/sengketa — RM-B6 «Sengketa Angka» on a
 * division production headline (e.g. # video Creative claims). Attaches a note,
 * does not change the count, notifies the SPV. Body: `{ alasan }`. Returns the
 * refreshed bundle.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapDetailToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; divisi: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, divisi } = await ctx.params;
    const b = await readJson<{ alasan?: unknown }>(request);
    const alasan = b.alasan === undefined || b.alasan === null ? '' : String(b.alasan);
    await recap.fileRecapSengketaDivisi(db(), actor, id, decodeURIComponent(divisi), alasan);
    return json(recapDetailToWire(await recap.getRecapDetail(db(), actor, id)));
  });
}
