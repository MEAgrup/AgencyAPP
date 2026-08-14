/**
 * /api/v1/clients/{id}/milestones — T-4c / RM-11 Upcoming Milestones.
 *
 * GET: the client's milestones, soonest target first (read-gated by canView).
 * POST: add one [Upcoming] milestone (Account own-client / lead / Director,
 * title + target_date mandatory). Incomplete → 400, Forbidden → 403, NotFound → 404.
 */
import { milestone } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { milestoneToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => milestone.listMilestones(sql, actor, id));
    return json({ data: rows.map(milestoneToWire) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ title?: string; target_date?: string }>(request);
    const m = await milestone.createMilestone(db(), actor, id, {
      title: b.title ?? '',
      targetDate: b.target_date ?? '',
    });
    return json(milestoneToWire(m));
  });
}
