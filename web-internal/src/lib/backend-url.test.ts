/**
 * The proxy target is the single wire between this app and its data. These
 * tests pin the two things that went wrong in practice: the default silently
 * being something other than apps/api, and a `BACKEND_URL` pointing at the
 * retired Go + MySQL stack passing unnoticed.
 */
import { describe, expect, it } from 'vitest';
import {
  BackendUrlError,
  DEV_BACKEND,
  isRetiredBackend,
  PRODUCTION_BACKEND,
  resolveBackendURL,
} from './backend-url';

describe('defaults', () => {
  it('falls back to the deployed apps/api in production', () => {
    expect(resolveBackendURL({ nodeEnv: 'production' })).toBe(PRODUCTION_BACKEND);
    expect(PRODUCTION_BACKEND).toBe('https://agency-app-api.vercel.app');
  });

  it('falls back to the local apps/api port everywhere else', () => {
    expect(resolveBackendURL({ nodeEnv: 'development' })).toBe(DEV_BACKEND);
    expect(resolveBackendURL({})).toBe(DEV_BACKEND);
  });

  it('never defaults to a retired host', () => {
    for (const env of ['production', 'development', 'test', undefined]) {
      expect(isRetiredBackend(resolveBackendURL({ nodeEnv: env }))).toBe(false);
    }
  });

  it('lets an explicit BACKEND_URL win, including a staging API', () => {
    expect(resolveBackendURL({ backendUrl: 'https://api-staging.example.com' }))
      .toBe('https://api-staging.example.com');
  });
});

describe('isRetiredBackend', () => {
  // Every spelling the Railway topology can take (docs/DEPLOY_RAILWAY.md):
  // the public service domain, the TCP proxy, the private network, and the Go
  // server's own default port.
  const retired = [
    'https://backend-production-1234.up.railway.app',
    'https://cdps.railway.app',
    'https://monorail.proxy.rlwy.net:26954',
    'http://backend.railway.internal:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
  ];
  it.each(retired)('flags %s', (url) => {
    expect(isRetiredBackend(url)).toBe(true);
  });

  const ok = [
    'https://agency-app-api.vercel.app',
    'http://127.0.0.1:3001',
    'https://api-staging.example.com',
    // Not a Railway host just because the word appears in it.
    'https://railway-notes.example.com',
  ];
  it.each(ok)('allows %s', (url) => {
    expect(isRetiredBackend(url)).toBe(false);
  });
});

describe('rejection', () => {
  it('fails the build for a Railway BACKEND_URL, naming the correct value', () => {
    const bad = 'https://backend-production-1234.up.railway.app';
    expect(() => resolveBackendURL({ backendUrl: bad })).toThrow(BackendUrlError);
    try {
      resolveBackendURL({ backendUrl: bad });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain(bad);
      expect(msg).toContain(PRODUCTION_BACKEND);
      expect(msg).toContain('ALLOW_LEGACY_BACKEND_URL');
    }
  });

  it('fails for a malformed BACKEND_URL instead of proxying to nowhere', () => {
    expect(() => resolveBackendURL({ backendUrl: 'agency-app-api.vercel.app' }))
      .toThrow(BackendUrlError);
  });

  it('treats whitespace-only BACKEND_URL as unset', () => {
    expect(resolveBackendURL({ backendUrl: '   ', nodeEnv: 'production' })).toBe(PRODUCTION_BACKEND);
  });

  it('honours the escape hatch, but not a "0" that reads like off', () => {
    const bad = 'http://backend.railway.internal:8080';
    expect(resolveBackendURL({ backendUrl: bad, allowLegacy: '1' })).toBe(bad);
    expect(() => resolveBackendURL({ backendUrl: bad, allowLegacy: '0' })).toThrow(BackendUrlError);
    expect(() => resolveBackendURL({ backendUrl: bad, allowLegacy: '' })).toThrow(BackendUrlError);
  });
});
