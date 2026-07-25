/**
 * POST /api/v1/assets/{id}/submit — the Asset [In Progress] → [Submitted] (M7 §4
 * Rule 3). Requires an output link. Body: { output_link }. Ports Go's SubmitAsset.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ output_link?: string }>(request);
    return transitionResponse(await task.submitAsset(db(), actor, id, b.output_link ?? ''));
  });
}
