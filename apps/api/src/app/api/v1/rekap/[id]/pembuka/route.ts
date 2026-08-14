/**
 * PUT /api/v1/rekap/{id}/pembuka — RM-A6 «Catatan Pembuka», the AM's opening
 * note. Writable only while the recap is Terbuka (domain `requireOpen`), by the
 * owning AM / Account lead / Director (`canWriteRecap`). Body: `{ catatan_pembuka }`.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapToWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ catatan_pembuka?: unknown }>(request);
    const catatanPembuka = b.catatan_pembuka === undefined || b.catatan_pembuka === null ? '' : String(b.catatan_pembuka);
    const saved = await recap.saveRecapPembuka(db(), actor, id, catatanPembuka);
    return json(recapToWire(saved));
  });
}
