/**
 * Request authentication: verify the Supabase (GoTrue) access token and resolve
 * the CDPS Actor from its `app_metadata` claim.
 *
 * The token is a GoTrue-issued JWT signed either with the project's legacy
 * symmetric secret (HS256, `SUPABASE_JWT_SECRET`) or its current asymmetric key
 * (ES256, verified against `SUPABASE_JWT_PUBLIC_JWK` — the project JWKS). Both
 * are accepted so the API survives a Supabase JWT-signing-key migration. Its
 * `app_metadata` is populated by our
 * `custom_access_token_hook` (migration 20260102000004) with the five CDPS
 * claims. We re-derive the Actor from those claims via `permission.actorFromClaims`
 * — the SAME mapping the SQL `employee_claims` and Go `ResolveActor` use, so the
 * three never diverge (HANDOFF_FASE1_SESI4 §7). This module only checks the
 * token's authenticity and freshness; authorization is the RLS/role layer.
 *
 * Framework-free (node:crypto only), so it is unit-testable without Next.
 */
import {
  createHmac,
  timingSafeEqual,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
  type JsonWebKey,
} from 'node:crypto';
import { permission } from '@cdps/core';
import { UnauthorizedError } from './http';

type Actor = permission.Actor;

/** Decoded JWT payload we care about (extra claims are ignored). */
interface JwtPayload {
  app_metadata?: unknown;
  exp?: number;
  nbf?: number;
  [k: string]: unknown;
}

function base64urlDecode(part: string): Buffer {
  return Buffer.from(part, 'base64url');
}

/** Splits a compact JWS into its three segments plus the decoded header. */
function decodeJws(token: string): {
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
  header: { alg?: string; kid?: string; typ?: string };
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('malformed token');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string; typ?: string };
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed token header');
  }
  return { headerB64, payloadB64, signatureB64, header };
}

/** Parses the payload and enforces exp/nbf (shared by both alg paths). */
function decodePayload(payloadB64: string, now: number): JwtPayload {
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed token payload');
  }
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) {
    throw new UnauthorizedError('token expired');
  }
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) {
    throw new UnauthorizedError('token not yet valid');
  }
  return payload;
}

/**
 * verifyJwtHS256 verifies a compact JWS (HS256 only) against `secret` and
 * returns the decoded payload. Throws UnauthorizedError on any failure:
 * malformed token, a non-HS256/`none` alg (algorithm confusion is rejected
 * up front), a bad signature (constant-time compared), or an expired/not-yet
 * -valid token. `now` is injectable for testing.
 */
export function verifyJwtHS256(token: string, secret: string, now: number = Date.now()): JwtPayload {
  if (!secret) {
    throw new UnauthorizedError('server auth secret not configured');
  }
  const { headerB64, payloadB64, signatureB64, header } = decodeJws(token);
  // Only HS256 — never trust the token's own choice of a weaker/none alg.
  if (header.alg !== 'HS256') {
    throw new UnauthorizedError(`unsupported token alg: ${String(header.alg)}`);
  }

  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const provided = base64urlDecode(signatureB64);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorizedError('bad token signature');
  }
  return decodePayload(payloadB64, now);
}

/**
 * Resolves the ES256 (ECDSA P-256) public key for verification from the
 * environment. `SUPABASE_JWT_PUBLIC_JWK` holds the project's asymmetric
 * verifying key(s) — a single JWK, a bare array of JWKs, or a whole JWKS
 * (`{ "keys": [...] }`), exactly as served at
 * `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. When the token names a `kid`
 * we pick that key; otherwise the first EC/ES256 key.
 */
function es256PublicKey(kid?: string): KeyObject {
  const raw = process.env.SUPABASE_JWT_PUBLIC_JWK ?? '';
  if (!raw) {
    throw new UnauthorizedError('server ES256 public key not configured');
  }
  let jwks: Array<Record<string, unknown>>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      jwks = parsed as Array<Record<string, unknown>>;
    } else if (parsed && Array.isArray((parsed as { keys?: unknown }).keys)) {
      jwks = (parsed as { keys: Array<Record<string, unknown>> }).keys;
    } else {
      jwks = [parsed as Record<string, unknown>];
    }
  } catch {
    throw new UnauthorizedError('server ES256 public key malformed');
  }
  const candidates = jwks.filter(
    (k) => (k.kty === undefined || k.kty === 'EC') && (k.alg === undefined || k.alg === 'ES256'),
  );
  const jwk = (kid ? candidates.find((k) => k.kid === kid) : undefined) ?? candidates[0] ?? jwks[0];
  if (!jwk) {
    throw new UnauthorizedError('no ES256 verifying key available');
  }
  try {
    return createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  } catch {
    throw new UnauthorizedError('server ES256 public key invalid');
  }
}

/**
 * verifyJwtES256 verifies a compact JWS signed with ECDSA P-256 (ES256) against
 * the project's asymmetric public key. GoTrue emits raw (IEEE P1363) r||s
 * signatures, so node's verify is told `dsaEncoding: 'ieee-p1363'`. Same
 * failure surface as the HS256 path. `now` is injectable for testing.
 */
export function verifyJwtES256(token: string, now: number = Date.now()): JwtPayload {
  const { headerB64, payloadB64, signatureB64, header } = decodeJws(token);
  if (header.alg !== 'ES256') {
    throw new UnauthorizedError(`unsupported token alg: ${String(header.alg)}`);
  }
  const ok = cryptoVerify(
    'sha256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    { key: es256PublicKey(header.kid), dsaEncoding: 'ieee-p1363' },
    base64urlDecode(signatureB64),
  );
  if (!ok) {
    throw new UnauthorizedError('bad token signature');
  }
  return decodePayload(payloadB64, now);
}

/**
 * verifyJwt verifies a GoTrue access token whether the project signs with the
 * legacy symmetric secret (HS256, `SUPABASE_JWT_SECRET`) or the current
 * asymmetric key (ES256, `SUPABASE_JWT_PUBLIC_JWK`) — so the API keeps working
 * across a Supabase JWT-signing-key migration. The alg is read from the header
 * and routed to the matching verifier; `none`/unknown algs fall through to the
 * HS256 verifier, which rejects them (no algorithm-confusion downgrade).
 */
export function verifyJwt(token: string, secret: string, now: number = Date.now()): JwtPayload {
  const { header } = decodeJws(token);
  if (header.alg === 'ES256') {
    return verifyJwtES256(token, now);
  }
  return verifyJwtHS256(token, secret, now);
}

/**
 * actorFromToken verifies the token and maps its app_metadata to an Actor. A
 * token with no resolved CDPS employee (hook did not inject claims) is treated
 * as unauthorized — mirroring RLS, which would deny every row anyway.
 */
export function actorFromToken(token: string, secret: string, now?: number): Actor {
  const payload = verifyJwt(token, secret, now);
  try {
    return permission.actorFromClaims(payload.app_metadata);
  } catch {
    throw new UnauthorizedError('token carries no CDPS employee claim');
  }
}

/** Extracts the bearer token from an Authorization header, or throws. */
export function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    throw new UnauthorizedError('missing bearer token');
  }
  return value.trim();
}

/**
 * Name of the httpOnly cookie holding the GoTrue access token. The auth BFF
 * (/api/v1/auth/login) sets it; web-internal sends it back automatically with
 * `credentials: 'include'`, so browser pages never handle the token directly.
 */
export const SESSION_COOKIE = 'cdps_access_token';

/** Reads a named cookie from the request's Cookie header, or null. */
export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * tokenFromRequest resolves the access token from either the Authorization
 * bearer header (API/service callers) or the session cookie (browser). Throws
 * UnauthorizedError when neither is present.
 */
export function tokenFromRequest(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) {
    return value.trim();
  }
  const cookie = cookieValue(req, SESSION_COOKIE);
  if (cookie) return cookie;
  throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
}

/**
 * requireActor is the handler entry point: resolve the access token (bearer OR
 * session cookie), verify it, and resolve the Actor. Throws UnauthorizedError
 * (→ 401) when anything is missing or invalid.
 */
export function requireActor(req: Request): Actor {
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';
  return actorFromToken(tokenFromRequest(req), secret);
}

/** Serializes the Set-Cookie header that stores the session token (httpOnly,
 *  SameSite=Lax, Secure in production). `maxAgeSec` mirrors the token TTL. */
export function sessionCookie(token: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

/** Serializes the Set-Cookie header that clears the session token (logout). */
export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
