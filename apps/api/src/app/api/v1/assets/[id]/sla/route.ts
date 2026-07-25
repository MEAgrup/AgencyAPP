/**
 * POST /api/v1/assets/{id}/sla — set the Asset's SLA Target in hours (M12 §5.3).
 * Creative Lead/SPV or Director; > 0. Body: { hours }. Ports Go's handleSetAssetSLA.
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
    await task.setAssetSla(db(), actor, id, b.hours ?? 0);
    return json({ id, sla_target_hours: b.hours ?? 0 });
  });
}
