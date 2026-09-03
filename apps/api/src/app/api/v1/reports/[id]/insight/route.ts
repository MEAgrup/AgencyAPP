/**
 * GET/PUT /api/v1/reports/{id}/insight — the report's NARRATIVE.
 *
 * The report's numbers are immutable (`client_reports.payload`, frozen trigger);
 * its prose is not. This is the only write surface for that prose, and it is
 * deliberately separate from publication: a PUT appends a revision and changes
 * nothing the client sees until `POST publish`/`republish` moves the pin.
 *
 * There is NO PATCH. A partial insight is not a thing — the six fields are one
 * narrative, and merging half of a new one into half of an old one produces text
 * no author wrote.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { errorJson, handle, json, readJson } from '@/lib/http';
import { reportInsightBundleToWire, toInsightDraft, type InsightDraftBody } from '@/lib/wire';

function idOf(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = idOf(id);
    if (reportId === null) return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    const bundle = await readAsActor(actor, (sql) => report.getReportInsight(sql, actor, reportId));
    return json(reportInsightBundleToWire(bundle));
  });
}

interface Body extends InsightDraftBody {
  catatan_revisi?: string | null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = idOf(id);
    if (reportId === null) return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    const b = await readJson<Body>(request);
    const bundle = await report.saveReportInsight(db(), actor, reportId, toInsightDraft(b), b.catatan_revisi ?? null);
    return json(reportInsightBundleToWire(bundle));
  });
}
