/**
 * POST /api/v1/bookings/{id}/hours — log Hours on the Booking (M9 §3/§7).
 * The echoed key is `hours_logged`, as Go's handler sends it and the client's
 * `HoursResult` declares it — the request's own `hours` key is NOT the response
 * contract, and echoing it blanked the refreshed cell.
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
    await kol.logHours(db(), actor, id, b.hours ?? 0);
    return json({ id, hours_logged: b.hours ?? 0 });
  });
}
