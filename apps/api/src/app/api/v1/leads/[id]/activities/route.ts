/**
 * GET /api/v1/leads/{id}/activities — every activity across ALL attempts on one
 * lead, newest-first (M1 §6: a contested pool lead has several attempts, and
 * comparing the effort behind them is the point of retaining every attempt).
 *
 * Read-only shell over `activity.listByLead`; rows are narrowed by
 * `prospect_activities_select` because the query runs through `readAsActor`.
 */
import { activity } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { activityToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => activity.listByLead(sql, id));
    return json({ data: rows.map(activityToWire) });
  });
}
