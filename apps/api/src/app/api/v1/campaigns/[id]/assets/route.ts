/**
 * POST /api/v1/campaigns/{id}/assets — link an approved same-client Creative Asset
 * to an Ad Campaign (M8 §4 Rule 2). Body: { asset_id }. Ports Go's handleLinkAsset.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ asset_id?: string }>(request);
    await ads.linkAsset(db(), actor, id, b.asset_id ?? '');
    return json({ id, asset_id: b.asset_id ?? '', linked: true });
  });
}
