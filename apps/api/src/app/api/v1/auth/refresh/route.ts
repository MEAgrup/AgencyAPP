/**
 * POST /api/v1/auth/refresh — trade the refresh cookie for a fresh access
 * cookie, without the user typing anything.
 *
 * ## The hole this closes
 *
 * Until now a CDPS session lasted exactly as long as the access token GoTrue
 * minted at login, counted from the LOGIN, not from the last thing the user
 * did. `refresh_token` was received and discarded (see `refreshGrant`). Three
 * separate complaints in the 2026-09-14 field feedback were that one fact:
 * "lagi ngedit baru klik simpan, udah sesi tidak valid", "user tiba-tiba
 * ter-logout secara otomatis", and Section A–J of the Strategi form losing
 * saved work — the last one because every 20s autosave was silently failing
 * against a dead token.
 *
 * ## Why this route is deliberately dumb
 *
 * It resolves no Actor, reads no database, and returns no profile. A refresh
 * must succeed for a user whose access token is ALREADY expired — that is the
 * entire point — so it cannot go through `requireActor`. Its only input is the
 * refresh cookie, and GoTrue is the sole authority on whether that cookie is
 * still good: it rotates the token on every use and refuses one that logout
 * revoked or whose user was disabled. Adding a CDPS-side check here would mean
 * a second, weaker opinion about whether a session is alive.
 *
 * ## No rate limiter here, on purpose
 *
 * `enforceLoginRateLimit` guards `/auth/login` because a password is guessable.
 * A refresh token is not — it is a 200-bit secret the server itself issued, and
 * GoTrue retires it the moment it is used. Putting the login bucket in front of
 * this route would do the opposite of what this change is for: the whole point
 * is that the browser may refresh many times a day, and a shared-office IP
 * (see `clientIp`) already makes that bucket far too small.
 *
 * ## Realm
 *
 * The caller says which realm it is, the same way `POST /auth/logout` already
 * does (`{ realm: 'client-portal' }`), rather than the server guessing from
 * whichever cookie it happens to find first — a browser can legitimately hold
 * both an employee and a client-contact session at once.
 */
import {
  CLIENT_PORTAL_REFRESH_COOKIE,
  CLIENT_PORTAL_SESSION_COOKIE,
  clearedRefreshCookie,
  clearedSessionCookie,
  cookieValue,
  REFRESH_COOKIE,
  refreshCookie,
  SESSION_COOKIE,
  sessionCookie,
} from '@/lib/auth';
import { refreshGrant } from '@/lib/gotrue';
import { handle, json, readJson, UnauthorizedError } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ realm?: string }>(request).catch(() => ({}) as { realm?: string });
    const isPortal = body.realm === 'client-portal';
    const accessName = isPortal ? CLIENT_PORTAL_SESSION_COOKIE : SESSION_COOKIE;
    const refreshName = isPortal ? CLIENT_PORTAL_REFRESH_COOKIE : REFRESH_COOKIE;

    const token = cookieValue(request, refreshName);
    if (!token) {
      throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
    }

    let session;
    try {
      session = await refreshGrant(token);
    } catch (err) {
      // A 4xx from GoTrue means this refresh token is genuinely finished
      // (expired, revoked at logout, or already rotated). Clear BOTH cookies on
      // the way out: leaving a dead refresh cookie in place would have the
      // browser retry it on every 401 for the next thirty days, turning one
      // expired session into a permanent background failure loop.
      if (err instanceof UnauthorizedError) {
        const res = json({ error: err.message }, 401);
        res.headers.append('Set-Cookie', clearedSessionCookie(accessName));
        res.headers.append('Set-Cookie', clearedRefreshCookie(refreshName));
        return res;
      }
      // Anything else (GoTrue down, network) is NOT the user's session ending.
      // Let it surface as 500 so the browser retries rather than logging out.
      throw err;
    }

    const res = json({ ok: true, expires_in: session.expires_in });
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in, accessName));
    // GoTrue ROTATES the refresh token: the one we just spent is now dead, so
    // the new one has to be written back. Storing only the access token would
    // leave the browser holding a retired refresh token and the session would
    // die at the NEXT refresh instead of the next expiry — a worse bug than the
    // one this route fixes, because it fails later and less predictably.
    res.headers.append('Set-Cookie', refreshCookie(session.refresh_token, refreshName));
    return res;
  });
}
