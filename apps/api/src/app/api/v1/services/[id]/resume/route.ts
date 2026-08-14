/**
 * POST /api/v1/services/{id}/resume — T-2 / RM-2: put a Service [On Hold] →
 * [In Execution]. Same gate as hold (Head of Account / Director). Reason
 * optional. Forbidden → 403, NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    await client.resumeService(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
