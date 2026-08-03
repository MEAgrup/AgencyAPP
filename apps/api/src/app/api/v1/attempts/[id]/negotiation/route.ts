/**
 * POST /api/v1/attempts/{id}/negotiation — open the negotiation from a Qualified
 * attempt (M0 §5). `no_nego: true` takes standard terms to Auto Approved;
 * otherwise the custom `lines` are versioned and routed to the superior. Ports
 * Go's handleSubmitNegotiation.
 *
 * The flag's wire name is `no_nego` — that is what the Go oracle declares
 * (`sales_handlers.go` `NoNego bool \`json:"no_nego"\``) and what `web-internal`
 * sends. This route was ported reading `no_negotiation`, so every "No
 * Negotiation Required" click arrived as `undefined` ⇒ `noNego = false` with an
 * empty `lines`, i.e. the no-nego path answered
 * `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` while the
 * negotiation path (which sends lines) worked. `no_negotiation` is still read as
 * an alias so any caller written against the Sesi-9 handoff note keeps working.
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
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{
      no_nego?: boolean;
      no_negotiation?: boolean;
      lines?: LineBody[];
    }>(request);
    const noNego = body.no_nego === true || body.no_negotiation === true;
    const result = await sales.submitNegotiation(db(), actor, id, toLines(body.lines), noNego);
    return transitionResponse(result);
  });
}
