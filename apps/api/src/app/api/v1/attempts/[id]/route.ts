/**
 * GET /api/v1/attempts/{id} — one attempt's detail: its Qualified draft and the
 * latest negotiation proposal (the working quote). Ports Go's handleGetAttempt.
 * NotFoundError → 404 (shared error mapper).
 */
import { sales } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const attempt = await sales.getAttempt(db(), id);
    return json({ attempt });
  });
}
