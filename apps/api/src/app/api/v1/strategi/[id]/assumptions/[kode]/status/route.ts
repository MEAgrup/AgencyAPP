/**
 * PUT /api/v1/strategi/{id}/assumptions/{kode}/status — flip one D-8 assumption
 * between `Berlaku` / `Gugur` / `Terverifikasi` (M6A §7 field-level notes).
 *
 * Separate from `PUT /strategi/{id}/assumptions` for one reason that matters: this
 * is reachable while the Strategi is **`Aktif`**. An assumption breaks during
 * execution — the ads budget lands late in month 3 — which is exactly when the
 * replace-set endpoint is shut (`Draft` / `Draft Revisi` only). Routing the flip
 * through that door would make the feature unreachable at the only moment it is
 * needed.
 *
 * Flipping into `Gugur` fires `strategi_revisi_disarankan` to the AM + Account
 * leads. It does not open a revision: Rule 13 requires a trigger, a reason and the
 * broken assumptions, all of which are a human's to declare.
 *
 * `kode` is the assumption's stable handle, not its row id — row ids do not
 * survive the copy into version n+1, which is the whole reason `kode` exists.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire } from '@/lib/wire';

interface Body {
  status?: unknown;
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
