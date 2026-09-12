/**
 * PUT /api/v1/clients/{id}/platforms/{pid}/shop-id — PX-M2a §4a: set (or
 * clear) the Shop ID gate value on one client platform row. One field, one
 * verb, its own route: it is NOT part of the client-profile patch, because the
 * profile patch is gated on Account Lead / OD / Director while this is the
 * owning AM's call too (`productexchange.canIsiShopId`) — same reasoning as
 * `platforms/{pid}/tahap-fokus` (see `report.setTahapFokus`).
 *
 * A PUT with `shop_id: null` — or the empty string a blank input submits —
 * clears the field. That is a legitimate state ("this store is not enrolled
 * in Product Exchange"), not a failure.
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json, readJson } from '@/lib/http';

interface Body {
  shop_id?: string | null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string; pid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, pid } = await ctx.params;
    const platformId = Number(pid);
    if (!Number.isInteger(platformId) || platformId <= 0) {
      return errorJson(productexchange.MSG_PLATFORM_NOT_FOUND, 404);
    }
    const b = await readJson<Body>(request);
    const shopId = await productexchange.isiShopId(db(), actor, id, platformId, b.shop_id ?? null);
    // Echoed back so the caller renders what the SERVER stored, not what it
    // sent — and `null` is sent explicitly rather than omitted (O43).
    return json({ shop_id: shopId });
  });
}
