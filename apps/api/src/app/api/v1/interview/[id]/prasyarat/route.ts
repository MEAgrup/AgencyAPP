/**
 * POST /api/v1/interview/{id}/prasyarat — mark the client-side prerequisite done
 * ("tandai prasyarat selesai", owner decision 2026-08-11 bagian 2). Flips
 * `prasyarat_status` to 'selesai' (stopping the daily overdue flag + hanging
 * escalation) and logs the completion. Advisory: the verdict is never touched.
 * Returns the updated verdict + prasyarat_status, or null when no qualification
 * has been computed yet.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { interviewVerdictToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const v = await interview.resolvePrasyarat(db(), actor, id);
    return json(v ? interviewVerdictToWire(v) : null);
  });
}
