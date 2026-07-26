/** GET /api/v1/clients/{id}/health/preview — the read-only, never-stored current-month preview (M13 §Rule 10). */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthSnapshotToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(healthSnapshotToWire(await health.preview(db(), actor, id, new Date())));
  });
}
