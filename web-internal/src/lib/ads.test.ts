/**
 * Regression tests for the two /ads bugs found in the M16 handoff review:
 *
 * 1. `createCampaign` never sent `tipe_iklan` (M16 LT-41, mandatory server-
 *    side) — every create-campaign submission failed `[data tidak lengkap...]`
 *    with no field in the form to fix it. Fixed by adding `tipe_iklan` to
 *    `CampaignInput` + `TIPE_IKLAN_OPTIONS`; this file pins the option values
 *    to the server's own `VALID_TIPE_IKLAN` (packages/domain/src/ads.ts) so
 *    the two can never silently drift apart again.
 * 2. A freshly created campaign is born `[Setting]` (M16 LT-40), not
 *    `[Paused]` — `campaignBadgeTone` had no case for it and fell through to
 *    the default gray tone. Fixed by adding the `[Setting]` case.
 */
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_STATUSES, TIPE_IKLAN_OPTIONS, campaignBadgeTone, isRoasTarget } from './ads';

describe('TIPE_IKLAN_OPTIONS', () => {
  it('matches the server VALID_TIPE_IKLAN set exactly (packages/domain/src/ads.ts)', () => {
    expect([...TIPE_IKLAN_OPTIONS].sort()).toEqual(['GMV Max Live', 'GMV Max Product', 'TTAM'].sort());
  });
});

describe('campaignBadgeTone', () => {
  it('renders every documented lifecycle status with a distinct, non-default tone', () => {
    expect(campaignBadgeTone('[Setting]')).toBe('blue');
    expect(campaignBadgeTone('[Paused]')).toBe('amber');
    expect(campaignBadgeTone('[Active]')).toBe('green');
    expect(campaignBadgeTone('[Ended]')).toBe('darkgray');
  });

  it('falls back to gray only for a genuinely unknown status', () => {
    expect(campaignBadgeTone('[Unknown]')).toBe('gray');
  });

  it('every CAMPAIGN_STATUSES entry gets a non-default tone', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(campaignBadgeTone(status)).not.toBe('gray');
    }
  });
});

describe('isRoasTarget', () => {
  it('matches case-insensitively on the substring "roas"', () => {
    expect(isRoasTarget('ROAS ≥ 4x')).toBe(true);
    expect(isRoasTarget('roas target 3x')).toBe(true);
    expect(isRoasTarget('GMV target Rp 50.000.000')).toBe(false);
  });
});
