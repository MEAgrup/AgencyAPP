/** GET /api/v1/clients/{id}/health[?period=YYYYMM] — one stored Client Health snapshot (M13 §5.1). */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthSnapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const period = new URL(request.url).searchParams.get('period') ?? '';
    return json(healthSnapshotToWire(await health.getSnapshot(db(), actor, id, period)));
  });
}
