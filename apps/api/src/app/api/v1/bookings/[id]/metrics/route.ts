/** GET /api/v1/bookings/{id}/metrics — recompute-from-log Booking metrics (M9 §7/§11). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { bookingMetricsToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(bookingMetricsToWire(await readAsActor(actor, (sql) => kol.bookingMetrics(sql, actor, id))));
  });
}
