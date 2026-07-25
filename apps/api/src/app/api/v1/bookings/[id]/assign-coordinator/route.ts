/** POST /api/v1/bookings/{id}/assign-coordinator — set/reassign the Coordinator (M9 §3). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ coordinator_id?: string; reason?: string }>(request);
    await kol.assignCoordinator(db(), actor, id, b.coordinator_id ?? '', b.reason ?? '');
    return json({ id, assigned_coordinator: b.coordinator_id ?? '' });
  });
}
