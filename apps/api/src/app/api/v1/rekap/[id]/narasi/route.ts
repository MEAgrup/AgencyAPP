/**
 * PUT /api/v1/rekap/{id}/narasi — RM-D1/2/3/5 narrative + RM-C9 «Catatan Metrik
 * Tambahan» (text-only). Full-replace upsert: an omitted field becomes null,
 * never merged. Body keys: `yang_bergerak`, `yang_tertahan`, `fokus_minggu_depan`,
 * `bahan_untuk_klien`, `catatan_metrik_tambahan`. AM-writable while Terbuka.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapCatatanToWire, recapNarasiFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await recap.saveRecapNarasi(db(), actor, id, recapNarasiFromWire(b));
    return json(recapCatatanToWire(saved));
  });
}
