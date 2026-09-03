/**
 * POST /api/v1/reports/{id}/republish — move the pin to the newest revision.
 *
 * A separate verb from `publish` on purpose: the status does not change, only
 * WHICH text the client reads. Refuses when there is nothing newer than the
 * pinned revision, so the button cannot be used to fake an update.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json } from '@/lib/http';
import { reportPublikasiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    return json(reportPublikasiToWire(await report.republishReport(db(), actor, reportId)));
  });
}
