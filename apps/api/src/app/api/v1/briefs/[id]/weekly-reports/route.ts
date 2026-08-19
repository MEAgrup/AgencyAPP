/**
 * GET  /api/v1/briefs/{id}/weekly-reports — every ISO week the Ads Brief-as-task
 *      has been worked, each with the six metrics RECOMPUTED from `metric_entries`
 *      (never stored) and the Advertiser's narrative, or the "belum diisi" gap.
 * POST /api/v1/briefs/{id}/weekly-reports — the PIC (or Ads lead / Director) files
 *      one week: analisa performa + saran perbaikan. Append-only.
 *
 * Follow-up PR #172 (keputusan pemilik 2026-08-19, DECISIONS.md): "adv bertugas
 * meningkatkan performa dan memberikan saran perbaikan setiap minggunya".
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { adsWeeklyReportToWire, adsWeeklyReportViewToWire, toAdsWeeklyReportInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const v = await ads.listWeeklyReports(db(), actor, id);
    return json(adsWeeklyReportViewToWire(v));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toAdsWeeklyReportInput>[0]>(request);
    const r = await ads.fileWeeklyReport(db(), actor, id, toAdsWeeklyReportInput(b));
    return json(adsWeeklyReportToWire(r));
  });
}
