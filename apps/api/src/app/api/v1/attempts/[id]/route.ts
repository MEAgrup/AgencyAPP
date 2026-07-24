/**
 * GET /api/v1/attempts/{id} — full attempt detail: attempt + lead + qualified
 * form snapshot + all negotiation proposals + NQ reasons (M0/M1 §7).
 * Response: AttemptDetail (FE sales.ts getAttempt — shape is returned flat).
 * NotFoundError → 404 (shared error mapper).
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptFullDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const detail = await readAs(actor, (tx) => sales.getAttemptFullDetail(tx, id));
    return json(attemptFullDetailToWire(detail));
  });
}
