/**
 * POST /api/v1/leads/{id}/claim — M1 §6 Pool claim: a Sales salesperson
 * self-claims a `[Pool]` lead, spawning a competing PRSP attempt (New Lead) and
 * logging the claim on the lead record. Ports Go's handleClaimLead.
 *
 * The same pool lead may be claimed by several salespeople by design (M1-OA-1);
 * the winner is resolved at closing. A non-claimable record (already a client /
 * already held by the actor / scouted-exclusive) surfaces as 409 with the
 * verbatim BI message; an unknown lead as 404 (shared error mapper).
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptStubToWire, leadStubToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const { lead, attempt } = await leads.claim(db(), actor, id);
    return json({ lead: leadStubToWire(lead), attempt: attemptStubToWire(attempt) }, 201);
  });
}
