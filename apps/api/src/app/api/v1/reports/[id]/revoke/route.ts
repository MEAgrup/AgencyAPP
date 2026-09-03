/**
 * POST /api/v1/reports/{id}/revoke — `[Terbit]` → `[Dicabut]`.
 *
 * The reason is mandatory: a client asking "where did my report go" deserves an
 * answer that exists somewhere. The pinned revision is KEPT as the record of
 * what they had already read; `status` is what stops them reading it.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json, readJson } from '@/lib/http';
import { reportPublikasiToWire } from '@/lib/wire';

interface Body { alasan?: string }

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) return errorJson(report.MSG_REPORT_NOT_FOUND, 404);
    const b = await readJson<Body>(request);
    return json(reportPublikasiToWire(await report.revokeReport(db(), actor, reportId, b.alasan ?? '')));
  });
}
