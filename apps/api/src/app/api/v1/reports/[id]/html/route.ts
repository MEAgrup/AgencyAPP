/**
 * GET /api/v1/reports/{id}/html?mode=klien|internal[&download=1] — the report
 * rendered as a standalone HTML document, scope-gated in the domain
 * (`renderReport`).
 *
 * `internal` carries MEA's audit blocks (budget burn, dead broadcast hours,
 * creators to drop, per-dimension score notes); `klien` OMITS them — the
 * renderer never builds the string, so nothing internal sits in the View Source
 * of a file a client can forward. Default is `klien` (the safe forward).
 *
 * ## `download=1`
 *
 * Without it the browser renders the document in a tab, which is what an AM
 * wants for a preview. With it the response carries `Content-Disposition:
 * attachment` and a real filename, which is what an AM wants when the next step
 * is attaching the file to an email — previously the panel's button said "Unduh"
 * and opened a tab, leaving the AM to Ctrl+S a file called `html.html`.
 *
 * The filename is derived SERVER-SIDE from the stored report (store, period,
 * mode), not passed in: the mode suffix is what tells an internal copy from a
 * client copy once the file is sitting in a downloads folder, and a caller-chosen
 * name could drop it.
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
    const q = new URL(request.url).searchParams;
    const mode = q.get('mode') === 'internal' ? 'internal' : 'klien';
    const { html, namaBerkas } = await report.renderReportForDownload(db(), actor, reportId, mode);
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    if (q.get('download') === '1') {
      // Both forms on purpose: the plain `filename` is what every browser reads,
      // and `filename*` (RFC 5987) preserves non-ASCII store names — MEA's client
      // list has plenty — instead of letting them be mangled or dropped.
      headers['content-disposition'] =
        `attachment; filename="${namaBerkas.replace(/[^\x20-\x7E]/g, '_')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(namaBerkas)}`;
    }
    return new Response(html, { status: 200, headers });
  });
}
