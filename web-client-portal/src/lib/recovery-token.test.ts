import { describe, expect, it } from 'vitest';
import { parseAccessTokenFromHash } from './recovery-token';

describe('parseAccessTokenFromHash', () => {
  it('extracts access_token from a GoTrue recovery fragment', () => {
    expect(parseAccessTokenFromHash('#access_token=abc.def.ghi&type=recovery&expires_in=3600')).toBe(
      'abc.def.ghi',
    );
  });

  it('works without a leading #', () => {
    expect(parseAccessTokenFromHash('access_token=xyz&type=recovery')).toBe('xyz');
  });

  it('returns null when access_token is absent', () => {
    expect(parseAccessTokenFromHash('#type=recovery&error=access_denied')).toBeNull();
  });

  it('returns null for an empty fragment', () => {
    expect(parseAccessTokenFromHash('')).toBeNull();
    expect(parseAccessTokenFromHash('#')).toBeNull();
  });

  it('returns null when access_token is present but empty', () => {
    expect(parseAccessTokenFromHash('#access_token=&type=recovery')).toBeNull();
  });
});
