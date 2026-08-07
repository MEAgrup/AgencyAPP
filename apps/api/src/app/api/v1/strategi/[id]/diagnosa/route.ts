/**
 * PUT /api/v1/strategi/{id}/diagnosa — Section C (A-07).
 *
 * Replaces all four Section C sub-sections atomically:
 *   - diagnosa      (C-1/C-2/C-3/C-4): per-channel bottleneck + evidence + root cause + gap
 *   - quick_wins    (C-5): quick wins in the first 14 days
 *   - risiko_struktural (C-6): structural risks that cannot be eliminated
 *   - prasyarat_klien   (C-7): things the client must resolve before execution
 *
 * Rule 6 (§4) is enforced here at save time (not at submit): each diagnosa must
 * cite ≥1 field-ID from VALID_BASELINE_FIELD_IDS. An invalid ID returns 422 so
 * the AM can fix it immediately rather than encountering it at submit.
 *
 * Auth: only the owning AM or a Director may write; the Strategi must be in
 * Draft or Draft Revisi status.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiDiagnosaFromWire } from '@/lib/wire';

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveDiagnosa(db(), actor, id, strategiDiagnosaFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
