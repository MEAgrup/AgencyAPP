/**
 * POST /api/v1/strategies/{id}/request-revision — send a submitted Plan back to
 * [Strategy Drafting] (M6 §4 Rule 4). Account lead / Director only; revision
 * notes mandatory. The revision count derives from the audit log. Body: { notes }.
 * Ports Go's handleRequestStrategyRevision.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ notes?: string }>(request);
    await account.requestRevision(db(), actor, id, b.notes ?? '');
    return json({ id, status: account.STRATEGY_STATUS_DRAFTING });
  });
}
