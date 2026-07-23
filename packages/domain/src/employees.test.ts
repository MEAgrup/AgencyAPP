/**
 * Tests for the employee importer.
 *
 * - Unit: the CSV parser (no DB).
 * - Integration (skipped unless DATABASE_URL is set): sync / provisioning /
 *   linking against a migrated Postgres. The composable functions run inside a
 *   rolled-back transaction (nothing persists); the importEmployees end-to-end
 *   test commits under a unique ZZ- id namespace and cleans up after itself.
 */
import { afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createClient, type Sql, type TransactionSql } from '@cdps/db';
import {
  CsvEmployeeSource,
  DEFAULT_TEMP_PASSWORD,
  importEmployees,
  linkAuthUsers,
  parseEmployeeCsv,
  provisionCredentials,
  syncEmployees,
  type Employee,
} from './employees.js';

describe('parseEmployeeCsv', () => {
  it('parses the canonical 6-column format with a header', () => {
    const csv = [
      'employee_id,nama,email,divisi,jabatan,status_aktif',
      'EMP-1,Budi,budi@mea.co.id,Sales,Sales Executive,1',
      'EMP-2,Siti,siti@mea.co.id,Creative,Designer,0',
    ].join('\n');
    const emps = parseEmployeeCsv(csv);
    expect(emps).toHaveLength(2);
    expect(emps[0]).toEqual({
      employeeId: 'EMP-1', nama: 'Budi', email: 'budi@mea.co.id',
      divisi: 'Sales', jabatan: 'Sales Executive', statusAktif: true, password: undefined,
    });
    expect(emps[1].statusAktif).toBe(false);
  });

  it('accepts an optional 7th password column', () => {
    const csv = 'employee_id,nama,email,divisi,jabatan,status_aktif,password\nEMP-1,Budi,b@x.id,Sales,Exec,true,S3cret!';
    expect(parseEmployeeCsv(csv)[0].password).toBe('S3cret!');
  });

  it('parses various truthy/falsy status tokens', () => {
    const rows = ['1', 'true', 'TRUE', 't', 'yes', 'y', '0', 'false', 'no', ''];
    const csv = ['employee_id,nama,email,divisi,jabatan,status_aktif']
      .concat(rows.map((v, i) => `EMP-${i},N,e${i}@x.id,D,J,${v}`))
      .join('\n');
    const emps = parseEmployeeCsv(csv);
    expect(emps.map((e) => e.statusAktif)).toEqual([
      true, true, true, true, true, true, false, false, false, false,
    ]);
  });

  it('honors quoted fields with commas and doubled quotes', () => {
    const csv =
      'employee_id,nama,email,divisi,jabatan,status_aktif\n' +
      'EMP-1,"Budi, Jr.",budi@x.id,Sales,"Head of ""Sales""",1';
    const e = parseEmployeeCsv(csv)[0];
    expect(e.nama).toBe('Budi, Jr.');
    expect(e.jabatan).toBe('Head of "Sales"');
  });

  it('ignores a trailing blank line', () => {
    const csv = 'employee_id,nama,email,divisi,jabatan,status_aktif\nEMP-1,B,b@x.id,S,J,1\n';
    expect(parseEmployeeCsv(csv)).toHaveLength(1);
  });

  it('throws on a row with fewer than 6 columns', () => {
    const csv = 'employee_id,nama,email,divisi,jabatan,status_aktif\nEMP-1,B,b@x.id,S,J';
    expect(() => parseEmployeeCsv(csv)).toThrow(/expected >=6 columns/);
  });

  it('returns [] for empty input', () => {
    expect(parseEmployeeCsv('')).toEqual([]);
  });
});

describe('CsvEmployeeSource', () => {
  it('names itself and fetches parsed rows', async () => {
    const src = new CsvEmployeeSource(
      'employee_id,nama,email,divisi,jabatan,status_aktif\nEMP-1,B,b@x.id,S,J,1',
      'employees.csv',
    );
    expect(src.name()).toBe('csv:employees.csv');
    expect(await src.fetch()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

/** Run fn inside a transaction, then force a ROLLBACK (nothing persists). */
async function inRollback<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  class Rollback extends Error {}
  let captured: T;
  try {
    await sql.begin(async (tx) => {
      captured = await fn(tx as TransactionSql);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return captured!;
}

const emp = (id: string, over: Partial<Employee> = {}): Employee => ({
  employeeId: id, nama: 'Test', email: `${id.toLowerCase()}@mea.co.id`,
  divisi: 'Sales', jabatan: 'Sales Executive', statusAktif: true, ...over,
});

describeDb('syncEmployees (integration)', () => {
  it('inserts new employees and counts them', async () => {
    const res = await inRollback((tx) =>
      syncEmployees(tx, [emp('ZZ-A'), emp('ZZ-B')], 'SYSTEM', { full: false }),
    );
    expect(res.synced).toBe(2);
    expect(res.deactivated).toBe(0);
    expect(res.reactivated).toBe(0);
  });

  it('is idempotent: re-syncing the same rows updates in place', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A', { nama: 'First' })], 'SYSTEM', { full: false });
      await syncEmployees(tx, [emp('ZZ-A', { nama: 'Second' })], 'SYSTEM', { full: false });
      const rows = await tx<{ nama: string }[]>`select nama from employees where employee_id = 'ZZ-A'`;
      expect(rows).toHaveLength(1);
      expect(rows[0].nama).toBe('Second');
    });
  });

  it('deactivation sets status inactive and audits once', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A')], 'SYSTEM', { full: false });
      const res = await syncEmployees(tx, [emp('ZZ-A', { statusAktif: false })], 'SYSTEM', { full: false });
      expect(res.deactivated).toBe(1);
      const active = await tx<{ status_aktif: boolean }[]>`select status_aktif from employees where employee_id = 'ZZ-A'`;
      expect(active[0].status_aktif).toBe(false);
      const audits = await tx<{ n: number }[]>`
        select count(*)::int as n from audit_log
        where entity_type = 'employee' and entity_id = 'ZZ-A' and action = 'hris_sync:deactivated'`;
      expect(audits[0].n).toBe(1);
    });
  });

  it('reactivation lifts inactive and audits', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A', { statusAktif: false })], 'SYSTEM', { full: false });
      const res = await syncEmployees(tx, [emp('ZZ-A', { statusAktif: true })], 'SYSTEM', { full: false });
      expect(res.reactivated).toBe(1);
      const audits = await tx<{ n: number }[]>`
        select count(*)::int as n from audit_log
        where entity_id = 'ZZ-A' and action = 'hris_sync:reactivated'`;
      expect(audits[0].n).toBe(1);
    });
  });

  it('full sync flags employees absent from the source', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A'), emp('ZZ-B')], 'SYSTEM', { full: false });
      // ZZ-B absent from this full source => flagged.
      const res = await syncEmployees(tx, [emp('ZZ-A')], 'SYSTEM', { full: true });
      expect(res.flagged).toBeGreaterThanOrEqual(1);
      const flagged = await tx<{ flagged_for_review: boolean }[]>`
        select flagged_for_review from employees where employee_id = 'ZZ-B'`;
      expect(flagged[0].flagged_for_review).toBe(true);
    });
  });
});

describeDb('provisionCredentials (integration)', () => {
  it('bcrypt-hashes a per-row password, forces change, and audits', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A', { password: 'MyTemp!234' })], 'SYSTEM', { full: false });
      const n = await provisionCredentials(tx, [emp('ZZ-A', { password: 'MyTemp!234' })], 'ADMIN-1');
      expect(n).toBe(1);
      const rows = await tx<{ password_hash: string; must_change_password: boolean }[]>`
        select password_hash, must_change_password from employee_credentials where employee_id = 'ZZ-A'`;
      expect(rows[0].must_change_password).toBe(true);
      expect(bcrypt.compareSync('MyTemp!234', rows[0].password_hash)).toBe(true);
      expect(rows[0].password_hash).not.toContain('MyTemp'); // never stored in the clear
    });
  });

  it('defaults the password when a row omits one', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A')], 'SYSTEM', { full: false });
      await provisionCredentials(tx, [emp('ZZ-A')], 'ADMIN-1');
      const rows = await tx<{ password_hash: string }[]>`
        select password_hash from employee_credentials where employee_id = 'ZZ-A'`;
      expect(bcrypt.compareSync(DEFAULT_TEMP_PASSWORD, rows[0].password_hash)).toBe(true);
    });
  });

  it('never re-provisions an existing credential (idempotent, no clobber)', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A', { password: 'Orig!234' })], 'SYSTEM', { full: false });
      expect(await provisionCredentials(tx, [emp('ZZ-A', { password: 'Orig!234' })], 'ADMIN-1')).toBe(1);
      // A second run with a DIFFERENT password must not overwrite.
      expect(await provisionCredentials(tx, [emp('ZZ-A', { password: 'New!234' })], 'ADMIN-1')).toBe(0);
      const rows = await tx<{ password_hash: string }[]>`
        select password_hash from employee_credentials where employee_id = 'ZZ-A'`;
      expect(bcrypt.compareSync('Orig!234', rows[0].password_hash)).toBe(true);
    });
  });

  it('skips inactive employees', async () => {
    await inRollback(async (tx) => {
      await syncEmployees(tx, [emp('ZZ-A', { statusAktif: false })], 'SYSTEM', { full: false });
      expect(await provisionCredentials(tx, [emp('ZZ-A', { statusAktif: false })], 'ADMIN-1')).toBe(0);
    });
  });
});

describeDb('linkAuthUsers (integration)', () => {
  it('is a no-op returning 0 when no auth schema exists (plain PG)', async () => {
    // CI Postgres has no `auth` schema, so the guard short-circuits.
    const linked = await inRollback((tx) => linkAuthUsers(tx));
    expect(linked).toBe(0);
  });
});

describeDb('importEmployees (end-to-end)', () => {
  it('syncs, provisions, and links in one run; cleans up after', async () => {
    const csv =
      'employee_id,nama,email,divisi,jabatan,status_aktif,password\n' +
      'ZZ-E1,Budi,zz-e1@mea.co.id,Sales,Sales Executive,1,Temp!234\n' +
      'ZZ-E2,Siti,zz-e2@mea.co.id,Creative,Designer,1,';
    try {
      const res = await importEmployees(sql, new CsvEmployeeSource(csv, 't.csv'), 'SYSTEM', { full: false });
      expect(res.source).toBe('csv:t.csv');
      expect(res.sync.synced).toBe(2);
      expect(res.provisioned).toBe(2);
      expect(res.linked).toBe(0); // no GoTrue in CI
      const creds = await sql<{ n: number }[]>`
        select count(*)::int as n from employee_credentials where employee_id in ('ZZ-E1','ZZ-E2')`;
      expect(creds[0].n).toBe(2);
    } finally {
      await sql`delete from employee_credentials where employee_id in ('ZZ-E1','ZZ-E2')`;
      await sql`delete from employees where employee_id in ('ZZ-E1','ZZ-E2')`;
    }
  });
});
