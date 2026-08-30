/**
 * POST /api/v1/clients/{id}/renewals/{rid}/decision — the superior's decision
 * (approve/reject) on a Pending Approval renewal/cross-sell request. Reject
 * requires a note. Lead/Director-only (enforced by the `renewal_request`
 * state machine's `require_lead` edges). Mirrors
 * `attempts/{id}/negotiation/decision`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; rid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rid } = await ctx.params;
    const body = await readJson<{ decision?: string; note?: string }>(request);
    const result = await renewal.decideRenewal(db(), actor, rid, body.decision ?? '', body.note ?? '');
    return transitionResponse(result);
  });
}
