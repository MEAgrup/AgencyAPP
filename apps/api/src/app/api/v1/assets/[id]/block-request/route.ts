/**
 * POST /api/v1/assets/{id}/block-request — file a pending block request on an
 * Asset (M12 §5.3a). Division staff / AM may request; only SPV/Lead may action.
 * Body: { reason }. Ports Go's handleAssetBlockRequest.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { blockRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    const br = await task.submitAssetBlockRequest(db(), actor, id, b.reason ?? '');
    return json(blockRequestToWire(br));
  });
}
