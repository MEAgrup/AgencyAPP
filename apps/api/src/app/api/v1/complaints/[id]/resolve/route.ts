/**
 * POST /api/v1/complaints/{id}/resolve — move a Complaint [In Progress] →
 * [Resolved] (M6 §8 Rule 5). Resolution notes mandatory. Owning AM, Account
 * lead/SPV or Director. Body: { notes }. Ports Go's handleResolveComplaint.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ notes?: string }>(request);
    return transitionResponse(await account.resolveComplaint(db(), actor, id, b.notes ?? ''));
  });
}
