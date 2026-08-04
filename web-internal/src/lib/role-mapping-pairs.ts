// Client-side rules for the role-mapping picker (`/admin/role-mappings`).
//
// WHY THIS EXISTS. `role_mappings(divisi, jabatan) → (division, level)` is the
// permission root: an employee whose HRIS jabatan has NO mapping resolves to no
// CDPS division at all, so they are invisible to every assignment picker and
// rejected by every assignment validator. The form that fixes that used to ask
// the Director to TYPE both HRIS strings from memory — the same defect the
// employee picker just removed, one level up, and with a nastier failure mode:
// a typo does not error, it silently creates a mapping that matches nobody.
//
// So the pairs are DERIVED from the employee roster (which the page already
// loads) and offered as a list, with the unmapped ones first — those are exactly
// the people currently missing from every dropdown.
//
// Owner clarification 2026-08-04: **AM and CRO are the same function**; only the
// client's service tier differs. CDPS has no role for a service tier, so both
// jabatan map to `Account/staff` and both must appear in the AM picker. That is a
// MAPPING fact, not a code fact — which is why this form matters.
//
// Pure + dependency-free (the campaign-picker / employee-picker precedent) so it
// is unit-testable: `lib/api` imports cannot be resolved by vitest.

import type { AdminEmployee, RoleMapping } from '@/lib/types';

/** One HRIS (divisi, jabatan) pair present in the roster, with its mapping state. */
export interface RolePair {
  divisi: string;
  jabatan: string;
  /** Active employees carrying this pair — how many people the mapping decides. */
  activeCount: number;
  /** Inactive ones, kept visible: they return on the next HRIS/CSV import. */
  inactiveCount: number;
  /** The existing mapping's target, or null when the pair is unmapped. */
  mappedTo: { division: string; level: string } | null;
}

/**
 * Stable value used as the <option value> — the pair itself, not an index.
 *
 * Joined with an ESCAPED unit separator (U+001F), not a space or a dash: HRIS
 * strings contain spaces, dashes and slashes ("HEAD OF SALES JASA"), so any
 * printable separator could split in the wrong place and map a jabatan nobody
 * holds. Written as an escape rather than a literal control byte so the source
 * stays plain ASCII.
 */
const SEP = '\u001f';

export function pairKey(divisi: string, jabatan: string): string {
  return `${divisi}${SEP}${jabatan}`;
}

export function parsePairKey(key: string): { divisi: string; jabatan: string } | null {
  const i = key.indexOf(SEP);
  if (i < 0) return null;
  return { divisi: key.slice(0, i), jabatan: key.slice(i + SEP.length) };
}

/**
 * Every (divisi, jabatan) pair in the roster, UNMAPPED FIRST (that is the work
 * to be done), then by divisi + jabatan. Pairs already mapped are kept in the
 * list because the create endpoint is an upsert keyed on the pair — picking a
 * mapped pair EDITS it, which is how a mis-mapped CRO gets corrected.
 *
 * Employees with an empty divisi or jabatan are skipped: a mapping on `''` can
 * never match a real person, and offering it would invite exactly that.
 */
export function rolePairs(employees: AdminEmployee[], mappings: RoleMapping[]): RolePair[] {
  const byKey = new Map<string, RolePair>();
  for (const e of employees) {
    const divisi = e.divisi.trim();
    const jabatan = e.jabatan.trim();
    if (divisi === '' || jabatan === '') continue;
    const key = pairKey(divisi, jabatan);
    const row =
      byKey.get(key) ?? { divisi, jabatan, activeCount: 0, inactiveCount: 0, mappedTo: null };
    if (e.status_aktif) row.activeCount += 1;
    else row.inactiveCount += 1;
    byKey.set(key, row);
  }
  for (const m of mappings) {
    const row = byKey.get(pairKey(m.divisi.trim(), m.jabatan.trim()));
    if (row) row.mappedTo = { division: m.division, level: m.level };
  }
  return [...byKey.values()].sort((a, b) => {
    // Unmapped first: they are the ones nobody can assign work to today.
    if ((a.mappedTo === null) !== (b.mappedTo === null)) return a.mappedTo === null ? -1 : 1;
    return a.divisi.localeCompare(b.divisi) || a.jabatan.localeCompare(b.jabatan);
  });
}

/**
 * Mappings whose (divisi, jabatan) matches NO employee in the roster — the
 * typo-shaped failure this picker exists to prevent, surfaced so the existing
 * ones can be cleaned up. A mapping that matches nobody grants nothing and
 * silently keeps its intended holder unassignable.
 */
export function orphanMappings(employees: AdminEmployee[], mappings: RoleMapping[]): RoleMapping[] {
  const present = new Set(employees.map((e) => pairKey(e.divisi.trim(), e.jabatan.trim())));
  return mappings.filter((m) => !present.has(pairKey(m.divisi.trim(), m.jabatan.trim())));
}

/** One dropdown line: the HRIS pair, its headcount, and where it maps today. */
export function pairLabel(p: RolePair): string {
  const head =
    p.activeCount > 0
      ? `${p.activeCount} aktif`
      : `${p.inactiveCount} nonaktif`;
  const target = p.mappedTo === null
    ? 'BELUM DIPETAKAN'
    : `${p.mappedTo.division}/${p.mappedTo.level}`;
  return `${p.divisi} · ${p.jabatan} — ${head} · ${target}`;
}

/**
 * Token-wise search over divisi + jabatan + current target, every token required
 * and order-independent (same rule as the employee picker, same reason: the order
 * two remembered words are typed is not the order they appear in).
 *
 * `keepKey` keeps the SELECTED pair in the list while the query narrows past it —
 * without it the <select> silently reselects another pair, and here that means
 * re-mapping a jabatan the Director never looked at.
 */
export function filterPairs(list: RolePair[], query: string, keepKey?: string): RolePair[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return list;
  return list.filter((p) => {
    if (keepKey && pairKey(p.divisi, p.jabatan) === keepKey) return true;
    const target = p.mappedTo === null ? 'belum dipetakan' : `${p.mappedTo.division} ${p.mappedTo.level}`;
    const haystack = `${p.divisi} ${p.jabatan} ${target}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
