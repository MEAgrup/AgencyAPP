/**
 * DELETE /api/v1/campaigns/{id}/assets/{assetId} — unlink a currently-linked Asset
 * (sets unlinked_at, never deletes — house rule 3). Ports Go's handleUnlinkAsset.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; assetId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, assetId } = await ctx.params;
    await ads.unlinkAsset(db(), actor, id, assetId);
    return json({ id, asset_id: assetId, linked: false });
  });
}
