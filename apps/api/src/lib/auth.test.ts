/**
 * Unit tests for token verification + actor resolution (no Next, no DB). Tokens
 * are minted here with node:crypto so the whole HS256 path is exercised.
 */
import { createHmac, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorFromToken,
  bearerToken,
  clearedSessionCookie,
  clientContactTokenFromRequest,
  CLIENT_PORTAL_SESSION_COOKIE,
  cookieValue,
  requireActor,
  requireClientContactActor,
  SESSION_COOKIE,
  sessionCookie,
  tokenFromRequest,
  verifyJwt,
  verifyJwtES256,
  verifyJwtHS256,
} from './auth';
import { UnauthorizedError } from './http';

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

const clientContactClaims = {
  app_metadata: { client_contact_id: 'CC-1', client_id: 'CLI-1' },
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

describe('verifyJwtES256 / verifyJwt (asymmetric ES256)', () => {
  // A throwaway P-256 keypair stands in for the project's GoTrue signing key.
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  // Sign a compact JWS with ES256 — raw r||s (IEEE P1363), exactly like GoTrue.
  function signES256(
    payload: Record<string, unknown>,
    key: KeyObject = privateKey,
    header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT', kid: 'test-key' },
  ): string {
    const h = b64url(JSON.stringify(header));
    const p = b64url(JSON.stringify(payload));
    const sig = cryptoSign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
    return `${h}.${p}.${b64url(sig)}`;
  }

  const prev = process.env.SUPABASE_JWT_PUBLIC_JWK;
  beforeEach(() => {
    process.env.SUPABASE_JWT_PUBLIC_JWK = JSON.stringify(publicKey.export({ format: 'jwk' }));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SUPABASE_JWT_PUBLIC_JWK;
    else process.env.SUPABASE_JWT_PUBLIC_JWK = prev;
  });

  it('accepts a well-formed ES256 token against the JWKS public key', () => {
    const payload = verifyJwtES256(signES256(staffClaims));
    expect((payload.app_metadata as { employee_id: string }).employee_id).toBe('EMP-1');
  });

  it('routes ES256 tokens through verifyJwt and resolves the actor', () => {
    // secret is irrelevant for ES256 — the asymmetric key path is taken.
    const actor = actorFromToken(signES256(staffClaims), 'unused-secret');
    expect(actor.employeeId).toBe('EMP-1');
  });

  it('rejects an ES256 token signed by a different key', () => {
    const attacker = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(() => verifyJwtES256(signES256(staffClaims, attacker))).toThrow(/signature/);
  });

  it('rejects an expired ES256 token', () => {
    const expired = { ...staffClaims, exp: Math.floor(Date.now() / 1000) - 10 };
    expect(() => verifyJwtES256(signES256(expired))).toThrow(/expired/);
  });

  it('throws when no ES256 public key is configured', () => {
    delete process.env.SUPABASE_JWT_PUBLIC_JWK;
    expect(() => verifyJwtES256(signES256(staffClaims))).toThrow(/ES256 public key not configured/);
  });

  it('still rejects an alg:none token via verifyJwt (no downgrade)', () => {
    const none = sign(staffClaims, SECRET, { alg: 'none', typ: 'JWT' });
    expect(() => verifyJwt(none, SECRET)).toThrow(/unsupported token alg/);
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

describe('cookieValue', () => {
  it('reads a named cookie from the Cookie header', () => {
    const req = new Request('http://x/', { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok.en.val; b=2` } });
    expect(cookieValue(req, SESSION_COOKIE)).toBe('tok.en.val');
  });

  it('url-decodes the value', () => {
    const req = new Request('http://x/', { headers: { cookie: `${SESSION_COOKIE}=a%20b` } });
    expect(cookieValue(req, SESSION_COOKIE)).toBe('a b');
  });

  it('returns null when the cookie / header is absent', () => {
    expect(cookieValue(new Request('http://x/'), SESSION_COOKIE)).toBeNull();
    const req = new Request('http://x/', { headers: { cookie: 'other=1' } });
    expect(cookieValue(req, SESSION_COOKIE)).toBeNull();
  });
});

describe('tokenFromRequest', () => {
  it('prefers the Authorization bearer header', () => {
    const req = new Request('http://x/', {
      headers: { authorization: 'Bearer header.tok', cookie: `${SESSION_COOKIE}=cookie.tok` },
    });
    expect(tokenFromRequest(req)).toBe('header.tok');
  });

  it('falls back to the session cookie', () => {
    const req = new Request('http://x/', { headers: { cookie: `${SESSION_COOKIE}=cookie.tok` } });
    expect(tokenFromRequest(req)).toBe('cookie.tok');
  });

  it('throws the BI session string when neither is present', () => {
    expect(() => tokenFromRequest(new Request('http://x/'))).toThrow(/\[sesi tidak valid/);
  });

  it('ignores the client-portal cookie even when present — a different accessor reads that one', () => {
    const req = new Request('http://x/', { headers: { cookie: `${CLIENT_PORTAL_SESSION_COOKIE}=client.tok` } });
    expect(() => tokenFromRequest(req)).toThrow(/\[sesi tidak valid/);
  });
});

describe('clientContactTokenFromRequest', () => {
  it('prefers the Authorization bearer header', () => {
    const req = new Request('http://x/', {
      headers: { authorization: 'Bearer header.tok', cookie: `${CLIENT_PORTAL_SESSION_COOKIE}=cookie.tok` },
    });
    expect(clientContactTokenFromRequest(req)).toBe('header.tok');
  });

  it('falls back to the client-portal cookie', () => {
    const req = new Request('http://x/', { headers: { cookie: `${CLIENT_PORTAL_SESSION_COOKIE}=cookie.tok` } });
    expect(clientContactTokenFromRequest(req)).toBe('cookie.tok');
  });

  it('ignores the general session cookie even when present — the two never mix', () => {
    // Both cookies coexisting is the exact scenario this split exists for (an
    // AM's own internal session alongside a client-contact session they are
    // using to check the Portal, same browser, same host).
    const req = new Request('http://x/', { headers: { cookie: `${SESSION_COOKIE}=general.tok` } });
    expect(() => clientContactTokenFromRequest(req)).toThrow(/\[sesi tidak valid/);
  });

  it('throws the BI session string when neither is present', () => {
    expect(() => clientContactTokenFromRequest(new Request('http://x/'))).toThrow(/\[sesi tidak valid/);
  });
});

describe('sessionCookie / clearedSessionCookie', () => {
  it('serializes an httpOnly, SameSite=Lax cookie with the token and Max-Age', () => {
    const c = sessionCookie('a.b.c', 3600);
    expect(c).toContain(`${SESSION_COOKIE}=a.b.c`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=3600');
  });

  it('clears the cookie with Max-Age=0', () => {
    const c = clearedSessionCookie();
    expect(c).toContain(`${SESSION_COOKIE}=;`);
    expect(c).toContain('Max-Age=0');
  });

  it('writes the client-portal cookie name when passed explicitly', () => {
    const c = sessionCookie('a.b.c', 3600, CLIENT_PORTAL_SESSION_COOKIE);
    expect(c).toContain(`${CLIENT_PORTAL_SESSION_COOKIE}=a.b.c`);
    expect(c).not.toContain(`${SESSION_COOKIE}=a.b.c`);
  });

  it('clears the client-portal cookie name when passed explicitly', () => {
    const c = clearedSessionCookie(CLIENT_PORTAL_SESSION_COOKIE);
    expect(c).toContain(`${CLIENT_PORTAL_SESSION_COOKIE}=;`);
    expect(c).toContain('Max-Age=0');
  });
});

describe('requireActor', () => {
  const prev = process.env.SUPABASE_JWT_SECRET;
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = prev;
  });

  it('reads the secret from the environment and resolves the actor (bearer)', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', { headers: { authorization: `Bearer ${sign(staffClaims)}` } });
    expect(requireActor(req).employeeId).toBe('EMP-1');
  });

  it('resolves the actor from the session cookie', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', { headers: { cookie: `${SESSION_COOKIE}=${sign(staffClaims)}` } });
    expect(requireActor(req).employeeId).toBe('EMP-1');
  });

  it('throws when no token is present at all', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    expect(() => requireActor(new Request('http://x/'))).toThrow(UnauthorizedError);
  });
});

describe('requireClientContactActor', () => {
  const prev = process.env.SUPABASE_JWT_SECRET;
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = prev;
  });

  it('resolves the client-contact actor from its own cookie', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', {
      headers: { cookie: `${CLIENT_PORTAL_SESSION_COOKIE}=${sign(clientContactClaims)}` },
    });
    const actor = requireClientContactActor(req);
    expect(actor.clientContactId).toBe('CC-1');
    expect(actor.clientId).toBe('CLI-1');
  });

  it('does not resolve from the general session cookie, even a valid one', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const req = new Request('http://x/', { headers: { cookie: `${SESSION_COOKIE}=${sign(staffClaims)}` } });
    expect(() => requireClientContactActor(req)).toThrow(UnauthorizedError);
  });

  it('throws when no token is present at all', () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    expect(() => requireClientContactActor(new Request('http://x/'))).toThrow(UnauthorizedError);
  });
});
