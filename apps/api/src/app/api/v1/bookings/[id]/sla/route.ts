/**
 * POST /api/v1/bookings/{id}/sla — set the Booking's SLA target (M9 §3/§7).
 * The echoed key is `sla_target_hours`, as Go's handler sends it and the client's
 * `SLAResult` declares it — echoing the request's own `hours` key instead left
 * the refreshed SLA cell reading `undefined`.
 */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ hours?: number }>(request);
    await kol.setSlaTarget(db(), actor, id, b.hours ?? 0);
    return json({ id, sla_target_hours: b.hours ?? 0 });
  });
}
