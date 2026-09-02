/**
 * PUT/DELETE /api/v1/plan/rows/{rowId} — re-point a work-row's PC-3 origin, or
 * remove the row outright. Owner-added 2026-09-02 (docs/DECISIONS.md): a row
 * born "Di Luar Strategi/Service" while Section E of the Strategi was empty
 * had no way back once Section E was later filled (or a Service appeared to
 * tie it to) — `updatePlanRowOrigin`/`deletePlanRow` close that gap. Both
 * gates, the write scope, the Draft/Aktif window, and the "already-briefed
 * rows are locked" rule all live in the domain; this route only maps
 * snake_case and shapes the response (O43).
 *
 * `rows` is a static sibling of the `[id]` period segment (mirrors
 * `plan/rows/[rowId]/weeks/route.ts`) — a PLAN- id never collides with the
 * literal `rows`.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planRowToWire } from '@/lib/wire';

interface UpdateOriginBody {
  strategi_pillar_id?: number | null;
  service_id?: string | null;
  di_luar_strategi?: boolean;
  di_luar_service?: boolean;
  di_luar_alasan?: string | null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ rowId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rowId } = await ctx.params;
    const b = await readJson<UpdateOriginBody>(request);
    const row = await plan.updatePlanRowOrigin(db(), actor, Number(rowId), {
      strategiPillarId: b.strategi_pillar_id ?? null,
      serviceId: b.service_id ?? null,
      diLuarStrategi: b.di_luar_strategi ?? false,
      diLuarService: b.di_luar_service ?? false,
      diLuarAlasan: b.di_luar_alasan ?? null,
    });
    return json(planRowToWire(row));
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ rowId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rowId } = await ctx.params;
    await plan.deletePlanRow(db(), actor, Number(rowId));
    return json({ deleted: true });
  });
}
