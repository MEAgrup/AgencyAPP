/**
 * PUT /api/v1/strategi/{id}/pillars — Section E, the per-pillar direction Briefs inherit (incl. E-4 floor price).
 *
 * A replace-set: the section is saved whole. Saving row by row would let a
 * section land half-written, which for Section B is precisely the state Rule 5
 * forbids — and it would turn one user action into a burst of audit rows nobody
 * can reconstruct a form state from.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiPillarsFromWire } from '@/lib/wire';

interface Body {
  pillars?: unknown;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.savePillars(db(), actor, id, strategiPillarsFromWire(b.pillars ?? []));
    return json(strategiDetailToWire(saved));
  });
}
