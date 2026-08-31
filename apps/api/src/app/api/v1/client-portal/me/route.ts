/**
 * GET /api/v1/client-portal/me — M15-C2: the calling contact's own profile.
 * The Client Portal realm's counterpart to `GET /vendor/me` — NOT nested
 * under `/portal/...` because that namespace is already the INTERNAL Team
 * Portal's (`GET /portal/me` = staff landing, module15_portal); reusing it
 * for a wholly different external realm would collide and, worse, invite a
 * future route to accidentally serve one realm's data to the other. Called
 * by `web-client-portal`'s own auth-context to hydrate/revalidate its
 * session, the same way `useVendorAuth()` calls `/vendor/me`.
 *
 * A wrong-realm caller (valid employee/vendor session) gets 403
 * `[akun ini bukan akun kontak klien]`, not 401 — the session itself is fine.
 */
import { account, auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, UnauthorizedError } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!permission.isClientContactActor(actor)) {
      throw new auth.ForbiddenError(clientPortalAuth.MSG_NOT_CLIENT_CONTACT);
    }
    try {
      const contact = await clientPortalAuth.getClientContactMe(db(), actor);
      return json({ contact });
    } catch (err) {
      // getClientContactMe throws account.NotFoundError (client-portal-auth.ts
      // imports NotFoundError from ./account, not ./auth).
      if (err instanceof account.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }
  });
}
