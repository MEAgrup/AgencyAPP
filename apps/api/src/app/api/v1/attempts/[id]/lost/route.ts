/**
 * POST /api/v1/attempts/{id}/lost — drive an attempt to Closed-Lost (M0 §5).
 * Ports Go's handleMarkLost.
 *
 * The response is `{ status: 'Closed-Lost' }`, NOT the raw TransitionResult:
 * that is what Go writes (`module0_sales.StatusClosedLost`) and what the FE
 * contract pins as FINAL (`web-internal/src/lib/sales.ts` markLost →
 * `{ status: string }`). Rejected transitions keep the engine's mapping — the
 * verbatim BI message with 409, or 403 when the role is denied.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await sales.markLost(db(), actor, id);
    if (!result.ok) {
      return transitionResponse(result); // verbatim BI message → 409 / 403
    }
    return json({ status: sales.STATUS_CLOSED_LOST });
  });
}
