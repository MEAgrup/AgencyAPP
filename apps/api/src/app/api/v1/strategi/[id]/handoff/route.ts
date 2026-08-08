/**
 * PUT /api/v1/strategi/{id}/handoff — Section I: I-2 the divisions that receive
 * Briefs and their dispatch order, I-3 the metrics pulled into the monthly
 * client report, I-4 the per-division note.
 *
 * I-1 (the Plan skeleton) and J-4 (the version diff) are NOT here and never will
 * be: §4 marks both `A`, derived from E and F. Storing either would create a
 * second answer to a question the source rows already answer (house rule #4,
 * and the same call D-3/X-11 made).
 *
 * I-2 and I-4 share one body because they share one key — a note for a division
 * that receives no Brief has no reader.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiHandoffFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveHandoff(db(), actor, id, strategiHandoffFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
