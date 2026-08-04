// Client-side rules for the employee (assignment) picker: how a row is
// labelled and how the search box narrows the list. Pure — no fetching, no
// runtime imports beyond a type.
//
// Unit-tested (employee-picker.test.ts) because the search box IS the feature:
// the doors it replaces asked for an `EMP-…` id typed from memory, and the
// failure mode being fixed is "cannot find the person ⇒ skip the field". A
// filter that hides the person you are looking for reproduces that bug exactly.
//
// Dependency-free ON PURPOSE (the campaign-picker / lead-progress precedent):
// `lib/directory.ts` imports `lib/api`, and the `@/` alias is a Next/tsconfig
// feature vitest does not resolve — so testable logic cannot live there.

import type { AssignableEmployee } from '@/lib/types';

/**
 * One dropdown line: name first (what people actually remember), then the raw
 * HRIS jabatan that disambiguates two people in the same division — an Account
 * Manager and a CRO both resolve to Account/staff, and the jabatan is the only
 * thing that tells them apart — then the employee id, because that is the value
 * the server records and the one that appears in audit trails.
 *
 * No `[...]` brackets here: those are reserved for BI validation messages
 * (house rule #5).
 */
export function employeeLabel(e: AssignableEmployee): string {
  const jabatan = e.jabatan.trim();
  return `${e.nama}${jabatan === '' ? '' : ` · ${jabatan}`} · ${e.employee_id}`;
}

/**
 * Substring search over nama + jabatan + divisi + employee_id, ALL
 * whitespace-separated tokens required. Token-wise rather than one substring so
 * "sinta account" finds "Sinta · Account Manager · EMP-2024-0007" — the order a
 * person types two remembered words is not the order they appear in the label.
 *
 * `keepId` is load-bearing, not a convenience: the picker is a <select> whose
 * value must survive typing in the search box. Without it, refining the query
 * after choosing someone drops the selected <option> from the DOM and the
 * browser silently falls back to the first remaining one — a DIFFERENT person
 * than the one on screen a moment earlier, which on these doors means work
 * assigned to the wrong colleague.
 */
export function filterEmployees(
  list: AssignableEmployee[],
  query: string,
  keepId?: string,
): AssignableEmployee[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return list;
  return list.filter((e) => {
    if (keepId && e.employee_id === keepId) return true;
    const haystack = `${e.nama} ${e.jabatan} ${e.divisi} ${e.employee_id}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

/**
 * Groups a division-agnostic list by CDPS division, PRESERVING the server's
 * order (division → staff first → nama) both between and inside groups.
 *
 * Only used by the unfiltered picker (no `division` prop): the per-door pickers
 * ask the server for one division and render a flat list. A division the FE does
 * not know about still reaches the user — an unpickable colleague is the failure
 * mode this whole feature exists to remove.
 */
export interface EmployeeGroup {
  label: string;
  items: AssignableEmployee[];
}

export function groupByDivision(list: AssignableEmployee[]): EmployeeGroup[] {
  const groups: EmployeeGroup[] = [];
  for (const e of list) {
    const label = e.division === '' ? 'Tanpa divisi' : e.division;
    const last = groups.find((g) => g.label === label);
    if (last) last.items.push(e);
    else groups.push({ label, items: [e] });
  }
  return groups;
}
