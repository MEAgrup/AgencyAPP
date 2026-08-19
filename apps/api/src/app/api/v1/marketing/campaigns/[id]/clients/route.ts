/** GET /api/v1/marketing/campaigns/{id}/clients — won-client list + service status (M3 §4 Rule 4 / Flow 2). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { campaignClientToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const list = await readAsActor(actor, (sql) => campaign.campaignClients(sql, actor, id));
    return json({ data: list.map(campaignClientToWire) });
  });
}
