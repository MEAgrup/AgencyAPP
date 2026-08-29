/**
 * PUT /api/v1/plan/{id}/pembuka — PA-7 «Catatan Pembuka», the AM's opening note
 * for a period. Writable only while the period is Draft (domain status gate),
 * by the owning AM / Account lead / Director (`canWritePlan`). Body:
 * `{ catatan_pembuka }`.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planToWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ catatan_pembuka?: unknown }>(request);
    const catatanPembuka = b.catatan_pembuka === undefined || b.catatan_pembuka === null ? '' : String(b.catatan_pembuka);
    const saved = await plan.saveCatatanPembuka(db(), actor, id, catatanPembuka);
    return json(planToWire(saved));
  });
}
