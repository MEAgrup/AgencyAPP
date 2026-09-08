/**
 * PUT /api/v1/strategi/{id}/targets — Section D-1/D-2/D-4, the floor + stretch matrix (Rule 7 lives in the DB CHECK).
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
import { strategiDetailToWire, strategiTargetsFromWire } from '@/lib/wire';

interface Body {
  targets?: unknown;
  /**
   * O76 — alasan WAJIB kalau Σ floor GMV per bulan menyimpang > 20% dari
   * `clients.target_gmv` (angka yang Sales sepakati dengan klien). Domain yang
   * memutuskan apakah ia wajib; di dalam toleransi ia diabaikan.
   */
  gmv_adjustment_reason?: string;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveTargets(
      db(), actor, id, strategiTargetsFromWire(b.targets ?? []), b.gmv_adjustment_reason ?? '',
    );
    return json(strategiDetailToWire(saved));
  });
}
