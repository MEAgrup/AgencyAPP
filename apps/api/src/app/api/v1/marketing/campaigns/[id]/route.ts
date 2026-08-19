/** /api/v1/marketing/campaigns/{id} — one acquisition Campaign: read (GET §5) + edit fields (PATCH §6.1). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { marketingCampaignToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(marketingCampaignToWire(await readAsActor(actor, (sql) => campaign.getCampaign(sql, actor, id))));
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ name?: string; channel?: string; online?: boolean; offline?: boolean; start_date?: string }>(request);
    const c = await campaign.updateCampaign(db(), actor, id, {
      name: b.name ?? '', channel: b.channel ?? '', online: b.online, offline: b.offline, startDate: b.start_date ?? '',
    });
    return json(marketingCampaignToWire(c));
  });
}
