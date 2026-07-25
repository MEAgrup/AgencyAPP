/** POST /api/v1/bookings/{id}/hours — set the Booking's SLA / Hours Logged (M9 §3/§7). */
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
    return json({ id, hours: b.hours ?? 0 });
  });
}
