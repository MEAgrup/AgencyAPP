/**
 * POST /api/v1/reports/{id}/publish — `[Draf]`/`[Dicabut]` → `[Terbit]`.
 *
 * Pins the latest insight revision as it publishes: from here the client reads
 * THAT revision and nothing later, until `republish` moves the pin. Per owner
 * decision 2026-09-08 there is no review gate — the owning AM (or an Account
 * lead / Director) publishes directly.
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
    return json(reportPublikasiToWire(await report.publishReport(db(), actor, reportId)));
  });
}
