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
    const record = performanceRecordToWire(await readAsActor(actor, (sql) => marketing.getRecord(sql, actor, id)));
    const metrics = marketingMetricsToWire(await readAsActor(actor, (sql) => marketing.metrics(sql, actor, id)));
    return json({ record, metrics });
  });
}
