/**
 * POST /api/v1/campaigns/{id}/launch — the Ad Campaign launch lifecycle edge (M8 §2,
 * STATE_MACHINES §14). Ads staff/lead or Director. Ports Go's launchCampaign.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return transitionResponse(await ads.launchCampaign(db(), actor, id));
  });
}
