/**
 * MEA SKU Screener — one screening_run (SC-08).
 *
 *  - GET /api/v1/skuscreener/runs/{id} — full run detail (payload + provenance), scope-gated.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { screeningRunDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const d = await skuscreener.getScreeningRun(db(), actor, id);
    return json(screeningRunDetailToWire(d));
  });
}
