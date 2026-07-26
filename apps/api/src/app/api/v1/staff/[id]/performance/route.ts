/**
 * GET /api/v1/staff/{id}/performance[?period=YYYYMM] — M14 §5.5: one stored
 * Performance Score snapshot for a staff member (latest, or the given period), with
 * the full breakdown (Rule 8). Visibility gated (Rule 7): staff see their own; a
 * division lead/SPV sees their team; OD/Director everyone. An invisible/absent staff
 * or a missing period is 404. Ports Go's handleGetPerf.
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
    const period = new URL(request.url).searchParams.get('period') ?? '';
    const snap = await performance.getSnapshot(db(), actor, id, period);
    return json(perfSnapshotToWire(snap));
  });
}
