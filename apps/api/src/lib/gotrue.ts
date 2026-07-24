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
