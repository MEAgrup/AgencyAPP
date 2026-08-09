import { describe, expect, it } from 'vitest';
import {
  STRATEGI_DEFAULT_INTERNAL,
  STRATEGI_FIELD_IDS,
  STRATEGI_HARD_INTERNAL,
  STRATEGI_TIER_UNDECIDED,
  VISIBILITY_INTERNAL,
  VISIBILITY_SHAREABLE,
  canToggleShareable,
  defaultVisibility,
  isHardInternal,
  shareableFields,
  tierOf,
} from './visibility';

/**
 * Section B and G field IDs, taken from M6A §4 rather than re-derived, because
 * §4.1 covers them with "all of B" / "all of G" and a rule stated over a section
 * is only safe if the section is actually enumerable.
 */
const SECTION_B = [
  'B-0.1', 'B-0.2', 'B-0.3', 'B-0.4', 'B-0.5', 'B-0.6', 'B-0.7', 'B-0.8',
  'B-1.1', 'B-1.2', 'B-1.3', 'B-1.4', 'B-1.5',
  'B-2.1', 'B-2.2', 'B-2.3', 'B-2.4',
  'B-3.1', 'B-3.2', 'B-3.3', 'B-3.4', 'B-3.5', 'B-3.6',
  'B-4.1', 'B-4.2', 'B-4.3', 'B-4.4', 'B-4.5',
  'B-5.1', 'B-5.2', 'B-5.3', 'B-5.4', 'B-5.5',
  'B-6.1', 'B-6.2', 'B-6.3', 'B-6.4', 'B-6.5',
  'B-7.1', 'B-7.2', 'B-7.3', 'B-7.4',
  'B-8.1', 'B-8.2', 'B-8.3',
  'B-9.1', 'B-9.2', 'B-9.3',
];
const SECTION_G = ['G-0', 'G-1', 'G-2', 'G-3', 'G-4'];

describe('§4.1 tier map is TOTAL', () => {
  it('gives every §4 field ID a tier — no holes, no fallback', () => {
    // The safety property of this module. A hole would need a default branch,
    // and both possible defaults are bugs: shareable publishes an unclassified
    // field to a client, internal makes new fields silently vanish from the
    // client document. See the module note.
    const untiered = [...STRATEGI_FIELD_IDS, ...SECTION_B, ...SECTION_G].filter(
      (id) => tierOf(id) === null,
    );
    expect(untiered, `field IDs with no §4.1 tier: ${untiered.join(', ')}`).toEqual([]);
  });

  it('refuses an ID that is not a Strategi field', () => {
    // `null` must never read as "allowed": an unknown ID is what a typo or a
    // careless migration supplies, and it must not become a publishing door.
    for (const bogus of ['', 'K-1', 'A-99', 'DROP TABLE', 'A', 'AKSES-3']) {
      expect(tierOf(bogus)).toBeNull();
      expect(canToggleShareable(bogus)).toBe(false);
      expect(defaultVisibility(bogus)).toBeNull();
    }
  });
});

describe('hard-internal set (FROZEN — §7 says the DB CHECK must match)', () => {
  it('is exactly the seven fields §4.1 names', () => {
    // Pinned member by member on purpose. Widening this set must show up in a
    // diff; narrowing it is a disclosure decision and belongs in DECISIONS.md.
    expect([...STRATEGI_HARD_INTERNAL].sort()).toEqual(
      ['A-10', 'D-7', 'F-5', 'F-7', 'H-4', 'J-2', 'J-3'].sort(),
    );
  });

  it('cannot be toggled shareable by anyone', () => {
    // Rule 16(a). This is the assertion that stands between an AM's toggle and
    // a client reading what our reviewer said about the AM's work.
    for (const id of STRATEGI_HARD_INTERNAL) {
      expect(isHardInternal(id)).toBe(true);
      expect(canToggleShareable(id)).toBe(false);
      expect(defaultVisibility(id)).toBe(VISIBILITY_INTERNAL);
    }
  });

  it('is ignored even when the overlay says otherwise', () => {
    // The overlay is a table an AM writes into. A row claiming A-10 is shareable
    // is data to disregard, not an instruction to obey — otherwise one bad write
    // (or one bad migration) publishes the whole hard-internal set.
    const overlay = Object.fromEntries(
      STRATEGI_HARD_INTERNAL.map((id) => [id, VISIBILITY_SHAREABLE] as const),
    );
    expect(shareableFields([...STRATEGI_HARD_INTERNAL], overlay)).toEqual([]);
  });
});

describe('default-internal set (§4.1 row 2 — AM may share, audit-logged)', () => {
  it('is exactly the six fields §4.1 names', () => {
    expect([...STRATEGI_DEFAULT_INTERNAL].sort()).toEqual(
      ['A-3', 'A-13', 'C-6', 'E-4', 'F-1', 'H-1'].sort(),
    );
  });

  it('starts hidden but can be turned on', () => {
    for (const id of STRATEGI_DEFAULT_INTERNAL) {
      expect(defaultVisibility(id)).toBe(VISIBILITY_INTERNAL);
      expect(canToggleShareable(id)).toBe(true);
    }
    expect(shareableFields(['A-3'], { 'A-3': VISIBILITY_SHAREABLE })).toEqual(['A-3']);
  });
});

describe('default-shareable', () => {
  it('covers all of B and all of G in one rule, as §4.1 states it', () => {
    for (const id of [...SECTION_B, ...SECTION_G]) {
      expect(tierOf(id)).toBe('default_shareable');
      expect(defaultVisibility(id)).toBe(VISIBILITY_SHAREABLE);
    }
  });

  it('keeps D-8 shareable — §4.1 calls that out as deliberate', () => {
    // "Showing them at kickoff is the point: it converts 'kenapa target gak
    // kejar' from an argument into a checklist both sides already signed off on."
    expect(tierOf('D-8')).toBe('default_shareable');
    expect(tierOf('D-9')).toBe('default_shareable');
  });

  it('keeps D-2 shareable but D-7 hidden — the target, not the argument about it', () => {
    expect(defaultVisibility('D-2')).toBe(VISIBILITY_SHAREABLE);
    expect(defaultVisibility('D-7')).toBe(VISIBILITY_INTERNAL);
  });
});

describe('⚠️ provisional tiers (X-16 — awaiting owner)', () => {
  it('names exactly the six IDs §4.1 leaves unclassified', () => {
    // §4.1's third row says "everything else" and then enumerates what that
    // means; these six appear in §4 but in none of the three rows. The PRD
    // contradicts itself, so the house rule is to flag, not to pick quietly.
    expect([...STRATEGI_TIER_UNDECIDED].sort()).toEqual(
      ['A-15', 'A-16', 'I-1', 'I-4', 'J-1', 'J-4'].sort(),
    );
  });

  it('errs toward hiding, because publishing is the direction that cannot be undone', () => {
    for (const id of STRATEGI_TIER_UNDECIDED) {
      expect(defaultVisibility(id)).toBe(VISIBILITY_INTERNAL);
    }
  });

  it('keeps I-4 unshareable even by AM toggle until the owner rules otherwise', () => {
    // I-4 is notes to our own delivery divisions about "hal yang mudah salah
    // dipahami". To a client that reads as a list of mistakes our team keeps
    // making on their account — so the provisional answer is the strict one.
    expect(isHardInternal('I-4')).toBe(true);
    expect(canToggleShareable('I-4')).toBe(false);
  });
});

describe('shareableFields', () => {
  it('drops unknown IDs rather than passing them through', () => {
    expect(shareableFields(['B-1.1', 'K-9', ''])).toEqual(['B-1.1']);
  });

  it('honours an overlay that hides a shareable field', () => {
    // Rule 16 lets the toggle run both ways: a default-shareable field can be
    // switched off for a client who should not see it.
    expect(shareableFields(['B-1.1'], { 'B-1.1': VISIBILITY_INTERNAL })).toEqual([]);
  });

  it('answers the whole §4.1 map in one call without leaking a hard-internal field', () => {
    const all = [...STRATEGI_FIELD_IDS, ...SECTION_B, ...SECTION_G];
    const out = shareableFields(all);
    for (const id of STRATEGI_HARD_INTERNAL) expect(out).not.toContain(id);
    for (const id of STRATEGI_DEFAULT_INTERNAL) expect(out).not.toContain(id);
    expect(out).toContain('D-8');
    expect(out).toContain('B-3.3');
    expect(out.length).toBeGreaterThan(60);
  });
});
