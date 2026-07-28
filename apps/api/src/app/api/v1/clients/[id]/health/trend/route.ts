/**
 * GET /api/v1/clients/{id}/health/trend — M13 Rule 9: every stored snapshot for a
 * Client, oldest first (stored snapshots only — never a retroactive recompute).
 * Visibility-gated. Ports Go's handleHealthTrend.
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthSnapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const list = await readAsActor(actor, (sql) => health.trend(sql, actor, id));
    return json({ data: list.map(healthSnapshotToWire) });
  });
}
