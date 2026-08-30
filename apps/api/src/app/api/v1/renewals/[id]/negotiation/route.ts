/**
 * POST /api/v1/renewals/{id}/negotiation — open negotiation on a Draft
 * renewal/cross-sell request (R-03). Mirrors `/attempts/{id}/negotiation`
 * exactly: `no_nego: true` with every line STANDARD goes straight to
 * Negotiation - Auto Approved; any custom line routes to Negotiation -
 * Pending Approval for the superior's decision.
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
    const body = await readJson<{ no_nego?: boolean; lines?: ProposalLineBody[] }>(request);
    const result = await renewal.submitRenewalNegotiation(
      db(), actor, id, toProposalLines(body.lines), body.no_nego === true,
    );
    return transitionResponse(result);
  });
}
