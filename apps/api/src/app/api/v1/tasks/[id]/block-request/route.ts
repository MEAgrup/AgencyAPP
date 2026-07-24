/**
 * POST /api/v1/tasks/{id}/block-request — file a pending block request on a
 * Brief-as-task (M12 §5.3a). Division staff / the AM may request; only SPV/Lead
 * may action it. Body: { reason }. Ports Go's handleTaskBlockRequest.
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
    const br = await task.submitBlockRequest(db(), actor, id, b.reason ?? '');
    return json(blockRequestToWire(br));
  });
}
