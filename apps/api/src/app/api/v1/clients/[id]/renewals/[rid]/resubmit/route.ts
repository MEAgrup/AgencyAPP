/**
 * POST /api/v1/clients/{id}/renewals/{rid}/resubmit — after a Reject, send a
 * fresh priced line set back to Pending Approval (same `RNW-`, new proposal
 * version). Mirrors `attempts/{id}/negotiation/resubmit`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';
import { toProposalLines, type ProposalLineBody } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; rid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rid } = await ctx.params;
    const body = await readJson<{ lines?: ProposalLineBody[] }>(request);
    const result = await renewal.resubmitRenewal(db(), actor, rid, toProposalLines(body.lines));
    return transitionResponse(result);
  });
}
