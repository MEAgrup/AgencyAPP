/**
 * POST /api/v1/reports/{id}/insight/reset — bring back the engine's narrative.
 *
 * Appends a NEW revision that copies revisi 0, rather than deleting the AM's
 * edits: the edit stays on file (the table is append-only) and the client keeps
 * reading whatever is pinned until someone publishes.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json } from '@/lib/http';
import { reportInsightBundleToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    const bundle = await report.resetReportInsight(db(), actor, reportId);
    return json(reportInsightBundleToWire(bundle));
  });
}
