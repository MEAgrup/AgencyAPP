/**
 * /api/v1/admin/vendor-accounts/{vendorId} — deactivate/reactivate ONE
 * vendor's login account (LT-61 follow-up admin screen). Never deletes the
 * row; drives `vendor.setVendorAccountStatus`, which mirrors
 * `set_employee_banned` (CDPS-side flag + GoTrue `banned_until`, in the same
 * SECURITY DEFINER RPC pattern).
 */
import { vendor } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface StatusBody {
  status_aktif?: boolean;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ vendorId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { vendorId } = await ctx.params;
    const body = await readJson<StatusBody>(request);
    await vendor.setVendorAccountStatus(db(), actor, vendorId, body.status_aktif ?? false);
    return json({ ok: true });
  });
}
