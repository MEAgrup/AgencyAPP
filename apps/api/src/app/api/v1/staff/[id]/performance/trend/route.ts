/**
 * GET /api/v1/staff/{id}/performance/trend — M14 §5.5: every stored Performance
 * Score snapshot for the staff member, oldest first. Visibility gated (Rule 7).
 * Ports Go's handlePerfTrend.
 */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { perfSnapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const list = await performance.trend(db(), actor, id);
    return json({ data: list.map(perfSnapshotToWire) });
  });
}
