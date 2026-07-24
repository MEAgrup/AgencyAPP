/**
 * POST /api/v1/attempts/{id}/negotiation — open the negotiation from a Qualified
 * attempt (M0 §5). `no_negotiation: true` takes standard terms to Auto Approved;
 * otherwise the custom `lines` are versioned and routed to the superior. Ports
 * Go's handleSubmitNegotiation.
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

function toLines(rows: LineBody[] | undefined): sales.ProposalLine[] {
  return (rows ?? []).map((l) => ({
    masterServiceId: l.master_service_id ?? '',
    proposedPrice: l.proposed_price ?? '',
    commissionRule: l.commission_rule ?? '',
    paymentTerms: l.payment_terms,
  }));
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ no_negotiation?: boolean; lines?: LineBody[] }>(request);
    const result = await sales.submitNegotiation(db(), actor, id, toLines(body.lines), body.no_negotiation === true);
    return transitionResponse(result);
  });
}
