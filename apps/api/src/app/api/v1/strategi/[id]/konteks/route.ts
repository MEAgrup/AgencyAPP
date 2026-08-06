/**
 * PUT /api/v1/strategi/{id}/konteks — Section A, Konteks Klien & Bisnis (A-05).
 *
 * Section A is filled once per Strategi (§4 "Filled once, not per channel"), so
 * this is a replace-in-place write on the record itself, not a replace-set.
 *
 * A partial body is legitimate and expected: §7 asks for autosave every 20s on a
 * form with sixteen required answers. Completeness is the submit gate's job
 * (`GET /strategi/{id}/kekurangan`), never this route's.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiKonteksFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveKonteks(db(), actor, id, strategiKonteksFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
