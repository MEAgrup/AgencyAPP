/**
 * GET /api/v1/reports/{id} — one full report bundle (payload + provenance),
 * scope-gated in the domain (`getReport`): the owning AM / Account lead / OD /
 * Director. Returns the `ClientReportDetail` wire shape.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json } from '@/lib/http';
import { clientReportDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    }
    const d = await report.getReport(db(), actor, reportId);
    return json(clientReportDetailToWire(d));
  });
}
