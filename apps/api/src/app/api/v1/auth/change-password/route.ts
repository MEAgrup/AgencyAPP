/**
 * POST /api/v1/auth/change-password — the logged-in employee changes their own
 * password (O44(c) part A). Ports Go's handleChangePassword to the GoTrue world.
 *
 * NOT a verbatim port, and deliberately so: on this stack the password lives in
 * GoTrue, not in `employee_credentials`. Rewriting that table (what the Go code
 * did) would leave the real login password untouched while telling the user it
 * changed. So the flow is:
 *
 *   1. re-grant with the OLD password  → proves possession AND yields a fresh
 *      token scoped to this user (no service-role key needed anywhere)
 *   2. PUT /auth/v1/user with the new password
 *   3. clear_must_change_password()    → only AFTER GoTrue accepted, otherwise a
 *      failed change would leave the forced-change gate open
 *   4. re-grant with the NEW password  → refreshes the session cookie, and
 *      doubles as an end-to-end check that the new password really works
 *
 * Step 1 also means GoTrue's rate limiting guards the old-password check, which
 * is why the Go-era CDPS lockout is not reimplemented here.
 *
 * Not blocked by the forced-change gate — a user who MUST change their password
 * has to be able to reach exactly this endpoint.
 *
 * M15-C2: a client-contact Actor branches the same way the login route does
 * — `getClientContactMe` (privileged read, `client_contacts` is internal
 * murni) instead of `auth.getMe`, and `clearClientContactMustChangePassword`
 * instead of `auth.clearMustChangePassword`. The GoTrue exchange itself
 * (re-grant with old password, `updatePassword`) is realm-agnostic and
 * unchanged — it is the same GoTrue user record either way.
 */
import { auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor, sessionCookie } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { passwordGrant, updatePassword } from '@/lib/gotrue';
import { BadRequestError, handle, json, readJson, UnauthorizedError } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{ old_password?: string; new_password?: string }>(request);
    const oldPassword = body.old_password ?? '';
    const newPassword = body.new_password ?? '';
    if (oldPassword === '' || newPassword === '') {
      throw new BadRequestError(auth.MSG_PASSWORD_INCOMPLETE);
    }
    // Policy before any network call — no point asking GoTrue about a password
    // we already know violates the length rules.
    auth.validatePassword(newPassword);

    // The grant needs the email; the JWT carries only claims, so read the profile.
    const isContact = permission.isClientContactActor(actor);
    const email = isContact
      ? (await clientPortalAuth.getClientContactMe(db(), actor)).email
      : (await readAsActor(actor, (sql) => auth.getMe(sql, actor))).employee.email;

    let session;
    try {
      session = await passwordGrant(email, oldPassword);
    } catch {
      // Any grant failure here means the current password did not match — report
      // that specifically instead of the generic login message.
      throw new auth.OldPasswordError();
    }

    await updatePassword(session.access_token, newPassword);
    if (isContact) {
      await clientPortalAuth.clearClientContactMustChangePassword(db(), actor);
    } else {
      await auth.clearMustChangePassword(db(), actor);
    }

    // Re-grant so the browser leaves with a cookie minted from the NEW password.
    let fresh;
    try {
      fresh = await passwordGrant(email, newPassword);
    } catch {
      // The change succeeded but the re-grant did not: do not pretend the change
      // failed (it did not) — tell the user to log in again with the new one.
      throw new UnauthorizedError('[password berhasil diubah, silahkan login kembali]');
    }

    const res = json({ status: 'ok' });
    res.headers.append('Set-Cookie', sessionCookie(fresh.access_token, fresh.expires_in));
    return res;
  });
}
