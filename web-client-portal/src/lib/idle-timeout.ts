/**
 * Client Portal's own 4-hour idle-session timeout (spec §3.5, OQ-3
 * RESOLVED) — layered entirely at this app's layer, NOT a change to the
 * Supabase project's GoTrue token TTL (which would also shorten the
 * employee/vendor realms' all-day sessions). The underlying access token
 * may still be valid past 4 idle hours; this only forces THIS app to stop
 * trusting it and re-prompt for login, same posture the spec describes
 * ("cek last_activity per request").
 *
 * The timestamp math is exported pure/framework-free so it is unit-testable
 * without a DOM — same split as recovery-token.ts. The localStorage
 * read/write wrappers are the untestable glue (localStorage, not
 * sessionStorage, so idle expiry is still detected after the tab/browser was
 * closed and reopened past the 4-hour mark).
 */

export const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const ACTIVITY_KEY = 'cdps.portal.lastActivity.v1';

/** Pure: true when `lastActivity` is old enough to count as idle-expired at `now`. */
export function isIdleExpired(lastActivity: number | null, now: number): boolean {
  if (lastActivity === null) {
    return false; // nothing recorded yet (fresh login/tab) — not expired
  }
  return now - lastActivity > IDLE_TIMEOUT_MS;
}

function readLastActivity(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Records "the contact did something just now" — called on every API call. */
export function touchActivity(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    // Storage disabled/full — idle enforcement fails open (never expires),
    // same posture as the session cache in portal-auth-context.tsx.
  }
}

/** Clears recorded activity — called on logout so the next login starts fresh. */
export function clearActivity(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // no-op
  }
}

/** The one impure entry point callers use: real clock, real storage. */
export function checkIdleExpired(): boolean {
  return isIdleExpired(readLastActivity(), Date.now());
}
