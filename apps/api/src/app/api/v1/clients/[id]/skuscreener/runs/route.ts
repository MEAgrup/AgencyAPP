/**
 * MEA SKU Screener — screening_run listing (SC-08).
 *
 *  - GET /api/v1/clients/{id}/skuscreener/runs — the client's screening/
 *    perbandingan runs, newest first. `?jenis=screening|perbandingan` filters.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { screeningRunSummaryToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const jenisParam = url.searchParams.get('jenis');
    const jenis = jenisParam === 'screening' || jenisParam === 'perbandingan' ? jenisParam : undefined;
    const rows = await skuscreener.listScreeningRuns(db(), actor, id, jenis);
    return json({ data: rows.map(screeningRunSummaryToWire) });
  });
}
