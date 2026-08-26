/**
 * POST /api/v1/strategi/{id}/revision — open version n+1 in `Draft Revisi`.
 *
 * Rule 13 requires a trigger from the H-2 list and a written reason, always.
 * Which D-8 assumptions broke is required too, UNLESS this Strategi has zero
 * D-8 rows recorded — D-8 is no longer a submit gate (⟳ 2026-08-26 DECISIONS),
 * so there can be nothing to cite. `openRevision` enforces the conditional; the
 * §9 metric ("% revisions with a declared trigger + broken assumption", target
 * 100%) is scoped to revisions where D-8 has ≥1 row for the same reason.
 *
 * Version n keeps running as `Aktif` — it is archived only when n+1 is approved.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiRevisionFromWire, strategiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const created = await strategi.openRevision(db(), actor, id, strategiRevisionFromWire(b));
    return json(strategiToWire(created), 201);
  });
}
