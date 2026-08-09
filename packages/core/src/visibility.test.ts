import { describe, expect, it } from 'vitest';
import {
  STRATEGI_DEFAULT_INTERNAL,
  STRATEGI_FIELD_IDS,
  STRATEGI_FIELD_ROSTER,
  STRATEGI_HARD_INTERNAL,
  STRATEGI_SECTION_B_FIELD_IDS as SECTION_B,
  STRATEGI_SECTION_G_FIELD_IDS as SECTION_G,
  VISIBILITY_INTERNAL,
  VISIBILITY_SHAREABLE,
  canToggleShareable,
  defaultVisibility,
  hardInternalFieldIds,
  isHardInternal,
  shareableFields,
  tierOf,
} from './visibility';

describe('§4.1 tier map is TOTAL', () => {
  it('gives every §4 field ID a tier — no holes, no fallback', () => {
    // The safety property of this module. A hole would need a default branch,
    // and both possible defaults are bugs: shareable publishes an unclassified
    // field to a client, internal makes new fields silently vanish from the
    // client document. See the module note.
    const untiered = STRATEGI_FIELD_ROSTER.filter((id) => tierOf(id) === null);
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
  it('is §4.1\'s seven plus I-4, which X-16 classified hard-internal (2026-08-09)', () => {
    // Pinned member by member on purpose. Widening this set must show up in a
    // diff; narrowing it is a disclosure decision and belongs in DECISIONS.md.
    // I-4 was unclassified by §4.1 and the owner ruled it hard-internal — see
    // the module note and DECISIONS.md 2026-08-09.
    expect([...STRATEGI_HARD_INTERNAL].sort()).toEqual(
      ['A-10', 'D-7', 'F-5', 'F-7', 'H-4', 'I-4', 'J-2', 'J-3'].sort(),
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

  it('hands the DB CHECK exactly the IDs the TS predicate refuses', () => {
    // The list the migration's CHECK is built from and asserted against, computed
    // from the tier map so the two enforcers can never drift. It equals
    // STRATEGI_HARD_INTERNAL because the roster contains no other hard-internal
    // field, but it is derived rather than copied on purpose (see the note on
    // hardInternalFieldIds).
    expect(hardInternalFieldIds().sort()).toEqual([...STRATEGI_HARD_INTERNAL].sort());
    expect(hardInternalFieldIds().sort()).toEqual(
      ['A-10', 'D-7', 'F-5', 'F-7', 'H-4', 'I-4', 'J-2', 'J-3'].sort(),
    );
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
  it('is §4.1\'s six plus J-4, which X-16 classified default-internal (2026-08-09)', () => {
    // J-4 was unclassified by §4.1; the owner ruled it default-internal. Its
    // diff-generator filter obligation lives in the module note, not here.
    expect([...STRATEGI_DEFAULT_INTERNAL].sort()).toEqual(
      ['A-3', 'A-13', 'C-6', 'E-4', 'F-1', 'H-1', 'J-4'].sort(),
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

describe('X-16 (RESOLVED 2026-08-09) — the six §4.1 left unclassified', () => {
  // §4.1's third row said "everything else" and then enumerated what it meant;
  // these six appeared in §4 but in none of the three rows. The owner ruled:
  // A-15/A-16/I-1/J-1 shareable, I-4 hard-internal, J-4 default-internal.
  it('makes A-15, A-16, I-1, J-1 default-shareable — this is what unblocked A-11', () => {
    for (const id of ['A-15', 'A-16', 'I-1', 'J-1']) {
      expect(tierOf(id)).toBe('default_shareable');
      expect(defaultVisibility(id)).toBe(VISIBILITY_SHAREABLE);
      expect(canToggleShareable(id)).toBe(true);
    }
  });

  it('keeps I-4 hard-internal — no toggle, no default sharing', () => {
    // I-4 is notes to our own delivery divisions about "hal yang mudah salah
    // dipahami". To a client that reads as a list of mistakes our team keeps
    // making on their account.
    expect(tierOf('I-4')).toBe('hard_internal');
    expect(isHardInternal('I-4')).toBe(true);
    expect(canToggleShareable('I-4')).toBe(false);
    expect(defaultVisibility('I-4')).toBe(VISIBILITY_INTERNAL);
  });

  it('keeps J-4 default-internal — hidden by default, AM may share', () => {
    // The diff generator must still filter its own rows (see the module note);
    // the tier alone does not make an AUTO DIFF over the whole record safe.
    expect(tierOf('J-4')).toBe('default_internal');
    expect(defaultVisibility('J-4')).toBe(VISIBILITY_INTERNAL);
    expect(canToggleShareable('J-4')).toBe(true);
  });
});

describe('the seed roster', () => {
  it('carries every §4 field ID exactly once', () => {
    // A duplicate is not cosmetic here: the overlay is keyed (strategi_id,
    // field_id), so a repeated ID makes the seed INSERT fail on the primary key
    // and takes `createStrategi` down with it.
    expect(new Set(STRATEGI_FIELD_ROSTER).size).toBe(STRATEGI_FIELD_ROSTER.length);
    expect(STRATEGI_FIELD_ROSTER).toEqual([...STRATEGI_FIELD_IDS, ...SECTION_B, ...SECTION_G]);
  });

  it('gives every entry a seedable default', () => {
    for (const id of STRATEGI_FIELD_ROSTER) expect(defaultVisibility(id)).not.toBeNull();
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
    const out = shareableFields(STRATEGI_FIELD_ROSTER);
    for (const id of STRATEGI_HARD_INTERNAL) expect(out).not.toContain(id);
    for (const id of STRATEGI_DEFAULT_INTERNAL) expect(out).not.toContain(id);
    expect(out).toContain('D-8');
    expect(out).toContain('B-3.3');
    expect(out.length).toBeGreaterThan(60);
  });
});
