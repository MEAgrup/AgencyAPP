/**
 * POST /api/v1/attempts/{id}/contacted — advance a New Lead attempt to Contacted
 * (M0 §4). Ports Go's handleMarkContacted. The state result maps via
 * transitionResponse; NotFound/Forbidden map via the shared error mapper.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const result = await sales.markContacted(db(), actor, id);
    if (!result.ok) return transitionResponse(result);
    return json({ status: result.to });
  });
}
