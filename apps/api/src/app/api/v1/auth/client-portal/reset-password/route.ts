/**
 * POST /api/v1/auth/client-portal/reset-password — M15-C2: self-service
 * password-reset COMPLETION (spec §3.3 jalur 2), the landing point of the
 * link GoTrue's recovery email sends.
 *
 * `web-client-portal`'s `/reset-password` page reads the `access_token`
 * GoTrue's redirect carries (URL fragment, per the GoTrue recovery flow) and
 * posts it here — the token never needs decoding client-side. Because
 * `custom_access_token_hook` runs on EVERY token GoTrue issues, including a
 * recovery-flow token, this recovery access token ALREADY carries the same
 * `client_contact_id`/`client_id` claims a normal login token would: it can
 * be resolved with the exact same `actorFromToken` the rest of auth uses,
 * with no separate raw-JWT-decoding path to invent or keep in sync.
 *
 * A recovery token for an employee/vendor is rejected here (403) as a
 * defense-in-depth belt: `forgot-password`'s realm check means one should
 * never be issued in the first place, but this route does not trust that
 * alone.
 *
 * On success the recovery token — a real, still-valid GoTrue session token —
 * becomes the browser's new session cookie directly (no extra re-grant round
 * trip): the contact lands logged in, exactly like a normal login.
 */
import { auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { actorFromToken, CLIENT_PORTAL_SESSION_COOKIE, sessionCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { updatePassword } from '@/lib/gotrue';
import { BadRequestError, handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ access_token?: string; new_password?: string }>(request);
    const accessToken = body.access_token?.trim() ?? '';
    const newPassword = body.new_password ?? '';
    if (accessToken === '' || newPassword === '') {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    const actor = actorFromToken(accessToken, secret);
    if (!permission.isClientContactActor(actor)) {
      throw new auth.ForbiddenError(clientPortalAuth.MSG_NOT_CLIENT_CONTACT);
    }

    auth.validatePassword(newPassword);
    await updatePassword(accessToken, newPassword);
    await clientPortalAuth.clearClientContactMustChangePassword(db(), actor);

    const res = json({ status: 'ok' });
    // Recovery tokens carry their own exp claim; reuse it as the cookie TTL —
    // there is no separate `expires_in` here the way a fresh grant returns one.
    res.headers.append('Set-Cookie', sessionCookie(accessToken, 3600, CLIENT_PORTAL_SESSION_COOKIE));
    return res;
  });
}
