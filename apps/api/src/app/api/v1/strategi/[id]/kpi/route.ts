/**
 * PUT /api/v1/strategi/{id}/kpi — Section D-5 (definisi berhasil 30/60/90) +
 * D-6 (leading indicator mingguan).
 *
 * One endpoint for both because they answer one question together — what good
 * looks like, and what gets watched weekly to know. Splitting them would turn
 * one form action into two audit rows nobody can pair back up.
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
