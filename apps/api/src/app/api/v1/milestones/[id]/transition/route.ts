/**
 * POST /api/v1/milestones/{id}/transition — T-4c / RM-11: move an [Upcoming]
 * milestone to [Done] or [Cancelled] (Account own-client / lead / Director).
 * Body: { to }. Forbidden → 403, NotFound → 404, bad/terminal transition → 409.
 */
import { milestone } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { milestoneToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ to?: string }>(request);
    const m = await milestone.transitionMilestone(db(), actor, id, b.to ?? '');
    return json(milestoneToWire(m));
  });
}
