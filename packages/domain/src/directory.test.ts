/**
 * Tests for the assignable-employee directory (directory.ts).
 *
 * - Unit: the `canReadDirectory` gate (no DB).
 * - Integration (skipped unless DATABASE_URL is set): the rows
 *   `private.employee_assignable()` offers, the division/level narrowing, and —
 *   the assertion that actually matters — PARITY WITH THE VALIDATORS: every
 *   employee the picker offers for a door must be one that door's server-side
 *   validation accepts, and every employee it hides must be one it rejects.
 *   Without that pairing the picker can drift into offering people who are then
 *   refused, which is worse than the free-text box it replaces: the user has no
 *   way left to guess what IS valid.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import {
  canReadDirectory,
  ForbiddenError,
  listAssignableEmployees,
  MSG_DIRECTORY_DENIED,
  type Actor,
} from './directory';
import { MSG_ADMIN_READ_DENIED } from './admin';
import { assignAM, ValidationError as AccountValidationError } from './account';

// ---- actors ---------------------------------------------------------------

const staff = (division: string): Actor => ({
  employeeId: `ZZ-${division}-S`,
  role: permission.makeRole({ division, level: 'staff' }),
});
const lead = (division: string): Actor => ({
  employeeId: `ZZ-${division}-L`,
  role: permission.makeRole({ division, level: 'lead' }),
});
const od: Actor = { employeeId: 'ZZ-OD', role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) };
const director: Actor = { employeeId: 'ZZ-DIR', role: permission.makeRole({ division: 'Management', level: 'staff', director: true }) };
/** A pure-OD account: read-only everywhere, no division write scope. */
const pureOd: Actor = { employeeId: 'ZZ-OD2', role: permission.makeRole({ od: true }) };
/** An employee whose divisi+jabatan has no role mapping yet — no scope at all. */
const unmapped: Actor = { employeeId: 'ZZ-NEW', role: permission.makeRole({}) };

// ===========================================================================
// Unit.
// ===========================================================================

describe('canReadDirectory', () => {
  it('admits every scoped division actor — the AM dispatching to Creative is the point', () => {
    // M6 §5: breaking a Brief down to another division is the AM's own job, so a
    // same-division-only gate would break the door this module exists for.
    expect(canReadDirectory(staff('Account'))).toBe(true);
    expect(canReadDirectory(lead('Account'))).toBe(true);
    expect(canReadDirectory(lead('Creative'))).toBe(true);
    expect(canReadDirectory(staff('KOL'))).toBe(true);
  });

  it('admits oversight (Phase 0 §4: OD read-only everywhere, Director full)', () => {
    expect(canReadDirectory(od)).toBe(true);
    expect(canReadDirectory(director)).toBe(true);
    expect(canReadDirectory(pureOd)).toBe(true);
  });

  it('fails closed for an actor with no scope at all', () => {
    // An employee whose divisi+jabatan is not mapped yet holds no division and no
    // layered role. Every RLS policy already denies them; the gate must too.
    expect(canReadDirectory(unmapped)).toBe(false);
  });

  it('reuses the admin deny string verbatim — no invented BI label (house rule #5)', () => {
    expect(MSG_DIRECTORY_DENIED).toBe(MSG_ADMIN_READ_DENIED);
    expect(new ForbiddenError().message).toBe(MSG_ADMIN_READ_DENIED);
  });
});

// ===========================================================================
// Integration.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

/** Seeds an employee + the role mapping that resolves their CDPS division/level. */
async function registerEmp(
  id: string,
  divisi: string,
  jabatan: string,
  division: string,
  level: string,
  active = true,
): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'Nama ' + id}, ${id + '@mea.id'}, ${divisi}, ${jabatan}, ${active}, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

/** An employee with NO role mapping — invisible to the picker, rejected by every door. */
async function registerUnmapped(id: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'Nama ' + id}, ${id + '@mea.id'}, 'ZZ-Divisi-Tanpa-Mapping', 'ZZ-Jabatan', true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

const ids = (list: { employeeId: string }[]): string[] => list.map((e) => e.employeeId);

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('listAssignableEmployees', () => {
  it('offers active, role-mapped employees and hides the rest', async () => {
    await registerEmp('ZZ-AM-1', 'Account', 'ZZ-AM', 'Account', 'staff');
    await registerEmp('ZZ-AM-OFF', 'Account', 'ZZ-AM', 'Account', 'staff', false);
    await registerUnmapped('ZZ-AM-NOMAP');

    const list = await listAssignableEmployees(sql, lead('Account'), { division: 'Account', level: 'staff' });

    expect(ids(list)).toContain('ZZ-AM-1');
    // Inactive: `status_aktif` is the first thing every validator checks, and an
    // employee deactivated in HRIS has their CDPS access revoked on sync.
    expect(ids(list)).not.toContain('ZZ-AM-OFF');
    // Unmapped: `rm.division` reads NULL, so no door can ever accept them.
    expect(ids(list)).not.toContain('ZZ-AM-NOMAP');
  });

  it('narrows by division and by level, and returns every division when unfiltered', async () => {
    await registerEmp('ZZ-CRE-S', 'Creative', 'ZZ-Designer', 'Creative', 'staff');
    await registerEmp('ZZ-CRE-L', 'Creative', 'ZZ-Head-Creative', 'Creative', 'lead');
    await registerEmp('ZZ-KOL-S', 'KOL', 'ZZ-Coordinator', 'KOL', 'staff');

    const creativeStaff = await listAssignableEmployees(sql, lead('Account'), { division: 'Creative', level: 'staff' });
    expect(ids(creativeStaff)).toContain('ZZ-CRE-S');
    expect(ids(creativeStaff)).not.toContain('ZZ-CRE-L'); // lead: no door accepts one as PIC
    expect(ids(creativeStaff)).not.toContain('ZZ-KOL-S'); // other division

    const all = await listAssignableEmployees(sql, director);
    expect(ids(all)).toEqual(expect.arrayContaining(['ZZ-CRE-S', 'ZZ-CRE-L', 'ZZ-KOL-S']));
  });

  it('orders the list division → staff first → nama, so the dropdown never reshuffles', async () => {
    await registerEmp('ZZ-CRE-B', 'Creative', 'ZZ-Designer', 'Creative', 'staff');
    await registerEmp('ZZ-CRE-A', 'Creative', 'ZZ-Editor', 'Creative', 'staff');
    await registerEmp('ZZ-CRE-H', 'Creative', 'ZZ-Head-Creative', 'Creative', 'lead');

    const list = (await listAssignableEmployees(sql, director, { division: 'Creative' })).filter((e) =>
      e.employeeId.startsWith('ZZ-CRE-'),
    );
    // 'Nama ZZ-CRE-A' < 'Nama ZZ-CRE-B' under collate "C"; the lead sorts last.
    expect(ids(list)).toEqual(['ZZ-CRE-A', 'ZZ-CRE-B', 'ZZ-CRE-H']);
  });

  it('carries the raw HRIS jabatan — that is how an AM vs a CRO is told apart', async () => {
    // `divisi`/`jabatan` are HRIS LABELS (never a scope): both an "Account
    // Manager" and a "CRO" map to Account/staff, and the jabatan is the only
    // thing on the row that distinguishes them for the person picking.
    await registerEmp('ZZ-AM-2', 'Account', 'ZZ-Account-Manager', 'Account', 'staff');
    const row = (await listAssignableEmployees(sql, lead('Account'), { division: 'Account' }))
      .find((e) => e.employeeId === 'ZZ-AM-2');
    expect(row).toMatchObject({
      nama: 'Nama ZZ-AM-2',
      divisi: 'Account',
      jabatan: 'ZZ-Account-Manager',
      division: 'Account',
      level: 'staff',
    });
  });

  it('denies an actor with no scope, with the verbatim BI message', async () => {
    await expect(listAssignableEmployees(sql, unmapped)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAssignableEmployees(sql, unmapped)).rejects.toThrow(MSG_ADMIN_READ_DENIED);
  });

  it('answers under RLS claims, where the employees table itself stays own-row', async () => {
    // Without this the whole feature passes as the migration owner (BYPASSRLS)
    // and ships an EMPTY dropdown — the campaign-picker lesson, same shape.
    await registerEmp('ZZ-AM-3', 'Account', 'ZZ-AM', 'Account', 'staff');
    const actor = lead('Account');
    const claims = JSON.stringify({
      app_metadata: {
        employee_id: actor.employeeId,
        division: actor.role.division,
        level: actor.role.level,
        od: false,
        director: false,
      },
    });
    await withClaims(sql, claims, async (tx) => {
      // The table is own-row for this actor: they are not Director/OD, and the
      // seeded AM is not them.
      const direct = await tx<{ n: number }[]>`select count(*)::int as n from employees where employee_id = 'ZZ-AM-3'`;
      expect(direct[0].n).toBe(0);
      // …and yet the picker answers.
      const list = await listAssignableEmployees(tx, actor, { division: 'Account', level: 'staff' });
      expect(ids(list)).toContain('ZZ-AM-3');
    });
  });
});

describeDb('picker ↔ validator parity (the anti-drift assertion)', () => {
  /**
   * Every candidate the AM picker offers must survive `assignAM`'s
   * `validateAMCandidate`, and every candidate it withholds must be rejected by
   * it. `MSG_INVALID_AM` is the server's only answer, and it does not say who IS
   * valid — so an offered-then-rejected employee leaves the user with no way
   * forward at all.
   */
  it('offers exactly the employees assignAM accepts', async () => {
    await registerEmp('ZZ-AM-OK', 'Account', 'ZZ-AM', 'Account', 'staff');
    await registerEmp('ZZ-AM-LEAD', 'Account', 'ZZ-Head-Account', 'Account', 'lead');
    await registerEmp('ZZ-AM-DEAD', 'Account', 'ZZ-AM', 'Account', 'staff', false);
    await registerEmp('ZZ-CRE-X', 'Creative', 'ZZ-Designer', 'Creative', 'staff');
    await registerUnmapped('ZZ-AM-NOMAP2');

    const offered = ids(await listAssignableEmployees(sql, lead('Account'), { division: 'Account', level: 'staff' }));
    const candidates = ['ZZ-AM-OK', 'ZZ-AM-LEAD', 'ZZ-AM-DEAD', 'ZZ-CRE-X', 'ZZ-AM-NOMAP2'];

    for (const candidate of candidates) {
      const clientId = `CLI-ZZ-DIR-${candidate}`;
      await sql`
        insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
          total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
        values (${clientId}, 'PIC', ${clientId}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00',
          'ZZ-BUDI', 'ZZ-BUDI', now(), 'ZZ-TEST')`;
      const accepted = await assignAM(sql, lead('Account'), clientId, candidate).then(
        () => true,
        (err) => {
          if (err instanceof AccountValidationError) return false;
          throw err; // any other failure is a broken fixture, not a verdict
        },
      );
      expect(
        accepted,
        `${candidate}: picker ${offered.includes(candidate) ? 'offers' : 'hides'} it, assignAM ${accepted ? 'accepts' : 'rejects'} it`,
      ).toBe(offered.includes(candidate));
    }
  });
});
