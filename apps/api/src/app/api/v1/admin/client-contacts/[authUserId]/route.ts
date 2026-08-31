/**
 * /api/v1/admin/client-contacts/{authUserId} — deactivate/reactivate ONE
 * client contact's login (M15-C2 admin screen). Never deletes the row; drives
 * `clientPortalAuth.setClientContactStatus`, which mirrors
 * `set_client_contact_status` (mirror of `set_vendor_account_status`) and
 * gates per-record (spec §3.2), not up front.
 */
import { clientPortalAuth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface StatusBody {
  status_aktif?: boolean;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ authUserId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { authUserId } = await ctx.params;
    const body = await readJson<StatusBody>(request);
    await clientPortalAuth.setClientContactStatus(db(), actor, authUserId, body.status_aktif ?? false);
    return json({ ok: true });
  });
}
