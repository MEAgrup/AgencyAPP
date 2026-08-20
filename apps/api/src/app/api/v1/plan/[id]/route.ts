/**
 * GET /api/v1/plan/{id} — the whole period bundle (Section P-A…P-G) in one load.
 *
 * The write surface (submit/approve/activate/rows/target/weeks/…) shipped in
 * RAB-15 before any page consumed it; the READ side was the one hole — a page
 * could act on a period but never load one. This closes it. One GET rather than
 * a call per child block: the page renders header + targets + rows + weeks +
 * actuals + flags at once, and six round-trips would spend that budget on
 * latency. Read scope (owning AM / Account lead / read-all) is enforced in the
 * domain (`getPlanDetail` → `getPlan`).
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { planDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(planDetailToWire(await plan.getPlanDetail(db(), actor, id)));
  });
}
