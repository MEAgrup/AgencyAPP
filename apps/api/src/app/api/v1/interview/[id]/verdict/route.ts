/**
 * GET /api/v1/interview/{id}/verdict — verdict + prasyarat ONLY (the additive
 * Sales-facing surface). No score, breakdown, or answers ever cross this route.
 * Returns null when no qualification has been computed yet.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { interviewVerdictToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const v = await interview.getInterviewVerdict(db(), actor, id);
    return json(v ? interviewVerdictToWire(v) : null);
  });
}
