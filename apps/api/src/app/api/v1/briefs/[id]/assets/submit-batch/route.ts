/**
 * POST /api/v1/briefs/{id}/assets/submit-batch — C2/C3 (docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md). Submits many `[In Progress]`
 * Assets of one Brief to `[Submitted]` at once (a screen with N link fields
 * and one button, replacing N separate `window.prompt` round-trips). Same
 * gate as `../route.ts`'s single-Asset submit — `canExecute` per row, not
 * per call — and all-or-nothing: one rejected row means nothing in the batch
 * is written (see `task.submitAssetBatch`'s own header for why).
 *
 * Brief-scoped, not `/assets/submit-batch` global: the Brief row lock is what
 * makes the batch's Asset-lock order safe, and the roll-up recompute at the
 * end targets exactly this one Brief.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assetExecBatchReportToWire, toAssetExecLines, type AssetExecLineWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ rows?: AssetExecLineWire[] }>(request);
    const report = await task.submitAssetBatch(db(), actor, id, toAssetExecLines(b.rows));
    return json(assetExecBatchReportToWire(report));
  });
}
