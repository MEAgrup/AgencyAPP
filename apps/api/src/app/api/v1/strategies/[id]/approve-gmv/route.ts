/**
 * POST /api/v1/strategies/{id}/approve-gmv — clear a pending (out-of-tolerance)
 * GMV adjustment (QA revisi 2026-08-12). Account lead (SPV / Head of Account) or
 * Director only — the "ACC Head/SPV" gate. Audited; a Plan whose GMV is not
 * awaiting approval → 409.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await account.approveGmvAdjustment(db(), actor, id);
    return json({ id, gmv_adjustment_status: account.GMV_ADJ_APPROVED });
  });
}
