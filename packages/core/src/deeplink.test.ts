/**
 * deeplink unit tests (DECISIONS O51).
 *
 * The cross-check that these paths correspond to pages that EXIST lives in
 * `apps/api/src/lib/deeplink-parity.test.ts` — it can read the `web-internal`
 * tree, which `core` deliberately knows nothing about. What is pinned here is the
 * shape each builder produces, so a future edit cannot quietly reintroduce the
 * `/<entity_type>/<id>` form that shipped 38 broken links to production.
 */
import { describe, expect, it } from 'vitest';
import * as deeplink from './deeplink';

describe('deeplink.brief — per-division, because Brief pages are per-division', () => {
  it('routes each dispatch division to its own Brief page', () => {
    expect(deeplink.brief('BRF-202607-0001', 'Creative')).toBe('/creative/briefs/BRF-202607-0001');
    expect(deeplink.brief('BRF-202607-0001', 'KOL')).toBe('/kol/briefs/BRF-202607-0001');
    expect(deeplink.brief('BRF-202607-0001', 'Live Stream')).toBe('/livestream/briefs/BRF-202607-0001');
  });

  it('sends an Ads Brief to the Ads queue — no per-Brief page exists there', () => {
    // Documented degradation, not an oversight: /ads/[id] takes a CAMPAIGN id.
    expect(deeplink.brief('BRF-202607-0001', 'Ads')).toBe('/ads');
  });

  it('degrades an unknown division to the Board rather than to a 404', () => {
    expect(deeplink.brief('BRF-202607-0001', 'Procurement')).toBe('/board');
    expect(deeplink.brief('BRF-202607-0001', '')).toBe('/board');
  });

  it('is case-sensitive on the division, matching the canonical stored values', () => {
    // `assigned_division` is written from ALLOWED_DIVISIONS verbatim (M6 §2), so
    // a lowercase value means the caller passed something other than the column.
    expect(deeplink.brief('BRF-202607-0001', 'creative')).toBe('/board');
  });
});

describe('deeplink — one builder per entity, each nested where its page lives', () => {
  it('asset → Creative', () => {
    expect(deeplink.asset('AST-202607-0001')).toBe('/creative/assets/AST-202607-0001');
  });

  it('complaint → Account', () => {
    expect(deeplink.complaint('CMP-202607-0001')).toBe('/account/complaints/CMP-202607-0001');
  });

  it('transaction → Finance, which owns the page', () => {
    expect(deeplink.transaction('TRX-202607-0001')).toBe('/finance/transactions/TRX-202607-0001');
  });

  it('prospect attempt → /sales/[id]; there is no /attempts/…', () => {
    expect(deeplink.attempt('PRSP-202607-0001')).toBe('/sales/PRSP-202607-0001');
  });

  it('performance snapshot → /performance/[id]; NOT /performance_snapshot/…', () => {
    const link = deeplink.performanceSnapshot('PERF-202606-0001');
    expect(link).toBe('/performance/PERF-202606-0001');
    expect(link).not.toContain('performance_snapshot');
  });

  it('live-stream session → nested under livestream', () => {
    expect(deeplink.liveStreamSession('LSS-202607-0001')).toBe('/livestream/sessions/LSS-202607-0001');
  });

  it('lead and demo task keep the paths that were already correct', () => {
    expect(deeplink.lead('LEAD-202607-0001')).toBe('/leads/LEAD-202607-0001');
    expect(deeplink.demoTask('DMT-202607-0001')).toBe('/demo-tasks/DMT-202607-0001');
  });
});

describe('deeplink.clientHealth — takes the CLIENT id, not the snapshot id', () => {
  it('builds the client-scoped health page', () => {
    expect(deeplink.clientHealth('CLI-202607-0001')).toBe('/health/CLI-202607-0001');
  });

  it('would render an empty page if handed a CHR- snapshot id — the O51 trap', () => {
    // Pinned as a reminder for the next caller: the builder cannot detect this,
    // so the emitter must pass clientId. `health.ts` does.
    expect(deeplink.clientHealth('CHR-202607-0001')).toBe('/health/CHR-202607-0001');
  });
});

describe('deeplink.task — block requests fire on both Briefs and Assets', () => {
  it('sends an asset-sourced task to the Asset page', () => {
    expect(deeplink.task('asset', 'AST-202607-0001', 'Creative')).toBe('/creative/assets/AST-202607-0001');
  });

  it('sends a brief-sourced task to that division’s Brief page', () => {
    expect(deeplink.task('brief', 'BRF-202607-0001', 'KOL')).toBe('/kol/briefs/BRF-202607-0001');
  });

  it('treats any non-asset source as a Brief (TaskSource has exactly two values)', () => {
    expect(deeplink.task('brief', 'BRF-202607-0001', 'Creative')).toBe('/creative/briefs/BRF-202607-0001');
  });
});

describe('no builder emits the old notify_emit default shape', () => {
  it('never starts a path with a snake_case segment', () => {
    const all = [
      deeplink.brief('BRF-202607-0001', 'Creative'),
      deeplink.asset('AST-202607-0001'),
      deeplink.complaint('CMP-202607-0001'),
      deeplink.clientHealth('CLI-202607-0001'),
      deeplink.liveStreamSession('LSS-202607-0001'),
      deeplink.performanceSnapshot('PERF-202606-0001'),
      deeplink.transaction('TRX-202607-0001'),
      deeplink.attempt('PRSP-202607-0001'),
      deeplink.lead('LEAD-202607-0001'),
      deeplink.demoTask('DMT-202607-0001'),
    ];
    for (const link of all) {
      expect(link.startsWith('/')).toBe(true);
      expect(link).not.toMatch(/^\/[a-z]+_[a-z_]+\//);
    }
  });
});
