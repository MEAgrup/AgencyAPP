/**
 * /api/v1/briefs/{id}/assets — the Creative Assets of a Brief (M7 §4).
 *
 * POST: break one unit of a Creative Brief into an Asset (Creative staff/lead
 * self-claim / Team Leader, or Director). Ports Go's handleCreateAsset.
 * GET: all Assets of the Brief in sequence order (§4 Rule 1 progress). Ports Go's
 * handleListBriefAssets.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assetToWire, toAssetInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toAssetInput>[0]>(request);
    const asset = await creative.createAsset(db(), actor, id, toAssetInput(b));
    return json(assetToWire(asset));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => creative.listBriefAssets(sql, actor, id));
    return json({ data: rows.map(assetToWire) });
  });
}
