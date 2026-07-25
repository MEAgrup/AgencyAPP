/**
 * GET /api/v1/assets/{id} — one Asset with its derived Revision Count / flag, if
 * the actor may read it (M7 §9.1: OD/Director, Account lead, owning AM, Creative
 * division staff/lead). Ports Go's handleGetAsset.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { assetToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const asset = await creative.getAsset(db(), actor, id);
    return json(assetToWire(asset));
  });
}
