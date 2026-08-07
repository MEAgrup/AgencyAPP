/**
 * POST /api/v1/vendors/{id}/status — move a vendor through the `vendor` machine.
 *
 * `Aktif ⇄ Nonaktif`, either into `Blacklist`, and `Blacklist → Nonaktif`. The
 * way back from a blacklist is deliberately two steps, not one: reinstating a
 * vendor should leave two audit rows and two decisions, and a `Blacklist` with
 * no exit at all would force a raw UPDATE to undo a mistake — the one thing the
 * transition engine exists to make impossible.
 *
 * The lead gate lives inside `sm_transition` (every edge is `require_lead`), so
 * a direct service-role call cannot bypass it either.
 */
import { vendor } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { vendorToWire } from '@/lib/wire';

interface StatusBody {
  status?: vendor.VendorStatus;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<StatusBody>(request);
    const updated = await vendor.setVendorStatus(
      db(),
      actor,
      id,
      b.status ?? vendor.VENDOR_STATUS_NONAKTIF,
    );
    return json(vendorToWire(updated));
  });
}
