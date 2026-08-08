/**
 * PUT /api/v1/strategi/{id}/kpi — Section D-5 (definisi berhasil 30/60/90) + D-6
 * (leading indicator mingguan, maks 5).
 *
 * A partial body is legal, unlike the replace-set sections: §7 asks for a 20s
 * autosave and §5 step 5 for a live "kekurangan" count, and both need a
 * half-filled Section D to be storable. Presence is a submit-gate concern
 * (`GET /strategi/{id}/kekurangan` reports `D-5` / `D-6`).
 *
 * D-3 has no endpoint on purpose — it is derived from D-2 (X-11) and arrives in
 * the detail body as `komposisi_kontribusi`.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiKpiFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveKpi(db(), actor, id, strategiKpiFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
