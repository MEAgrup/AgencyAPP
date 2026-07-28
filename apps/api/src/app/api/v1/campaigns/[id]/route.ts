/**
 * GET /api/v1/campaigns/{id} — an Ad Campaign with its derived performance metrics
 * (Total Spend/GMV/ROAS, §5), recomputed from immutable rows, behind the §9.1 read
 * gate. Ports Go's handleGetCampaign.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { campaignToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const c = await readAsActor(actor, (sql) => ads.getCampaign(sql, actor, id));
    return json(campaignToWire(c));
  });
}
