/**
 * GET /api/v1/clients/{id}/health — M13 §5.1: one stored Client Health Report
 * Snapshot. `?period=YYYYMM` picks a month; omitted picks the latest. Visibility
 * gated (Rule 11): owning AM / Account lead / OD / Director. An invisible or
 * absent client is 404; a role with no M13 scope is 403. Ports Go's handleGetSnapshot.
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { snapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const period = new URL(request.url).searchParams.get('period') ?? '';
    const snap = await health.getSnapshot(db(), actor, id, period);
    return json(snapshotToWire(snap));
  });
}
