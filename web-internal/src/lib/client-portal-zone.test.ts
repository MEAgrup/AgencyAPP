/**
 * Guards the multi-zone rewrite that serves the Client Portal under
 * `app.meagency.co.id/klien/*` (DECISIONS.md 2026-09-01).
 *
 * This locks the CAUSE of a live outage, not its symptom. `/klien/:path*` on
 * its own looks complete — path-to-regexp matches `/klien` with zero segments,
 * and `next dev` / `next start` compile the destination back down to `/klien`,
 * so every local check passed while the deployed front door was dead.
 *
 * Vercel's edge does not compile, it substitutes. It applies the
 * routes-manifest regex `^/klien(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?(?:/)?$` and
 * puts the EMPTY capture into `…/klien/:path*` as a string, so the portal is
 * asked for `/klien/` — trailing slash included. The portal answers
 * `308 → /klien` (trailingSlash: false), the browser resolves that against the
 * shared domain, and the request comes straight back: ERR_TOO_MANY_REDIRECTS
 * on `/klien` while `/klien/login` and every deeper path served fine.
 *
 * A source with no parameters compiles to a literal route with a literal
 * destination, so there is no empty capture to substitute. That is the entry
 * these tests protect — deleting it as "redundant with the catch-all" is
 * exactly the reasoning that caused the outage.
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

interface Rewrite {
  source: string;
  destination: string;
}

async function portalRewrites(): Promise<Rewrite[]> {
  const rewrites = await nextConfig.rewrites!();
  const all = (Array.isArray(rewrites) ? rewrites : rewrites.afterFiles) as Rewrite[];
  return all.filter((r) => r.source.startsWith('/klien'));
}

describe('Client Portal zone rewrite', () => {
  it('has a parameterless entry for the bare /klien', async () => {
    const sources = (await portalRewrites()).map((r) => r.source);
    expect(sources).toContain('/klien');
  });

  it('puts the bare entry BEFORE the catch-all, or the catch-all wins', async () => {
    const sources = (await portalRewrites()).map((r) => r.source);
    // Guard the guard: a missing entry gives indexOf === -1, which would sail
    // past a bare "is less than" comparison.
    expect(sources.indexOf('/klien')).toBeGreaterThanOrEqual(0);
    expect(sources.indexOf('/klien')).toBeLessThan(sources.indexOf('/klien/:path*'));
  });

  it('sends the bare /klien to a slash-free, parameter-free destination', async () => {
    const bare = (await portalRewrites()).find((r) => r.source === '/klien');
    // A `:param` here would reintroduce the empty-capture substitution, and a
    // trailing slash would hand the portal the very path it redirects away
    // from — either one restores the loop.
    expect(bare?.destination).not.toMatch(/:[a-zA-Z]/);
    expect(bare?.destination).toMatch(/\/klien$/);
  });

  it('still forwards deeper paths through the catch-all', async () => {
    const deep = (await portalRewrites()).find((r) => r.source === '/klien/:path*');
    expect(deep?.destination).toMatch(/\/klien\/:path\*$/);
  });
});
