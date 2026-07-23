/**
 * /api/v1/leads/{id} — fetch one lead + its attempt contest (GET), ported from
 * Go's handleGetLead. NotFoundError → 404 via the shared error mapper.
 */
import { leads } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const lead = await leads.get(db(), id);
    return json({ lead });
  });
}
