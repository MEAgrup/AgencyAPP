/**
 * Unit tests for the GoTrue client with an injected fetch — no network, no live
 * Supabase. Exercises the password grant success/failure mapping and the
 * request shape (endpoint, apikey header).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { passwordGrant, signOut } from './gotrue';
import { UnauthorizedError } from './http';

const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('passwordGrant', () => {
  it('exchanges credentials for a session and hits the token endpoint with the apikey', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/auth/v1/token?grant_type=password');
      const headers = init?.headers as Record<string, string>;
      expect(headers.apikey).toBe('anon-key');
      expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.c', password: 'pw' });
      return jsonResponse({ access_token: 'a.b.c', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' });
    });
    const session = await passwordGrant('a@b.c', 'pw', fetchImpl);
    expect(session.access_token).toBe('a.b.c');
    expect(session.expires_in).toBe(3600);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('maps a 400 (bad credentials) to UnauthorizedError with the BI string', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(passwordGrant('a@b.c', 'wrong', fetchImpl)).rejects.toThrow(UnauthorizedError);
    await expect(passwordGrant('a@b.c', 'wrong', fetchImpl)).rejects.toThrow('[email atau password salah]');
  });

  it('maps a 5xx to a generic error (→ 500), not a credential failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'server' }, 503));
    await expect(passwordGrant('a@b.c', 'pw', fetchImpl)).rejects.toThrow(/GoTrue token grant failed: 503/);
  });

  it('throws a server error when Supabase is unconfigured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(passwordGrant('a@b.c', 'pw', vi.fn())).rejects.toThrow(/not configured/);
  });
});

describe('signOut', () => {
  it('calls the logout endpoint with the access token and swallows failures', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/auth/v1/logout');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer a.b.c');
      return new Response(null, { status: 204 });
    });
    await expect(signOut('a.b.c', fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never throws even if the network call rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(signOut('a.b.c', fetchImpl)).resolves.toBeUndefined();
  });
});
