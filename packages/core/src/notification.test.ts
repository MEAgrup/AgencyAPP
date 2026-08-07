import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG,
  CATALOG_VERSION,
  CATALOG_VERSIONS,
  EVENTS,
  type NotifyEmitArgs,
  type NotifyExecutor,
  emit,
  events,
  eventsOfVersion,
  isEventType,
  registeredEventCount,
} from './notification';

describe('frozen catalog', () => {
  // O55 (DECISIONS 2026-08-07): the catalog is still frozen, but "frozen" is now
  // enforced against the REGISTRY rather than a literal. The literal used to be
  // 15, then 17, and each bump meant touching the invariant itself — an
  // invariant that is routinely edited has stopped being one. What follows never
  // hard-codes a total: it asserts the catalog matches what is registered, and
  // asserts separately that each version's membership is exactly what was
  // signed off. Adding an event without registering it fails the first test;
  // adding it to the wrong version fails the second or third.
  it('has exactly as many events as the registry accounts for', () => {
    expect(events()).toHaveLength(registeredEventCount());
    // Every event belongs to a registered version — no orphans.
    for (const e of events()) {
      expect(CATALOG_VERSIONS.map((v) => v.version)).toContain(CATALOG[e].version);
    }
    // Every registered version's declared count matches its actual membership.
    for (const v of CATALOG_VERSIONS) {
      expect(eventsOfVersion(v.version)).toHaveLength(v.eventCount);
    }
  });

  it('is at version 2, and the versions are registered in order with no gaps', () => {
    expect(CATALOG_VERSION).toBe(2);
    expect(CATALOG_VERSIONS.map((v) => v.version)).toEqual([1, 2]);
    // A registry row with no decision reference is how an un-signed-off
    // amendment would sneak in looking legitimate.
    for (const v of CATALOG_VERSIONS) {
      expect(v.decisionRef).toMatch(/DECISIONS/);
    }
  });

  // The 15 frozen entries. Anything added past these is a DECISIONS.md-logged
  // deviation and must be asserted separately (below), so a silent drift back
  // into this list cannot happen unnoticed. Hoisted to describe scope because
  // the v1-membership test (O55) checks the same list from the other direction.
  const frozen = [
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

  it('matches the Go EventType string values verbatim', () => {
    for (const e of frozen) {
      expect(events()).toContain(e);
    }
  });

  it('carries exactly the two logged lead-delete additions and nothing else', () => {
    // Owner decision 2026-07-29: lead delete requires Head ACC, so the Head has
    // to be notified. Pinned here so a third un-logged event fails the build.
    const added = ['m1.lead.delete_requested', 'm1.lead.delete_decided'];
    expect(EVENTS.LeadDeleteRequested).toBe('m1.lead.delete_requested');
    expect(EVENTS.LeadDeleteDecided).toBe('m1.lead.delete_decided');
    expect(CATALOG[EVENTS.LeadDeleteRequested].resolver).toBe('leadsOfDivision');
    expect(CATALOG[EVENTS.LeadDeleteDecided].resolver).toBe('explicit');
    expect(events().filter((e) => e.startsWith('m1.lead.delete'))).toEqual(added);
  });

  it('keeps v1 exactly at the 17 pre-O55 events — the amendment added nothing to it', () => {
    // This is the assertion that makes "15 event lama tak disentuh" testable.
    // The DB enforces it with a trigger; here it is enforced against the TS
    // mirror, so a v2 event mislabeled `version: 1` cannot pass review.
    expect(eventsOfVersion(1).sort()).toEqual([...frozen, ...['m1.lead.delete_requested', 'm1.lead.delete_decided']].sort());
  });

  it('carries exactly the 14 v2 events of the single M6A/6B/6C amendment (O55)', () => {
    // Names are verbatim from the PRDs (M6A §7 D12, M6B §9, M6C §10). The
    // convention break — no `mN.` prefix — is deliberate and logged; asserting
    // them here stops a later session from "tidying" them into new identifiers,
    // which would silently orphan every emit site.
    expect(eventsOfVersion(2).sort()).toEqual([
      'gate_deeskalasi_diminta',
      'gate_override_dicatat',
      'm6.client.assigned',
      'plan_baris_belum_dieksekusi',
      'plan_keberatan_kapasitas',
      'plan_periode_aktif',
      'plan_periode_ditutup',
      'plan_realisasi_belum_lengkap',
      'plan_sekarang_disarankan',
      'plan_target_diturunkan',
      'strategi_diajukan',
      'strategi_dikembalikan',
      'strategi_disetujui',
      'strategi_revisi_disarankan',
    ]);
    // O53 rode in on this amendment; assert it explicitly so closing O53 cannot
    // be claimed without the event actually existing.
    expect(EVENTS.ClientAssigned).toBe('m6.client.assigned');
    expect(CATALOG[EVENTS.ClientAssigned].version).toBe(2);
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
