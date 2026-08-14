/**
 * PUT /api/v1/rekap/{id}/metrik/{metrik} — RM-C manual fallback for a non-auto
 * metric (`total_view` / `ctr` / `cvr`): a sourced manual figure, or `—`
 * (tidak_tersedia) when `nilai` is null. A manual figure requires `file_bukti`
 * + `tanggal_ambil` (RM-C7). An `otomatis` figure can never be overwritten this
 * way — only disputed (see `/sengketa`). Body: `{ nilai, file_bukti, tanggal_ambil }`.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapMetrikManualFromWire, recapMetrikToWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string; metrik: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, metrik } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await recap.recordRecapMetrikManual(db(), actor, id, metrik, recapMetrikManualFromWire(b));
    return json(recapMetrikToWire(saved));
  });
}
