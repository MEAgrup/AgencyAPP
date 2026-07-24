import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG,
  EVENTS,
  type NotifyEmitArgs,
  type NotifyExecutor,
  emit,
  events,
  isEventType,
} from './notification';

describe('frozen catalog', () => {
  it('has exactly 15 events', () => {
    expect(events()).toHaveLength(15);
  });

  it('matches the Go EventType string values verbatim', () => {
    const want = [
      'm0.negotiation.pending_approval',
      'm0.negotiation.decision',
      'm0m5.installment.due',
      'm5.contract.not_received',
      'm6.complaint.logged',
      'm9.kol.qc_failed_or_escalated',
      'm10.session.discrepancy_flagged',
      'm11.dependency.satisfied',
      'm12.block_request.submitted',
      'm12.block_request.decided',
      'm12.revision_count.flag',
      'm13.client.band_drop',
      'm14.performance.published',
      'm1.lead.co_pursuit',
      'm7.hours_logged.reminder',
    ];
    expect(new Set(events())).toEqual(new Set(want));
  });

  it('every event carries a description and a valid resolver', () => {
    for (const [event, entry] of Object.entries(CATALOG)) {
      expect(event.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(['explicit', 'leadsOfDivision', 'explicitOrLeads']).toContain(entry.resolver);
    }
  });

  it('resolver assignment matches Go NewCatalog', () => {
    expect(CATALOG[EVENTS.NegotiationPendingApproval].resolver).toBe('leadsOfDivision');
    expect(CATALOG[EVENTS.NegotiationDecision].resolver).toBe('explicit');
    expect(CATALOG[EVENTS.InstallmentDue].resolver).toBe('explicitOrLeads');
    expect(CATALOG[EVENTS.PerformancePublished].resolver).toBe('explicit');
    expect(CATALOG[EVENTS.ClientBandDrop].resolver).toBe('leadsOfDivision');
  });
});

describe('isEventType', () => {
  it('accepts cataloged events, rejects others', () => {
    expect(isEventType('m6.complaint.logged')).toBe(true);
    expect(isEventType('m0.unknown')).toBe(false);
    expect(isEventType('')).toBe(false);
  });
});

describe('emit wrapper', () => {
  function fakeExec(notified: string[]): { exec: NotifyExecutor; calls: NotifyEmitArgs[] } {
    const calls: NotifyEmitArgs[] = [];
    return {
      calls,
      exec: {
        notifyEmit: vi.fn(async (args: NotifyEmitArgs) => {
          calls.push(args);
          return { ok: true as const, notified };
        }),
      },
    };
  }

  it('maps an emission to the SQL args and returns notified recipients', async () => {
    const { exec, calls } = fakeExec(['LEAD-1', 'LEAD-2']);
    const notified = await emit(exec, {
      event: EVENTS.ComplaintLogged,
      entityType: 'complaints',
      entityId: 'CPL-202607-0001',
      actor: 'EMP-9',
      division: 'Account',
    });
    expect(notified).toEqual(['LEAD-1', 'LEAD-2']);
    expect(calls[0]).toEqual({
      event: 'm6.complaint.logged',
      entityType: 'complaints',
      entityId: 'CPL-202607-0001',
      actor: 'EMP-9',
      deepLink: '',
      division: 'Account',
      explicit: [],
      notifyActor: false,
    });
  });

  it('passes explicit recipients + notifyActor through', async () => {
    const { exec, calls } = fakeExec(['EMP-1']);
    await emit(exec, {
      event: EVENTS.PerformancePublished,
      entityType: 'performance_scores',
      entityId: 'PERF-202607-0001',
      actor: 'SYSTEM',
      explicitRecipients: ['EMP-1'],
      notifyActor: true,
      deepLink: '/perf/PERF-202607-0001',
    });
    expect(calls[0].explicit).toEqual(['EMP-1']);
    expect(calls[0].notifyActor).toBe(true);
    expect(calls[0].deepLink).toBe('/perf/PERF-202607-0001');
  });

  it('rejects an uncataloged event before touching the DB', async () => {
    const { exec } = fakeExec([]);
    // @ts-expect-error — deliberately passing an uncataloged event at runtime.
    await expect(emit(exec, { event: 'm0.nope', entityType: 'e', entityId: '1', actor: 'A' })).rejects.toThrow(
      /unknown event/,
    );
    expect(exec.notifyEmit).not.toHaveBeenCalled();
  });
});
