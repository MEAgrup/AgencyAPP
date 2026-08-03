/**
 * FE↔API request-BODY parity guard.
 *
 * `route-parity.test.ts` proves every path the frontend calls is served. It says
 * nothing about what is *inside* the request, and that hole shipped two live
 * bugs:
 *
 *   1. `POST /attempts/{id}/negotiation` — the FE sends `no_nego`, the route read
 *      `no_negotiation`. So "No Negotiation Required" arrived as `undefined` ⇒
 *      `noNego = false` with zero lines, and the no-negotiation path answered
 *      `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` while
 *      "Negotiation Required" (which does send lines) worked fine.
 *   2. `POST /transactions/{id}/scheme` — the FE sends `payment_intent_scheme`,
 *      the route read `payment_scheme`, so every change-scheme call arrived with
 *      an empty scheme and could only ever fail validation.
 *
 * Both are the O43 shape: the route answers, the *page* is broken, and a unit
 * test per side passes because neither side crosses the boundary. A missing key
 * is worse than a null one here — `undefined === true` is silently `false`, so
 * the request degrades into a differently-shaped valid request instead of an
 * error that names the problem.
 *
 * The assertion is deliberately crude and one-directional: every top-level key
 * the FE sends must appear *somewhere* in the code of the route that serves it.
 * That cannot verify semantics, but it catches the whole class of "the two halves
 * spell it differently", which is the only way these bugs arose. Routes are free
 * to read keys the FE never sends (optional fields, other callers).
 *
 * Keys come from an inline body literal where there is one, and otherwise from the
 * declared interface of a variable body (`api.post(path, input)` where `input:
 * ClosingInput`). Checking only literals would have left the two steps
 * immediately after the negotiation — `/qualify` and `/close`, both variable-body
 * — unguarded, which is precisely the stretch of the lead→transaction flow QA
 * walks next.
 */
import { describe, expect, it } from 'vitest';
import { feCalls, routeFiles, routeFor } from './parity-scan';

/** Keys that are not wire fields at all and never reach a route handler. */
const NOT_WIRE_KEYS = new Set<string>([
  // `api.post(path, body, { signal })`-style option bags are third arguments, not
  // body keys, so nothing here should normally match — kept as an explicit anchor.
]);

describe('FE↔API request-body parity', () => {
  const files = routeFiles();
  const calls = feCalls();
  const writes = calls.filter((c) => c.method !== 'GET' && c.bodyKeys.length > 0);

  it('finds bodies to check (guards against the extraction silently breaking)', () => {
    // Without this, a broken scanner makes every assertion below vacuously green.
    expect(files.length).toBeGreaterThan(150);
    expect(writes.length).toBeGreaterThan(30);
    // The two regressions above must be in scope, by name.
    const paths = writes.map((w) => w.call);
    expect(paths).toContain('POST /attempts/{}/negotiation');
    expect(paths).toContain('POST /transactions/{}/scheme');
    // And so must the rest of the lead→transaction path, including the two
    // variable-body steps that only interface resolution reaches.
    expect(paths).toContain('POST /leads');
    expect(paths).toContain('POST /attempts/{}/qualify');
    expect(paths).toContain('POST /attempts/{}/close');
    expect(writes.filter((w) => w.bodySource === 'interface').length).toBeGreaterThan(10);
  });

  it('resolves nearly every body it finds (an unresolved body checks nothing)', () => {
    // The scanner degrades to `unresolved` rather than to a false pass. Keep that
    // set tiny and named, so drift cannot hide behind a body the scanner gave up on.
    const unresolved = calls
      .filter((c) => c.method !== 'GET' && c.bodySource === 'unresolved')
      .map((c) => `${c.call}  body=${c.bodyObject ?? '?'}  (${c.file})`);
    expect(unresolved, `unresolvable request bodies:\n${unresolved.join('\n')}`).toEqual([]);
  });

  it('reads every body key web-internal sends', () => {
    const drift: string[] = [];
    for (const call of writes) {
      const route = routeFor(call, files);
      if (!route) {
        continue; // an unserved path is route-parity.test.ts's business, not ours
      }
      for (const key of call.bodyKeys) {
        if (NOT_WIRE_KEYS.has(key)) {
          continue;
        }
        // `readsFrom`, not `src`: comments are excluded (these handlers document
        // their own wire contract in prose, and a key named only in a doc comment
        // is not read) while the `@/lib/wire` mappers they delegate to are included.
        if (!new RegExp(`\\b${key}\\b`).test(route.readsFrom)) {
          drift.push(
            `${call.call} sends body.${key}, which ${route.file} never reads` +
              `  (called from ${call.file}, keys via ${call.bodySource})`,
          );
        }
      }
    }
    expect(
      drift,
      `request-body key drift — the route answers but the page is broken:\n${drift.join('\n')}`,
    ).toEqual([]);
  });

  it('accepts the negotiation flag under the name the FE and the Go oracle use', () => {
    // Positive assertion, not just absence from the diff above: the no-negotiation
    // path is the one QA hit, so pin the exact spelling rather than trusting the
    // scanner to keep finding this call.
    const route = files.find((f) => f.path === '/attempts/{}/negotiation');
    expect(route).toBeDefined();
    expect(route?.code).toMatch(/\bno_nego\b/);
  });

  it('accepts the change-scheme field under the name the FE and the Go oracle use', () => {
    const route = files.find((f) => f.path === '/transactions/{}/scheme');
    expect(route).toBeDefined();
    expect(route?.code).toMatch(/\bpayment_intent_scheme\b/);
  });
});
