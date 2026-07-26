/** GET /api/v1/staff/{id}/performance/trend — all stored snapshots for the staff member, oldest first (M14). */
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
