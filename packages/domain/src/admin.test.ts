/**
 * Tests for the admin plane (O44): employee directory, role mappings, layered
 * OD/Director roles.
 *
 * - Unit: the read/write permission matrix (OD reads, only Director writes).
 * - Integration (skipped unless DATABASE_URL is set): upsert/delete against a
 *   migrated Postgres, including the `(divisi, jabatan)` conflict key and the
 *   before→after audit rows. Rows are namespaced `ZZ-` and cleaned in afterEach.
 *
 * The audit assertions matter more here than anywhere else: `role_mappings` IS
 * the permission root, so a silent `staff`→`lead` re-grade must be
 * reconstructible from the log (house rule #3).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  type Actor,
  addEmployeeManually,
  canManageEmployeeAssignment,
  canReadAdmin,
  canWriteAdmin,
  ConflictError,
  deleteRoleMapping,
  ForbiddenError,
  HR_DIVISION,
  listEmployees,
  listLayeredRoles,
  listRoleMappings,
  MSG_ADMIN_READ_DENIED,
  MSG_BAD_LEVEL,
  MSG_BAD_ROLE,
  MSG_EMPLOYEE_ADD_DENIED,
  MSG_EMPLOYEE_EXISTS,
  MSG_EMPLOYEE_MUTATION_DENIED,
  MSG_EMPLOYEE_NOT_FOUND,
  MSG_INCOMPLETE,
  MSG_LAYERED_ROLE_DENIED,
  MSG_ROLE_MAPPING_DENIED,
  MSG_UNMAPPED_POSITION,
  NotFoundError,
  addHariLibur,
  listHariLibur,
  MSG_HARI_LIBUR_ADA,
  MSG_HARI_LIBUR_DENIED,
  MSG_HARI_LIBUR_KETERANGAN,
  MSG_HARI_LIBUR_NOT_FOUND,
  MSG_HARI_LIBUR_TANGGAL,
  removeHariLibur,
  setLayeredRole,
  updateEmployeeAssignment,
  upsertRoleMapping,
  ValidationError,
} from './admin';

const director = (): Actor => ({
  employeeId: 'ZZ-DIR', role: permission.makeRole({ division: 'OD', level: 'lead', director: true }),
});
const od = (): Actor => ({
  employeeId: 'ZZ-OD', role: permission.makeRole({ division: 'OD', level: 'lead', od: true }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const salesStaff = (): Actor => ({
  employeeId: 'ZZ-SSTAFF', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const hrLead = (): Actor => ({
  employeeId: 'ZZ-HRLEAD', role: permission.makeRole({ division: HR_DIVISION, level: 'lead' }),
});

// ---------------------------------------------------------------------------
// Unit: permission matrix (Phase 0 §4 — OD is read-only EVERYWHERE).
// ---------------------------------------------------------------------------
describe('admin permission matrix', () => {
  it('lets Director and OD read', () => {
    expect(canReadAdmin(director())).toBe(true);
    expect(canReadAdmin(od())).toBe(true);
  });

  it('denies read to a division lead and to staff', () => {
    // A Sales Lead is division-wide, not admin-wide: the admin plane carries the
    // authorization rules, so it is Director/OD only.
    expect(canReadAdmin(salesLead())).toBe(false);
    expect(canReadAdmin(salesStaff())).toBe(false);
  });

  it('lets ONLY Director write — OD can read the plane but never change it', () => {
    expect(canWriteAdmin(director())).toBe(true);
    expect(canWriteAdmin(od())).toBe(false);
    expect(canWriteAdmin(salesLead())).toBe(false);
    expect(canWriteAdmin(salesStaff())).toBe(false);
  });

  it('gates employee mutation to Director + HR-division Lead ONLY', () => {
    // Director always; the HR Lead is the one non-Director allowed (owner
    // decision 2026-08-10). Crucially a Lead of ANOTHER division must NOT be able
    // to re-grade employees — that would be self-promotion via jabatan.
    expect(canManageEmployeeAssignment(director())).toBe(true);
    expect(canManageEmployeeAssignment(hrLead())).toBe(true);
    expect(canManageEmployeeAssignment(salesLead())).toBe(false);
    expect(canManageEmployeeAssignment(salesStaff())).toBe(false);
    expect(canManageEmployeeAssignment(od())).toBe(false);
    // An HR *staff* (not lead) is not enough either.
    expect(
      canManageEmployeeAssignment({
        employeeId: 'ZZ-HRSTAFF', role: permission.makeRole({ division: HR_DIVISION, level: 'staff' }),
      }),
    ).toBe(false);
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

afterEach(async () => {
  if (!sql) return;
  await sql`delete from employee_layered_roles where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
  // addEmployeeManually provisions credentials; clear them before employees (FK).
  await sql`delete from employee_credentials where employee_id like 'ZZ-%'`;
  await sql`delete from employees where employee_id like 'ZZ-%'`;
});

/**
 * Highest `audit_log` id right now, so a test can assert on ONLY the rows its
 * own action appended.
 *
 * `audit_log` is append-only by design (house rule #3 — a `forbid_mutation`
 * trigger blocks DELETE), so afterEach cannot clean it and rows accumulate
 * across runs. Counting by `entity_id` alone would therefore pass on a fresh
 * database and fail on the second run — which is exactly what happened.
 */
async function auditWatermark(): Promise<string> {
  const r = await sql<{ max: string }[]>`select coalesce(max(id), 0)::text as max from audit_log`;
  return r[0].max;
}

/** Inserts a minimal employee (layered roles FK-reference `employees`). */
async function seedEmployee(
  id: string,
  divisi = 'BUSINESS DEVELOPMENT',
  jabatan = 'MARKETING STRATEGIST',
): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'Nama ' + id}, ${id.toLowerCase() + '@zz.local'}, ${divisi}, ${jabatan}, true, 'ZZ-DIR')`;
}

/**
 * Inserts one `role_mappings` row a test's divisi/jabatan pair resolves through —
 * `updateEmployeeAssignment`/`addEmployeeManually` now reject a pair with no
 * mapping (MSG_UNMAPPED_POSITION), mirroring the picker web-internal builds the
 * mutasi/add forms from. `created_by` is `ZZ-`-prefixed so `afterEach` reaps it.
 */
async function seedMapping(divisi: string, jabatan: string, division: string, level: string): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-DIR')
    on conflict (divisi, jabatan) do update set division = excluded.division, level = excluded.level`;
}

describeDb('upsertRoleMapping', () => {
  it('creates a mapping and audits it with no before-state', async () => {
    const wm = await auditWatermark();
    const id = await upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'MARKETING STRATEGIST',
      division: 'Marketing', level: 'staff',
    });
    expect(id).toMatch(/^\d+$/); // bigint as string — never a raw JS number (C03-F2)

    const rows = await listRoleMappings(sql);
    const made = rows.find((r) => r.id === id);
    expect(made).toBeDefined();
    expect(made!.division).toBe('Marketing');
    expect(made!.level).toBe('staff');

    const audit = await sql<{ before_json: unknown; after_json: { division: string; level: string } }[]>`
      select before_json, after_json from audit_log
       where entity_type = 'role_mapping'
         and entity_id = 'BUSINESS DEVELOPMENT/MARKETING STRATEGIST'
         and action = 'upsert'
         and id > ${wm}::bigint`;
    expect(audit).toHaveLength(1);
    expect(audit[0].before_json).toBeNull();
    expect(audit[0].after_json).toEqual({ division: 'Marketing', level: 'staff' });
  });

  it('re-grades an existing pair in place and records before→after', async () => {
    // This is the O33 shape: one jabatan promoted staff→lead. It must UPDATE the
    // existing row (uq_role_mapping), not insert a rival mapping for the pair.
    const wm = await auditWatermark();
    const first = await upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'HEAD OF BUSINESS DEVELOPMENT',
      division: 'Marketing', level: 'staff',
    });
    const second = await upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'HEAD OF BUSINESS DEVELOPMENT',
      division: 'Marketing', level: 'lead',
    });
    expect(second).toBe(first); // same row, not a duplicate

    const pairs = (await listRoleMappings(sql)).filter(
      (r) => r.divisi === 'BUSINESS DEVELOPMENT' && r.jabatan === 'HEAD OF BUSINESS DEVELOPMENT',
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].level).toBe('lead');

    const audit = await sql<
      { before_json: { level: string } | null; after_json: { level: string } }[]
    >`select before_json, after_json from audit_log
       where entity_type = 'role_mapping'
         and entity_id = 'BUSINESS DEVELOPMENT/HEAD OF BUSINESS DEVELOPMENT'
         and id > ${wm}::bigint
       order by id`;
    expect(audit).toHaveLength(2);
    expect(audit[0].before_json).toBeNull();
    expect(audit[1].before_json).toEqual({ division: 'Marketing', level: 'staff' });
    expect(audit[1].after_json).toEqual({ division: 'Marketing', level: 'lead' });
  });

  it('denies OD and a Sales Lead with the verbatim BI message', async () => {
    const input = {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'PUBLIC RELATION',
      division: 'Marketing', level: 'staff',
    };
    await expect(upsertRoleMapping(sql, od(), input)).rejects.toThrow(MSG_ROLE_MAPPING_DENIED);
    await expect(upsertRoleMapping(sql, od(), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(upsertRoleMapping(sql, salesLead(), input)).rejects.toThrow(MSG_ROLE_MAPPING_DENIED);
    // Nothing was written by the denied attempts.
    expect(await listRoleMappings(sql)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ jabatan: 'PUBLIC RELATION' })]),
    );
  });

  it('rejects a bad level, and reports incompleteness BEFORE the level check', async () => {
    await expect(upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'SEO CONTENT WRITER',
      division: 'Marketing', level: 'supervisor',
    })).rejects.toThrow(MSG_BAD_LEVEL);

    // Empty form: the house default wins over the enum complaint (mirror of Go).
    await expect(upsertRoleMapping(sql, director(), {
      divisi: '', jabatan: '', division: '', level: 'supervisor',
    })).rejects.toThrow(MSG_INCOMPLETE);
    await expect(upsertRoleMapping(sql, director(), {
      divisi: 'X', jabatan: 'Y', division: '', level: 'staff',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('trims input so " Marketing " cannot create a division nobody can match', async () => {
    // O42's failure mode was a division with no rows resolving to it; a stray
    // space would recreate it invisibly.
    const id = await upsertRoleMapping(sql, director(), {
      divisi: '  BUSINESS DEVELOPMENT  ', jabatan: '  MARKETING STRATEGIST  ',
      division: '  Marketing  ', level: ' staff ',
    });
    const made = (await listRoleMappings(sql)).find((r) => r.id === id)!;
    expect(made.divisi).toBe('BUSINESS DEVELOPMENT');
    expect(made.jabatan).toBe('MARKETING STRATEGIST');
    expect(made.division).toBe('Marketing');
    expect(made.level).toBe('staff');
  });
});

describeDb('deleteRoleMapping', () => {
  it('removes the rule and audits what it used to grant', async () => {
    const wm = await auditWatermark();
    const id = await upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'MARKETING STRATEGIST',
      division: 'Marketing', level: 'staff',
    });
    await deleteRoleMapping(sql, director(), id);

    expect((await listRoleMappings(sql)).find((r) => r.id === id)).toBeUndefined();

    const audit = await sql<
      { before_json: { division: string; level: string } | null; after_json: unknown }[]
    >`select before_json, after_json from audit_log
       where entity_type = 'role_mapping' and action = 'delete'
         and entity_id = 'BUSINESS DEVELOPMENT/MARKETING STRATEGIST'
         and id > ${wm}::bigint`;
    expect(audit).toHaveLength(1);
    // Without the before-state the log could not answer "what did this grant?".
    expect(audit[0].before_json).toEqual({ division: 'Marketing', level: 'staff' });
    expect(audit[0].after_json).toBeNull();
  });

  it('denies a non-Director', async () => {
    const id = await upsertRoleMapping(sql, director(), {
      divisi: 'BUSINESS DEVELOPMENT', jabatan: 'PUBLIC RELATION',
      division: 'Marketing', level: 'staff',
    });
    await expect(deleteRoleMapping(sql, od(), id)).rejects.toThrow(MSG_ROLE_MAPPING_DENIED);
    expect((await listRoleMappings(sql)).find((r) => r.id === id)).toBeDefined();
  });
});

describeDb('setLayeredRole', () => {
  it('grants, then DISABLES rather than deletes, auditing before→after', async () => {
    await seedEmployee('ZZ-EMP1');
    const wm = await auditWatermark();
    await setLayeredRole(sql, director(), 'ZZ-EMP1', 'od', true);

    let rows = (await listLayeredRoles(sql)).filter((r) => r.employeeId === 'ZZ-EMP1');
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('od');
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].id).toMatch(/^\d+$/);

    await setLayeredRole(sql, director(), 'ZZ-EMP1', 'od', false);
    rows = (await listLayeredRoles(sql)).filter((r) => r.employeeId === 'ZZ-EMP1');
    // Still ONE row, now disabled: absence of a row means "pure OD/Director" to
    // employee_claims(), so deleting would assert something different.
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);

    const audit = await sql<
      { before_json: { enabled: boolean } | null; after_json: { enabled: boolean } }[]
    >`select before_json, after_json from audit_log
       where entity_type = 'layered_role' and entity_id = 'ZZ-EMP1'
         and id > ${wm}::bigint
       order by id`;
    expect(audit).toHaveLength(2);
    expect(audit[0].before_json).toBeNull();
    expect(audit[1].before_json).toEqual({ role: 'od', enabled: true });
    expect(audit[1].after_json).toEqual({ role: 'od', enabled: false });
  });

  it('rejects a role outside {od, director, lead} and an empty employee id', async () => {
    await seedEmployee('ZZ-EMP2');
    await expect(setLayeredRole(sql, director(), 'ZZ-EMP2', 'superadmin', true))
      .rejects.toThrow(MSG_BAD_ROLE);
    await expect(setLayeredRole(sql, director(), '', 'od', true))
      .rejects.toThrow(MSG_INCOMPLETE);
  });

  /**
   * `lead` became a layered role in migrasi `20260730154210_layered_lead_role`
   * so that ONE employee can be lead without promoting everyone sharing their
   * jabatan (`role_mappings` is keyed on `(divisi, jabatan)`). The DB honoured it
   * from that day; this gate did not, so `rolemapseed --apply` — the only
   * documented way to write layered roles — rejected the three `lead` rows the
   * seed CSV already shipped. Locked here so the gate cannot drift back.
   */
  it('grants the layered `lead` role and lets employee_claims honour it', async () => {
    await seedEmployee('ZZ-EMP4');
    await setLayeredRole(sql, director(), 'ZZ-EMP4', 'lead', true);

    const rows = (await listLayeredRoles(sql)).filter((r) => r.employeeId === 'ZZ-EMP4');
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('lead');
    expect(rows[0].enabled).toBe(true);

    const [claims] = await sql<{ level: string }[]>`
      select public.employee_claims('ZZ-EMP4')->>'level' as level`;
    expect(claims.level).toBe('lead');
  });

  it('denies OD granting itself Director', async () => {
    await seedEmployee('ZZ-EMP3');
    await expect(setLayeredRole(sql, od(), 'ZZ-EMP3', 'director', true))
      .rejects.toThrow(MSG_LAYERED_ROLE_DENIED);
    expect((await listLayeredRoles(sql)).filter((r) => r.employeeId === 'ZZ-EMP3')).toHaveLength(0);
  });
});

describeDb('listEmployees', () => {
  it('maps the row to camelCase with a null syncedAt when never synced', async () => {
    await seedEmployee('ZZ-EMP4');
    const rows = (await listEmployees(sql)).filter((e) => e.employeeId === 'ZZ-EMP4');
    expect(rows).toHaveLength(1);
    expect(rows[0].divisi).toBe('BUSINESS DEVELOPMENT');
    expect(rows[0].jabatan).toBe('MARKETING STRATEGIST');
    expect(rows[0].statusAktif).toBe(true);
    expect(rows[0].flagged).toBe(false);
    expect(rows[0].syncedAt).toBeNull();
  });
});

describeDb('updateEmployeeAssignment', () => {
  it('mutates divisi/jabatan and audits the before→after transfer', async () => {
    await seedEmployee('ZZ-EMP5', 'ACCOUNT', 'ADMIN A&S');
    await seedMapping('CREATIVE', 'GRAPHIC DESIGNER', 'Creative', 'staff');
    const wm = await auditWatermark();

    const row = await updateEmployeeAssignment(sql, director(), 'ZZ-EMP5', 'CREATIVE', 'GRAPHIC DESIGNER');
    expect(row.divisi).toBe('CREATIVE');
    expect(row.jabatan).toBe('GRAPHIC DESIGNER');

    // The row itself moved.
    const after = (await listEmployees(sql)).find((e) => e.employeeId === 'ZZ-EMP5')!;
    expect(after.divisi).toBe('CREATIVE');
    expect(after.jabatan).toBe('GRAPHIC DESIGNER');

    // A transfer must be reconstructible from the log (house rule #3).
    const audit = await sql<
      {
        before_json: { divisi: string; jabatan: string } | null;
        after_json: { divisi: string; jabatan: string };
      }[]
    >`select before_json, after_json from audit_log
       where entity_type = 'employee' and entity_id = 'ZZ-EMP5' and action = 'reassign'
         and id > ${wm}::bigint`;
    expect(audit).toHaveLength(1);
    expect(audit[0].before_json).toEqual({ divisi: 'ACCOUNT', jabatan: 'ADMIN A&S' });
    expect(audit[0].after_json).toEqual({ divisi: 'CREATIVE', jabatan: 'GRAPHIC DESIGNER' });
  });

  it('trims input so a stray space cannot mint an unmatchable divisi', async () => {
    await seedEmployee('ZZ-EMP6', 'ACCOUNT', 'ADMIN A&S');
    await seedMapping('CREATIVE', 'VIDEOGRAPHER', 'Creative', 'staff');
    const row = await updateEmployeeAssignment(sql, director(), 'ZZ-EMP6', '  CREATIVE  ', '  VIDEOGRAPHER  ');
    expect(row.divisi).toBe('CREATIVE');
    expect(row.jabatan).toBe('VIDEOGRAPHER');
  });

  it('lets an HR-division Lead mutate, but denies a Sales Lead, OD and staff', async () => {
    await seedEmployee('ZZ-EMP7', 'ACCOUNT', 'ADMIN A&S');
    await seedMapping('CREATIVE', 'VIDEOGRAPHER', 'Creative', 'staff');
    await seedMapping('KOL', 'KOL SPECIALIST', 'KOL', 'staff');

    // Denied paths write nothing and carry the verbatim BI message.
    for (const bad of [salesLead(), od(), salesStaff()]) {
      await expect(
        updateEmployeeAssignment(sql, bad, 'ZZ-EMP7', 'CREATIVE', 'VIDEOGRAPHER'),
      ).rejects.toThrow(MSG_EMPLOYEE_MUTATION_DENIED);
    }
    await expect(
      updateEmployeeAssignment(sql, salesLead(), 'ZZ-EMP7', 'CREATIVE', 'VIDEOGRAPHER'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listEmployees(sql)).find((e) => e.employeeId === 'ZZ-EMP7')!.divisi).toBe('ACCOUNT');

    // HR Lead is allowed.
    const row = await updateEmployeeAssignment(sql, hrLead(), 'ZZ-EMP7', 'KOL', 'KOL SPECIALIST');
    expect(row.divisi).toBe('KOL');
    expect(row.jabatan).toBe('KOL SPECIALIST');
  });

  it('reports incompleteness for an empty divisi/jabatan, and 404 for an unknown employee', async () => {
    await seedEmployee('ZZ-EMP8', 'ACCOUNT', 'ADMIN A&S');
    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-EMP8', '', 'X'),
    ).rejects.toThrow(MSG_INCOMPLETE);
    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-EMP8', 'X', '  '),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-NOPE', 'CREATIVE', 'VIDEOGRAPHER'),
    ).rejects.toThrow(MSG_EMPLOYEE_NOT_FOUND);
    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-NOPE', 'CREATIVE', 'VIDEOGRAPHER'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a divisi/jabatan pair that matches no Role Mapping (the O42-class defect)', async () => {
    // This is exactly the bug a free-text mutasi form used to allow: a pair that
    // resolves to no CDPS division/level at all, silently, until someone notices
    // the employee has no access to anything.
    await seedEmployee('ZZ-EMP9', 'ACCOUNT', 'ADMIN A&S');
    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-EMP9', 'Marketing', 'Ads'),
    ).rejects.toThrow(MSG_UNMAPPED_POSITION);
    await expect(
      updateEmployeeAssignment(sql, director(), 'ZZ-EMP9', 'Marketing', 'Ads'),
    ).rejects.toBeInstanceOf(ValidationError);
    // The bad pair never landed — the employee's real assignment is untouched.
    expect((await listEmployees(sql)).find((e) => e.employeeId === 'ZZ-EMP9')!.divisi).toBe('ACCOUNT');
  });
});

describeDb('addEmployeeManually', () => {
  it('creates the employee, provisions a login credential, and audits create', async () => {
    await seedMapping('ACCOUNT', 'ACCOUNT MANAGER', 'Account', 'staff');
    const wm = await auditWatermark();
    const res = await addEmployeeManually(sql, director(), {
      employeeId: 'ZZ-NEW1', nama: 'Baru Satu', email: 'zz-new1@zz.local',
      divisi: 'ACCOUNT', jabatan: 'ACCOUNT MANAGER',
    });
    expect(res.sync.synced).toBe(1);
    expect(res.provisioned).toBe(1);

    const made = (await listEmployees(sql)).find((e) => e.employeeId === 'ZZ-NEW1');
    expect(made).toBeDefined();
    expect(made!.divisi).toBe('ACCOUNT');
    expect(made!.statusAktif).toBe(true);

    // A credential exists, forced-change on first login — the point of "can log in".
    const cred = await sql<{ must_change_password: boolean }[]>`
      select must_change_password from employee_credentials where employee_id = 'ZZ-NEW1'`;
    expect(cred).toHaveLength(1);
    expect(cred[0].must_change_password).toBe(true);

    const audit = await sql<
      { before_json: unknown; after_json: Record<string, unknown> }[]
    >`select before_json, after_json from audit_log
       where entity_type = 'employee' and entity_id = 'ZZ-NEW1' and action = 'create'
         and id > ${wm}::bigint`;
    expect(audit).toHaveLength(1);
    expect(audit[0].before_json).toBeNull();
    expect(audit[0].after_json).toMatchObject({
      nama: 'Baru Satu', divisi: 'ACCOUNT', jabatan: 'ACCOUNT MANAGER', status_aktif: true,
    });
  });

  it('rejects a duplicate employee_id or email with a clean BI message', async () => {
    await seedEmployee('ZZ-DUP', 'ACCOUNT', 'ADMIN A&S'); // email zz-dup@zz.local
    await expect(
      addEmployeeManually(sql, director(), {
        employeeId: 'ZZ-DUP', nama: 'x', email: 'lain@zz.local', divisi: 'ACCOUNT', jabatan: 'X',
      }),
    ).rejects.toThrow(MSG_EMPLOYEE_EXISTS);
    await expect(
      addEmployeeManually(sql, director(), {
        employeeId: 'ZZ-DUP2', nama: 'x', email: 'zz-dup@zz.local', divisi: 'ACCOUNT', jabatan: 'X',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // The clashing add never created a rival row.
    expect((await listEmployees(sql)).filter((e) => e.employeeId === 'ZZ-DUP2')).toHaveLength(0);
  });

  it('lets an HR-division Lead add, denies a Sales Lead/staff, and needs all fields', async () => {
    await expect(
      addEmployeeManually(sql, salesLead(), {
        employeeId: 'ZZ-NEW2', nama: 'x', email: 'zz-new2@zz.local', divisi: 'ACCOUNT', jabatan: 'X',
      }),
    ).rejects.toThrow(MSG_EMPLOYEE_ADD_DENIED);
    await expect(
      addEmployeeManually(sql, salesStaff(), {
        employeeId: 'ZZ-NEW2', nama: 'x', email: 'zz-new2@zz.local', divisi: 'ACCOUNT', jabatan: 'X',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // A denied add wrote nothing.
    expect((await listEmployees(sql)).filter((e) => e.employeeId === 'ZZ-NEW2')).toHaveLength(0);

    await expect(
      addEmployeeManually(sql, director(), {
        employeeId: 'ZZ-NEW3', nama: '', email: 'zz-new3@zz.local', divisi: 'ACCOUNT', jabatan: 'X',
      }),
    ).rejects.toThrow(MSG_INCOMPLETE);

    await seedMapping('KOL', 'KOL SPECIALIST', 'KOL', 'staff');
    const res = await addEmployeeManually(sql, hrLead(), {
      employeeId: 'ZZ-NEW4', nama: 'HR Add', email: 'zz-new4@zz.local', divisi: 'KOL', jabatan: 'KOL SPECIALIST',
    });
    expect(res.provisioned).toBe(1);
    expect((await listEmployees(sql)).find((e) => e.employeeId === 'ZZ-NEW4')!.divisi).toBe('KOL');
  });

  it('rejects a divisi/jabatan pair that matches no Role Mapping', async () => {
    await expect(
      addEmployeeManually(sql, director(), {
        employeeId: 'ZZ-NEW5', nama: 'x', email: 'zz-new5@zz.local', divisi: 'Marketing', jabatan: 'Ads',
      }),
    ).rejects.toThrow(MSG_UNMAPPED_POSITION);
    expect((await listEmployees(sql)).filter((e) => e.employeeId === 'ZZ-NEW5')).toHaveLength(0);
  });
});

describe('BI messages are the exact ported strings', () => {
  it('never drifts from the Go handlers', () => {
    // These are user-visible and ported byte-for-byte; a reword is a regression.
    expect(MSG_ADMIN_READ_DENIED).toBe('[anda tidak memiliki akses ke data ini]');
    expect(MSG_ROLE_MAPPING_DENIED).toBe('[hanya Director yang dapat mengelola role mapping]');
    expect(MSG_LAYERED_ROLE_DENIED).toBe('[hanya Director yang dapat mengelola layered role]');
    expect(MSG_BAD_LEVEL).toBe("[level harus 'staff' atau 'lead']");
    // The ONE deliberate divergence from Go, logged in DECISIONS 2026-07-30:
    // `lead` joined LAYERED_ROLES with migrasi `20260730154210`, so the Go
    // wording now under-reports what the gate accepts. Go is retired
    // (CLAUDE.md §Stack) and is no longer the parity oracle for this string.
    // Every other message here is still byte-for-byte the ported one.
    expect(MSG_BAD_ROLE).toBe("[role harus 'od', 'director', atau 'lead']");
    expect(MSG_INCOMPLETE).toBe('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
  });

  it('locks the NEW mutation strings (no Go ancestor — TS-only feature)', () => {
    expect(MSG_EMPLOYEE_MUTATION_DENIED).toBe(
      '[hanya Director atau Lead HR yang dapat mengubah divisi/jabatan karyawan]',
    );
    expect(MSG_EMPLOYEE_NOT_FOUND).toBe('[karyawan tidak ditemukan]');
    expect(MSG_EMPLOYEE_ADD_DENIED).toBe('[hanya Director atau Lead HR yang dapat menambah karyawan]');
    expect(MSG_EMPLOYEE_EXISTS).toBe('[karyawan dengan ID atau email itu sudah terdaftar]');
    expect(MSG_UNMAPPED_POSITION).toBe(
      '[divisi/jabatan tidak dikenali, pilih posisi yang sudah dipetakan di Role Mapping]',
    );
  });
});

// ---------------------------------------------------------------------------
// hari_libur — the calendar that makes "hari kerja" mean working days
// ---------------------------------------------------------------------------
//
// This is not cosmetic admin CRUD: `working_days_between` reads this table, so a
// row added here changes whether an AM is late on the Kelola Klien SLA. That is
// exactly why the write gate is Director-only, and why the tests below check the
// gate as carefully as the CRUD.

describe('hari libur permission matrix', () => {
  it('is the admin-plane gate: Director writes, OD reads only', () => {
    expect(canWriteAdmin(director())).toBe(true);
    expect(canWriteAdmin(od())).toBe(false);
    expect(canReadAdmin(od())).toBe(true);
    expect(canReadAdmin(salesLead())).toBe(false);
  });

  it('keeps the BI messages exact', () => {
    expect(MSG_HARI_LIBUR_DENIED).toBe('[hanya Director yang dapat mengelola hari libur]');
    expect(MSG_HARI_LIBUR_TANGGAL).toBe('[tanggal libur tidak valid, gunakan format YYYY-MM-DD]');
    expect(MSG_HARI_LIBUR_KETERANGAN).toBe('[keterangan hari libur wajib diisi]');
    expect(MSG_HARI_LIBUR_ADA).toBe('[tanggal itu sudah terdaftar sebagai hari libur]');
    expect(MSG_HARI_LIBUR_NOT_FOUND).toBe('[hari libur tidak ditemukan]');
  });
});

describeDb('hari libur (integration)', () => {
  // A far-future date so the fixture can never collide with a real entry an
  // operator adds, nor with another test's working-day arithmetic.
  const TANGGAL = '2099-12-25';

  afterEach(async () => {
    if (sql) await sql`delete from hari_libur where tanggal = ${TANGGAL}`;
  });

  it('adds, lists, and removes — each write audited', async () => {
    const added = await addHariLibur(sql, director(), { tanggal: TANGGAL, keterangan: 'Natal (uji)' });
    expect(added.tanggal).toBe(TANGGAL); // civil date, not shifted by timezone
    expect(added.keterangan).toBe('Natal (uji)');

    const rows = await listHariLibur(sql, od()); // OD may read
    expect(rows.some((r) => r.tanggal === TANGGAL)).toBe(true);

    // The calendar drives who counts as late, so both directions are logged.
    const auditAdd = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_type = 'hari_libur' and entity_id = ${TANGGAL} and action = 'create'`;
    expect(auditAdd[0].n).toBe(1);

    await removeHariLibur(sql, director(), TANGGAL);
    expect((await listHariLibur(sql, director())).some((r) => r.tanggal === TANGGAL)).toBe(false);
    const auditDel = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_type = 'hari_libur' and entity_id = ${TANGGAL} and action = 'delete'`;
    expect(auditDel[0].n).toBe(1);
  });

  it('refuses a duplicate date, an unknown date, and a bad payload', async () => {
    await addHariLibur(sql, director(), { tanggal: TANGGAL, keterangan: 'Natal (uji)' });
    await expect(
      addHariLibur(sql, director(), { tanggal: TANGGAL, keterangan: 'Duplikat' }),
    ).rejects.toThrow(MSG_HARI_LIBUR_ADA);
    await expect(removeHariLibur(sql, director(), '2099-12-24')).rejects.toThrow(MSG_HARI_LIBUR_NOT_FOUND);
    await expect(
      addHariLibur(sql, director(), { tanggal: '25-12-2099', keterangan: 'Format salah' }),
    ).rejects.toThrow(MSG_HARI_LIBUR_TANGGAL);
    await expect(
      addHariLibur(sql, director(), { tanggal: '2099-12-24', keterangan: '   ' }),
    ).rejects.toThrow(MSG_HARI_LIBUR_KETERANGAN);
  });

  it('never lets a non-Director change what counts as a working day', async () => {
    for (const actor of [od(), salesLead(), salesStaff(), hrLead()]) {
      await expect(
        addHariLibur(sql, actor, { tanggal: TANGGAL, keterangan: 'Percobaan' }),
      ).rejects.toThrow(MSG_HARI_LIBUR_DENIED);
      await expect(removeHariLibur(sql, actor, TANGGAL)).rejects.toThrow(MSG_HARI_LIBUR_DENIED);
    }
    // Even the HR lead — who MAY move an employee between divisions — cannot.
    expect((await listHariLibur(sql, director())).some((r) => r.tanggal === TANGGAL)).toBe(false);
  });

  it('actually changes the working-day arithmetic (the reason the table exists)', async () => {
    // 2099-12-24 is a Thursday, 2099-12-25 a Friday. (24, 25] = one working day.
    const before = await sql<{ n: number }[]>`select working_days_between('2099-12-24','2099-12-25') as n`;
    expect(Number(before[0].n)).toBe(1);

    await addHariLibur(sql, director(), { tanggal: TANGGAL, keterangan: 'Natal (uji)' });
    const after = await sql<{ n: number }[]>`select working_days_between('2099-12-24','2099-12-25') as n`;
    expect(Number(after[0].n)).toBe(0);
  });
});
