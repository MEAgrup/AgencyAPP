/**
 * POST /api/v1/attempts/{id}/negotiation/resubmit — send a fresh proposal version
 * after a Revision Required or Reject (M0 §5), back to Pending Approval. Ports
 * Go's handleResubmitNegotiation.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

interface LineBody {
  master_service_id?: string;
  proposed_price?: string;
  commission_rule?: string;
  payment_terms?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ lines?: LineBody[] }>(request);
    const lines: sales.ProposalLine[] = (body.lines ?? []).map((l) => ({
      masterServiceId: l.master_service_id ?? '',
      proposedPrice: l.proposed_price ?? '',
      commissionRule: l.commission_rule ?? '',
      paymentTerms: l.payment_terms,
    }));
    const result = await sales.resubmitNegotiation(db(), actor, id, lines);
    return transitionResponse(result);
  });
}
