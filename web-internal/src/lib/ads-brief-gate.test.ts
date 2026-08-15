/**
 * Tests for the /ads create-campaign gate.
 *
 * The failure this guards is not arithmetic, it is a dead end: two Ads briefs
 * sit in the division queue, both `[To Do]`, and the brief dropdown offers
 * nothing — with no reason given. `partitionAdsBriefs` has to keep the
 * `[In Progress]` bucket byte-identical to the server's own gate
 * (packages/domain `ads.createCampaign` → MSG_BRIEF_NOT_IN_PROGRESS), and
 * `gateHint` has to name the *actionable* case (start the brief) instead of the
 * generic "nothing here".
 */
import { describe, expect, it } from 'vitest';
import type { AdsBrief } from './ads';
import { partitionAdsBriefs, gateHint } from './ads-brief-gate';

function brief(id: string, status: string): AdsBrief {
  return {
    id,
    service_id: 'SVC-202608-0002',
    assigned_division: 'Ads',
    assigned_pic: '2602020622',
    deliverable_type: 'Ads spent (Rp)',
    due_date: '2026-09-05',
    priority: 'Medium',
    title: `Ads — ${id}`,
    status,
    created_by: '200000001',
    created_at: '2026-08-12T15:53:13Z',
  };
}

describe('partitionAdsBriefs', () => {
  it('only [In Progress] is selectable — the server rejects anything else', () => {
    const gate = partitionAdsBriefs([
      brief('BRF-1', '[To Do]'),
      brief('BRF-2', '[In Progress]'),
      brief('BRF-3', '[Submitted]'),
      brief('BRF-4', '[Approved]'),
      brief('BRF-5', '[Blocked]'),
    ]);
    expect(gate.selectable.map((b) => b.id)).toEqual(['BRF-2']);
    expect(gate.startable.map((b) => b.id)).toEqual(['BRF-1']);
    expect(gate.blocked.map((b) => b.id)).toEqual(['BRF-3', 'BRF-4', 'BRF-5']);
  });

  it('tolerates a queue that has not loaded yet', () => {
    const gate = partitionAdsBriefs(null);
    expect(gate).toEqual({ selectable: [], startable: [], blocked: [] });
  });

  it('never re-cases or trims a status label', () => {
    // '[in progress]' is not a brief_task label; treating it as one would let the
    // form offer a brief the server then refuses.
    const gate = partitionAdsBriefs([brief('BRF-6', '[in progress]')]);
    expect(gate.selectable).toEqual([]);
    expect(gate.blocked.map((b) => b.id)).toEqual(['BRF-6']);
  });
});

describe('gateHint', () => {
  it('stays silent when the dropdown has something in it', () => {
    expect(gateHint(partitionAdsBriefs([brief('BRF-2', '[In Progress]')]))).toBeNull();
  });

  it('points at the start edge when every brief is [To Do] — the reported case', () => {
    const hint = gateHint(partitionAdsBriefs([brief('BRF-1', '[To Do]'), brief('BRF-2', '[To Do]')]));
    expect(hint).toContain('mulai dulu briefnya');
  });

  it('explains a queue that has moved past [In Progress]', () => {
    const hint = gateHint(partitionAdsBriefs([brief('BRF-3', '[Approved]')]));
    expect(hint).toContain('[In Progress]');
    expect(hint).not.toContain('mulai dulu briefnya');
  });

  it('explains an empty queue', () => {
    expect(gateHint(partitionAdsBriefs([]))).toContain('Belum ada brief divisi Ads');
  });
});
