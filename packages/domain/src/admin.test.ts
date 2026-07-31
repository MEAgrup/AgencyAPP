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
  canReadAdmin,
  canWriteAdmin,
  deleteRoleMapping,
  ForbiddenError,
  listEmployees,
  listLayeredRoles,
  listRoleMappings,
  MSG_ADMIN_READ_DENIED,
  MSG_BAD_LEVEL,
  MSG_BAD_ROLE,
  MSG_INCOMPLETE,
  MSG_LAYERED_ROLE_DENIED,
  MSG_ROLE_MAPPING_DENIED,
  setLayeredRole,
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
});
