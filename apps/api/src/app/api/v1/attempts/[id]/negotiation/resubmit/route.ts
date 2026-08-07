/**
 * POST /api/v1/attempts/{id}/negotiation/resubmit — send a fresh proposal version
 * after a Revision Required or Reject (M0 §5), back to Pending Approval. Ports
 * Go's handleResubmitNegotiation.
 *
 * `lines` may add or drop services, not just re-price them (M0 §5 Flow 1: the
 * negotiation form carries the previously selected services PLUS additional ones
 * from the Master Service List). A line with an empty `proposed_price` is priced
 * server-side from the MSL — see `toProposalLines`.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';
import { toProposalLines, type ProposalLineBody } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ lines?: ProposalLineBody[] }>(request);
    const result = await sales.resubmitNegotiation(db(), actor, id, toProposalLines(body.lines));
    return transitionResponse(result);
  });
}
