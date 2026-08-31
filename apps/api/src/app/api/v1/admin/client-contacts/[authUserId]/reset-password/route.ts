/**
 * POST /api/v1/admin/client-contacts/{authUserId}/reset-password — admin/AM
 * sets a new temporary password for an existing contact (spec §3.3 jalur 1:
 * always available, no email dependency — the companion to the self-service
 * email jalur 2 at /auth/client-portal/forgot-password). Drives
 * `clientPortalAuth.adminResetClientContactPassword`, gated per-record like
 * the other admin/client-contacts endpoints.
 */
import { clientPortalAuth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface ResetBody {
  temp_password?: string;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ authUserId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { authUserId } = await ctx.params;
    const body = await readJson<ResetBody>(request);
    await clientPortalAuth.adminResetClientContactPassword(db(), actor, authUserId, body.temp_password ?? '');
    return json({ ok: true });
  });
}
