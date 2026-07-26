/** POST /api/v1/marketing/campaigns/{id}/reassign — hand ownership to another Marketing staff (M3 §5 / M3-OA-6). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { marketingCampaignToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ owner_employee_id?: string }>(request);
    return json(marketingCampaignToWire(await campaign.reassignCampaign(db(), actor, id, b.owner_employee_id ?? '')));
  });
}
