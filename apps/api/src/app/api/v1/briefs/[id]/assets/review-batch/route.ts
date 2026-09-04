/**
 * POST /api/v1/briefs/{id}/assets/review-batch — C4 (docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md). Drives many `[Submitted]` Assets
 * of one Brief to `[In Review]` at once — the AM's side of the batch screen,
 * mirroring submit-batch/start-batch (C2). Reuses `AssetExecLineWire`/
 * `toAssetExecLines` even though a review line never carries an output
 * link — one request shape for every door in this family, one converter.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assetExecBatchReportToWire, toAssetExecLines, type AssetExecLineWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ rows?: AssetExecLineWire[] }>(request);
    const lines = toAssetExecLines(b.rows);
    const report = await creative.reviewAssetBatch(db(), actor, id, lines.map((l) => l.assetId));
    return json(assetExecBatchReportToWire(report));
  });
}
