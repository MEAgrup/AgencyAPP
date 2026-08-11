/**
 * PUT /api/v1/interview/{id}/jadwal — set/replace the schedule (IA-3) and move
 * to Terjadwal. A later reschedule replaces the reminder markers automatically
 * (the DB reset trigger, langkah 5).
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { interviewDetailToWire, interviewJadwalFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const detail = await interview.scheduleInterview(db(), actor, id, interviewJadwalFromWire(b));
    return json(interviewDetailToWire(detail));
  });
}
