/**
 * P2 §6 regression guard: the list endpoints that were paginated STAY
 * paginated, and their wire contract keeps the `next_cursor` key.
 *
 * Why a scanner and not six per-route tests: the failure this guards against is
 * not "pagination is broken" (each route has its own behavioural test) but
 * "someone added a list endpoint, or edited one of these, and quietly went back
 * to reading the whole table". That regression type-checks, passes every
 * existing test, and only shows up in production as a slow page — exactly the
 * class of bug `route-parity`/`shape-parity` exist to catch for their own
 * contracts.
 *
 * A route is "paged" here when it does both halves of the contract:
 *   1. builds a page request from the query string (`page.parseRequest`), and
 *   2. returns `next_cursor` in the response envelope.
 * Doing only (1) bounds the read but leaves the client unable to reach page 2;
 * doing only (2) is a lie. Both, or it is not paged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = join(__dirname, '..', 'app', 'api', 'v1');

/**
 * All six list reads P2 §6 bounded. A route may only leave this list with a
 * DECISIONS.md entry saying why an unbounded read became acceptable again.
 */
const PAGED_ROUTES = [
  'leads/route.ts',
  'leads/pool/route.ts',
  'clients/route.ts',
  'attempts/route.ts',
  'marketing/campaigns/route.ts',
  'renewals/route.ts',
];

/**
 * Deliberately NOT paged, with the reason. An export of "the first 100 rows" is
 * not an export; this endpoint carries its own explicit EXPORT_ROW_CAP instead.
 */
const UNPAGED_BY_DESIGN: Record<string, string> = {
  'leads/export/route.ts': 'CSV export — bounded by EXPORT_ROW_CAP, not by a page',
};

function read(rel: string): string {
  return readFileSync(join(API_ROOT, rel), 'utf8');
}

describe('P2 §6 — paginated list routes stay paginated', () => {
  it.each(PAGED_ROUTES)('%s builds a page request from the query string', (rel) => {
    expect(read(rel)).toContain('page.parseRequest(');
  });

  it.each(PAGED_ROUTES)('%s returns next_cursor in its envelope', (rel) => {
    // Explicitly present on every response, null on the last page — a MISSING
    // key would read to the client as "no more pages" (the O43 failure mode).
    expect(read(rel)).toContain('next_cursor:');
  });

  it('the CSV export stays deliberately unpaged, and says why', () => {
    const rel = Object.keys(UNPAGED_BY_DESIGN)[0];
    const src = read(rel);
    expect(src).not.toContain('page.parseRequest(');
    expect(src).toContain('EXPORT_ROW_CAP');
  });
});
