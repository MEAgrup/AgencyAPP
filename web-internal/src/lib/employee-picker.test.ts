/**
 * Tests for the employee picker's client-side rules.
 *
 * The load-bearing one is `filterEmployees` keeping the SELECTED employee in the
 * list while the query narrows: without it the browser silently reselects the
 * first remaining <option>, which on these doors means the Brief/Task/Asset is
 * assigned to a different colleague than the one on screen. The label test is a
 * guard on the AM-vs-CRO case: both resolve to Account/staff, so the raw HRIS
 * jabatan is the only thing that tells them apart.
 */
import { describe, expect, it } from 'vitest';
import type { AssignableEmployee } from './types';
import { employeeLabel, filterEmployees, groupByDivision } from './employee-picker';

function emp(
  id: string,
  nama: string,
  jabatan: string,
  division = 'Account',
  level = 'staff',
  divisi = division,
): AssignableEmployee {
  return { employee_id: id, nama, jabatan, divisi, division, level };
}

const LIST: AssignableEmployee[] = [
  emp('EMP-2024-0007', 'Sinta Rahayu', 'Account Manager'),
  emp('EMP-2024-0011', 'Bagus Prakoso', 'CRO'),
  emp('EMP-2024-0021', 'Citra Dewi', 'Designer', 'Creative'),
  emp('EMP-2024-0022', 'Dimas Aji', 'Video Editor', 'Creative'),
];

describe('employeeLabel', () => {
  it('reads nama · jabatan · id — the jabatan is what separates an AM from a CRO', () => {
    expect(employeeLabel(LIST[0])).toBe('Sinta Rahayu · Account Manager · EMP-2024-0007');
    expect(employeeLabel(LIST[1])).toBe('Bagus Prakoso · CRO · EMP-2024-0011');
  });

  it('drops the separator when jabatan is empty rather than rendering a dangling dot', () => {
    expect(employeeLabel(emp('EMP-1', 'Tanpa Jabatan', '   '))).toBe('Tanpa Jabatan · EMP-1');
  });

  it('never emits square brackets — those are reserved for BI messages (house rule #5)', () => {
    for (const e of LIST) expect(employeeLabel(e)).not.toMatch(/[[\]]/);
  });
});

describe('filterEmployees', () => {
  it('returns the whole list for an empty or whitespace query', () => {
    expect(filterEmployees(LIST, '')).toEqual(LIST);
    expect(filterEmployees(LIST, '   ')).toEqual(LIST);
  });

  it('matches on nama, jabatan, divisi and employee id, case-insensitively', () => {
    expect(filterEmployees(LIST, 'sinta').map((e) => e.employee_id)).toEqual(['EMP-2024-0007']);
    expect(filterEmployees(LIST, 'cro').map((e) => e.employee_id)).toEqual(['EMP-2024-0011']);
    expect(filterEmployees(LIST, 'creative').map((e) => e.employee_id)).toEqual([
      'EMP-2024-0021',
      'EMP-2024-0022',
    ]);
    expect(filterEmployees(LIST, '0022').map((e) => e.employee_id)).toEqual(['EMP-2024-0022']);
  });

  it('requires every token but not their order', () => {
    // The order two remembered words are typed is not the order they appear in.
    expect(filterEmployees(LIST, 'manager sinta').map((e) => e.employee_id)).toEqual(['EMP-2024-0007']);
    expect(filterEmployees(LIST, 'sinta designer')).toEqual([]);
  });

  it('KEEPS the selected employee while the query narrows past them', () => {
    // Without keepId the <select> loses its selected <option> and the browser
    // falls back to the first remaining one — work assigned to the wrong person.
    const shown = filterEmployees(LIST, 'designer', 'EMP-2024-0007');
    expect(shown.map((e) => e.employee_id)).toEqual(['EMP-2024-0007', 'EMP-2024-0021']);
  });

  it('ignores keepId when nothing is selected yet', () => {
    expect(filterEmployees(LIST, 'designer', '').map((e) => e.employee_id)).toEqual(['EMP-2024-0021']);
  });
});

describe('groupByDivision', () => {
  it("groups in the server's order, both between and inside groups", () => {
    expect(groupByDivision(LIST)).toEqual([
      { label: 'Account', items: [LIST[0], LIST[1]] },
      { label: 'Creative', items: [LIST[2], LIST[3]] },
    ]);
  });

  it('still shows an employee whose division is empty rather than dropping them', () => {
    const odd = emp('EMP-9', 'Belum Dimap', 'Staff', '', 'staff');
    expect(groupByDivision([odd])).toEqual([{ label: 'Tanpa divisi', items: [odd] }]);
  });
});
