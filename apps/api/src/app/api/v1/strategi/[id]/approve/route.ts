/**
 * POST /api/v1/strategi/{id}/approve — `Diajukan` → `Aktif` (Rule 12).
 *
 * Approving version n+1 archives version n in the same transaction (Rule 13) —
 * the active version never disappears mid-revision, and never doubles either.
 *
 * Since A-3 (2026-09-07, STATE_MACHINES §6b) this ALSO moves every plan-gated
 * Service on the contract from `[Awaiting Onboarding]` to `[Strategy Approved]`
 * in the same transaction, unlocking Brief dispatch — see
 * `driveServicesToStrategyApproved` in the `strategi` module.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(strategiToWire(await strategi.approveStrategi(db(), actor, id)));
  });
}
