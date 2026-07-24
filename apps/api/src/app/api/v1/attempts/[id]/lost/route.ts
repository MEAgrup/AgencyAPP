/**
 * POST /api/v1/attempts/{id}/lost — mark a prospect attempt Closed-Lost (M0 §6).
 * Owner / Sales Lead (division-wide) / Director only. Ports the "Endpoint BARU"
 * from the FE contract (fe_m0m1_contract.md §6). Forbidden → 403, NotFound → 404,
 * invalid transition → 409 (shared error mapper).
 *
 * FE: sales.markLost(id) → { status: string }.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const result = await sales.markLost(db(), actor, id);
    if (!result.ok) {
      const status = result.code === 'role_denied' ? 403 : 409;
      return new Response(JSON.stringify({ error: result.message }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return json({ status: result.to });
  });
}
