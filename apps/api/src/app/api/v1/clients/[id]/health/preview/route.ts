/**
 * GET /api/v1/clients/{id}/health/preview — M13 Rule 10 / §5.3: the CURRENT,
 * not-yet-closed month's Health score, computed read-only (never stored, never on
 * the trend). Visibility-gated. Ports Go's handleHealthPreview.
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
    const snap = await readAsActor(actor, (sql) => health.preview(sql, actor, id));
    return json(healthSnapshotToWire(snap));
  });
}
