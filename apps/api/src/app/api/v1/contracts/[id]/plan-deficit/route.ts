/**
 * GET /api/v1/contracts/{id}/plan-deficit — the contract-level carried GMV
 * deficit (Rule 9 / PA-6): Σ(nilai_strategi − nilai_dipakai) over committed
 * downward GMV adjustments across every period of the chain. Computed, never
 * stored. Read scope (owning AM / Account lead / read-all) is enforced in the
 * domain (`contractDeficit`).
 *
 * The body is a single computed number, so it is wrapped in a named snake_case
 * key rather than returned bare — `{ defisit_terbawa: <rupiah> }` — matching
 * `plan.ts::PlanDeficit`.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const defisit = await plan.contractDeficit(db(), actor, id);
    return json({ defisit_terbawa: defisit });
  });
}
