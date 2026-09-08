/**
 * POST /api/v1/assets/{id}/request-revision — sends an Asset back to its PIC
 * with mandatory feedback (→ [Revision Requested], M7 §6 Rule 1).
 *
 * ONE route, TWO doors since B-4/K-1 — the Asset's current status decides whose
 * call it is, in the domain (`creative.requestAssetRevision`):
 *   from [In Review]  owning AM / Director — the client-side verdict, and the
 *                     only one counted toward Revision Count (3rd flags the lead);
 *   from [Submitted]  the executing division's LEAD — internal-QC reject.
 * Body: { feedback }. Ports Go's handleRequestAssetRevision.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ feedback?: string }>(request);
    return transitionResponse(await creative.requestAssetRevision(db(), actor, id, b.feedback ?? ''));
  });
}
