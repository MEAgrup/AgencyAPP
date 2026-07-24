/**
 * POST /api/v1/auth/change-password — change the signed-in employee's password
 * (O38). Powers both the forced first-login change (all provisioned accounts
 * ship with must_change_password=true and a shared default) and an ordinary
 * self-service change.
 *
 * Flow (GoTrue owns the password; see docs/O37_RLS_DECISION_BRIEF / O38):
 *   1. resolve the actor from the session (must be authenticated),
 *   2. verify the CURRENT password by exchanging it at GoTrue (password grant) —
 *      also yields a fresh access token,
 *   3. set the NEW password via GoTrue PUT /auth/v1/user,
 *   4. clear the must_change_password gate (service-role RPC),
 *   5. re-issue a session cookie for the new password and return the refreshed
 *      MeResponse (must_change_password now false).
 *
 * Validation (BI strings): missing fields → 400 default incomplete; too-short or
 * unchanged new password → 400; wrong current password → 401.
 */
import { auth } from '@cdps/domain';
import { requireActor, sessionCookie } from '@/lib/auth';
import { passwordGrant, updatePassword } from '@/lib/gotrue';
import { db, readAs } from '@/lib/db';
import { BadRequestError, handle, json, readJson, UnauthorizedError } from '@/lib/http';

const MIN_LENGTH = 8;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const body = await readJson<{ current_password?: string; new_password?: string }>(request);
    const current = body.current_password ?? '';
    const next = body.new_password ?? '';

    if (!current || !next) {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }
    if (next.length < MIN_LENGTH) {
      throw new BadRequestError('[kata sandi baru minimal 8 karakter]');
    }
    if (next === current) {
      throw new BadRequestError('[kata sandi baru harus berbeda dari kata sandi lama]');
    }

    // Resolve the actor's login email + profile (own row under RLS).
    const me = await readAs(actor, (tx) => auth.getMe(tx, actor));

    // 2. Verify the current password (wrong → 401) and mint a token for THIS
    //    user in one grant.
    let verified;
    try {
      verified = await passwordGrant(me.employee.email, current);
    } catch {
      throw new UnauthorizedError('[kata sandi lama salah]');
    }

    // 3. Set the new password via GoTrue, authenticated with that token.
    await updatePassword(verified.access_token, next);

    // 4. Clear the forced-change gate (service-role RPC).
    await db()`select public.clear_must_change_password(${actor.employeeId})`;

    // 5. Re-issue the session for the new password and return the fresh profile.
    const session = await passwordGrant(me.employee.email, next);
    const refreshed = await readAs(actor, (tx) => auth.getMe(tx, actor));
    const res = json(refreshed);
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in));
    return res;
  });
}
