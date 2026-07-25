/**
 * POST /api/v1/assets/{id}/request-revision — the AM sends an Asset under review
 * back to the PIC with mandatory feedback ([In Review] → [Revision Requested],
 * M7 §6 Rule 1). Owning AM or Director; the 3rd revision flags the Team Leader.
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
