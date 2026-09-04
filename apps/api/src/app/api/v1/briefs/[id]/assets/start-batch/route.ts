/**
 * POST /api/v1/briefs/{id}/assets/start-batch — C2/C3 (docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md). Drives many `[To Do]` Assets of
 * one Brief to `[In Progress]` at once — a separate door from submit-batch
 * on purpose (M7 §5 Rule 1 Turnaround / Speed Score, see `task.
 * startAssetBatch`'s own header). Reuses the same wire shape as submit-batch
 * (`AssetExecLineWire`/`toAssetExecLines`) even though a start line never
 * carries an output link — one request shape for both doors, one converter.
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
    const lines = toAssetExecLines(b.rows);
    const report = await task.startAssetBatch(db(), actor, id, lines.map((l) => l.assetId));
    return json(assetExecBatchReportToWire(report));
  });
}
