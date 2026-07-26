/** GET /api/v1/clients/{id}/health/trend — all stored snapshots, oldest first (M13 §Rule 9). */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthSnapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const list = await health.trend(db(), actor, id);
    return json({ data: list.map(healthSnapshotToWire) });
  });
}
