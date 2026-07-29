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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const API_V1 = join(REPO_ROOT, 'apps/api/src/app/api/v1');
const FE_LIB = join(REPO_ROOT, 'web-internal/src/lib');

/** HTTP methods a Next route handler may export. */
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

/**
 * The route table apps/api actually serves, as `METHOD /path` with every dynamic
 * segment normalised to `{}` (`[id]` and `${id}` compare equal).
 */
function apiRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of walk(API_V1)) {
    const path = file
      .slice(API_V1.length + 1)
      .replace(/\/route\.ts$/, '')
      .replace(/\[[^\]]+\]/g, '{}');
    const src = readFileSync(file, 'utf8');
    for (const method of METHODS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(src)) {
        routes.add(`${method} /${path}`);
      }
    }
  }
  return routes;
}

/**
 * Reads one string/template literal starting at `open` and returns its raw text
 * plus the index after its closing quote. A regex cannot do this: FE paths embed
 * `${cond ? `?${qs}` : ''}`, i.e. nested template literals AND nested braces, so
 * the argument is scanned with a depth counter instead.
 */
function readLiteral(src: string, open: number): { raw: string; end: number } | null {
  const quote = src[open];
  if (quote !== '`' && quote !== "'" && quote !== '"') {
    return null;
  }
  let raw = '';
  let i = open + 1;
  let depth = 0; // nesting inside ${ ... }
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      raw += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      depth += 1;
      raw += '${';
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      raw += ch;
      i += 1;
      continue;
    }
    if (ch === quote) {
      return { raw, end: i + 1 };
    }
    raw += ch;
    i += 1;
  }
  return null;
}

/** Collapses a raw FE path literal to a comparable route shape. */
function normalisePath(raw: string): string {
  let path = '';
  let i = 0;
  let depth = 0;
  // Replace each balanced ${...} hole with a single {} placeholder.
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth += 1;
        if (raw[i] === '}') depth -= 1;
        i += 1;
      }
      path += '{}';
      continue;
    }
    path += raw[i];
    i += 1;
  }
  return path.replace(/\?.*$/, '').replace(/\/+$/, '');
}

/**
 * Every `api.<method>(<path>)` call in the FE data layer, as `METHOD /path`.
 * Calls whose path is fully computed at runtime (a variable base rather than a
 * literal) cannot be checked statically and are skipped — the count assertion
 * below keeps this from silently checking nothing.
 */
function feCalls(): { call: string; file: string }[] {
  const out: { call: string; file: string }[] = [];
  const callRe = /\bapi\.(get|post|patch|put|del|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*/g;
  for (const entry of readdirSync(FE_LIB)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) {
      continue;
    }
    const src = readFileSync(join(FE_LIB, entry), 'utf8');
    for (const m of src.matchAll(callRe)) {
      const lit = readLiteral(src, m.index + m[0].length);
      if (!lit || lit.raw.startsWith('${')) {
        continue; // computed base — not statically checkable
      }
      const method = m[1].toUpperCase() === 'DEL' ? 'DELETE' : m[1].toUpperCase();
      out.push({
        call: `${method} ${normalisePath(lit.raw)}`,
        file: `web-internal/src/lib/${entry}`,
      });
    }
  }
  return out;
}

/**
 * Does a FE call shape match a served route shape? Compared per path segment:
 * a `{}` on either side matches any single segment, so the FE's
 * `/divisions/Creative/brief-queue` matches the route `/divisions/{}/brief-queue`.
 * A trailing `{}` on the FE side may also be an interpolated query string
 * (`` `/my-tasks${query}` ``), so one extra trailing placeholder is allowed.
 */
function servedBy(feCall: string, route: string): boolean {
  const [feMethod, fePath = ''] = feCall.split(' ');
  const [rtMethod, rtPath = ''] = route.split(' ');
  if (feMethod !== rtMethod) {
    return false;
  }
  const rt = rtPath.split('/');
  const segmentsMatch = (fe: string[]) =>
    fe.length === rt.length && fe.every((seg, i) => seg === rt[i] || seg === '{}' || rt[i] === '{}');

  // An interpolated query string can appear either as its own trailing segment
  // (`/a/${qs}`) or glued to the last one (`` `/my-tasks${query}` `` →
  // `/my-tasks{}`). Try the literal shape first, then those two readings.
  const base = fePath.split('/');
  if (segmentsMatch(base)) {
    return true;
  }
  const last = base[base.length - 1];
  if (last === '{}' && segmentsMatch(base.slice(0, -1))) {
    return true;
  }
  if (last.endsWith('{}') && last.length > 2) {
    return segmentsMatch([...base.slice(0, -1), last.slice(0, -2)]);
  }
  return false;
}

/**
 * Endpoints the FE calls that `apps/api` does not serve — the unported remainder
 * of the Go→TS port (DECISIONS O41). Each line is a broken page; the list must
 * only ever shrink.
 */
const KNOWN_GAPS = new Set([
  // M5 money path — /finance and the transaction detail cannot load.
  'GET /finance/queue', //             Go handleFinanceQueue   → needs finance.queue()
  'GET /transactions/{}', //           Go handleGetTransaction → needs finance.loadTransaction()
  'POST /transactions/{}/schedule', // Go handleCreateSchedule → needs finance.createSchedule()
  'GET /transactions/{}/bermasalah', // Go handleGetBermasalah (POST half exists)
  // M4/M5 — payment intent (scheme + total) is set from the client record.
  'POST /clients/{}/payment-intent', // Go handleSetPaymentIntent
  // M1 — Marketing bulk lead import.
  'POST /leads/bulk', //                Go handleBulkLeads
  // Cross-module audit trail reader (used by the Creative asset history panel).
  'GET /audit', //                      Go handleAudit
]);

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

  it('serves the M5 reminder dashboard on the path the FE actually calls', () => {
    // Regression: these were ported to `/reminders[/scan]` while both the FE and
    // Go use `/finance/reminders[/scan]`, so the Reminder Pembayaran page 404'd.
    expect(routes).toContain('GET /finance/reminders');
    expect(routes).toContain('POST /finance/reminders/scan');
    expect(routes).not.toContain('GET /reminders');
    expect(routes).not.toContain('POST /reminders/scan');
  });
});
