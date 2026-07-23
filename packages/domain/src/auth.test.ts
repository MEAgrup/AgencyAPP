/**
 * Tests for local CDPS authentication (auth.ts). Integration only (skipped unless
 * DATABASE_URL is set): exercises bcrypt verification, the failed-attempt lockout,
 * and the DERIVED identity/claims against a migrated Postgres. Namespaces ids with
 * `ZZ-` and cleans up.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createClient, type Sql } from '@cdps/db';
import {
  authenticate, loadClaims, loadIdentity, mustChangePassword,
  InvalidCredentialsError, NotProvisionedError, LockedError, MAX_FAILED_ATTEMPTS,
} from './auth.js';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const EMAIL = 'zz-auth@mea.co.id';
const PW = 'secret123';

/** Seed one active employee (Sales/staff via a ZZ role mapping) with a credential. */
async function seedEmployee(opts: { active?: boolean; mustChange?: boolean; withCred?: boolean } = {}): Promise<string> {
  const { active = true, mustChange = false, withCred = true } = opts;
  const id = 'ZZ-AUTH1';
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
            values ('ZZSales', 'ZZExec', 'Sales', 'staff', 'ZZ-AUTH')
            on conflict (divisi, jabatan) do nothing`;
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
            values (${id}, 'ZZ Auth', ${EMAIL}, 'ZZSales', 'ZZExec', ${active}, 'ZZ-AUTH')`;
  if (withCred) {
    await sql`insert into employee_credentials (employee_id, password_hash, must_change_password, failed_attempts, created_by)
              values (${id}, ${bcrypt.hashSync(PW, 10)}, ${mustChange}, 0, 'ZZ-AUTH')`;
  }
  return id;
}

afterAll(async () => { if (sql) await sql.end(); });
afterEach(async () => {
  if (!sql) return;
  await sql`delete from employee_credentials where created_by = 'ZZ-AUTH'`;
  await sql`delete from employees where created_by = 'ZZ-AUTH'`;
  await sql`delete from role_mappings where created_by = 'ZZ-AUTH'`;
});

describeDb('authenticate', () => {
  it('accepts the right password and reports mustChange', async () => {
    await seedEmployee({ mustChange: true });
    const res = await authenticate(sql, EMAIL, PW);
    expect(res.employeeId).toBe('ZZ-AUTH1');
    expect(res.mustChange).toBe(true);
  });

  it('rejects a wrong password (verbatim BI) and increments the failure counter', async () => {
    await seedEmployee();
    await expect(authenticate(sql, EMAIL, 'nope')).rejects.toThrow('[email atau password salah]');
    const c = await sql<{ failed_attempts: number }[]>`select failed_attempts from employee_credentials where employee_id = 'ZZ-AUTH1'`;
    expect(c[0].failed_attempts).toBe(1);
  });

  it('rejects an unknown email and a deactivated employee with the same generic error', async () => {
    await expect(authenticate(sql, 'ghost@mea.co.id', PW)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await seedEmployee({ active: false });
    await expect(authenticate(sql, EMAIL, PW)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('reports NotProvisioned for an active employee with no credential row', async () => {
    await seedEmployee({ withCred: false });
    await expect(authenticate(sql, EMAIL, PW)).rejects.toBeInstanceOf(NotProvisionedError);
  });

  it('locks after 5 failures and then rejects even the correct password (lock before hash)', async () => {
    await seedEmployee();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await expect(authenticate(sql, EMAIL, 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // 5th failure set the lock; a correct password is now rejected as locked.
    await expect(authenticate(sql, EMAIL, PW)).rejects.toBeInstanceOf(LockedError);
    const locked = await sql<{ locked_until: Date | null }[]>`select locked_until from employee_credentials where employee_id = 'ZZ-AUTH1'`;
    expect(locked[0].locked_until).not.toBeNull();
    // append-only audit_log can't be reset between reruns on a persistent DB, so assert ≥1.
    const audit = await sql<{ n: number }[]>`select count(*)::int n from audit_log where entity_id = 'ZZ-AUTH1' and action = 'account_locked'`;
    expect(audit[0].n).toBeGreaterThanOrEqual(1);
  });

  it('clears the failure counter on a successful login', async () => {
    await seedEmployee();
    await expect(authenticate(sql, EMAIL, 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    await authenticate(sql, EMAIL, PW);
    const c = await sql<{ failed_attempts: number }[]>`select failed_attempts from employee_credentials where employee_id = 'ZZ-AUTH1'`;
    expect(c[0].failed_attempts).toBe(0);
  });
});

describeDb('identity / claims', () => {
  it('loadClaims derives division/level from the role mapping', async () => {
    await seedEmployee();
    const claims = await loadClaims(sql, 'ZZ-AUTH1');
    expect(claims).toMatchObject({ employee_id: 'ZZ-AUTH1', division: 'Sales', level: 'staff', od: false, director: false });
  });

  it('loadIdentity returns the employee profile + role + must_change flag', async () => {
    await seedEmployee({ mustChange: true });
    const id = await loadIdentity(sql, 'ZZ-AUTH1', await mustChangePassword(sql, 'ZZ-AUTH1'));
    expect(id.employee).toMatchObject({ employee_id: 'ZZ-AUTH1', email: EMAIL, divisi: 'ZZSales', jabatan: 'ZZExec' });
    expect(id.role).toMatchObject({ division: 'Sales', level: 'staff' });
    expect(id.must_change_password).toBe(true);
  });
});
