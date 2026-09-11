/**
 * POST /api/v1/bridge/orders/{id}/accept — Head Account/Director accepts a
 * `[Masuk]` order (D10, re-read: lead Account OR Director — see
 * `bridge.canDecideOrder`). `bridgeEmployeeId` is resolved HERE from
 * `MEAGO_BRIDGE_EMPLOYEE_ID` (D5 opsi b — one service employee, never the
 * MEAGO BD's own login), not accepted from the request body: the accepting
 * human does not get to pick who a MEAGO client's `sales_pic_id` is.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bridgeOrderSummaryToWire } from '@/lib/wire';

interface Body {
  existing_client_id?: string | null;
  gmv_baseline?: string;
  target_gmv?: string;
  link_toko?: string;
  kategori?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<Body>(request);
    const result = await bridge.accept(db(), actor, id, {
      existingClientId: body.existing_client_id ?? null,
      gmvBaseline: body.gmv_baseline ?? '',
      targetGmv: body.target_gmv ?? '',
      linkToko: body.link_toko ?? '',
      kategori: body.kategori ?? '',
      bridgeEmployeeId: process.env.MEAGO_BRIDGE_EMPLOYEE_ID ?? '',
    });
    return json(bridgeOrderSummaryToWire(result));
  });
}
