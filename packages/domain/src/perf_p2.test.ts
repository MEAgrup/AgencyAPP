/**
 * P-2 regression guard — the record-detail reads must stay CONCURRENT.
 *
 * P-1 removed the N+1 shape (one extra round-trip per ROW). P-2 removes the
 * shape that replaced it as the dominant cost on the Strategi form: one extra
 * round-trip per SECTION. `loadDetail` read nineteen child tables one after the
 * other, and `checkCompleteness` — which §5 step 5 calls live on every autosave —
 * read thirteen more the same way, plus one `count(*)` per `Eksisting` channel.
 * None of those reads consumes another's rows; they were serial only because
 * each `await` sat on its own line. That is exactly the symptom QA reported:
 * "the more fields a form has, the longer it takes to load".
 *
 * A wall-clock assertion would be flaky and would pass on a fast local socket,
 * so these tests assert the thing that is deterministic and that actually
 * matters:
 *
 *   how many statements are IN FLIGHT AT ONCE.
 *
 * Serial code can only ever have one; a batched read has as many as the batch.
 * Re-introducing a `const x = await sql…` line inside either batch drops the
 * peak and fails here immediately.
 *
 * No database: the probe is a fake tagged-template `sql` that answers with the
 * rows each query shape needs. That keeps the guard running in every CI job
 * rather than only where DATABASE_URL is set, and it makes the concurrency
 * measurement exact instead of timing-dependent — a statement is counted from
 * the moment it is created until its promise settles, and nothing settles while
 * a synchronous burst of `Promise.all` arguments is still being evaluated.
 */
import { describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import type { Queryable } from '@cdps/db';
import type { Actor } from './account';
import { checkCompleteness, getStrategi } from './strategi';

const STRATEGI_ID = 'STRG-202608-9999';
const AM = 'ZZ-P2-AM';

const director: Actor = {
  employeeId: 'ZZ-P2-DIR',
  divisi: 'Management',
  role: permission.makeRole({ director: true }),
};

/**
 * A Strategi header row as postgres.js would hand it over. Only the columns
 * `rowToStrategi` cannot survive without are spelled out: the three real dates
 * and the nullable timestamps (a missing one would reach `new Date(undefined)`).
 * Everything else is legitimately absent on a blank Draft.
 */
function headRow(): Record<string, unknown> {
  return {
    id: STRATEGI_ID,
    contract_id: 'CTR-202608-0001',
    client_id: 'CLI-202608-0001',
    versi_no: 1,
    status: '[Draft]',
    durasi_kontrak_bulan: 6,
    tanggal_mulai_kontrak: '2026-09-01',
    tanggal_akhir_kontrak: '2027-02-28',
    tanggal_mulai_siklus: null,
    siklus_terkunci: false,
    toleransi_over_persen: '20',
    diajukan_pada: null,
    disetujui_pada: null,
    sanggahan_diajukan_pada: null,
    created_by: AM,
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

/** `n` Section-B channel blocks, `Eksisting` so the Rule 5 baseline arm runs. */
function channelRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    channel: `Channel-${i + 1}`,
    status_channel: 'Eksisting',
    periode_baseline_bulan: 3,
    lampiran: null,
  }));
}

/** The canned answer for one query, chosen by what the statement reads from. */
function answerFor(text: string, channels: number): unknown[] {
  if (text.includes('from strategi s join contracts')) return [headRow()];
  if (text.includes('from contracts ct join clients')) return [{ assigned_am_id: AM }];
  if (text.includes('from strategi_channel where')) return channelRows(channels);
  // The grouped baseline-coverage read: shaped `channel_id, n`, and an empty
  // result is the honest answer for a fixture with no baseline months.
  if (text.includes('group by b.channel_id')) return [];
  if (text.includes('count(*)')) return [{ n: 0 }];
  if (text.includes('from clients where id')) return [{ link_toko: null }];
  return [];
}

interface Probe {
  sql: Queryable;
  /** The most statements that were ever in flight simultaneously. */
  peak: () => number;
  /** How many statements were issued in total. */
  count: () => number;
}

function probe(channels = 1): Probe {
  let inflight = 0;
  let peak = 0;
  let count = 0;
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    void values;
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    inflight += 1;
    count += 1;
    if (inflight > peak) peak = inflight;
    return Promise.resolve(answerFor(text, channels)).then((rows) => {
      inflight -= 1;
      return rows;
    });
  };
  return { sql: tagged as unknown as Queryable, peak: () => peak, count: () => count };
}

describe('P-2 — the Strategi record reads stay concurrent', () => {
  it('getStrategi issues every child-table read in one batch, not one at a time', async () => {
    const p = probe(2);
    const detail = await getStrategi(p.sql, director, STRATEGI_ID);

    // The batch is 20 entries; two of them fan out into further reads
    // (`clientStoreLinksByChannel` 2, `loadFieldVisibility` 1), so 21 statements
    // are created before any of them can settle. The bound is deliberately
    // loose — what must never happen is the peak collapsing towards 1.
    expect(p.peak()).toBeGreaterThanOrEqual(18);
    // …and the batch must not have quietly grown a serial tail either.
    expect(p.count()).toBe(p.peak() + 2); // + the head row and the owner-AM gate

    // Concurrency did not change the shape the form renders.
    expect(detail.id).toBe(STRATEGI_ID);
    expect(detail.channels).toHaveLength(2);
    expect(detail.akses).toEqual([]);
    expect(detail.riwayat).toEqual([]);
  });

  it('checkCompleteness issues its whole gate in one batch', async () => {
    const p = probe(1);
    const kekurangan = await checkCompleteness(p.sql, STRATEGI_ID);

    // 14 reads in the batch; only the header row precedes it.
    expect(p.peak()).toBeGreaterThanOrEqual(12);
    expect(p.count()).toBe(p.peak() + 1);
    // The gate still reports — a batch that returned nothing would pass a
    // concurrency assertion while breaking the submit gate outright.
    expect(kekurangan.length).toBeGreaterThan(0);
  });

  it('checkCompleteness costs the same number of statements for 1 channel and for 5', async () => {
    const one = probe(1);
    const five = probe(5);
    await checkCompleteness(one.sql, STRATEGI_ID);
    await checkCompleteness(five.sql, STRATEGI_ID);

    // Rule 5 baseline coverage used to be a `count(*)` per `Eksisting` channel,
    // issued from inside the loop — the cost grew with exactly the thing §7
    // budgets for ("full form load < 2s with 5 channel blocks").
    expect(five.count()).toBe(one.count());
  });
});
