/**
 * GET /api/v1/assets/{id}/metrics — the Asset's computed metrics (M12 §5.1 + the
 * M7-OA-3 revision speed score), recomputed from the log, behind the §9.1 read
 * gate. Ports Go's handleAssetMetrics.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { metricsToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const m = await readAsActor(actor, (sql) => task.assetMetrics(sql, actor, id));
    return json(metricsToWire(m));
  });
}
