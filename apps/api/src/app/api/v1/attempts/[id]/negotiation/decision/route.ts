/**
 * POST /api/v1/attempts/{id}/negotiation/decision — the superior's decision on a
 * Pending Approval attempt (M0 §5): approve / revise / reject. Revise & reject
 * require a mandatory note. Lead/Director-only (enforced by the state machine).
 * Ports Go's handleDecideNegotiation.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ decision?: string; note?: string }>(request);
    const result = await sales.decideNegotiation(db(), actor, id, body.decision ?? '', body.note ?? '');
    return transitionResponse(result);
  });
}
