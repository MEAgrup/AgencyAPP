/**
 * POST /api/v1/briefs/{id}/request-revision — the AM sends a Brief under review
 * back to the division with mandatory feedback ([In Review] → [Revision
 * Requested], M6 §7). Owning AM or Director; on the 3rd revision the SPV flag
 * fires. Body: { feedback }. Ports Go's handleRequestBriefRevision.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ feedback?: string }>(request);
    return transitionResponse(await account.requestBriefRevision(db(), actor, id, b.feedback ?? ''));
  });
}
