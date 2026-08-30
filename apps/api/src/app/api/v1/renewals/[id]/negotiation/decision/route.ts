/**
 * POST /api/v1/renewals/{id}/negotiation/decision — the superior's decision on
 * a Pending Approval renewal (R-03): approve / revise / reject. Revise &
 * reject require a mandatory note. Mirrors `/attempts/{id}/negotiation/decision`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ decision?: string; note?: string }>(request);
    const result = await renewal.decideRenewal(db(), actor, id, body.decision ?? '', body.note ?? '');
    return transitionResponse(result);
  });
}
