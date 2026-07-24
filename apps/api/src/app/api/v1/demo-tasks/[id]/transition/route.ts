/**
 * /api/v1/demo-tasks/{id}/transition — drive the brief_task state machine
 * (POST { to }). Ported from Go's handleTransitionDemoTask. Status is written
 * ONLY through sm_transition; a rejected transition returns the engine's exact
 * BI message (role_denied → 403, blocked → 409).
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ to?: string }>(request);
    const to = body.to?.trim();
    if (!to) {
      throw new BadRequestError('field "to" is required');
    }
    const result = await demo.transition(db(), actor, id, to);
    return transitionResponse(result);
  });
}
