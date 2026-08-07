/**
 * POST /api/v1/strategi/{id}/submit — `Draft` / `Draft Revisi` → `Diajukan`.
 *
 * The completeness gate runs inside the same transaction as the transition, so
 * a Strategi cannot reach a reviewer half-filled and a concurrent edit cannot
 * slip in between the check and the move.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(strategiToWire(await strategi.submitStrategi(db(), actor, id)));
  });
}
