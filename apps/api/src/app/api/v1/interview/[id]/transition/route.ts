/**
 * POST /api/v1/interview/{id}/transition — move the interview to `to` via
 * sm_transition. Cancellation requires a reason (written before the transition
 * in the same tx). Reviewer edges require Account-lead/Director authority.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { interviewDetailToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Record<string, unknown>>(request);
    const to = String(b.to ?? '');
    const alasanPembatalan = b.alasan_pembatalan == null ? undefined : String(b.alasan_pembatalan);
    const detail = await interview.transitionInterview(db(), actor, id, to, { alasanPembatalan });
    return json(interviewDetailToWire(detail));
  });
}
