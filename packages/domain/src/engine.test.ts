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

  describe('[Unrespon] (L1, docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md)', () => {
    /** Throwaway lead + attempt pair for a single test; caller deletes both. */
    const seedAttempt = async (attemptId: string, status: string): Promise<{ leadId: string }> => {
      const lead = await sql<{ id: string }[]>`
        insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
        values (${`LD-999999-${attemptId.slice(-4)}`}, 'ZZ Engine Test', '0800', '0800', 'Manual', 'Sales', 'active', 'ZZ-STAFF')
        returning id`;
      await sql`
        insert into prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
        values (${attemptId}, ${lead[0].id}, 'ZZ-STAFF', ${status}, 'ZZ-STAFF')`;
      return { leadId: lead[0].id };
    };
    const cleanupAttempt = async (attemptId: string, leadId: string): Promise<void> => {
      await sql`delete from prospect_attempts where id = ${attemptId}`;
      await sql`delete from leads where id = ${leadId}`;
    };

    it('has exactly the three legal exits, bracketed status last (byte order)', async () => {
      expect(await allowedTransitions(sql, 'prospect_attempt', '[Unrespon]')).toEqual([
        'Contacted', 'Not Qualified', '[Closed - Kalah Kompetisi]',
      ]);
    });

    it('New Lead and Contacted can both age into it', async () => {
      expect(await allowedTransitions(sql, 'prospect_attempt', 'New Lead'))
        .toContain('[Unrespon]');
      expect(await allowedTransitions(sql, 'prospect_attempt', 'Contacted'))
        .toContain('[Unrespon]');
    });

    it('has no edge to Qualified — the only door back in is via the Qualified Form (M0 §4)', async () => {
      expect(await allowedTransitions(sql, 'prospect_attempt', '[Unrespon]'))
        .not.toContain('Qualified');
    });

    it('an edge outside the table (e.g. straight to Qualified) is blocked, not silently allowed', async () => {
      const attemptId = 'PA-999999-0002';
      const { leadId } = await seedAttempt(attemptId, '[Unrespon]');
      try {
        const res = await sql<{ ok: boolean; code: string }[]>`
          select (r->>'ok')::boolean as ok, r->>'code' as code from (
            select sm_transition('prospect_attempt', 'prospect_attempt', 'prospect_attempts',
              'id', 'status', ${attemptId}, 'Qualified', 'SISTEM', true, true) as r
          ) s`;
        expect(res[0].ok).toBe(false);
        expect(res[0].code).toBe('blocked');
        expect(await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`)
          .toEqual([{ status: '[Unrespon]' }]); // nothing written on a blocked transition
      } finally {
        await cleanupAttempt(attemptId, leadId);
      }
    });

    it('require_lead is enforced by SQL itself — a staff actor gets role_denied + the exact BI message', async () => {
      // Real row, real edge (New Lead -> [Unrespon], require_lead=true), actor
      // WITHOUT director/lead — this must be rejected by sm_transition itself,
      // not just by the TypeScript layer (CLAUDE.md §2: enforcement is in the DB).
      const attemptId = 'PA-999999-0001';
      const { leadId } = await seedAttempt(attemptId, 'New Lead');
      try {
        const res = await sql<{ ok: boolean; code: string; message: string }[]>`
          select (r->>'ok')::boolean as ok, r->>'code' as code, r->>'message' as message from (
            select sm_transition('prospect_attempt', 'prospect_attempt', 'prospect_attempts',
              'id', 'status', ${attemptId}, '[Unrespon]', 'ZZ-STAFF', false, false) as r
          ) s`;
        expect(res[0].ok).toBe(false);
        expect(res[0].code).toBe('role_denied');
        expect(res[0].message).toBe('[anda tidak memiliki akses untuk melakukan transisi ini]');
      } finally {
        await cleanupAttempt(attemptId, leadId);
      }
    });
  });
});
