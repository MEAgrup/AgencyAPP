/**
 * /api/v1/campaigns/{id}/metrics — periodic Metric Entries (M8 §5).
 *
 * POST: record one Metric Entry + refresh Attributed GMV (Ads staff/lead or
 * Director). Ports Go's handleLogMetricEntry.
 * GET: the campaign's Metric Entries in period order (view-gated). Ports Go's
 * handleListMetricEntries.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { metricEntryToWire, toMetricInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toMetricInput>[0]>(request);
    const m = await ads.logMetricEntry(db(), actor, id, toMetricInput(b));
    return json(metricEntryToWire(m));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await ads.listMetricEntries(db(), actor, id);
    return json({ data: rows.map(metricEntryToWire) });
  });
}
