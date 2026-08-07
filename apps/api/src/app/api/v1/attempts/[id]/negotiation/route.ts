/**
 * POST /api/v1/attempts/{id}/negotiation — open the negotiation from a Qualified
 * attempt (M0 §5). Ports Go's handleSubmitNegotiation.
 *
 * `no_nego: true` is the non-negotiation flow → Auto Approved. It accepts `lines`
 * as the §5 Flow-1 "Service Selection & Confirmation" screen (deselect an offered
 * service, add one from the Master Service List) as long as every line uses
 * STANDARD terms; empty `lines` means "take the Qualified offer as it stands". A
 * line carrying a custom price is refused with the switch-to-negotiation error.
 * `no_nego: false` versions the lines and routes them to the superior.
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
import { toProposalLines, type ProposalLineBody } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{
      no_nego?: boolean;
      no_negotiation?: boolean;
      lines?: ProposalLineBody[];
    }>(request);
    const noNego = body.no_nego === true || body.no_negotiation === true;
    const result = await sales.submitNegotiation(db(), actor, id, toProposalLines(body.lines), noNego);
    return transitionResponse(result);
  });
}
