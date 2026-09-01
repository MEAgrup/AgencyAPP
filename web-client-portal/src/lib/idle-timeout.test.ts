import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, isIdleExpired } from './idle-timeout';

describe('isIdleExpired', () => {
  const now = 1_000_000_000_000;

  it('is not expired when nothing has been recorded yet', () => {
    expect(isIdleExpired(null, now)).toBe(false);
  });

  it('is not expired exactly at the 4-hour boundary', () => {
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS, now)).toBe(false);
  });

  it('is not expired just under 4 hours idle', () => {
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS + 1, now)).toBe(false);
  });

  it('is expired just past 4 hours idle', () => {
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS - 1, now)).toBe(true);
  });

  it('is expired for an activity timestamp far in the past', () => {
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS * 10, now)).toBe(true);
  });
});
