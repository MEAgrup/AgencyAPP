/** GET /api/v1/marketing/campaigns/{id}/rollup — derived linkage funnel (M3 §4 Rule 4 / §6.3). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { campaignRollupToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(campaignRollupToWire(await readAsActor(actor, (sql) => campaign.campaignRollup(sql, actor, id))));
  });
}
