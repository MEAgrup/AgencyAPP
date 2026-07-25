/**
 * POST /api/v1/strategies/{id}/approve — approve a submitted Plan (M6 §4 Rule 4).
 * Account lead / Director only. Flips the STR- to [Strategy Approved] AND drives
 * the parent Service [Awaiting Onboarding] → [Strategy Approved] in one
 * transaction; records Approved By. An invalid edge → 409 (nothing moves). Ports
 * Go's handleApproveStrategy.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await account.approveStrategy(db(), actor, id);
    return json({ id, status: account.STRATEGY_STATUS_APPROVED });
  });
}
