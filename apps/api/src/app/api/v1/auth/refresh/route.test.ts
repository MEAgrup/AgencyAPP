/**
 * POST /api/v1/auth/refresh — route wiring (feedback lapangan 2026-09-14, F-1).
 *
 * `globalThis.fetch` is injected (same pattern as the PDT upload-url route
 * test) so GoTrue is simulated without a network. No database is touched: this
 * route resolves no Actor and reads no table, by design — a refresh has to work
 * for a user whose access token has ALREADY expired, so it can never go through
 * `requireActor`. That is the behaviour these tests pin.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const prevFetch = globalThis.fetch;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
  globalThis.fetch = prevFetch;
});

function req(cookie: string | null, body: unknown = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie !== null) headers.cookie = cookie;
  return new Request('http://localhost/api/v1/auth/refresh', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function gotrue(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

/** All Set-Cookie headers, since one response legitimately writes two. */
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe('POST /auth/refresh', () => {
  it('rotates BOTH cookies on success — the new refresh token must be written back', async () => {
    gotrue(200, { access_token: 'new.a.t', refresh_token: 'rotated-r', expires_in: 3600, token_type: 'bearer' });

    const res = await POST(req('cdps_refresh_token=old-r'));
    expect(res.status).toBe(200);

    const cookies = setCookies(res);
    const access = cookies.find((c) => c.startsWith('cdps_access_token='));
    const refresh = cookies.find((c) => c.startsWith('cdps_refresh_token='));
    expect(access).toContain('new.a.t');
    expect(access).toContain('HttpOnly');
    // GoTrue rotates on every use: keeping `old-r` would kill the session at the
    // NEXT refresh instead of the next expiry — later and less predictable than
    // the bug this route exists to fix.
    expect(refresh).toContain('rotated-r');
    expect(refresh).toContain('HttpOnly');
    // Scoped to the auth routes so the long-lived credential is not attached to
    // every other request in the app.
    expect(refresh).toContain('Path=/api/v1/auth');
  });

  it('401s with the BI string when there is no refresh cookie at all', async () => {
    const res = await POST(req(null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[sesi tidak valid, silahkan login kembali]');
  });

  it('CLEARS both cookies when GoTrue rejects the token — no permanent retry loop', async () => {
    gotrue(400, { error: 'invalid_grant' });

    const res = await POST(req('cdps_refresh_token=dead-r'));
    expect(res.status).toBe(401);

    const cookies = setCookies(res);
    // A dead refresh cookie left in place would be retried on every 401 for the
    // next thirty days.
    expect(cookies.some((c) => c.startsWith('cdps_access_token=;'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('cdps_refresh_token=;'))).toBe(true);
  });

  it('does NOT end the session when GoTrue is merely unavailable (5xx → 500, cookies untouched)', async () => {
    gotrue(503, { error: 'server' });

    const res = await POST(req('cdps_refresh_token=good-r'));
    expect(res.status).toBe(500);
    // Critical distinction: an outage must leave the user logged in so the
    // browser retries, rather than logging out everyone during a blip.
    expect(setCookies(res)).toHaveLength(0);
  });

  it('reads the client-portal realm cookie when the caller says so — realms never share a slot', async () => {
    gotrue(200, { access_token: 'p.a.t', refresh_token: 'p-r', expires_in: 3600, token_type: 'bearer' });

    const res = await POST(
      req('cdps_client_refresh_token=portal-r', { realm: 'client-portal' }),
    );
    expect(res.status).toBe(200);

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('cdps_client_access_token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('cdps_client_refresh_token='))).toBe(true);
    // The employee realm's cookies must not be touched by a portal refresh.
    expect(cookies.some((c) => c.startsWith('cdps_access_token='))).toBe(false);
  });

  it('ignores the OTHER realm cookie: an employee cookie cannot refresh a portal session', async () => {
    const res = await POST(req('cdps_refresh_token=employee-r', { realm: 'client-portal' }));
    expect(res.status).toBe(401);
  });
});
