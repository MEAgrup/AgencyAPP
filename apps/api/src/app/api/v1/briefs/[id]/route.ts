/**
 * GET /api/v1/briefs/{id} — one Brief with its derived revision count + flag,
 * if the actor may read it (M6 §6/§9.1: OD/Director, Account lead, owning AM, or
 * the Brief's target-division staff/lead). Ports Go's handleGetBrief.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { briefToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const brief = await account.getBrief(db(), actor, id);
    return json(briefToWire(brief));
  });
}
