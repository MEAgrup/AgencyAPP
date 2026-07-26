/** GET /api/v1/staff/{id}/performance[?period=YYYYMM] — one stored Performance Score snapshot (M14 §5.1). */
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
    return json(perfSnapshotToWire(await performance.getSnapshot(db(), actor, id, period)));
  });
}
