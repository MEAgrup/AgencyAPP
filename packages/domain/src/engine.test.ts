/**
 * Tests for the transition-engine introspection reader (`allowedTransitions`).
 *
 * These run against the REAL seeded `sm_edges` table rather than a fixture: the
 * point of the reader is that the buttons a client renders and the moves
 * `sm_transition` will actually accept come from one source. A hand-written
 * fixture would pass while the two drifted apart.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { allowedTransitions } from './engine';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('allowedTransitions', () => {
  it('returns the states reachable in one step, in BYTE order like Go', async () => {
    const from = await allowedTransitions(sql, 'prospect_attempt', 'Contacted');
    expect(from.length).toBeGreaterThan(0);
    // JS sorts by UTF-16 code unit, which for these ASCII statuses IS byte order —
    // the same order Go's `sort.Strings` produced, and what `collate "C"` pins.
    expect([...from].sort()).toEqual(from);
    expect(new Set(from).size).toBe(from.length); // no duplicate edges
  });

  it('puts a bracketed status LAST regardless of the cluster locale', async () => {
    // The regression that caught this: CI's Postgres 17 is initialized with
    // `en_US.utf8`, whose glibc collation deprioritizes punctuation and sorts
    // `[Closed - Kalah Kompetisi]` FIRST; a `C`-collated cluster sorts it LAST.
    // Unpinned, the button order in the API response depended on which locale the
    // database happened to be created with.
    const from = await allowedTransitions(sql, 'prospect_attempt', 'Contacted');
    const bracketed = from.filter((s) => s.startsWith('['));
    expect(bracketed.length).toBeGreaterThan(0);
    for (const b of bracketed) {
      const plain = from.filter((s) => !s.startsWith('['));
      // Every unbracketed status comes before every bracketed one, byte order.
      expect(plain.every((p) => from.indexOf(p) < from.indexOf(b))).toBe(true);
    }
  });

  it('agrees with sm_edges — the same table sm_transition validates against', async () => {
    const rows = await sql<{ machine: string; from_state: string }[]>`
      select machine, from_state from sm_edges group by machine, from_state limit 12`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const expected = await sql<{ to_state: string }[]>`
        select to_state from sm_edges
        where machine = ${r.machine} and from_state = ${r.from_state}
        order by to_state collate "C"`;
      expect(await allowedTransitions(sql, r.machine, r.from_state))
        .toEqual(expected.map((e) => e.to_state));
    }
  });

  it('returns [] — never null — for a terminal state and an unknown machine', async () => {
    // The client iterates the array to decide which buttons exist at all; null
    // would throw instead of rendering a no-action page.
    expect(await allowedTransitions(sql, 'prospect_attempt', 'Closed-Lost')).toEqual([]);
    expect(await allowedTransitions(sql, 'mesin_yang_tidak_ada', 'Apapun')).toEqual([]);
    expect(await allowedTransitions(sql, 'prospect_attempt', '')).toEqual([]);
  });

  it('is read-only — a call leaves the edge table untouched', async () => {
    const before = await sql<{ n: number }[]>`select count(*)::int as n from sm_edges`;
    await allowedTransitions(sql, 'prospect_attempt', 'Contacted');
    const after = await sql<{ n: number }[]>`select count(*)::int as n from sm_edges`;
    expect(after[0].n).toBe(before[0].n);
  });
});
