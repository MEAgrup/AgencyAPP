/** POST /api/v1/marketing/campaigns/{id}/transition — drive the campaign machine (M3 §3). */
import { campaign } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ to?: string }>(request);
    return transitionResponse(await campaign.transitionCampaign(db(), actor, id, b.to ?? ''));
  });
}
