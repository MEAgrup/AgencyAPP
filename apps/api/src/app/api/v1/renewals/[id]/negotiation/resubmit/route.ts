/**
 * POST /api/v1/renewals/{id}/negotiation/resubmit — a fresh proposal version
 * after a Revision Required or Rejected renewal (R-03), back to Negotiation -
 * Pending Approval. Mirrors `/attempts/{id}/negotiation/resubmit`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';
import { toProposalLines, type ProposalLineBody } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ lines?: ProposalLineBody[] }>(request);
    const result = await renewal.resubmitRenewalNegotiation(db(), actor, id, toProposalLines(body.lines));
    return transitionResponse(result);
  });
}
