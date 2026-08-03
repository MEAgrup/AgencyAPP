/**
 * FE↔API route parity guard.
 *
 * Every path `web-internal` calls must be served by a route in `apps/api`. The
 * Go build and the TypeScript build were ported module by module, and nothing
 * checked that the two halves still met at the HTTP boundary — so a handful of
 * endpoints were simply never ported, and the pages that call them 404 in
 * production (`web-internal/next.config.ts` proxies `/api/v1/*` to
 * `agency-app-api`, and the Go backend is archived read-only).
 *
 * This is the same class of defect as C03-F2 (`quote-preview`): a route nobody
 * crossed the HTTP boundary for. A unit test per side passes while the pair is
 * broken. So the assertion here is deliberately about the PAIR.
 *
 * KNOWN_GAPS is the ledger of what is still unported (DECISIONS **O41**). It is
 * expected to SHRINK; adding to it needs a decision entry, because every line in
 * it is a page that does not work.
 */
import { describe, expect, it } from 'vitest';
import { apiRoutes, feCalls, servedBy } from './parity-scan';

/**
 * Endpoints the FE calls that `apps/api` does not serve — the unported remainder
 * of the Go→TS port (DECISIONS O41). Each line is a broken page; the list must
 * only ever shrink.
 */
/**
 * EMPTY as of 2026-07-29 — all six O41 gaps are served. Kept (rather than deleted
 * along with its assertions) because the "every entry is still genuinely missing"
 * test below is what stops a future gap from being parked here silently: adding a
 * line means admitting a page does not work, and needs a DECISIONS entry.
 */
const KNOWN_GAPS = new Set<string>([]);

describe('FE↔API route parity', () => {
  const routes = apiRoutes();
  const calls = feCalls();

  it('finds both route tables (guards against the extraction silently breaking)', () => {
    // If either side ever reads as empty, every other assertion here becomes
    // vacuous — so assert the shape of the inputs, not just the diff.
    expect(routes.size).toBeGreaterThan(150);
    expect(calls.length).toBeGreaterThan(100);
    expect(routes).toContain('GET /me');
    expect(routes).toContain('POST /auth/login');
  });

  const isServed = (call: string) => [...routes].some((route) => servedBy(call, route));

  it('serves every endpoint web-internal calls, except the documented O41 gaps', () => {
    const missing = calls
      .filter(({ call }) => !isServed(call) && !KNOWN_GAPS.has(call))
      .map(({ call, file }) => `${call}  (called from ${file})`);
    expect(missing, `unported endpoints — the FE would 404:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps KNOWN_GAPS honest — every entry is still genuinely missing', () => {
    // When a gap gets ported, this fails until the line is deleted, so the
    // ledger cannot drift into fiction.
    const stale = [...KNOWN_GAPS].filter((gap) => isServed(gap));
    expect(stale, `already served — delete from KNOWN_GAPS: ${stale.join(', ')}`).toEqual([]);
  });

  it('serves the M4 §5 payment-intent handoff (O41 #1)', () => {
    // Positive assertion, not just absence from KNOWN_GAPS: proves the route file
    // is actually discovered on the path web-internal's setPaymentIntent() posts to.
    expect(routes).toContain('POST /clients/{}/payment-intent');
  });

  it('serves the M5 reminder dashboard on the path the FE actually calls', () => {
    // Regression: these were ported to `/reminders[/scan]` while both the FE and
    // Go use `/finance/reminders[/scan]`, so the Reminder Pembayaran page 404'd.
    expect(routes).toContain('GET /finance/reminders');
    expect(routes).toContain('POST /finance/reminders/scan');
    expect(routes).not.toContain('GET /reminders');
    expect(routes).not.toContain('POST /reminders/scan');
  });
});
