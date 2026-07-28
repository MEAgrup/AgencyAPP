/** GET /api/v1/marketing/campaigns/{id} — one acquisition Campaign, §5-scoped (M3 §5). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { marketingCampaignToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(marketingCampaignToWire(await readAsActor(actor, (sql) => campaign.getCampaign(sql, actor, id))));
  });
}
