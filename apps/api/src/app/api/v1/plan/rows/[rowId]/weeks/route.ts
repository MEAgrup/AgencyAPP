/**
 * POST /api/v1/plan/rows/{rowId}/weeks — re-drag a work-row's Section P-D weekly
 * distribution (Rule 7/18): the per-week quotas must sum to the monthly quota,
 * every week must be in range, and the period must be Aktif. All three gates are
 * enforced in the domain (`setWeeklyDistribution`); this route maps the body and
 * shapes the returned cells through `planRowWeekToWire`.
 *
 * `rows` is a static sibling of the `[id]` period segment; a PLAN- id never
 * collides with the literal `rows`.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planRowWeekToWire } from '@/lib/wire';

interface WeeksBody {
  per_week?: { minggu_no?: number; kuota?: number }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ rowId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rowId } = await ctx.params;
    const b = await readJson<WeeksBody>(request);
    const perWeek = (b.per_week ?? []).map((w) => ({
      mingguNo: w.minggu_no as number,
      kuota: w.kuota as number,
    }));
    const weeks = await plan.setWeeklyDistribution(db(), actor, Number(rowId), perWeek);
    return json(weeks.map(planRowWeekToWire));
  });
}
