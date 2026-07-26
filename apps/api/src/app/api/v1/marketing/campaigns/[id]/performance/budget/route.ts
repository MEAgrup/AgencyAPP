/** POST|PATCH /api/v1/marketing/campaigns/{id}/performance/budget — edit the budget input (M2 §3). */
import { marketing } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { performanceRecordToWire } from '@/lib/wire';

async function update(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ budget?: string }>(request);
    return json(performanceRecordToWire(await marketing.updateBudget(db(), actor, id, b.budget ?? '')));
  });
}
export const POST = update;
export const PATCH = update;
