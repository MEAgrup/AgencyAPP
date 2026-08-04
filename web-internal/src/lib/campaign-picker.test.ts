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
  CAMPAIGN_REQUIRED_SOURCES,
  OUTSIDE_CAMPAIGN,
  campaignLabel,
  campaignRequiredForSource,
  filterCampaigns,
} from './campaign-picker';

function cmp(id: string, name: string, channel: string, status = 'Active'): SelectableCampaign {
  return { id, name, channel, status, start_date: '2026-08-01' };
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
    expect(campaignLabel(LIST[0])).toBe('Promo Skilskul Agustus · TikTok Ads · CMP-202608-0001');
  });

  it('marks a Paused campaign, without the BI bracket convention', () => {
    const label = campaignLabel(LIST[1]);
    expect(label.endsWith('· Paused')).toBe(true);
    expect(label).not.toContain('[');
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
