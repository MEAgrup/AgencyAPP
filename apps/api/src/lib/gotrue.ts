/**
 * Minimal Supabase GoTrue client for the auth BFF routes.
 *
 * CDPS login is owned by Supabase GoTrue: the browser never talks to GoTrue
 * directly — web-internal posts email/password to our /api/v1/auth/login, which
 * exchanges them here for a JWT (the access token our custom_access_token_hook
 * stamps with the CDPS claims) and hands the browser an httpOnly cookie. Keeping
 * the exchange server-side means the anon key and the tokens stay off the client.
 *
 * Framework-free: only the Web `fetch`/`Response`. `fetchImpl` is injectable so
 * the login flow is unit-testable without a live GoTrue (no network in tests).
 */
import { UnauthorizedError } from './http';

/** The subset of a GoTrue token response we use. */
export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GoTrueConfig {
  url: string;
  anonKey: string;
  fetchImpl?: FetchLike;
}

function config(fetchImpl?: FetchLike): GoTrueConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    // Misconfiguration is a server fault, not a credential problem.
    throw new Error('Supabase URL / anon key not configured');
  }
  return { url, anonKey, fetchImpl };
}

/**
 * passwordGrant exchanges email+password for a GoTrue session via the
 * `token?grant_type=password` endpoint. A 4xx (bad credentials, unconfirmed,
 * banned) surfaces as UnauthorizedError carrying the CDPS BI string
 * `[email atau password salah]` (the authorized Go-era message); other failures
 * throw a generic error → 500.
 */
export async function passwordGrant(
  email: string,
  password: string,
  fetchImpl?: FetchLike,
): Promise<GoTrueSession> {
  const { url, anonKey, fetchImpl: fi } = config(fetchImpl);
  const doFetch = fi ?? fetch;
  const res = await doFetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (res.status >= 400 && res.status < 500) {
    throw new UnauthorizedError('[email atau password salah]');
  }
  if (!res.ok) {
    throw new Error(`GoTrue token grant failed: ${res.status}`);
  }
  return (await res.json()) as GoTrueSession;
}

/**
 * signOut revokes a GoTrue session server-side (best-effort). A failure here
 * never blocks logout — the cookie is cleared regardless by the caller.
 */
export async function signOut(accessToken: string, fetchImpl?: FetchLike): Promise<void> {
  const { url, anonKey, fetchImpl: fi } = config(fetchImpl);
  const doFetch = fi ?? fetch;
  try {
    await doFetch(`${url}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    // best-effort; the cookie is cleared by the route regardless
  }
}

/**
 * updatePassword sets the password of the user the access token belongs to, via
 * GoTrue's `PUT /auth/v1/user`.
 *
 * Deliberately uses the USER's own token, not a service-role key: `apps/api` has
 * no service-role key configured, and it does not need one here — proving
 * possession of the current password (a fresh `passwordGrant`) yields exactly the
 * token this call requires. That also means GoTrue's own rate limiting covers the
 * old-password check, so CDPS does not reimplement the Go-era lockout.
 *
 * A 4xx surfaces as UnauthorizedError: at this point the token came from a
 * successful grant seconds ago, so a rejection means GoTrue refused the change
 * (e.g. same-password reuse policy), not bad credentials.
 */
/**
 * requestPasswordRecovery (M15-C2) triggers GoTrue's own password-recovery
 * email via `POST /auth/v1/recover` — the first self-service email flow in
 * CDPS (docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md §3.3 jalur 2). GoTrue's
 * `recover` endpoint already returns 200 regardless of whether `email`
 * resolves to a user (built-in non-disclosure); the CALLER additionally only
 * invokes this when `email` is confirmed to belong to an ACTIVE
 * `client_contacts` row (see `client.findClientContactByEmailForReset`), so
 * an employee/vendor email never reaches this function at all — the realm
 * boundary is enforced before this call, not by it.
 *
 * `redirectTo` must be present in the Supabase project's allowed redirect
 * URL list (Dashboard → Auth → URL Configuration) — an infra prerequisite,
 * not something this code can configure.
 *
 * Never throws on a 4xx (GoTrue's own non-disclosure) — only a genuine
 * transport/5xx failure surfaces, and even that should not block the
 * caller's generic "ok" response (best-effort, like `signOut`).
 */
export async function requestPasswordRecovery(
  email: string,
  redirectTo: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { url, anonKey, fetchImpl: fi } = config(fetchImpl);
  const doFetch = fi ?? fetch;
  try {
    await doFetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    // best-effort — the caller always reports generic success (non-disclosure)
  }
}

export async function updatePassword(
  accessToken: string,
  newPassword: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { url, anonKey, fetchImpl: fi } = config(fetchImpl);
  const doFetch = fi ?? fetch;
  const res = await doFetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (res.status >= 400 && res.status < 500) {
    throw new UnauthorizedError('[password baru tidak dapat digunakan, silahkan pilih password lain]');
  }
  if (!res.ok) {
    throw new Error(`GoTrue password update failed: ${res.status}`);
  }
}
