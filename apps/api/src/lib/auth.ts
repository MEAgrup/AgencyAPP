/**
 * Request authentication: verify the Supabase (GoTrue) access token and resolve
 * the CDPS Actor from its `app_metadata` claim.
 *
 * The token is a GoTrue-issued JWT, HS256-signed with the project's JWT secret
 * (`SUPABASE_JWT_SECRET`). Its `app_metadata` is populated by our
 * `custom_access_token_hook` (migration 20260102000004) with the five CDPS
 * claims. We re-derive the Actor from those claims via `permission.actorFromClaims`
 * — the SAME mapping the SQL `employee_claims` and Go `ResolveActor` use, so the
 * three never diverge (HANDOFF_FASE1_SESI4 §7). This module only checks the
 * token's authenticity and freshness; authorization is the RLS/role layer.
 *
 * Framework-free (node:crypto only), so it is unit-testable without Next.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
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
 * actorFromToken verifies the token and maps its app_metadata to an Actor. A
 * token with no resolved CDPS employee (hook did not inject claims) is treated
 * as unauthorized — mirroring RLS, which would deny every row anyway.
 */
export function actorFromToken(token: string, secret: string, now?: number): Actor {
  const payload = verifyJwtHS256(token, secret, now);
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
 * requireActor is the handler entry point: pull the bearer token, verify it, and
 * resolve the Actor. Throws UnauthorizedError (→ 401) when anything is missing
 * or invalid.
 */
export function requireActor(req: Request): Actor {
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';
  return actorFromToken(bearerToken(req), secret);
}
