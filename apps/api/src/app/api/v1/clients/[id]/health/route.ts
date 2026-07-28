/**
 * GET /api/v1/clients/{id}/health?period=YYYYMM — M13 §5.1: one stored Client
 * Health snapshot (latest when period omitted). Visibility-gated (Rule 11). Ports
 * Go's handleGetHealth.
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
    const period = new URL(request.url).searchParams.get('period') ?? '';
    const snap = await readAsActor(actor, (sql) => health.getSnapshot(sql, actor, id, period));
    return json(healthSnapshotToWire(snap));
  });
}
