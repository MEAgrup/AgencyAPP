/**
 * GET /api/v1/briefs/{id}/stage — a Brief's tahapan overview (M16 §5.1/§5.3):
 * current `production_stage`, the Cek Brief AM decision (if any), and the full
 * per-tahap lead-time timeline. OD/Director, owning AM, or the target division
 * (`stage.canViewBriefStage`, mirrors `task.canViewTask`).
 */
import { stage } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { stageOverviewToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const overview = await readAsActor(actor, (sql) => stage.getStageOverview(sql, actor, id));
    return json(stageOverviewToWire(overview));
  });
}
