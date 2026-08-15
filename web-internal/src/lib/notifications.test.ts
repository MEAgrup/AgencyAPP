/**
 * Notification inbox routing tests.
 *
 * The regression this guards: the ONLY notification a fresh staff account
 * receives is `m14.performance.published`, and clicking it went to
 * `/performance_snapshot/PERF-…` — the `notify_emit` default deep link, which is
 * not a route in this app. Every assertion below is a route that must exist under
 * `web-internal/src/app/(shell)`, so a page move breaks this file rather than the
 * inbox.
 */
import { describe, expect, it } from 'vitest';
import { eventLabel, notificationHref } from './notifications';

const n = (entity_type: string, entity_id: string) => ({ entity_type, entity_id });

describe('notificationHref — entity-keyed pages', () => {
  it('routes each emitted entity type to a page that exists', () => {
    expect(notificationHref(n('prospect_attempt', 'PRSP-202608-0001'))).toBe('/sales/PRSP-202608-0001');
    expect(notificationHref(n('lead', 'LEAD-202608-0001'))).toBe('/leads/LEAD-202608-0001');
    expect(notificationHref(n('transaction', 'TRX-202608-0001'))).toBe(
      '/finance/transactions/TRX-202608-0001',
    );
    expect(notificationHref(n('complaint', 'CPL-202608-0001'))).toBe('/account/complaints/CPL-202608-0001');
    expect(notificationHref(n('brief', 'BRF-202608-0001'))).toBe('/tasks/BRF-202608-0001');
    expect(notificationHref(n('asset', 'AST-202608-0001'))).toBe('/tasks/AST-202608-0001');
    expect(notificationHref(n('demo_task', 'DEMO-1'))).toBe('/demo-tasks/DEMO-1');
    // Penugasan Internal is its OWN page, not `/tasks/{}` (M12) — routing it
    // there would open a Brief/Asset detail that cannot resolve a TSK- id.
    expect(notificationHref(n('internal_task', 'TSK-202608-0001'))).toBe('/penugasan/TSK-202608-0001');
    expect(notificationHref(n('live_stream_session', 'LSS-202608-0001'))).toBe(
      '/livestream/sessions/LSS-202608-0001',
    );
  });

  it('never routes to the Go-era paths that were never ported', () => {
    // finance.ts emits deep_link '/transactions/{id}' and sales.ts '/attempts/{id}';
    // neither is a page here. Resolving from entity_type is what fixes them.
    expect(notificationHref(n('transaction', 'TRX-1'))).not.toBe('/transactions/TRX-1');
    expect(notificationHref(n('prospect_attempt', 'PRSP-1'))).not.toBe('/attempts/PRSP-1');
  });
});

describe('notificationHref — the m14 404 (the reported bug)', () => {
  it('sends a published Performance Score to the viewer own-score page', () => {
    // NOT /performance/PERF-… : that route is keyed by staff id, not snapshot id.
    expect(notificationHref(n('performance_snapshot', 'PERF-202606-0009'), 'EMP-0002')).toBe(
      '/performance/EMP-0002',
    );
  });

  it('falls back to the landing page when the viewer is not resolved yet', () => {
    expect(notificationHref(n('performance_snapshot', 'PERF-202606-0009'))).toBe('/performance');
    expect(notificationHref(n('performance_snapshot', 'PERF-202606-0009'), '  ')).toBe('/performance');
  });
});

describe('notificationHref — entities with no page render unclickable', () => {
  it('returns null rather than a 404 target', () => {
    // Each of these carries an id whose page is keyed by a DIFFERENT entity.
    expect(notificationHref(n('installment', 'INST-202608-0001'))).toBeNull();
    expect(notificationHref(n('client_health_snapshot', 'CHR-202608-0001'))).toBeNull();
    expect(notificationHref(n('dependency', 'DEP-202608-0001'))).toBeNull();
  });

  it('returns null for an unknown entity type or a blank id', () => {
    expect(notificationHref(n('something_new', 'X-1'))).toBeNull();
    expect(notificationHref(n('brief', '   '))).toBeNull();
  });

  it('encodes the id so a stray character cannot break the path', () => {
    expect(notificationHref(n('lead', 'LEAD/../admin'))).toBe('/leads/LEAD%2F..%2Fadmin');
  });
});

describe('eventLabel', () => {
  it('renders the frozen catalog identifiers as readable Bahasa Indonesia', () => {
    expect(eventLabel('m14.performance.published')).toBe('Skor performa bulanan dipublikasikan');
    expect(eventLabel('m6.complaint.logged')).toBe('Komplain baru dicatat');
  });

  it('falls back to the raw identifier for an event this build does not know', () => {
    expect(eventLabel('m99.future.event')).toBe('m99.future.event');
  });
});
