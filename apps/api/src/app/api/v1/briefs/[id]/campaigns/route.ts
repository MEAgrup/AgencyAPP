/**
 * POST /api/v1/briefs/{id}/campaigns — create an Ad Campaign under an Ads Brief
 * [In Progress] (M8 §4 Rule 1). Ads staff/lead or Director; born [Paused]. Ports
 * Go's handleCreateCampaign.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { campaignToWire, toCampaignInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toCampaignInput>[0]>(request);
    const c = await ads.createCampaign(db(), actor, id, toCampaignInput(b));
    return json(campaignToWire(c));
  });
}
