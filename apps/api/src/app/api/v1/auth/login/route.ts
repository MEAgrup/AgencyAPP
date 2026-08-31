/**
 * POST /api/v1/auth/login — email/password → session cookie + MeResponse (or,
 * for a Live Stream vendor, `{ vendor }`).
 *
 * The BFF exchange: take the browser's credentials, trade them with Supabase
 * GoTrue for a JWT (server-side, so the anon key/tokens never reach the client),
 * resolve the actor from that JWT's CDPS claims, load the profile, and hand the
 * browser an httpOnly session cookie. Bad credentials surface as 401 with
 * `[email atau password salah]`; missing fields as 400 with the default
 * incomplete BI string.
 *
 * LT-61: one login endpoint serves both realms (owner decision — branch here
 * rather than a second `POST /vendor/auth/login`, per
 * docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md §2/§3.4). Before
 * this branch, a vendor with a correct password still got a 401: `auth.getMe`
 * always queried `employees` by `actor.employeeId`, which for a vendor Actor
 * holds `vendors.id` — a row that table does not have. `permission.isVendorActor`
 * is checked BEFORE `auth.getMe` runs, so a vendor never hits that query at all.
 *
 * M15-C2 adds a THIRD branch, same reasoning: a client-contact Actor's
 * `employeeId` holds `client_contacts.auth_user_id`, which `employees`/
 * `vendors` do not have either — checked before `auth.getMe`/`auth.getVendorMe`
 * so a client contact never hits either query.
 */
import { account, auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { actorFromToken, sessionCookie } from '@/lib/auth';
import { passwordGrant } from '@/lib/gotrue';
import { db, readAsActor } from '@/lib/db';
import { BadRequestError, handle, json, readJson, UnauthorizedError } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!email || !password) {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const session = await passwordGrant(email, password);
    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    const actor = actorFromToken(session.access_token, secret);

    let profile: unknown;
    try {
      // client_contacts is "internal murni" (zero grant to `authenticated`),
      // so its own-profile read goes through the privileged client like the
      // admin roster functions do — see getClientContactMe's doc comment.
      // Employee/vendor self-reads still run under RLS (readAsActor) via
      // auth.getMe/getVendorMe, unchanged.
      if (permission.isClientContactActor(actor)) {
        profile = { contact: await clientPortalAuth.getClientContactMe(db(), actor) };
      } else if (permission.isVendorActor(actor)) {
        profile = { vendor: await readAsActor(actor, (sql) => auth.getVendorMe(sql, actor)) };
      } else {
        profile = await readAsActor(actor, (sql) => auth.getMe(sql, actor));
      }
    } catch (err) {
      // account.NotFoundError is what getClientContactMe throws (M15-C2) —
      // caught alongside auth.NotFoundError (employee/vendor) so a resolved-
      // but-gone-or-deactivated actor of ANY realm gets the same "session
      // invalid" message here, rather than a bare 404 that reads oddly on a
      // login attempt.
      if (err instanceof auth.NotFoundError || err instanceof account.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }

    const res = json(profile);
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in));
    return res;
  });
}
