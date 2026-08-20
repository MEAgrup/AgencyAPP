/**
 * GET /api/v1/contracts/{id}/plans — every Plan period of a full-management
 * contract, ordered by period number (Section P-A / Rule 1).
 *
 * The navigation a Strategi needs into its generated Plan skeleton: on Strategi
 * approval `generatePlanPeriods` mints one `plan` row per contract month, but
 * there was no way to list them. Header rows only (`planToWire`), so a strategy
 * can render "Periode 1…n" links without pulling every child block. Read scope
 * is enforced in the domain (`listPlansForContract`).
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { planToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const plans = await plan.listPlansForContract(db(), actor, id);
    return json(plans.map(planToWire));
  });
}
