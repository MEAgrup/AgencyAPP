/**
 * Request authentication: verify the Supabase (GoTrue) access token and resolve
 * the CDPS Actor from its `app_metadata` claim.
 *
 * The token is a GoTrue-issued JWT. Depending on the project's signing key it is
 * either HS256-signed with the shared JWT secret (`SUPABASE_JWT_SECRET`, legacy)
 * OR asymmetric-signed (ES256/RS256) with a key published at the project JWKS
 * endpoint. Newer Supabase projects default to asymmetric keys, so `verifyJwt`
 * accepts both (the asymmetric half lives in `jwks.ts`). Its `app_metadata` is
 * populated by our `custom_access_token_hook` (migration 20260102000004) with the
 * five CDPS claims. We re-derive the Actor from those claims via
 * `permission.actorFromClaims` — the SAME mapping the SQL `employee_claims` and Go
 * `ResolveActor` use, so the three never diverge (HANDOFF_FASE1_SESI4 §7). This
 * module only checks the token's authenticity and freshness; authorization is the
 * RLS/role layer.
 *
 * Framework-free (node:crypto only), so it is unit-testable without Next.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { permission } from '@cdps/core';
import { UnauthorizedError } from './http';
import { publicKeyForKid, verifyAsymSignature, type FetchLike } from './jwks';

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

/** Decoded JWT header fields we act on. */
interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

/** Splits a compact JWS and decodes its header + payload (no signature check). */
function decodeSegments(token: string): { header: JwtHeader; payload: JwtPayload; headerB64: string; payloadB64: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('malformed token');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed token header');
  }
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed token payload');
  }
  return { header, payload, headerB64, payloadB64, signature: base64urlDecode(signatureB64) };
}

/** Rejects an expired or not-yet-valid token. `now` is ms since epoch. */
function checkTimeClaims(payload: JwtPayload, now: number): void {
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) {
    throw new UnauthorizedError('token expired');
  }
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) {
    throw new UnauthorizedError('token not yet valid');
  }
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
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('malformed token');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed token header');
  }
  // Only HS256 — never trust the token's own choice of a weaker/none alg.
  if (header.alg !== 'HS256') {
    throw new UnauthorizedError(`unsupported token alg: ${String(header.alg)}`);
  }

  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const provided = base64urlDecode(signatureB64);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorizedError('bad token signature');
  }

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
 * actorFromToken verifies an HS256 token and maps its app_metadata to an Actor.
 * Synchronous, HS256-only — retained for the legacy shared-secret path and unit
 * tests. Asymmetric-signed tokens must go through `actorFromAccessToken`.
 */
export function actorFromToken(token: string, secret: string, now?: number): Actor {
  const payload = verifyJwtHS256(token, secret, now);
  try {
    return permission.actorFromClaims(payload.app_metadata);
  } catch {
    throw new UnauthorizedError('token carries no CDPS employee claim');
  }
}

/** Options for the dual-algorithm `verifyJwt` / `actorFromAccessToken`. */
export interface VerifyOptions {
  /** Shared secret for HS256 tokens (defaults to `SUPABASE_JWT_SECRET`). */
  secret?: string;
  /** Injectable fetch for the JWKS request (asymmetric tokens); tests only. */
  fetchImpl?: FetchLike;
  /** Injectable clock in ms since epoch; tests only. */
  now?: number;
}

/**
 * verifyJwt verifies a GoTrue access token signed with EITHER the legacy shared
 * HS256 secret OR an asymmetric key (ES256/RS256) resolved from the project JWKS,
 * and returns the decoded payload. The token's own `alg` header selects the path,
 * but only algorithms we support are ever accepted — `none` and any unknown alg
 * are rejected up front (no algorithm-confusion downgrade). Throws
 * UnauthorizedError on any failure.
 */
export async function verifyJwt(token: string, opts: VerifyOptions = {}): Promise<JwtPayload> {
  const { header, payload, headerB64, payloadB64, signature } = decodeSegments(token);
  const alg = header.alg;

  if (alg === 'HS256') {
    // Reuse the constant-time HS256 path (re-parses, but keeps one audited impl).
    return verifyJwtHS256(token, opts.secret ?? process.env.SUPABASE_JWT_SECRET ?? '', opts.now);
  }

  if (alg === 'ES256' || alg === 'ES384' || alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
    if (!header.kid) {
      throw new UnauthorizedError('token missing key id');
    }
    const resolved = await publicKeyForKid(header.kid, opts.fetchImpl, opts.now);
    if (!resolved) {
      throw new UnauthorizedError('unknown token signing key');
    }
    // The published key's alg must match the token's — never let the token pick.
    if (resolved.alg !== alg) {
      throw new UnauthorizedError('token alg does not match signing key');
    }
    if (!verifyAsymSignature(alg, `${headerB64}.${payloadB64}`, signature, resolved.key)) {
      throw new UnauthorizedError('bad token signature');
    }
    checkTimeClaims(payload, opts.now ?? Date.now());
    return payload;
  }

  throw new UnauthorizedError(`unsupported token alg: ${String(alg)}`);
}

/**
 * actorFromAccessToken verifies a token (HS256 or asymmetric) and maps its
 * app_metadata to an Actor. A token with no resolved CDPS employee (hook did not
 * inject claims) is treated as unauthorized — mirroring RLS, which would deny
 * every row anyway. This is the async counterpart of `actorFromToken`.
 */
export async function actorFromAccessToken(token: string, opts: VerifyOptions = {}): Promise<Actor> {
  const payload = await verifyJwt(token, opts);
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
 * session cookie), verify it (HS256 or asymmetric), and resolve the Actor. Async
 * because asymmetric verification may fetch the project JWKS. Throws
 * UnauthorizedError (→ 401) when anything is missing or invalid.
 */
export async function requireActor(req: Request): Promise<Actor> {
  return actorFromAccessToken(tokenFromRequest(req));
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
