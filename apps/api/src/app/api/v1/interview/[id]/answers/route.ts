/**
 * PUT /api/v1/interview/{id}/answers — upsert Blok B answers (draft). The DB
 * CHECKs reject a blank scored field and a baseless estimate with their own
 * messages; this route just maps the body and calls the domain.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { interviewAnswersFromWire, interviewDetailToWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const detail = await interview.saveAnswers(db(), actor, id, interviewAnswersFromWire(b));
    return json(interviewDetailToWire(detail));
  });
}
