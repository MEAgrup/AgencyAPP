/**
 * GET /api/v1/vendors/{id} — one vendor record (M6A §7).
 * PUT /api/v1/vendors/{id} — edit the eight §7 fields. Account lead / Director.
 *
 * `status` is deliberately absent from the PUT body: it is a lifecycle, and it
 * moves through `POST /vendors/{id}/status` → `sm_transition` (CLAUDE.md #2).
 * Accepting it here would give the entity a second, unaudited status path.
 */
import { vendor } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { vendorInputFromWire, vendorToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const { id } = await ctx.params;
    return json(vendorToWire(await vendor.getVendor(db(), id)));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    return json(vendorToWire(await vendor.updateVendor(db(), actor, id, vendorInputFromWire(b))));
  });
}
