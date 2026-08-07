/**
 * POST /api/v1/attempts/{id}/services — Edit Service before closing (M0 §5.1,
 * owner QA revisi 2026-08-07).
 *
 * Revises the final service set on an already-approved attempt, in the window
 * between approval and closing: the deal that was negotiated is often not the set
 * that was offered at Qualified, and closing reads the LATEST proposal version.
 *
 * Standard-terms-only revisions keep the attempt approved (the same bypass §5
 * grants the non-negotiation flow); any custom price/commission sends it back to
 * `Negotiation - Pending Approval` — the domain decides which, this shell only maps
 * the body. A line with an empty `proposed_price` is priced server-side from the
 * MSL (`toProposalLines`), so the client never sends rupiah for an added service.
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
    const result = await sales.reviseServices(db(), actor, id, toProposalLines(body.lines));
    return transitionResponse(result);
  });
}
