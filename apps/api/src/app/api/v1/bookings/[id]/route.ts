/** GET /api/v1/bookings/{id} — one Creator Booking with derived fields (M9 §10.1). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { bookingToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(bookingToWire(await kol.getBooking(db(), actor, id)));
  });
}
