/**
 * GET /api/v1/attempts/{id} — one attempt's detail: its Qualified draft and the
 * latest negotiation proposal (the working quote). Ports Go's handleGetAttempt.
 * NotFoundError → 404 (shared error mapper).
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const attempt = await readAsActor(actor, (sql) => sales.getAttempt(sql, id));
    return json({ attempt });
  });
}
