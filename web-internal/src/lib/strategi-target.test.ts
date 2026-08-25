import { describe, expect, it } from 'vitest';
import {
  assumptionsToBody,
  channelsMissingSupport,
  computeBaselineStretchTargets,
  gmvCellsToBody,
  gmvGridOf,
  offerableTargetKeys,
  pruneTargetTerkait,
  quarterCount,
  quarterLabel,
  quarterOf,
  quarterStretchValue,
  readTargetKey,
  setQuarterStretch,
  supportRowsOf,
  supportRowsToBody,
  targetKey,
  uncoveredTargetKeys,
  type AssumptionRow,
  type GmvCell,
} from './strategi-target';

const cell = (channel: string, month: number, floor: string, stretch: string): GmvCell => ({
  channel,
  month_index: month,
  nilai_floor: floor,
  nilai_stretch: stretch,
});

const asumsi = (kode: string, targets: string[] = []): AssumptionRow => ({
  kode,
  asumsi: 'budget iklan cair tiap tanggal 1',
  pemilik: 'Klien',
  cara_verifikasi: 'cek mutasi rekening',
  target_terkait: targets,
});

describe('targetKey', () => {
  // These exact strings are what `strategi_assumption.target_terkait` stores and
  // what `saveAssumptions` checks membership against. If this format drifts from
  // `targetKey` in packages/domain, every D-9 mapping is refused with
  // `[asumsi menunjuk target yang tidak ada]` — and nothing else fails first.
  it('matches the server format exactly: metric:channel:monthIndex', () => {
    expect(targetKey('gmv', 'Shopee', 3)).toBe('gmv:Shopee:3');
    expect(targetKey('gmv', 'TikTok Shop', 12)).toBe('gmv:TikTok Shop:12');
  });

  it('round-trips through readTargetKey, including channels with spaces', () => {
    expect(readTargetKey(targetKey('gmv', 'TikTok Shop', 7))).toEqual({
      metric: 'gmv',
      channel: 'TikTok Shop',
      month: 7,
    });
  });

  it('returns null for a string that is not a target key', () => {
    expect(readTargetKey('gmv')).toBeNull();
    expect(readTargetKey('')).toBeNull();
    expect(readTargetKey('gmv:Shopee:x')).toBeNull();
  });
});

describe('gmvGridOf', () => {
  it('renders every channel × month cell, not just the saved ones', () => {
    // A sparse grid would open empty on a fresh Strategi — nothing to type into,
    // and D-2 permanently in the gap list.
    const grid = gmvGridOf([{ channel: 'Shopee' }, { channel: 'TikTok Shop' }], 3, []);
    expect(grid).toHaveLength(6);
    expect(grid.map((c) => `${c.channel}/${c.month_index}`)).toEqual([
      'Shopee/1',
      'Shopee/2',
      'Shopee/3',
      'TikTok Shop/1',
      'TikTok Shop/2',
      'TikTok Shop/3',
    ]);
  });

  it('months are 1-based, unlike the 0-based baseline months of Section B', () => {
    const grid = gmvGridOf([{ channel: 'Shopee' }], 2, []);
    expect(grid.map((c) => c.month_index)).toEqual([1, 2]);
  });

  it('seeds saved values into their cells and leaves the rest blank', () => {
    const grid = gmvGridOf([{ channel: 'Shopee' }], 3, [
      { channel: 'Shopee', month_index: 2, metric: 'gmv', nilai_floor: '100', nilai_stretch: '150' },
    ]);
    expect(grid[1]).toEqual(cell('Shopee', 2, '100', '150'));
    expect(grid[0]).toEqual(cell('Shopee', 1, '', ''));
  });

  it('ignores non-GMV rows — D-4 has its own editor and its own grain', () => {
    const grid = gmvGridOf([{ channel: 'Shopee' }], 1, [
      { channel: 'Shopee', month_index: 1, metric: 'aov', nilai_floor: null, nilai_stretch: '90' },
    ]);
    expect(grid[0]).toEqual(cell('Shopee', 1, '', ''));
  });

  it('survives a contract duration that is zero, fractional or absent', () => {
    expect(gmvGridOf([{ channel: 'Shopee' }], 0, [])).toEqual([]);
    expect(gmvGridOf([{ channel: 'Shopee' }], Number.NaN, [])).toEqual([]);
    expect(gmvGridOf([{ channel: 'Shopee' }], 2.7, [])).toHaveLength(2);
  });
});

describe('gmvCellsToBody', () => {
  it('sends cells where both figures are typed', () => {
    const { rows, incomplete } = gmvCellsToBody([cell('Shopee', 1, '100', '150')]);
    expect(incomplete).toEqual([]);
    expect(rows).toEqual([
      {
        channel: 'Shopee',
        month_index: 1,
        metric: 'gmv',
        nilai_floor: '100',
        nilai_stretch: '150',
      },
    ]);
  });

  it('skips untouched cells without reporting them', () => {
    // An empty grid cell is not an unfinished answer, it is an unstarted one.
    const { rows, incomplete } = gmvCellsToBody([cell('Shopee', 1, '', ''), cell('Shopee', 2, '  ', '')]);
    expect(rows).toEqual([]);
    expect(incomplete).toEqual([]);
  });

  it('reports half-filled cells instead of dropping or sending them', () => {
    // Dropping = the O43 silent-loss class (200 OK, number gone next load).
    // Sending = the whole section save fails every autosave tick while the AM
    // is still typing, taking the complete cells down with it.
    const { rows, incomplete } = gmvCellsToBody([
      cell('Shopee', 1, '100', ''),
      cell('Shopee', 2, '', '150'),
      cell('Shopee', 3, '100', '150'),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].month_index).toBe(3);
    expect(incomplete.map((c) => c.month_index)).toEqual([1, 2]);
  });

  it('does not enforce stretch >= floor — that CHECK is the DB\'s, not ours', () => {
    // Rule 7 is `ck_strtg_stretch_gmv`. Rejecting it here would put a second copy
    // of the rule in TS, and D-7 Sanggahan Target exists precisely because the
    // answer to "stretch below floor" is an argument, not a softer client rule.
    const { rows } = gmvCellsToBody([cell('Shopee', 1, '200', '150')]);
    expect(rows).toHaveLength(1);
  });
});

describe('supportRowsOf / supportRowsToBody (D-4)', () => {
  it('takes every non-GMV saved row', () => {
    expect(
      supportRowsOf([
        { channel: 'Shopee', month_index: 1, metric: 'gmv', nilai_floor: '1', nilai_stretch: '2' },
        { channel: 'Shopee', month_index: 1, metric: 'aov', nilai_floor: null, nilai_stretch: '90' },
      ]),
    ).toEqual([{ channel: 'Shopee', month_index: 1, metric: 'aov', nilai_stretch: '90' }]);
  });

  it('always sends nilai_floor null — ck_strtg_floor_gmv_only refuses anything else', () => {
    const body = supportRowsToBody([
      { channel: 'Shopee', month_index: 2, metric: 'cr', nilai_stretch: '3.5' },
    ]);
    expect(body).toEqual([
      {
        channel: 'Shopee',
        month_index: 2,
        metric: 'cr',
        nilai_floor: null,
        nilai_stretch: '3.5',
      },
    ]);
  });

  it('drops rows the AM added but never filled', () => {
    expect(
      supportRowsToBody([{ channel: '', month_index: 1, metric: '', nilai_stretch: '' }]),
    ).toEqual([]);
  });
});

describe('uncoveredTargetKeys (Rule 8)', () => {
  const cells = [cell('Shopee', 1, '100', '150'), cell('Shopee', 2, '100', '160')];

  it('names the targets no assumption points at', () => {
    expect(uncoveredTargetKeys(cells, [asumsi('AS-1', ['gmv:Shopee:1'])])).toEqual([
      'gmv:Shopee:2',
    ]);
  });

  it('is empty once every target is covered — the same test the submit gate runs', () => {
    expect(
      uncoveredTargetKeys(cells, [asumsi('AS-1', ['gmv:Shopee:1', 'gmv:Shopee:2'])]),
    ).toEqual([]);
  });

  it('counts a half-filled cell as no target at all', () => {
    // It will not be saved, so Rule 8 will not ask about it either. Listing it
    // would send the AM hunting for an assumption for a row that does not exist.
    expect(uncoveredTargetKeys([cell('Shopee', 1, '100', '')], [])).toEqual([]);
  });

  it('ignores assumption references to targets outside the matrix', () => {
    expect(uncoveredTargetKeys(cells, [asumsi('AS-1', ['gmv:Lazada:1'])])).toEqual([
      'gmv:Shopee:1',
      'gmv:Shopee:2',
    ]);
  });
});

describe('channelsMissingSupport (D-4 gate, X-15)', () => {
  const channels = [{ channel: 'Shopee' }, { channel: 'TikTok Shop' }];

  it('names the channels with no supporting metric', () => {
    expect(
      channelsMissingSupport(channels, [
        { channel: 'Shopee', month_index: 1, metric: 'cr', nilai_stretch: '2.8' },
      ]),
    ).toEqual(['TikTok Shop']);
  });

  it('is satisfied by ONE row per channel — the owner gated the question, not the matrix', () => {
    // If this ever needs a second row to pass, the mirror has drifted past the
    // decision, and the AM would be chasing a gap the server never reports.
    expect(
      channelsMissingSupport(channels, [
        { channel: 'Shopee', month_index: 1, metric: 'cr', nilai_stretch: '2.8' },
        { channel: 'TikTok Shop', month_index: 1, metric: 'aov', nilai_stretch: '90000' },
      ]),
    ).toEqual([]);
  });

  it('does not let a GMV row satisfy D-4 — that is D-2, the other question', () => {
    expect(
      channelsMissingSupport(channels, [
        { channel: 'Shopee', month_index: 1, metric: 'gmv', nilai_stretch: '460000000' },
        { channel: 'TikTok Shop', month_index: 1, metric: 'aov', nilai_stretch: '90000' },
      ]),
    ).toEqual(['Shopee']);
  });

  it('ignores a row the AM added but never filled', () => {
    // It will not be saved, so the server will still report the gap. Counting it
    // here would show a green form over a submit that is about to be refused.
    expect(
      channelsMissingSupport(channels, [
        { channel: 'Shopee', month_index: 1, metric: 'cr', nilai_stretch: '' },
        { channel: 'TikTok Shop', month_index: 1, metric: 'aov', nilai_stretch: '90000' },
      ]),
    ).toEqual(['Shopee']);
  });
});

describe('offerableTargetKeys', () => {
  it('offers keys from the DRAFT, so D-9 is usable before the first save', () => {
    expect(offerableTargetKeys([cell('TikTok Shop', 4, '10', '12')])).toEqual([
      'gmv:TikTok Shop:4',
    ]);
  });
});

describe('pruneTargetTerkait', () => {
  it('drops references to targets that no longer exist', () => {
    // Without this, shortening the contract locks the AM out of saving Section D:
    // `saveAssumptions` refuses the whole call for one dangling key, and the
    // checkbox that caused it is no longer on screen to untick.
    const out = pruneTargetTerkait([asumsi('AS-1', ['gmv:Shopee:1', 'gmv:Shopee:9'])], [
      'gmv:Shopee:1',
    ]);
    expect(out[0].target_terkait).toEqual(['gmv:Shopee:1']);
  });

  it('de-duplicates', () => {
    const out = pruneTargetTerkait([asumsi('AS-1', ['gmv:Shopee:1', 'gmv:Shopee:1'])], [
      'gmv:Shopee:1',
    ]);
    expect(out[0].target_terkait).toEqual(['gmv:Shopee:1']);
  });

  it('leaves the rest of the assumption untouched', () => {
    const out = pruneTargetTerkait([asumsi('AS-1', ['nope'])], []);
    expect(out[0]).toEqual({ ...asumsi('AS-1'), target_terkait: [] });
  });
});

describe('quarterOf / quarterCount / quarterLabel (D-2 entered per quarter)', () => {
  it('groups months into blocks of 3', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(quarterOf)).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it('counts a trailing partial block as its own quarter', () => {
    expect(quarterCount(11)).toBe(4);
    expect(quarterCount(6)).toBe(2);
    expect(quarterCount(0)).toBe(0);
  });

  it('labels a full quarter as a month range', () => {
    expect(quarterLabel(1, 12)).toBe('Q1 (M1–M3)');
    expect(quarterLabel(2, 12)).toBe('Q2 (M4–M6)');
  });

  it('labels a trailing single-month quarter without a dash', () => {
    expect(quarterLabel(4, 10)).toBe('Q4 (M10)');
  });
});

describe('setQuarterStretch / quarterStretchValue', () => {
  const cells = [
    cell('Shopee', 1, '100', ''),
    cell('Shopee', 2, '100', ''),
    cell('Shopee', 3, '100', ''),
    cell('Shopee', 4, '100', ''),
    cell('TikTok Shop', 1, '50', '80'),
  ];

  it('writes one figure to every month of the quarter, for that channel only', () => {
    const out = setQuarterStretch(cells, 'Shopee', 1, '999');
    expect(out.filter((c) => c.channel === 'Shopee').map((c) => c.nilai_stretch)).toEqual([
      '999',
      '999',
      '999',
      '',
    ]);
    expect(out.find((c) => c.channel === 'TikTok Shop')!.nilai_stretch).toBe('80');
  });

  it('never touches nilai_floor — that is D-1, a different question', () => {
    const out = setQuarterStretch(cells, 'Shopee', 1, '999');
    expect(out[0].nilai_floor).toBe('100');
  });

  it('reads back the shared value when every month in the quarter agrees', () => {
    const filled = setQuarterStretch(cells, 'Shopee', 1, '999');
    expect(quarterStretchValue(filled, 'Shopee', 1)).toBe('999');
  });

  it('reads back blank when the quarter has drifted out of sync via per-month edits', () => {
    const drifted = [cell('Shopee', 1, '100', '999'), cell('Shopee', 2, '100', '111'), cell('Shopee', 3, '100', '999')];
    expect(quarterStretchValue(drifted, 'Shopee', 1)).toBe('');
  });
});

describe('computeBaselineStretchTargets', () => {
  const channels = [
    {
      channel: 'Shopee',
      baseline: [
        { month_index: 1, gmv: '150000000' },
        { month_index: 2, gmv: '160000000' },
        { month_index: 3, gmv: '180000000' },
      ],
    },
    { channel: 'TikTok Shop', baseline: [] },
  ];

  it('grows the LATEST baseline month (highest month_index), not the first or an average', () => {
    const out = computeBaselineStretchTargets(channels, gmvGridOf([{ channel: 'Shopee' }], 3, []), 20);
    // Q1 (M1-3) = 180,000,000 * 1.2
    expect(out.map((c) => c.nilai_stretch)).toEqual(['216000000', '216000000', '216000000']);
  });

  it('compounds quarter over quarter, not flat off the same baseline', () => {
    const grid = gmvGridOf([{ channel: 'Shopee' }], 6, []);
    const out = computeBaselineStretchTargets(channels, grid, 20);
    const q1 = out.filter((c) => c.month_index <= 3).map((c) => c.nilai_stretch);
    const q2 = out.filter((c) => c.month_index > 3).map((c) => c.nilai_stretch);
    expect(q1).toEqual(['216000000', '216000000', '216000000']); // 180M * 1.2
    expect(q2).toEqual(['259200000', '259200000', '259200000']); // 180M * 1.2^2
  });

  it('never overwrites a stretch figure the AM already typed', () => {
    const grid = gmvGridOf([{ channel: 'Shopee' }], 3, [
      { channel: 'Shopee', month_index: 2, metric: 'gmv', nilai_floor: '100', nilai_stretch: '123' },
    ]);
    const out = computeBaselineStretchTargets(channels, grid, 20);
    expect(out.find((c) => c.month_index === 2)!.nilai_stretch).toBe('123');
    expect(out.find((c) => c.month_index === 1)!.nilai_stretch).toBe('216000000');
  });

  it('leaves a channel with no baseline untouched — nothing to derive a suggestion from', () => {
    const grid = gmvGridOf([{ channel: 'TikTok Shop' }], 2, []);
    const out = computeBaselineStretchTargets(channels, grid, 20);
    expect(out.every((c) => c.nilai_stretch === '')).toBe(true);
  });
});

describe('assumptionsToBody', () => {
  it('drops the blank row RepeatList just added', () => {
    expect(
      assumptionsToBody([
        { kode: '', asumsi: '', pemilik: '', cara_verifikasi: '', target_terkait: [] },
      ]),
    ).toEqual([]);
  });

  it('keeps a partly-typed row so the server answers it, not the form', () => {
    // A started-but-incomplete assumption is a real attempt; `[data tidak
    // lengkap …]` from the server is the correct reply. Dropping it here would
    // make the row vanish on next load with nothing said.
    const partial = {
      kode: 'AS-1',
      asumsi: '',
      pemilik: '',
      cara_verifikasi: '',
      target_terkait: [],
    };
    expect(assumptionsToBody([partial])).toEqual([partial]);
  });
});
