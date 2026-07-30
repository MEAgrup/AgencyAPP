/**
 * Tests for the rolemapseed CSV parsers — pure, no DB.
 *
 * The real seed files are asserted against too (as Go's csv_test.go did): they
 * ARE the contract, so a hand-edit that breaks them must fail here rather than
 * halfway through a bootstrap run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLayeredRoleCsv, parseRoleMappingCsv } from './csv';

const seed = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../supabase/seed/${name}`, import.meta.url)), 'utf8');

describe('parseRoleMappingCsv', () => {
  it('parses the canonical headerless 4-column format', () => {
    const rows = parseRoleMappingCsv('ACCOUNT,ADMIN MARKETPLACE,Account,staff');
    expect(rows).toEqual([{
      line: 1, divisi: 'ACCOUNT', jabatan: 'ADMIN MARKETPLACE',
      division: 'Account', level: 'staff',
    }]);
  });

  it('parses the real seed file — 23 mappings, DECISIONS 2026-07-17 batch-1', () => {
    const rows = parseRoleMappingCsv(seed('role_mappings_riil.csv'));
    expect(rows).toHaveLength(23);
    expect(rows.every((r) => r.level === 'staff' || r.level === 'lead')).toBe(true);
    expect(rows.every((r) => r.division !== '')).toBe(true);
  });

  it('rejects a level outside staff/lead', () => {
    expect(() => parseRoleMappingCsv('ACCOUNT,ADMIN,Account,supervisor'))
      .toThrow(/level "supervisor" harus "staff" atau "lead"/);
  });

  it('rejects an empty divisi/jabatan/division', () => {
    expect(() => parseRoleMappingCsv(',ADMIN,Account,staff')).toThrow(/tidak boleh kosong/);
    expect(() => parseRoleMappingCsv('ACCOUNT,,Account,staff')).toThrow(/tidak boleh kosong/);
    expect(() => parseRoleMappingCsv('ACCOUNT,ADMIN,,staff')).toThrow(/division \(CDPS\) kosong/);
  });

  it('accepts a division name it has never seen — the table exists so that is data', () => {
    // Go validates non-empty only. An allow-list here would reject a new MEA
    // division until someone shipped a code change.
    expect(parseRoleMappingCsv('BARU,JABATAN BARU,DivisiBaru,staff')[0].division).toBe('DivisiBaru');
  });

  it('rejects a duplicate (divisi, jabatan) pair and names both lines', () => {
    const csv = [
      'ACCOUNT,ADMIN MARKETPLACE,Account,staff',
      'SALES,SALES EXECUTIVE,Sales,staff',
      'ACCOUNT,ADMIN MARKETPLACE,Creative,lead',
    ].join('\n');
    // (divisi, jabatan) is the table's unique key, so on upsert the second row
    // silently re-grades the first — Account/staff quietly becomes Creative/lead.
    expect(() => parseRoleMappingCsv(csv)).toThrow(/ACCOUNT\/ADMIN MARKETPLACE duplikat di baris 1, 3/);
  });

  it('rejects a row with the wrong column count', () => {
    expect(() => parseRoleMappingCsv('ACCOUNT,ADMIN,Account')).toThrow(/butuh 4 kolom/);
  });

  it('reports every problem in one pass', () => {
    const csv = ['ACCOUNT,ADMIN,Account,supervisor', ',X,Sales,staff'].join('\n');
    expect(() => parseRoleMappingCsv(csv)).toThrow(/2 masalah/);
  });

  it('skips blank lines and a trailing newline', () => {
    expect(parseRoleMappingCsv('ACCOUNT,ADMIN,Account,staff\n\n')).toHaveLength(1);
  });

  it('surfaces an accidentally-added header as a line-1 error, not a silent row', () => {
    // These files are headerless; a pasted header must not become a mapping.
    expect(() => parseRoleMappingCsv('divisi,jabatan,division,level\nACCOUNT,ADMIN,Account,staff'))
      .toThrow(/baris 1/);
  });
});

describe('parseLayeredRoleCsv', () => {
  it('parses the canonical headerless 2-column format', () => {
    expect(parseLayeredRoleCsv('2409230432,od')).toEqual([
      { line: 1, employeeId: '2409230432', role: 'od' },
    ]);
  });

  it('parses the real seed file', () => {
    const rows = parseLayeredRoleCsv(seed('layered_roles_riil.csv'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.role === 'od' || r.role === 'director')).toBe(true);
    expect(rows.every((r) => r.employeeId !== '')).toBe(true);
  });

  it('rejects a role outside od/director', () => {
    expect(() => parseLayeredRoleCsv('2409230432,admin'))
      .toThrow(/role "admin" harus "od" atau "director"/);
  });

  it('rejects an empty employee_id', () => {
    expect(() => parseLayeredRoleCsv(',od')).toThrow(/employee_id tidak boleh kosong/);
  });

  it('rejects a duplicate (employee_id, role) grant', () => {
    expect(() => parseLayeredRoleCsv('2409230432,od\n2409230432,od'))
      .toThrow(/2409230432\/od duplikat di baris 1, 2/);
  });

  it('allows one employee to hold BOTH layered roles', () => {
    // OD and Director are layered roles on one account (CLAUDE.md §Permissions),
    // so this is legitimate and must not read as a duplicate.
    expect(parseLayeredRoleCsv('2409230432,od\n2409230432,director')).toHaveLength(2);
  });
});
