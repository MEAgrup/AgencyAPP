/**
 * Tests for the campaign picker's client-side rules.
 *
 * Two of the three are guards on real failure modes rather than on arithmetic:
 *   - `campaignRequiredForSource` must stay byte-identical to the server's
 *     `leads.CAMPAIGN_REQUIRED_SOURCES` (M1 §9.3). If the two lists drift, the
 *     form stops marking a field the server still rejects — the user gets a BI
 *     error on a field that looked optional.
 *   - `filterCampaigns` must keep the SELECTED campaign in the list while the
 *     query narrows. Without that the browser silently reselects the first
 *     remaining <option>, i.e. a different campaign than the one on screen.
 */
import { describe, expect, it } from 'vitest';
import type { SelectableCampaign } from './marketing';
import {
  CAMPAIGN_GROUPS,
  CAMPAIGN_REQUIRED_SOURCES,
  OUTSIDE_CAMPAIGN,
  campaignLabel,
  campaignRequiredForSource,
  filterCampaigns,
  funnelSummary,
  groupCampaigns,
  qualityRateLabel,
} from './campaign-picker';

function cmp(
  id: string,
  name: string,
  channel: string,
  status = 'Active',
  funnel: [number, number, number] = [0, 0, 0],
): SelectableCampaign {
  return {
    id, name, channel, status, start_date: '2026-08-01',
    lead_by_dashboard: funnel[0], lead_real_by_sales: funnel[1], lead_not_qualified: funnel[2],
  };
}

const LIST: SelectableCampaign[] = [
  cmp('CMP-202608-0001', 'Promo Skilskul Agustus', 'TikTok Ads'),
  cmp('CMP-202608-0002', 'Broadcast Ramadan', 'Broadcast', 'Paused'),
  cmp('CMP-202607-0009', 'Expo Surabaya', 'Event'),
];

describe('campaignRequiredForSource (M1 §9.3)', () => {
  it('matches the server list exactly — verbatim, in order', () => {
    expect([...CAMPAIGN_REQUIRED_SOURCES]).toEqual(['Leads - Iklan', 'Broadcast', 'Event', 'Kulwa']);
  });

  it('is true for the four Marketing-channel sources only', () => {
    for (const s of CAMPAIGN_REQUIRED_SOURCES) {
      expect(campaignRequiredForSource(s)).toBe(true);
    }
    for (const s of ['Scouting', 'Leads - Socmed', 'Website', 'Referral (Affiliasi)', 'Database', 'Others', '']) {
      expect(campaignRequiredForSource(s)).toBe(false);
    }
  });

  it('does not match a near-miss spelling', () => {
    expect(campaignRequiredForSource('Leads-Iklan')).toBe(false);
    expect(campaignRequiredForSource('leads - iklan')).toBe(false);
  });
});

describe('OUTSIDE_CAMPAIGN sentinel', () => {
  it('cannot be confused with a campaign id', () => {
    // It is compared against `value` before anything is sent, so a value that
    // looked like a CMP- id would risk being posted as one.
    expect(OUTSIDE_CAMPAIGN.startsWith('CMP-')).toBe(false);
    expect(LIST.some((c) => c.id === OUTSIDE_CAMPAIGN)).toBe(false);
  });
});

describe('campaignLabel', () => {
  it('reads name → channel → id, so the searchable words come first', () => {
    // An Active campaign carries no status mark — it is the unremarkable case.
    expect(campaignLabel(LIST[0])).toBe('Promo Skilskul Agustus · TikTok Ads · CMP-202608-0001');
  });

  it('marks every non-Active status, without the BI bracket convention', () => {
    for (const status of ['Paused', 'Closed', 'Archived', 'Draft']) {
      const label = campaignLabel(cmp('CMP-1', 'X', 'IG', status));
      expect(label.endsWith(`· ${status}`)).toBe(true);
      expect(label).not.toContain('[');
    }
  });
});

describe('groupCampaigns', () => {
  const full = [
    cmp('CMP-A', 'A Active', 'IG', 'Active'),
    cmp('CMP-P', 'B Paused', 'IG', 'Paused'),
    cmp('CMP-C', 'C Closed', 'IG', 'Closed'),
    cmp('CMP-R', 'D Archived', 'IG', 'Archived'),
    cmp('CMP-D', 'E Draft', 'IG', 'Draft'),
  ];

  it('splits the five statuses into the three groups, in server order', () => {
    expect(groupCampaigns(full)).toEqual([
      { label: 'Sedang jalan', items: [full[0], full[1]] },
      { label: 'Sudah selesai', items: [full[2], full[3]] },
      { label: 'Belum jalan', items: [full[4]] },
    ]);
    expect(CAMPAIGN_GROUPS).toHaveLength(3);
  });

  it('drops empty groups instead of rendering a headed empty section', () => {
    expect(groupCampaigns([full[0]]).map((g) => g.label)).toEqual(['Sedang jalan']);
    expect(groupCampaigns([])).toEqual([]);
  });

  it('still shows a status the FE does not know — an unpickable campaign is the bug', () => {
    // If M3 ever gains a status, the campaign must not silently disappear from
    // the dropdown: an unattributable lead is exactly what this feature removes.
    const odd = cmp('CMP-X', 'X Unknown', 'IG', 'SomethingNew');
    const groups = groupCampaigns([full[0], odd]);
    expect(groups.flatMap((g) => g.items.map((c) => c.id))).toContain('CMP-X');
  });
});

describe('qualityRateLabel (M2 §4 r3 + house rule #7)', () => {
  it('renders — for a zero divisor, never 0% and never an error', () => {
    expect(qualityRateLabel(0, 0)).toBe('—');
    expect(qualityRateLabel(5, 0)).toBe('—');
  });

  it('matches the PRD worked example: 12 of 46 → 26%', () => {
    expect(qualityRateLabel(12, 46)).toBe('26%');
  });

  it('rounds half UP, like the server percentRound', () => {
    // 1/8 = 12.5% → 13%, 3/8 = 37.5% → 38%. A round-half-even implementation
    // would answer 12% and 38%, i.e. differ from Marketing's dashboard by a point.
    expect(qualityRateLabel(1, 8)).toBe('13%');
    expect(qualityRateLabel(3, 8)).toBe('38%');
    expect(qualityRateLabel(1, 3)).toBe('33%');
    expect(qualityRateLabel(2, 3)).toBe('67%');
    expect(qualityRateLabel(46, 46)).toBe('100%');
  });
});

describe('funnelSummary', () => {
  it('names all three derived counts plus the rate, in PRD vocabulary', () => {
    expect(funnelSummary(cmp('CMP-1', 'X', 'IG', 'Active', [46, 12, 18]))).toBe(
      '46 lead masuk · 12 lead asli (≥ Qualified) · 18 not qualified · quality rate 26%',
    );
  });

  it('reads honestly for a campaign nobody has worked yet', () => {
    expect(funnelSummary(cmp('CMP-2', 'Y', 'IG'))).toBe(
      '0 lead masuk · 0 lead asli (≥ Qualified) · 0 not qualified · quality rate —',
    );
  });
});

describe('filterCampaigns', () => {
  it('returns everything for an empty or whitespace query', () => {
    expect(filterCampaigns(LIST, '')).toHaveLength(3);
    expect(filterCampaigns(LIST, '   ')).toHaveLength(3);
  });

  it('searches name, channel and id, case-insensitively', () => {
    expect(filterCampaigns(LIST, 'skilskul').map((c) => c.id)).toEqual(['CMP-202608-0001']);
    expect(filterCampaigns(LIST, 'event').map((c) => c.id)).toEqual(['CMP-202607-0009']);
    expect(filterCampaigns(LIST, 'cmp-202608').map((c) => c.id)).toEqual([
      'CMP-202608-0001',
      'CMP-202608-0002',
    ]);
  });

  it('requires every token but not their order — "promo tiktok" finds the ad campaign', () => {
    expect(filterCampaigns(LIST, 'promo tiktok').map((c) => c.id)).toEqual(['CMP-202608-0001']);
    expect(filterCampaigns(LIST, 'tiktok promo').map((c) => c.id)).toEqual(['CMP-202608-0001']);
    expect(filterCampaigns(LIST, 'promo event')).toEqual([]);
  });

  it('keeps the picked campaign even when the query excludes it', () => {
    const shown = filterCampaigns(LIST, 'expo', 'CMP-202608-0001');
    expect(shown.map((c) => c.id)).toEqual(['CMP-202608-0001', 'CMP-202607-0009']);
  });

  it('ignores keepId when nothing is picked yet', () => {
    expect(filterCampaigns(LIST, 'expo', '').map((c) => c.id)).toEqual(['CMP-202607-0009']);
  });

  it('preserves the server ordering of whatever survives the filter', () => {
    // Active-first-then-name is decided by private.campaign_selectable(); the
    // filter must not resort, or the dropdown order changes as the user types.
    expect(filterCampaigns(LIST, 'cmp-').map((c) => c.id)).toEqual(LIST.map((c) => c.id));
  });
});
