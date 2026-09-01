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
 *
 * Reads `requireClientContactActor` (the CLIENT_PORTAL_SESSION_COOKIE-only
 * accessor), not the general `requireActor` — Client Portal now shares
 * `app.meagency.co.id` with `web-internal`, so a browser can legitimately
 * hold BOTH cookies at once (an AM's own internal session, and a
 * client-contact session used to check the Portal). This route is called on
 * every Portal page load to hydrate the session, so it must always resolve
 * the CLIENT cookie specifically — reading the general one first would make
 * the Portal appear broken for exactly the AMs who need to verify it works.
 */
import { account, auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, UnauthorizedError } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
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
