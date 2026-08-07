/**
 * PUT /api/v1/strategi/{id}/akses — A-15 access matrix + A-16 blockers.
 *
 * A replace-set, like every other section write: the matrix is saved whole. A
 * blocker (A-16) is a flag on the row it blocks, not a separate list — so a row
 * can never claim to block an access that is not in the matrix.
 *
 * §5 step 3 makes these rows the SPV dashboard's first signal: an access blocker
 * is the most common reason a Strategi stalls.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiAksesFromWire } from '@/lib/wire';

interface Body {
  akses?: unknown;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveAkses(db(), actor, id, strategiAksesFromWire(b.akses ?? []));
    return json(strategiDetailToWire(saved));
  });
}
