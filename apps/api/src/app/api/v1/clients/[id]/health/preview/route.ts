/**
 * GET /api/v1/clients/{id}/health/preview — M13 §Rule 10 / §5.3: the CURRENT,
 * not-yet-closed WIB month's Health Score computed read-only. NEVER stored and
 * never on the trend. Visibility gated (Rule 11). Ports Go's handlePreview.
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
    const snap = await health.preview(db(), actor, id);
    return json(snapshotToWire(snap));
  });
}
