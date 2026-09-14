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
 *
 * M15-C2 follow-up also adds a login rate limit (spec §5.2 OQ-5, DECISIONS.md
 * O64) — 10 FAILED attempts/email+IP/15min, applied UNIFORMLY across all
 * three realms since this endpoint is shared and can't tell them apart until
 * after GoTrue has already run. F-2 (2026-09-14) reworked the bucket: see
 * auth.assertLoginNotRateLimited's doc comment for why it's now two calls
 * (a read-only pre-check, then a failure-only record) instead of one.
 *
 * Client Portal is now served under `app.meagency.co.id/klien/*` — the SAME
 * host as `web-internal` (owner decision 2026-09-01, DECISIONS.md) — so a
 * client-contact session gets its OWN cookie (`CLIENT_PORTAL_SESSION_COOKIE`)
 * instead of sharing `SESSION_COOKIE` with employee/vendor: otherwise an AM
 * with an internal session open who also logs into the Client Portal in the
 * same browser would silently log one or the other out, since both would be
 * writing the same cookie slot.
 */
import { account, auth, clientPortalAuth } from '@cdps/domain';
import { permission } from '@cdps/core';
import {
  actorFromToken,
  CLIENT_PORTAL_SESSION_COOKIE,
  refreshCookie,
  refreshCookieNameFor,
  sessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth';
import { passwordGrant } from '@/lib/gotrue';
import { db, readAsActor } from '@/lib/db';
import { BadRequestError, clientIp, handle, json, readJson, UnauthorizedError } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!email || !password) {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const ip = clientIp(request);
    await auth.assertLoginNotRateLimited(db(), ip, email);

    let session: Awaited<ReturnType<typeof passwordGrant>>;
    try {
      session = await passwordGrant(email, password);
    } catch (err) {
      await auth.recordFailedLoginAttempt(db(), ip, email);
      throw err;
    }
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

    const cookieName = permission.isClientContactActor(actor) ? CLIENT_PORTAL_SESSION_COOKIE : SESSION_COOKIE;
    const res = json(profile);
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in, cookieName));
    // BOTH cookies, always. GoTrue has returned `refresh_token` here since day
    // one and CDPS dropped it on the floor, which is why a session could only
    // ever be ENDED, never renewed — see `refreshGrant`'s doc comment for the
    // three field complaints that one omission produced.
    res.headers.append('Set-Cookie', refreshCookie(session.refresh_token, refreshCookieNameFor(cookieName)));
    return res;
  });
}
