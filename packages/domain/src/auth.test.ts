/**
 * Tests for the /me read model (packages/domain/src/auth.ts).
 *
 * - Integration (skipped unless DATABASE_URL is set): getMe reads the actor's
 *   employee profile and combines it with the JWT-resolved role, inside a
 *   rolled-back transaction (nothing persists). A missing/inactive employee
 *   surfaces as NotFoundError (the route maps that to a 401).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Sql, type TransactionSql } from '@cdps/db';
import { permission } from '@cdps/core';
import { getMe, NotFoundError } from './auth';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

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

const actor = (employeeId: string, role: Partial<permission.Role> = {}): permission.Actor => ({
  employeeId,
  role: { division: 'Sales', level: 'staff', od: false, director: false, ...role },
});

async function insertEmployee(tx: TransactionSql, id: string, active = true): Promise<void> {
  await tx`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, 'Budi', ${`${id.toLowerCase()}@mea.co.id`}, 'Sales', 'Sales Executive', ${active}, 'SYSTEM')`;
}

describeDb('getMe (integration)', () => {
  it('returns the employee profile combined with the JWT-resolved role', async () => {
    const me = await inRollback(async (tx) => {
      await insertEmployee(tx, 'ZZ-ME-1');
      return getMe(tx, actor('ZZ-ME-1', { level: 'lead' }));
    });
    expect(me.employee).toEqual({
      employee_id: 'ZZ-ME-1',
      nama: 'Budi',
      email: 'zz-me-1@mea.co.id',
      divisi: 'Sales',
      jabatan: 'Sales Executive',
      must_change_password: false,
    });
    expect(me.role).toEqual({ division: 'Sales', level: 'lead', od: false, director: false });
  });

  it('throws NotFoundError for an unknown employee', async () => {
    await expect(
      inRollback((tx) => getMe(tx, actor('ZZ-NOPE'))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError for a deactivated employee (dead session)', async () => {
    await expect(
      inRollback(async (tx) => {
        await insertEmployee(tx, 'ZZ-OFF', false);
        return getMe(tx, actor('ZZ-OFF'));
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
