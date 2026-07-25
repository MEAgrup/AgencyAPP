/** /api/v1/briefs/{id}/bookings — the Creator Bookings of a KOL Brief (M9 §4). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bookingToWire, toBookingInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toBookingInput>[0]>(request);
    return json(bookingToWire(await kol.createBooking(db(), actor, id, toBookingInput(b))));
  });
}
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await kol.listBriefBookings(db(), actor, id);
    return json({ data: rows.map(bookingToWire) });
  });
}
