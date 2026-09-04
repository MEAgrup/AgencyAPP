/**
 * POST /api/v1/briefs/{id}/assets/approve-batch — C4 (docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md). Drives many `[In Review]` Assets
 * of one Brief to `[Approved]` at once — the second, separate door from
 * review-batch (§4 Flow 3: review and approve are distinct actions, never
 * collapsed into one edge). Same wire shape as the rest of this family.
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
    const report = await creative.approveAssetBatch(db(), actor, id, lines.map((l) => l.assetId));
    return json(assetExecBatchReportToWire(report));
  });
}
