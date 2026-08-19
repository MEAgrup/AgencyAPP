/**
 * GET /api/v1/reports/{id}/html?mode=klien|internal — the report rendered as a
 * standalone HTML document, scope-gated in the domain (`renderReport`).
 *
 * `internal` carries MEA's audit blocks (budget burn, dead broadcast hours,
 * creators to drop, per-dimension score notes); `klien` OMITS them — the
 * renderer never builds the string, so nothing internal sits in the View Source
 * of a file a client can forward. Default is `klien` (the safe forward).
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    }
    const mode = new URL(request.url).searchParams.get('mode') === 'internal' ? 'internal' : 'klien';
    const body = await report.renderReport(db(), actor, reportId, mode);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
}
