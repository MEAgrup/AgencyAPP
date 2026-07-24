/**
 * Unit tests for the asymmetric (ES256/RS256) token path — the signing scheme
 * newer Supabase projects use. Key pairs are generated here with node:crypto, a
 * JWKS is assembled from their public halves, and it is injected via `fetchImpl`
 * so the whole verify path runs without a live GoTrue or network.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actorFromAccessToken, verifyJwt } from './auth';
import { _resetJwksCache, type FetchLike } from './jwks';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

const ec: KeyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa: KeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Builds a JWKS JSON body from (kid, publicKey, alg) triples. */
function jwks(entries: Array<{ kid: string; key: KeyObject; alg: string }>): string {
  return JSON.stringify({
    keys: entries.map(({ kid, key, alg }) => ({
      ...(key.export({ format: 'jwk' }) as Record<string, unknown>),
      kid,
      alg,
      use: 'sig',
    })),
  });
}

/** A fetchImpl that always serves the given JWKS body (200 OK). */
function jwksFetch(body: string): FetchLike {
  return async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Signs a compact JWS with an asymmetric key. ES* → raw r||s (JOSE). */
function signAsym(
  payload: Record<string, unknown>,
  privateKey: KeyObject,
  alg: string,
  kid: string,
): string {
  const h = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const data = Buffer.from(`${h}.${p}`);
  let sig: Buffer;
  if (alg.startsWith('ES')) {
    sig = cryptoSign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  } else {
    sig = cryptoSign('RSA-SHA256', data, privateKey);
  }
  return `${h}.${p}.${b64url(sig)}`;
}

const staffClaims = {
  app_metadata: { employee_id: 'EMP-9', division: 'Sales', level: 'staff', od: false, director: false },
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeEach(() => {
  _resetJwksCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
});
afterEach(() => {
  _resetJwksCache();
});

describe('verifyJwt — ES256 (asymmetric)', () => {
  it('accepts a valid ES256 token verified against the JWKS', async () => {
    const token = signAsym(staffClaims, ec.privateKey, 'ES256', 'ec-1');
    const payload = await verifyJwt(token, {
      fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])),
    });
    expect((payload.app_metadata as { employee_id: string }).employee_id).toBe('EMP-9');
  });

  it('resolves a CDPS Actor from an ES256 token', async () => {
    const token = signAsym(staffClaims, ec.privateKey, 'ES256', 'ec-1');
    const actor = await actorFromAccessToken(token, {
      fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])),
    });
    expect(actor.employeeId).toBe('EMP-9');
    expect(actor.role).toEqual({ division: 'Sales', level: 'staff', od: false, director: false });
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const token = signAsym(staffClaims, ec.privateKey, 'ES256', 'missing');
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])) }),
    ).rejects.toThrow(/unknown token signing key/);
  });

  it('rejects a forged signature (signed with a different EC key)', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const token = signAsym(staffClaims, other.privateKey, 'ES256', 'ec-1');
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])) }),
    ).rejects.toThrow(/bad token signature/);
  });

  it('rejects a token missing a kid header', async () => {
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
    const p = b64url(JSON.stringify(staffClaims));
    const sig = cryptoSign('sha256', Buffer.from(`${h}.${p}`), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
    const token = `${h}.${p}.${b64url(sig)}`;
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])) }),
    ).rejects.toThrow(/missing key id/);
  });

  it('rejects when the published key alg disagrees with the token alg', async () => {
    // token claims ES256 but the JWKS advertises that kid as RS256
    const token = signAsym(staffClaims, ec.privateKey, 'ES256', 'ec-1');
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'RS256' }])) }),
    ).rejects.toThrow(/does not match/);
  });

  it('rejects an expired ES256 token', async () => {
    const expired = { ...staffClaims, exp: Math.floor(Date.now() / 1000) - 10 };
    const token = signAsym(expired, ec.privateKey, 'ES256', 'ec-1');
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'ec-1', key: ec.publicKey, alg: 'ES256' }])) }),
    ).rejects.toThrow(/expired/);
  });
});

describe('verifyJwt — RS256 (asymmetric)', () => {
  it('accepts a valid RS256 token verified against the JWKS', async () => {
    const token = signAsym(staffClaims, rsa.privateKey, 'RS256', 'rsa-1');
    const payload = await verifyJwt(token, {
      fetchImpl: jwksFetch(jwks([{ kid: 'rsa-1', key: rsa.publicKey, alg: 'RS256' }])),
    });
    expect((payload.app_metadata as { employee_id: string }).employee_id).toBe('EMP-9');
  });

  it('rejects an RS256 forgery (signed with a different RSA key)', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = signAsym(staffClaims, other.privateKey, 'RS256', 'rsa-1');
    await expect(
      verifyJwt(token, { fetchImpl: jwksFetch(jwks([{ kid: 'rsa-1', key: rsa.publicKey, alg: 'RS256' }])) }),
    ).rejects.toThrow(/bad token signature/);
  });
});

describe('verifyJwt — alg gate', () => {
  it('rejects alg "none" outright', async () => {
    const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const p = b64url(JSON.stringify(staffClaims));
    await expect(verifyJwt(`${h}.${p}.`)).rejects.toThrow(/unsupported token alg/);
  });
});
