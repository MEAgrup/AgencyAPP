/**
 * Tests for the role-mapping picker's client-side rules.
 *
 * The load-bearing ones are about the two silent failures this picker removes:
 *   - an UNMAPPED (divisi, jabatan) pair means every holder of that jabatan is
 *     invisible to every assignment dropdown and rejected by every assignment
 *     validator — so unmapped pairs must sort FIRST, they are the work;
 *   - an ORPHAN mapping (typed by hand, matching nobody) grants nothing while
 *     looking like it does — so it must be listed, not hidden.
 * Plus the separator: HRIS strings are full of spaces and slashes, and a pair key
 * that splits in the wrong place maps a jabatan nobody holds.
 */
import { describe, expect, it } from 'vitest';
import type { AdminEmployee, RoleMapping } from './types';
import {
  filterPairs,
  orphanMappings,
  pairKey,
  pairLabel,
  parsePairKey,
  rolePairs,
} from './role-mapping-pairs';

function emp(id: string, divisi: string, jabatan: string, aktif = true): AdminEmployee {
  return {
    employee_id: id, nama: `Nama ${id}`, email: `${id}@mea.id`,
    divisi, jabatan, status_aktif: aktif, flagged: false,
  };
}
function map(id: string, divisi: string, jabatan: string, division: string, level: string): RoleMapping {
  return { id, divisi, jabatan, division, level };
}

// The real-world case behind this feature: an Account Manager mapped, a CRO not.
const EMPLOYEES: AdminEmployee[] = [
  emp('EMP-1', 'Account', 'Account Manager'),
  emp('EMP-2', 'Account', 'Account Manager'),
  emp('EMP-3', 'Account', 'CUSTOMER RELATION OFFICER'),
  emp('EMP-4', 'Sales', 'HEAD OF SALES JASA'),
  emp('EMP-5', 'Account', 'CUSTOMER RELATION OFFICER', false),
];
const MAPPINGS: RoleMapping[] = [
  map('1', 'Account', 'Account Manager', 'Account', 'staff'),
  map('2', 'Sales', 'HEAD OF SALES JASA', 'Sales', 'lead'),
];

describe('pairKey / parsePairKey', () => {
  it('round-trips HRIS strings that contain spaces and slashes', () => {
    const key = pairKey('Sales / Jasa', 'HEAD OF SALES JASA');
    expect(parsePairKey(key)).toEqual({ divisi: 'Sales / Jasa', jabatan: 'HEAD OF SALES JASA' });
  });

  it('does not split on a space — a printable separator would map the wrong jabatan', () => {
    const key = pairKey('Account', 'CUSTOMER RELATION OFFICER');
    expect(parsePairKey(key)?.divisi).toBe('Account');
    expect(parsePairKey(key)?.jabatan).toBe('CUSTOMER RELATION OFFICER');
  });

  it('returns null for a value that is not a pair key', () => {
    expect(parsePairKey('Account')).toBeNull();
  });
});

describe('rolePairs', () => {
  it('lists UNMAPPED pairs first — those are the people no picker can offer', () => {
    const pairs = rolePairs(EMPLOYEES, MAPPINGS);
    expect(pairs[0]).toMatchObject({
      divisi: 'Account',
      jabatan: 'CUSTOMER RELATION OFFICER',
      mappedTo: null,
    });
  });

  it('counts active and inactive holders separately', () => {
    const cro = rolePairs(EMPLOYEES, MAPPINGS)[0];
    expect(cro.activeCount).toBe(1);
    expect(cro.inactiveCount).toBe(1);
  });

  it('keeps mapped pairs in the list and shows their target — picking one EDITS it', () => {
    // The create endpoint upserts on (divisi, jabatan), so a mis-mapped CRO is
    // corrected by choosing it again, not by deleting first.
    const am = rolePairs(EMPLOYEES, MAPPINGS).find((p) => p.jabatan === 'Account Manager');
    expect(am).toMatchObject({ activeCount: 2, mappedTo: { division: 'Account', level: 'staff' } });
  });

  it('skips employees whose divisi or jabatan is blank — such a mapping matches nobody', () => {
    const pairs = rolePairs([emp('EMP-9', '', ''), emp('EMP-8', 'Account', '  ')], []);
    expect(pairs).toEqual([]);
  });

  it('ignores surrounding whitespace when matching a pair to its mapping', () => {
    const pairs = rolePairs([emp('EMP-7', ' Account ', ' Account Manager ')], MAPPINGS);
    expect(pairs[0].mappedTo).toEqual({ division: 'Account', level: 'staff' });
  });
});

describe('orphanMappings', () => {
  it('flags a mapping whose pair matches no employee (the hand-typed typo)', () => {
    const typo = map('3', 'Acount', 'Account Manger', 'Account', 'staff');
    expect(orphanMappings(EMPLOYEES, [...MAPPINGS, typo])).toEqual([typo]);
  });

  it('is empty when every mapping matches somebody', () => {
    expect(orphanMappings(EMPLOYEES, MAPPINGS)).toEqual([]);
  });
});

describe('pairLabel', () => {
  it('marks an unmapped pair loudly and reports its headcount', () => {
    const cro = rolePairs(EMPLOYEES, MAPPINGS)[0];
    expect(pairLabel(cro)).toBe('Account · CUSTOMER RELATION OFFICER — 1 aktif · BELUM DIPETAKAN');
  });

  it('shows the current target for a mapped pair', () => {
    const am = rolePairs(EMPLOYEES, MAPPINGS).find((p) => p.jabatan === 'Account Manager')!;
    expect(pairLabel(am)).toBe('Account · Account Manager — 2 aktif · Account/staff');
  });

  it('falls back to the inactive count when nobody active holds the jabatan', () => {
    const pairs = rolePairs([emp('EMP-6', 'KOL', 'KOL Specialist', false)], []);
    expect(pairLabel(pairs[0])).toBe('KOL · KOL Specialist — 1 nonaktif · BELUM DIPETAKAN');
  });
});

describe('filterPairs', () => {
  const pairs = rolePairs(EMPLOYEES, MAPPINGS);

  it('finds a jabatan by one remembered word', () => {
    expect(filterPairs(pairs, 'relation').map((p) => p.jabatan)).toEqual(['CUSTOMER RELATION OFFICER']);
  });

  it('matches the mapping target too, so "belum" lists the outstanding work', () => {
    expect(filterPairs(pairs, 'belum').every((p) => p.mappedTo === null)).toBe(true);
    expect(filterPairs(pairs, 'belum').length).toBe(1);
  });

  it('requires every token, order-independently', () => {
    expect(filterPairs(pairs, 'account manager').map((p) => p.jabatan)).toEqual(['Account Manager']);
    expect(filterPairs(pairs, 'manager account').map((p) => p.jabatan)).toEqual(['Account Manager']);
    expect(filterPairs(pairs, 'account sales')).toEqual([]);
  });

  it('KEEPS the selected pair while the query narrows past it', () => {
    const selected = pairKey('Account', 'Account Manager');
    const shown = filterPairs(pairs, 'relation', selected);
    expect(shown.map((p) => p.jabatan)).toEqual(['CUSTOMER RELATION OFFICER', 'Account Manager']);
  });
});
