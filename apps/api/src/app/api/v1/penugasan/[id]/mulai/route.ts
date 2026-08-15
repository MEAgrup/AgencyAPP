/**
 * POST /api/v1/penugasan/{id}/mulai — [Ditugaskan] → [Dikerjakan], freezing
 * `dimulai_pada`. Only the assigned PIC: a lead marking someone else's task
 * "started" would forge the anchor the duration is measured from.
 */
import { internaltask } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { internalTaskToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const t = await internaltask.startTask(db(), actor, id);
    return json(internalTaskToWire(t));
  });
}
