/**
 * /api/v1/leads/{id} — fetch one lead + its attempt contest (GET), ported from
 * Go's handleGetLead. NotFoundError → 404 via the shared error mapper.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { leadDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const detail = await readAs(actor, (tx) => leads.leadDetailView(tx, id));
    return json(leadDetailToWire(detail));
  });
}
