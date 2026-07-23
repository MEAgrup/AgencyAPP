/**
 * GET /api/v1/transactions/{id}/commission — M0 §5 commission achievement,
 * recognized on the actually-verified amount (M5 Amount Verified) and split by
 * the Sales Allocation snapshot. Pure derived read-model. Ports Go's
 * handleGetCommissionAchievement. NotFound → 404.
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const commission = await finance.commissionAchievement(db(), id);
    return json({ commission });
  });
}
