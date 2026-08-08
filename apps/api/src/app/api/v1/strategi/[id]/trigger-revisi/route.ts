/**
 * PUT /api/v1/strategi/{id}/trigger-revisi — H-2, the revision triggers declared
 * for this client, each with its threshold where §4 asks for one.
 *
 * This is the list Rule 13 points at: `POST /strategi/{id}/revision` refuses a
 * trigger that is not declared here, so an empty H-2 is not merely an incomplete
 * form — it is a Strategi that could never state why it was revised. That is why
 * H-2 is gated at submit and why revisions inherit these rows.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiTriggerRevisiFromWire } from '@/lib/wire';

/** Wrapped in a named key like every other list endpoint here (`pillars`, `risks`). */
interface Body {
  trigger_revisi?: unknown;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveTriggerRevisi(db(), actor, id, strategiTriggerRevisiFromWire(b.trigger_revisi ?? []));
    return json(strategiDetailToWire(saved));
  });
}
