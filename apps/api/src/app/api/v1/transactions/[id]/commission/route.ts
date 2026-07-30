/**
 * GET /api/v1/transactions/{id}/commission — M0 §5 commission achievement,
 * recognized on the actually-verified amount (M5 Amount Verified) and split by
 * the Sales Allocation snapshot. Pure derived read-model. NotFound → 404.
 *
 * ⚠️ O43 residue — the body is the RAW camelCase read model, deliberately:
 * Go has NO `handleGetCommissionAchievement` (an earlier comment here claimed it
 * did; it does not exist), and `web-internal` calls this path from nowhere. With
 * neither an oracle nor a consumer, picking snake_case names now would be
 * inventing a contract the PRD never defined. Whoever builds the first page
 * against this endpoint owns adding the `*ToWire` mapper — do not assume the
 * shape below is the agreed wire format.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const commission = await readAsActor(actor, (sql) => finance.commissionAchievement(sql, id));
    return json({ commission });
  });
}
