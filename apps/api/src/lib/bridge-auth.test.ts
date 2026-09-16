/**
 * Shared secret gates for the two machine bridge ingest routes. Pure — no DB,
 * no route — pinning the one thing that must never regress: only a
 * configured secret, presented as `Authorization: Bearer <secret>`, opens the
 * gate; everything else (including an unconfigured environment) is closed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bridgePxSecretOk, bridgeSecretOk } from './bridge-auth';

const prevIngest = process.env.BRIDGE_INGEST_SECRET;
const prevPx = process.env.BRIDGE_PX_SECRET;

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/internal/bridge/x', { method: 'POST', headers });
}

beforeEach(() => {
  delete process.env.BRIDGE_INGEST_SECRET;
  delete process.env.BRIDGE_PX_SECRET;
});
afterEach(() => {
  if (prevIngest === undefined) delete process.env.BRIDGE_INGEST_SECRET;
  else process.env.BRIDGE_INGEST_SECRET = prevIngest;
  if (prevPx === undefined) delete process.env.BRIDGE_PX_SECRET;
  else process.env.BRIDGE_PX_SECRET = prevPx;
});

describe('bridgeSecretOk — fail-closed', () => {
  it('rejects when unconfigured, whatever is presented', () => {
    expect(bridgeSecretOk(req({ authorization: 'Bearer anything' }))).toBe(false);
  });
  it('accepts the exact configured secret', () => {
    process.env.BRIDGE_INGEST_SECRET = 's3cr3t';
    expect(bridgeSecretOk(req({ authorization: 'Bearer s3cr3t' }))).toBe(true);
  });
  it('rejects a wrong secret and a non-Bearer scheme', () => {
    process.env.BRIDGE_INGEST_SECRET = 's3cr3t';
    expect(bridgeSecretOk(req({ authorization: 'Bearer nope' }))).toBe(false);
    expect(bridgeSecretOk(req({ authorization: 'Basic s3cr3t' }))).toBe(false);
    expect(bridgeSecretOk(req())).toBe(false);
  });
});

describe('bridgePxSecretOk — fail-closed, SEPARATE secret from bridgeSecretOk (PX-M3-B)', () => {
  it('rejects when unconfigured, whatever is presented', () => {
    expect(bridgePxSecretOk(req({ authorization: 'Bearer anything' }))).toBe(false);
  });
  it('accepts the exact configured secret', () => {
    process.env.BRIDGE_PX_SECRET = 'px-s3cr3t';
    expect(bridgePxSecretOk(req({ authorization: 'Bearer px-s3cr3t' }))).toBe(true);
  });
  it('rejects a wrong secret, a right-prefix-wrong-length secret, and a non-Bearer scheme', () => {
    process.env.BRIDGE_PX_SECRET = 'px-s3cr3t';
    expect(bridgePxSecretOk(req({ authorization: 'Bearer px-s3cr3' }))).toBe(false);
    expect(bridgePxSecretOk(req({ authorization: 'Basic px-s3cr3t' }))).toBe(false);
    expect(bridgePxSecretOk(req())).toBe(false);
  });
  it('BRIDGE_INGEST_SECRET being set does NOT satisfy bridgePxSecretOk — rotating one must never open the other', () => {
    process.env.BRIDGE_INGEST_SECRET = 'ingest-secret';
    expect(bridgePxSecretOk(req({ authorization: 'Bearer ingest-secret' }))).toBe(false);
  });
});
