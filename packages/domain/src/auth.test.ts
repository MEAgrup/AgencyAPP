/**
 * Tests for the /me read model (packages/domain/src/auth.ts).
 *
 * - Integration (skipped unless DATABASE_URL is set): getMe reads the actor's
 *   employee profile and combines it with the JWT-resolved role, inside a
 *   rolled-back transaction (nothing persists). A missing/inactive employee
 *   surfaces as NotFoundError (the route maps that to a 401).
 * - getVendorMe (LT-61): the vendor-realm counterpart — reads `vendors` by
 *   `actor.vendorId` instead of `employees` by `actor.employeeId`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql, type TransactionSql } from '@cdps/db';
import { permission } from '@cdps/core';
import { getMe, getVendorMe, NotFoundError } from './auth';

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

/** LT-61: a vendor Actor — employeeId = vendorId, Role all-empty. */
const vendorActor = (vendorId: string): permission.Actor => ({
  employeeId: vendorId, vendorId, role: permission.makeRole({}),
});

async function insertVendor(tx: TransactionSql, id: string): Promise<void> {
  await tx`
    insert into vendors (id, nama_vendor, jenis_layanan, pic_nama, pic_kontak, skema_biaya, tarif, catatan_kinerja, created_by)
    values (${id}, 'Vendor Live ZZ', 'live_stream', 'PIC Vendor', '0800000000', 'per_sesi', '1000000.00',
            'catatan internal rahasia', 'ZZ-ADMIN')`;
}

describeDb('getVendorMe (integration, LT-61)', () => {
  it("returns the vendor's own profile, never the internal catatan_kinerja", async () => {
    const me = await inRollback(async (tx) => {
      await insertVendor(tx, 'ZZ-VND-ME-1');
      return getVendorMe(tx, vendorActor('ZZ-VND-ME-1'));
    });
    expect(me).toEqual({ vendor_id: 'ZZ-VND-ME-1', nama_vendor: 'Vendor Live ZZ' });
  });

  it('throws NotFoundError for an unknown vendor', async () => {
    await expect(
      inRollback((tx) => getVendorMe(tx, vendorActor('ZZ-VND-NOPE'))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getVendorMe under REAL RLS (O37 / reads_rls.test.ts pattern) — proves
// `readAsActor` (apps/api's route for both `POST /auth/login`'s vendor branch
// and `GET /vendor/me`) is safe to use here, unlike `listVendorBriefs`
// (packages/domain/src/livestream.test.ts): `vendors_select` is
// `TO authenticated USING (true)` — the same "shared master list, no row scope
// needed" policy `vendor.getVendor`/`listVendors` already rely on for
// employees — so it evaluates true for a vendor claim too, with zero
// migration change. `withClaims` needs a COMMITTED row (it opens its own
// transaction on the shared connection), so this uses real insert/delete
// rather than `inRollback`.
// ---------------------------------------------------------------------------
describeDb('getVendorMe under RLS (readAsActor) — the route\'s actual access mode', () => {
  const VND_ID = 'ZZ-VND-RLS-ME-1';

  afterAll(async () => {
    await sql`delete from vendors where id = ${VND_ID}`;
  });

  it('a vendor reads its own profile through readAsActor (vendors_select USING(true))', async () => {
    await sql`
      insert into vendors (id, nama_vendor, jenis_layanan, pic_nama, pic_kontak, skema_biaya, tarif, created_by)
      values (${VND_ID}, 'Vendor RLS ZZ', 'live_stream', 'PIC Vendor', '0800000000', 'per_sesi', '1000000.00', 'ZZ-ADMIN')
      on conflict (id) do nothing`;

    const claims = JSON.stringify({ app_metadata: { vendor_id: VND_ID } });
    const me = await withClaims(sql, claims, (tx) => getVendorMe(tx, vendorActor(VND_ID)));
    expect(me).toEqual({ vendor_id: VND_ID, nama_vendor: 'Vendor RLS ZZ' });
  });
});

// ---------------------------------------------------------------------------
// Password management (O44(c)) — policy, authorization matrix, DB effects.
//
// Audit assertions use an id watermark rather than counting by entity_id:
// `audit_log` is append-only (a `forbid_mutation` trigger blocks DELETE), so
// afterEach cannot clean it and rows accumulate across runs.
// ---------------------------------------------------------------------------
import {
  adminMayManage,
  canManagePasswords,
  clearMustChangePassword,
  EmployeeNotFoundError,
  ForbiddenError as AuthForbiddenError,
  listCredentials,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LEN,
  MSG_EMPLOYEE_NOT_FOUND,
  MSG_PASSWORD_INCOMPLETE,
  MSG_PASSWORD_TOO_LONG,
  MSG_PASSWORD_WEAK,
  MSG_SET_PASSWORD_DENIED,
  PasswordPolicyError,
  setPassword,
  validatePassword,
} from './auth';

const director = (): permission.Actor => actor('ZZ-DIR', { division: 'OD', level: 'lead', director: true });
const od = (): permission.Actor => actor('ZZ-OD', { division: 'OD', level: 'lead', od: true });
const salesLead = (): permission.Actor => actor('ZZ-SLEAD', { division: 'Sales', level: 'lead' });
const salesStaff = (): permission.Actor => actor('ZZ-SSTAFF', { division: 'Sales', level: 'staff' });
const creativeLead = (): permission.Actor => actor('ZZ-CLEAD', { division: 'Creative', level: 'lead' });

describe('validatePassword', () => {
  it('rejects shorter than the minimum, counted in CHARACTERS', () => {
    expect(() => validatePassword('a'.repeat(MIN_PASSWORD_LEN - 1))).toThrow(MSG_PASSWORD_WEAK);
    expect(() => validatePassword('Rahasia1')).not.toThrow(); // exactly 8
  });

  it('counts multi-byte characters as characters, not bytes, for the minimum', () => {
    // 8 emoji = 8 characters but 32 bytes. A byte-based minimum would wrongly
    // accept 2 emoji, and a naive `.length` would miscount surrogate pairs.
    expect(() => validatePassword('😀'.repeat(8))).not.toThrow();
    expect(() => validatePassword('😀'.repeat(7))).toThrow(MSG_PASSWORD_WEAK);
  });

  it('rejects longer than the byte ceiling, because bcrypt truncates silently', () => {
    expect(() => validatePassword('a'.repeat(MAX_PASSWORD_BYTES))).not.toThrow();
    expect(() => validatePassword('a'.repeat(MAX_PASSWORD_BYTES + 1))).toThrow(MSG_PASSWORD_TOO_LONG);
    // 24 emoji = 24 chars but 96 bytes > 72 → too long even though it looks short.
    expect(() => validatePassword('😀'.repeat(24))).toThrow(MSG_PASSWORD_TOO_LONG);
  });

  it('throws PasswordPolicyError, so the route maps it to 400', () => {
    expect(() => validatePassword('short')).toThrow(PasswordPolicyError);
  });
});

describe('canManagePasswords', () => {
  it('allows Director and any division Lead; denies staff', () => {
    expect(canManagePasswords(director())).toBe(true);
    expect(canManagePasswords(salesLead())).toBe(true);
    expect(canManagePasswords(salesStaff())).toBe(false);
  });

  it('allows OD only because OD is level lead — the per-target gate still applies', () => {
    // Mirrors Go: the coarse check is director||lead. OD being read-only is
    // enforced by adminMayManage/domain gates, not by this predicate.
    expect(canManagePasswords(od())).toBe(true);
  });
});

describeDb('adminMayManage', () => {
  it('throws EmployeeNotFoundError for an unknown target', async () => {
    await expect(adminMayManage(sql, director(), 'ZZ-NOBODY')).rejects.toThrow(MSG_EMPLOYEE_NOT_FOUND);
    await expect(adminMayManage(sql, director(), 'ZZ-NOBODY')).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it('lets a Lead manage only their OWN mapped division, and never a layered target', async () => {
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ZZ-DIV', 'ZZ-JAB', 'Sales', 'staff', 'ZZ-DIR')
      on conflict (divisi, jabatan) do update set division = excluded.division`;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-TGT', 'Target', 'zz-tgt@zz.local', 'ZZ-DIV', 'ZZ-JAB', true, 'ZZ-DIR')
      on conflict (employee_id) do nothing`;
    try {
      expect(await adminMayManage(sql, director(), 'ZZ-TGT')).toBe(true);
      expect(await adminMayManage(sql, salesLead(), 'ZZ-TGT')).toBe(true);
      // Different division → denied even though the actor is a Lead.
      expect(await adminMayManage(sql, creativeLead(), 'ZZ-TGT')).toBe(false);
      // Staff is never allowed.
      expect(await adminMayManage(sql, salesStaff(), 'ZZ-TGT')).toBe(false);

      // Layered OD target: a Lead must NOT be able to take over an account above
      // them by resetting its password (privilege escalation).
      await sql`
        insert into employee_layered_roles (employee_id, role, enabled, created_by)
        values ('ZZ-TGT', 'od', true, 'ZZ-DIR')
        on conflict (employee_id, role) do update set enabled = true`;
      expect(await adminMayManage(sql, salesLead(), 'ZZ-TGT')).toBe(false);
      // ...but the Director still can.
      expect(await adminMayManage(sql, director(), 'ZZ-TGT')).toBe(true);
    } finally {
      await sql`delete from employee_layered_roles where employee_id = 'ZZ-TGT'`;
      await sql`delete from employee_credentials where employee_id = 'ZZ-TGT'`;
      await sql`delete from employees where employee_id = 'ZZ-TGT'`;
      await sql`delete from role_mappings where divisi = 'ZZ-DIV'`;
    }
  });

  it('treats an UNMAPPED target as Director-only', async () => {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-UNMAPPED', 'Unmapped', 'zz-un@zz.local', 'ZZ-NOMAP', 'ZZ-NOMAP', true, 'ZZ-DIR')
      on conflict (employee_id) do nothing`;
    try {
      expect(await adminMayManage(sql, director(), 'ZZ-UNMAPPED')).toBe(true);
      expect(await adminMayManage(sql, salesLead(), 'ZZ-UNMAPPED')).toBe(false);
    } finally {
      await sql`delete from employees where employee_id = 'ZZ-UNMAPPED'`;
    }
  });
});

describeDb('setPassword (B1 admin reset)', () => {
  async function watermark(): Promise<string> {
    const r = await sql<{ max: string }[]>`select coalesce(max(id), 0)::text as max from audit_log`;
    return r[0].max;
  }

  async function seed(): Promise<void> {
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ZZ-DIV', 'ZZ-JAB', 'Sales', 'staff', 'ZZ-DIR')
      on conflict (divisi, jabatan) do update set division = excluded.division`;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-TGT', 'Target', 'zz-tgt@zz.local', 'ZZ-DIV', 'ZZ-JAB', true, 'ZZ-DIR')
      on conflict (employee_id) do nothing`;
  }
  async function cleanup(): Promise<void> {
    await sql`delete from employee_credentials where employee_id = 'ZZ-TGT'`;
    await sql`delete from employees where employee_id = 'ZZ-TGT'`;
    await sql`delete from role_mappings where divisi = 'ZZ-DIV'`;
  }

  it('stores a hash, raises the forced-change gate, and clears the lockout', async () => {
    await seed();
    try {
      await setPassword(sql, director(), 'ZZ-TGT', 'RahasiaBaru123');
      const rows = await sql<
        { password_hash: string; must_change_password: boolean; failed_attempts: number; locked_until: Date | null }[]
      >`select password_hash, must_change_password, failed_attempts, locked_until
          from employee_credentials where employee_id = 'ZZ-TGT'`;
      expect(rows).toHaveLength(1);
      // Stored as a bcrypt hash, never the plaintext.
      expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
      expect(rows[0].password_hash).not.toContain('RahasiaBaru123');
      expect(rows[0].must_change_password).toBe(true);
      expect(rows[0].failed_attempts).toBe(0);
      expect(rows[0].locked_until).toBeNull();

      const emp = await sql<{ must_change_password: boolean }[]>`
        select must_change_password from employees where employee_id = 'ZZ-TGT'`;
      expect(emp[0].must_change_password).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('audits the reset WITHOUT ever recording the password or its hash', async () => {
    await seed();
    const wm = await watermark();
    try {
      await setPassword(sql, director(), 'ZZ-TGT', 'RahasiaBaru123');
      const audit = await sql<{ action: string; after_json: Record<string, unknown> }[]>`
        select action, after_json from audit_log
         where entity_type = 'employee_credential' and entity_id = 'ZZ-TGT'
           and id > ${wm}::bigint`;
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe('admin_set_password');
      const serialized = JSON.stringify(audit[0].after_json);
      expect(serialized).not.toContain('RahasiaBaru123');
      expect(serialized).not.toMatch(/\$2[aby]\$/);
      expect(audit[0].after_json).toEqual({ must_change_password: true, sessions_revoked: true });
    } finally {
      await cleanup();
    }
  });

  it('denies staff, and denies a Lead from another division', async () => {
    await seed();
    try {
      await expect(setPassword(sql, salesStaff(), 'ZZ-TGT', 'RahasiaBaru123'))
        .rejects.toThrow(MSG_SET_PASSWORD_DENIED);
      await expect(setPassword(sql, creativeLead(), 'ZZ-TGT', 'RahasiaBaru123'))
        .rejects.toBeInstanceOf(AuthForbiddenError);
      // Nothing was written by the denied attempts.
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from employee_credentials where employee_id = 'ZZ-TGT'`;
      expect(rows[0].n).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('reports the empty form with the house message, and enforces the policy', async () => {
    await seed();
    try {
      await expect(setPassword(sql, director(), '', '')).rejects.toThrow(MSG_PASSWORD_INCOMPLETE);
      await expect(setPassword(sql, director(), 'ZZ-TGT', 'short')).rejects.toThrow(MSG_PASSWORD_WEAK);
    } finally {
      await cleanup();
    }
  });

  it('rejects an unknown target with the employee message', async () => {
    await expect(setPassword(sql, director(), 'ZZ-NOBODY', 'RahasiaBaru123'))
      .rejects.toThrow(MSG_EMPLOYEE_NOT_FOUND);
  });
});

describeDb('clearMustChangePassword (part A, after GoTrue accepted)', () => {
  it('lowers the gate on both tables and stamps the change time', async () => {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, must_change_password, created_by)
      values ('ZZ-SELF', 'Self', 'zz-self@zz.local', 'ZZ-DIV', 'ZZ-JAB', true, true, 'ZZ-DIR')
      on conflict (employee_id) do update set must_change_password = true`;
    await sql`
      insert into employee_credentials (employee_id, password_hash, must_change_password, created_by)
      values ('ZZ-SELF', '$2a$10$placeholderplaceholderplaceholderplaceholderpl', true, 'ZZ-DIR')
      on conflict (employee_id) do update set must_change_password = true`;
    try {
      await clearMustChangePassword(sql, actor('ZZ-SELF', { division: 'Sales', level: 'staff' }));
      const emp = await sql<{ must_change_password: boolean }[]>`
        select must_change_password from employees where employee_id = 'ZZ-SELF'`;
      const cred = await sql<{ must_change_password: boolean; password_changed_at: Date | null }[]>`
        select must_change_password, password_changed_at from employee_credentials where employee_id = 'ZZ-SELF'`;
      expect(emp[0].must_change_password).toBe(false);
      expect(cred[0].must_change_password).toBe(false);
      expect(cred[0].password_changed_at).not.toBeNull();
    } finally {
      await sql`delete from employee_credentials where employee_id = 'ZZ-SELF'`;
      await sql`delete from employees where employee_id = 'ZZ-SELF'`;
    }
  });
});

describeDb('listCredentials', () => {
  it('denies staff outright', async () => {
    await expect(listCredentials(sql, salesStaff())).rejects.toBeInstanceOf(AuthForbiddenError);
  });

  it('scopes a Lead to their own mapped division, while Director sees more', async () => {
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ZZ-DIV', 'ZZ-JAB', 'Sales', 'staff', 'ZZ-DIR')
      on conflict (divisi, jabatan) do update set division = excluded.division`;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-TGT', 'Target', 'zz-tgt@zz.local', 'ZZ-DIV', 'ZZ-JAB', true, 'ZZ-DIR')
      on conflict (employee_id) do nothing`;
    try {
      const asLead = await listCredentials(sql, salesLead());
      const asDirector = await listCredentials(sql, director());
      expect(asLead.some((c) => c.employeeId === 'ZZ-TGT')).toBe(true);
      expect(asDirector.some((c) => c.employeeId === 'ZZ-TGT')).toBe(true);
      // A Sales lead must not see a Creative-mapped employee; the Director set is
      // therefore a strict superset here.
      expect(asDirector.length).toBeGreaterThan(asLead.length);
      // Never leak credential material through this read model.
      expect(Object.keys(asLead[0])).not.toContain('passwordHash');
    } finally {
      await sql`delete from employee_credentials where employee_id = 'ZZ-TGT'`;
      await sql`delete from employees where employee_id = 'ZZ-TGT'`;
      await sql`delete from role_mappings where divisi = 'ZZ-DIV'`;
    }
  });

  it('reports has_password / must_change honestly for a fresh reset', async () => {
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ZZ-DIV', 'ZZ-JAB', 'Sales', 'staff', 'ZZ-DIR')
      on conflict (divisi, jabatan) do update set division = excluded.division`;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-TGT', 'Target', 'zz-tgt@zz.local', 'ZZ-DIV', 'ZZ-JAB', true, 'ZZ-DIR')
      on conflict (employee_id) do nothing`;
    try {
      let row = (await listCredentials(sql, director())).find((c) => c.employeeId === 'ZZ-TGT')!;
      expect(row.hasPassword).toBe(false);
      expect(row.mustChangePassword).toBe(false);

      await setPassword(sql, director(), 'ZZ-TGT', 'RahasiaBaru123');
      row = (await listCredentials(sql, director())).find((c) => c.employeeId === 'ZZ-TGT')!;
      expect(row.hasPassword).toBe(true);
      expect(row.mustChangePassword).toBe(true);
    } finally {
      await sql`delete from employee_credentials where employee_id = 'ZZ-TGT'`;
      await sql`delete from employees where employee_id = 'ZZ-TGT'`;
      await sql`delete from role_mappings where divisi = 'ZZ-DIV'`;
    }
  });
});

describe('password BI messages are the exact ported strings', () => {
  it('never drifts from the Go handlers', () => {
    expect(MSG_PASSWORD_WEAK).toBe('[password minimal 8 karakter]');
    expect(MSG_PASSWORD_TOO_LONG).toBe('[password maksimal 72 karakter]');
    expect(MSG_SET_PASSWORD_DENIED).toBe('[anda tidak memiliki akses untuk mengatur password karyawan ini]');
    expect(MSG_EMPLOYEE_NOT_FOUND).toBe('[karyawan tidak ditemukan]');
    expect(MSG_PASSWORD_INCOMPLETE).toBe('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
  });
});
