/** POST /api/v1/bridge/orders/{id}/reject — reason mandatory, same gate as accept. */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bridgeOrderSummaryToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ alasan?: string }>(request);
    const result = await bridge.reject(db(), actor, id, body.alasan ?? '');
    return json(bridgeOrderSummaryToWire(result));
  });
}
