/**
 * GET /api/v1/bridge/orders — inbox list for `/bridge/inbox`. Optional
 * `?status=` filter (`[Masuk]` for the default queue). Row scope is RLS
 * (`external_orders_select`: lead Account | Director | OD | the AM of the
 * linked client once accepted) — no extra TS gate, same posture as
 * `renewal.listRenewals`.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { bridgeOrderSummaryToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const status = new URL(request.url).searchParams.get('status') ?? undefined;
    const rows = await readAsActor(actor, (sql) => bridge.listOrders(sql, status));
    return json({ data: rows.map(bridgeOrderSummaryToWire) });
  });
}
