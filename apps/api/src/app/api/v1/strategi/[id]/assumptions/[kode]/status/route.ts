/**
 * PUT /api/v1/strategi/{id}/assumptions/{kode}/status — flip one D-8 assumption
 * between `Berlaku` / `Gugur` / `Terverifikasi` (§7 field-level notes).
 *
 * Separate from `PUT .../assumptions` (which replaces the whole set while the
 * record is a Draft) because this one is reachable on an `Aktif` Strategi — that
 * is the state where an assumption breaking means anything, and where the flip
 * fires `strategi_revisi_disarankan` to AM + SPV.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire } from '@/lib/wire';

interface Body {
  status?: string;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string; kode: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, kode } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.setAssumptionStatus(
      db(),
      actor,
      id,
      decodeURIComponent(kode),
      String(b.status ?? '') as strategi.AssumptionState,
    );
    return json(strategiDetailToWire(saved));
  });
}
