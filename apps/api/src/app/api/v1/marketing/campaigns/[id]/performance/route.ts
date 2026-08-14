/** /api/v1/marketing/campaigns/{id}/performance — create record (POST) + record+metrics (GET) (M2 §3/§4). */
import { marketing } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { marketingMetricsToWire, performanceRecordToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ budget?: string }>(request);
    return json(performanceRecordToWire(await marketing.createRecord(db(), actor, id, b.budget ?? '')));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // P-1: ONE claim-scoped transaction for both reads. Two readAsActor calls meant
    // two full BEGIN → set_config → SET ROLE → … → COMMIT cycles back to back —
    // the claim envelope paid for twice on a single GET. Same reads, same gates.
    const { record, metrics } = await readAsActor(actor, async (sql) => {
      const [rec, met] = await Promise.all([
        marketing.getRecord(sql, actor, id),
        marketing.metrics(sql, actor, id),
      ]);
      return { record: rec, metrics: met };
    });
    return json({ record: performanceRecordToWire(record), metrics: marketingMetricsToWire(metrics) });
  });
}
