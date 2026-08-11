/**
 * GET /api/v1/interview/{id} — the full record (interview + jadwal + Blok C
 * qualification + answers). Account-scope only; Sales and other divisions get
 * 403, matching the table's RLS default-deny.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { interviewDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(interviewDetailToWire(await interview.getInterview(db(), actor, id)));
  });
}
