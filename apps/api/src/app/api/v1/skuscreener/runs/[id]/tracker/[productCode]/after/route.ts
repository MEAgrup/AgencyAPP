/**
 * MEA SKU Screener — Modul D, D3/D4 (SC-08).
 *
 *  - POST /api/v1/skuscreener/runs/{id}/tracker/{productCode}/after — fill
 *    `after_*` (≥14 days / ≥20 clicks later per Flow D3), compute
 *    delta/verdict via `evaluateOptimization` (R12). The only mutable write
 *    in the SKU Screener domain.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { trackerRowToWire } from '@/lib/wire';

interface RecordAfterWire {
  after?: { views: number; clicks: number; ctr: number; cr: number; orders: number };
  min_klik_sesudah?: number;
  budget_decision?: string | null;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string; productCode: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, productCode } = await ctx.params;
    const b = await readJson<RecordAfterWire>(request);
    const d = await skuscreener.recordTrackerAfter(db(), actor, {
      screeningId: id,
      productCode: decodeURIComponent(productCode),
      after: b.after ?? { views: 0, clicks: 0, ctr: 0, cr: 0, orders: 0 },
      minKlikSesudah: b.min_klik_sesudah,
      budgetDecision: b.budget_decision ?? null,
    });
    return json(trackerRowToWire(d));
  });
}
