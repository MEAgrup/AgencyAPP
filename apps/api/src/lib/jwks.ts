/**
 * JWKS-backed public-key resolution for asymmetric GoTrue access tokens.
 *
 * Supabase projects created from mid-2025 on sign user access tokens with an
 * asymmetric signing key (ECC → ES256, or RSA → RS256) instead of the legacy
 * shared HS256 secret. GoTrue publishes the public half at
 * `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. This module fetches that set,
 * caches the parsed public keys by `kid`, and verifies an asymmetric JWS
 * signature — the counterpart to auth.ts's HS256 path so `verifyJwt` accepts a
 * token whichever signing key the project uses (see O36/O37 + GO_LIVE_RUNBOOK).
 *
 * Framework-free (node:crypto + global fetch). `fetchImpl` is injectable so the
 * verification path is unit-testable without a live GoTrue.
 */
import { createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

/** A single JSON Web Key as published by GoTrue. Only signing keys are used. */
interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

interface Jwks {
  keys?: Jwk[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A resolved verification key: the parsed public key + its JWS algorithm. */
export interface ResolvedKey {
  key: KeyObject;
  alg: string;
}

interface CacheEntry {
  keys: Map<string, ResolvedKey>;
  fetchedAt: number;
}

/** Full re-fetch cadence, and a floor between kid-miss re-fetches (anti-hammer). */
const TTL_MS = 10 * 60_000;
const MIN_REFETCH_MS = 30_000;

let cache: CacheEntry | null = null;

/** The algorithms we accept from an asymmetric key (Supabase uses ES256/RS256). */
const ASYM_ALGS = new Set(['ES256', 'ES384', 'RS256', 'RS384', 'RS512']);

function jwksUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!base) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL not configured (needed for JWKS)');
  }
  return `${base}/auth/v1/.well-known/jwks.json`;
}

function defaultAlg(kty: string | undefined): string {
  return kty === 'RSA' ? 'RS256' : 'ES256';
}

async function load(fetchImpl?: FetchLike): Promise<CacheEntry> {
  const doFetch = fetchImpl ?? fetch;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const res = await doFetch(jwksUrl(), { headers: anon ? { apikey: anon } : {} });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as Jwks;
  const keys = new Map<string, ResolvedKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue;
    if (jwk.use && jwk.use !== 'sig') continue; // encryption keys never verify tokens
    const alg = jwk.alg ?? defaultAlg(jwk.kty);
    if (!ASYM_ALGS.has(alg)) continue;
    try {
      // node accepts a JWK directly; a malformed key is skipped, not fatal.
      const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
      keys.set(jwk.kid, { key, alg });
    } catch {
      /* skip an unparseable key rather than fail the whole set */
    }
  }
  return { keys, fetchedAt: Date.now() };
}

/**
 * publicKeyForKid resolves the signing key for a token's `kid`, refreshing the
 * cache when it is stale (TTL) or the kid is unknown (key rotation). A kid-miss
 * re-fetch is rate-limited so a flood of tokens carrying bogus kids cannot force
 * a fetch storm. Returns null when the kid is genuinely absent from the set.
 * `now` is injectable for testing.
 */
export async function publicKeyForKid(
  kid: string,
  fetchImpl?: FetchLike,
  now: number = Date.now(),
): Promise<ResolvedKey | null> {
  const stale = !cache || now - cache.fetchedAt > TTL_MS;
  const kidMiss = !!cache && !cache.keys.has(kid) && now - cache.fetchedAt > MIN_REFETCH_MS;
  if (stale || kidMiss) {
    try {
      cache = await load(fetchImpl);
    } catch (err) {
      if (!cache) throw err; // no cache to fall back on → propagate
      // otherwise serve the stale cache; a bad kid still resolves to null below
    }
  }
  return cache?.keys.get(kid) ?? null;
}

/**
 * verifyAsymSignature checks a JWS signature (`signingInput` = `header.payload`)
 * against a resolved public key. ECDSA (ES*) tokens carry a raw r||s signature
 * (JOSE / IEEE-P1363), not DER, so node is told so explicitly. Returns false —
 * never throws — on any unsupported alg or verification failure.
 */
export function verifyAsymSignature(
  alg: string,
  signingInput: string,
  signature: Buffer,
  key: KeyObject,
): boolean {
  const data = Buffer.from(signingInput);
  try {
    switch (alg) {
      case 'ES256':
        return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
      case 'ES384':
        return cryptoVerify('sha384', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
      case 'RS256':
        return cryptoVerify('RSA-SHA256', data, key, signature);
      case 'RS384':
        return cryptoVerify('RSA-SHA384', data, key, signature);
      case 'RS512':
        return cryptoVerify('RSA-SHA512', data, key, signature);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** Test hook: clear the module-level JWKS cache between cases. */
export function _resetJwksCache(): void {
  cache = null;
}
