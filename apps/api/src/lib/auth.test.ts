/**
 * Unit tests for token verification + actor resolution (no Next, no DB). Tokens
 * are minted here with node:crypto so the whole HS256 path is exercised.
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorFromToken,
  bearerToken,
  buildSessionCookie,
  clearSessionCookie,
  requireActor,
  sessionCookie,
  signJwtHS256,
  SESSION_COOKIE,
  verifyJwtHS256,
} from './auth.js';
import { UnauthorizedError } from './http.js';

const SECRET = 'test-jwt-secret-please-change';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(
  payload: Record<string, unknown>,
  secret = SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const staffClaims = {
  app_metadata: { employee_id: 'EMP-1', division: 'Sales', level: 'staff', od: false, director: false },
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('verifyJwtHS256', () => {
  it('accepts a well-formed, unexpired HS256 token', () => {
    const payload = verifyJwtHS256(sign(staffClaims), SECRET);
    expect((payload.app_metadata as { employee_id: string }).employee_id).toBe('EMP-1');
  });

  it('rejects a bad signature (wrong secret)', () => {
    expect(() => verifyJwtHS256(sign(staffClaims, 'other-secret'), SECRET)).toThrow(/signature/);
  });

  it('rejects a non-HS256 alg (algorithm confusion / none)', () => {
    const t = sign(staffClaims, SECRET, { alg: 'none', typ: 'JWT' });
    expect(() => verifyJwtHS256(t, SECRET)).toThrow(/unsupported token alg/);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyJwtHS256('a.b', SECRET)).toThrow(/malformed/);
  });

  it('rejects an expired token', () => {
    const expired = { ...staffClaims, exp: Math.floor(Date.now() / 1000) - 10 };
    expect(() => verifyJwtHS256(sign(expired), SECRET)).toThrow(/expired/);
  });

  it('rejects a not-yet-valid token (nbf in the future)', () => {
    const future = { ...staffClaims, nbf: Math.floor(Date.now() / 1000) + 1000 };
    expect(() => verifyJwtHS256(sign(future), SECRET)).toThrow(/not yet valid/);
  });

  it('honors an injected clock', () => {
    const payload = { ...staffClaims, exp: 2_000 }; // expires at t=2000s
    expect(() => verifyJwtHS256(sign(payload), SECRET, 3_000_000)).toThrow(/expired/);
    expect(verifyJwtHS256(sign(payload), SECRET, 1_000_000)).toBeTruthy(); // t=1000s, still valid
  });

  it('rejects an empty secret', () => {
    expect(() => verifyJwtHS256(sign(staffClaims), '')).toThrow(/secret/);
  });
});

describe('actorFromToken', () => {
  it('resolves a CDPS Actor from app_metadata', () => {
    const actor = actorFromToken(sign(staffClaims), SECRET);
    expect(actor.employeeId).toBe('EMP-1');
    expect(actor.role).toEqual({ division: 'Sales', level: 'staff', od: false, director: false });
  });

  it('rejects a valid token that carries no employee claim', () => {
    const t = sign({ app_metadata: {}, exp: Math.floor(Date.now() / 1000) + 60 });
    expect(() => actorFromToken(t, SECRET)).toThrow(/no CDPS employee/);
  });
});

describe('bearerToken', () => {
  it('extracts the token from an Authorization header', () => {
    const req = new Request('http://x/', { headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(bearerToken(req)).toBe('abc.def.ghi');
  });

  it('throws without a bearer scheme', () => {
    const req = new Request('http://x/', { headers: { authorization: 'Basic zzz' } });
    expect(() => bearerToken(req)).toThrow(UnauthorizedError);
  });

  it('throws when the header is absent', () => {
    expect(() => bearerToken(new Request('http://x/'))).toThrow(/missing bearer/);
  });
});

describe('requireActor', () => {
  const prev = process.env.SUPABASE_JWT_SECRET;
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = prev;
  });

  it('reads the secret from the environment and resolves the actor', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', { headers: { authorization: `Bearer ${sign(staffClaims)}` } });
    expect(requireActor(req).employeeId).toBe('EMP-1');
  });

  it('resolves the actor from the cdps_session cookie (browser login)', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', { headers: { cookie: `foo=bar; ${SESSION_COOKIE}=${sign(staffClaims)}` } });
    expect(requireActor(req).employeeId).toBe('EMP-1');
  });

  it('throws when neither a bearer token nor a session cookie is present', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    expect(() => requireActor(new Request('http://x/'))).toThrow(/missing session/);
  });
});

describe('signJwtHS256', () => {
  it('mints a token that verifyJwtHS256 accepts (round-trip)', () => {
    const token = signJwtHS256(staffClaims, SECRET);
    const payload = verifyJwtHS256(token, SECRET);
    expect((payload.app_metadata as { employee_id: string }).employee_id).toBe('EMP-1');
    // A round-tripped token resolves to the same Actor as a hand-signed one.
    expect(actorFromToken(token, SECRET).employeeId).toBe('EMP-1');
  });

  it('rejects signing with an empty secret', () => {
    expect(() => signJwtHS256(staffClaims, '')).toThrow(/secret/);
  });
});

describe('sessionCookie', () => {
  it('extracts the cdps_session value among other cookies', () => {
    const req = new Request('http://x/', { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok.en.val; b=2` } });
    expect(sessionCookie(req)).toBe('tok.en.val');
  });

  it('returns null when the cookie is absent', () => {
    expect(sessionCookie(new Request('http://x/', { headers: { cookie: 'a=1' } }))).toBeNull();
    expect(sessionCookie(new Request('http://x/'))).toBeNull();
  });
});

describe('session cookie headers', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('build sets HttpOnly/SameSite/Max-Age; clear expires it', () => {
    const set = buildSessionCookie('abc');
    expect(set).toContain(`${SESSION_COOKIE}=abc`);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Max-Age=43200/);
    expect(clearSessionCookie()).toMatch(/Max-Age=0/);
  });

  it('adds Secure only in production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(buildSessionCookie('abc')).not.toMatch(/Secure/);
    vi.stubEnv('NODE_ENV', 'production');
    expect(buildSessionCookie('abc')).toMatch(/Secure/);
  });
});
