/**
 * POST /api/v1/auth/logout — clears the session cookie (and best-effort revokes
 * the GoTrue session). Always returns 200 with a cleared cookie, even if the
 * server-side revoke fails or Supabase is unconfigured — logout must never leave
 * the browser holding a live cookie.
 *
 * Realm-agnostic by an explicit hint, not a guess: `{ realm: 'client-portal' }`
 * in the body clears CLIENT_PORTAL_SESSION_COOKIE instead of the general
 * SESSION_COOKIE (default, unchanged — every existing caller that sends no
 * body keeps working exactly as before). Needed because Client Portal now
 * shares `app.meagency.co.id` with `web-internal` (owner decision
 * 2026-09-01, DECISIONS.md): the two cookies can coexist in one browser, and
 * clicking "logout" in ONE app should only end THAT app's session — an AM
 * logging out of the Client Portal they are testing should not also be
 * kicked out of their own internal session. Each frontend already knows
 * which realm it is, so it passes the hint rather than the backend guessing
 * from ambient cookie state.
 */
import { clearedSessionCookie, CLIENT_PORTAL_SESSION_COOKIE, cookieValue, SESSION_COOKIE } from '@/lib/auth';
import { signOut } from '@/lib/gotrue';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ realm?: string }>(request).catch(() => ({}) as { realm?: string });
    const cookieName = body.realm === 'client-portal' ? CLIENT_PORTAL_SESSION_COOKIE : SESSION_COOKIE;

    const token = cookieValue(request, cookieName);
    if (token) {
      try {
        await signOut(token);
      } catch {
        // best-effort; the cookie is cleared regardless
      }
    }
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', clearedSessionCookie(cookieName));
    return res;
  });
}
