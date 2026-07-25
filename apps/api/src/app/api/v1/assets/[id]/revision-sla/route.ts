/**
 * POST /api/v1/assets/{id}/revision-sla — set the Asset's Revision SLA Target in
 * hours (M7-OA-3 / §9.3), the separate shorter target revision rounds are measured
 * against. Creative Lead/SPV or Director; > 0. Body: { hours }. Ports Go's
 * handleSetAssetRevisionSLA.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ hours?: number }>(request);
    await task.setAssetRevisionSla(db(), actor, id, b.hours ?? 0);
    return json({ id, revision_sla_target_hours: b.hours ?? 0 });
  });
}
