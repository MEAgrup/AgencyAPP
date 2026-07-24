/**
 * Tests for M6 Cluster 1 — client intake & AM assignment (account.ts).
 *
 * - Unit: the §3 authorization predicates (canManageAssignment / canReadIntake),
 *   plus the pre-DB input gates (empty AM, missing reason — reject before DB).
 * - Integration (skipped unless DATABASE_URL is set): assign/reassign atomicity
 *   + audit, the intake queue / workload read model, the read/write permission
 *   matrix, and the immutable-history guarantee, against a migrated Postgres.
 *   Ids namespaced `ZZ-`; afterEach deletes the clients/employees it made
 *   (audit_log is append-only, so client ids are made unique per test instead).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  assignAM,
  canManageAssignment,
  canReadIntake,
  ConflictError,
  ForbiddenError,
  intakeQueue,
  NotFoundError,
  reassignAM,
  ValidationError,
  workload,
  type Actor,
} from './account';

const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const accountStaff = (id = 'ZZ-AM'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SL', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit: §3 authorization predicates + pre-DB gates.
// ---------------------------------------------------------------------------
describe('assignment predicates (§3 Rule 2)', () => {
  it('canManageAssignment: Account Lead / Director only', () => {
    expect(canManageAssignment(accountLead())).toBe(true);
    expect(canManageAssignment(director())).toBe(true);
    expect(canManageAssignment(accountStaff())).toBe(false); // an AM is not an assigner
    expect(canManageAssignment(od())).toBe(false); // read-only everywhere
    expect(canManageAssignment(salesLead())).toBe(false); // other division
  });

  it('canReadIntake: Account Lead / OD / Director (§3 Rule 1)', () => {
    expect(canReadIntake(accountLead())).toBe(true);
    expect(canReadIntake(od())).toBe(true);
    expect(canReadIntake(director())).toBe(true);
    expect(canReadIntake(accountStaff())).toBe(false); // individual AMs cannot see the queue
    expect(canReadIntake(salesLead())).toBe(false);
  });
});

describe('pre-DB input gates', () => {
  const anySql = undefined as unknown as Sql; // never reached: gate rejects first

  it('assignAM rejects a non-assigner before any DB access', async () => {
    await expect(assignAM(anySql, accountStaff(), 'CLI-X', 'ZZ-AM')).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('assignAM rejects an empty AM id', async () => {
    await expect(assignAM(anySql, accountLead(), 'CLI-X', '  ')).rejects.toBeInstanceOf(ValidationError);
  });
  it('reassignAM rejects an empty reason', async () => {
    await expect(reassignAM(anySql, accountLead(), 'CLI-X', 'ZZ-AM', '  ')).rejects.toBeInstanceOf(ValidationError);
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

let seq = 0;
/** A fresh client id per call — audit_log is append-only, so ids never repeat. */
const nextClientId = (): string => `CLI-ZZ-${Date.now() % 100000}-${seq++}`;

/** Births a client with a controllable release state (created_by 'ZZ-…' for cleanup). */
async function insertClient(id: string, released: boolean): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', ${released ? sql`now()` : null}, 'ZZ-TEST')`;
}

/** Seeds an active Account-division AM (employee + role mapping) validateAMCandidate accepts. */
async function registerAM(id: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'AM ' + id}, ${id + '@mea.id'}, 'Account', 'ZZ-AM', true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Account', 'ZZ-AM', 'Account', 'staff', 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}

const assignedAm = async (clientId: string): Promise<string | null> =>
  (await sql<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`)[0]
    ?.assigned_am_id ?? null;

const auditActions = async (entityId: string): Promise<string[]> =>
  (await sql<{ action: string }[]>`
    select action from audit_log where entity_type = 'client' and entity_id = ${entityId} order by id desc`)
    .map((r) => r.action);

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('assignAM (§3 Rules 2–4)', () => {
  it('assigns a released, unassigned client; writes the pointer + one audit row', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');

    const res = await assignAM(sql, accountLead(), id, 'ZZ-SINTA');
    expect(res.assignedAm).toBe('ZZ-SINTA');
    expect(res.assignedBy).toBe('ZZ-ALEAD');
    expect(await assignedAm(id)).toBe('ZZ-SINTA');
    expect(await auditActions(id)).toEqual(['am_assigned']);
  });

  it('§3 Rule 2 authority: only Account Lead / Director may assign', async () => {
    await registerAM('ZZ-SINTA');
    const allow: [string, Actor][] = [['account lead', accountLead()], ['director', director()]];
    for (const [, actor] of allow) {
      const id = nextClientId();
      await insertClient(id, true);
      await expect(assignAM(sql, actor, id, 'ZZ-SINTA')).resolves.toBeTruthy();
    }
    const deny: Actor[] = [accountStaff('ZZ-SINTA'), od(), salesLead()];
    for (const actor of deny) {
      const id = nextClientId();
      await insertClient(id, true);
      await expect(assignAM(sql, actor, id, 'ZZ-SINTA')).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('a pre-release or missing client is invisible (not-found)', async () => {
    const pre = nextClientId();
    await insertClient(pre, false);
    await registerAM('ZZ-SINTA');
    await expect(assignAM(sql, accountLead(), pre, 'ZZ-SINTA')).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignAM(sql, accountLead(), 'CLI-GHOST-000', 'ZZ-SINTA')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exactly one AM at a time (M6-OA-6): a second assign is a conflict', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');
    await expect(assignAM(sql, accountLead(), id, 'ZZ-RANI')).rejects.toBeInstanceOf(ConflictError);
  });

  it('the assignee must be an active Account staff', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    // A Sales employee — not an Account AM.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-SALES', 'Sales Guy', 'sg@mea.id', 'Sales', 'ZZ-SALESJAB', true, 'ZZ-TEST')`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Sales', 'ZZ-SALESJAB', 'Sales', 'staff', 'ZZ-TEST') on conflict do nothing`;
    // An inactive Account employee.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-EXAM', 'Ex AM', 'ex@mea.id', 'Account', 'ZZ-AM', false, 'ZZ-TEST')`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Account', 'ZZ-AM', 'Account', 'staff', 'ZZ-TEST') on conflict do nothing`;

    for (const am of ['ZZ-SALES', 'ZZ-EXAM', 'ZZ-UNKNOWN']) {
      await expect(assignAM(sql, accountLead(), id, am)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describeDb('reassignAM (§3 Rule 3)', () => {
  it('reason mandatory, target valid + different, pointer moved, second audit row', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');

    await expect(reassignAM(sql, accountLead(), id, 'ZZ-RANI', '  ')).rejects.toBeInstanceOf(ValidationError);
    await expect(reassignAM(sql, accountLead(), id, 'ZZ-SINTA', 'cuti')).rejects.toBeInstanceOf(ConflictError);

    const res = await reassignAM(sql, accountLead(), id, 'ZZ-RANI', 'Sinta cuti panjang');
    expect(res.previousAm).toBe('ZZ-SINTA');
    expect(res.assignedAm).toBe('ZZ-RANI');
    expect(res.reason).toBe('Sinta cuti panjang');
    expect(await assignedAm(id)).toBe('ZZ-RANI');
    expect(await auditActions(id)).toEqual(['am_reassigned', 'am_assigned']); // newest first
  });

  it('reassigning an unassigned client is a conflict', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-RANI');
    await expect(reassignAM(sql, accountLead(), id, 'ZZ-RANI', 'alasan')).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('intakeQueue + workload (§3 Rule 1 / Rule 5)', () => {
  it('only released+unassigned clients show; assigning removes them; read gate enforced', async () => {
    const pre = nextClientId();
    const q1 = nextClientId();
    const q2 = nextClientId();
    await insertClient(pre, false); // never in queue
    await insertClient(q1, true); // stays in queue
    await insertClient(q2, true); // leaves queue on assign
    await registerAM('ZZ-SINTA');
    await assignAM(sql, accountLead(), q2, 'ZZ-SINTA');

    const q = await intakeQueue(sql, accountLead());
    const ids = q.map((r) => r.clientId);
    expect(ids).toContain(q1);
    expect(ids).not.toContain(q2);
    expect(ids).not.toContain(pre);

    for (const a of [od(), director()]) {
      await expect(intakeQueue(sql, a)).resolves.toBeTruthy();
    }
    for (const a of [accountStaff('ZZ-SINTA'), salesLead()]) {
      await expect(intakeQueue(sql, a)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('workload counts active clients per AM, highest first; same read gate', async () => {
    const c1 = nextClientId();
    const c2 = nextClientId();
    const c3 = nextClientId();
    await insertClient(c1, true);
    await insertClient(c2, true);
    await insertClient(c3, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), c1, 'ZZ-SINTA');
    await assignAM(sql, accountLead(), c2, 'ZZ-SINTA');
    await assignAM(sql, accountLead(), c3, 'ZZ-RANI');

    const wl = await workload(sql, accountLead());
    const sinta = wl.find((w) => w.amEmployeeId === 'ZZ-SINTA');
    const rani = wl.find((w) => w.amEmployeeId === 'ZZ-RANI');
    expect(sinta?.activeClientCount).toBe(2);
    expect(rani?.activeClientCount).toBe(1);
    // Highest first: Sinta (2) sorts before Rani (1).
    expect(wl.findIndex((w) => w.amEmployeeId === 'ZZ-SINTA'))
      .toBeLessThan(wl.findIndex((w) => w.amEmployeeId === 'ZZ-RANI'));

    await expect(workload(sql, accountStaff('ZZ-SINTA'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('assignment history is immutable', () => {
  it('the am_assigned audit row cannot be updated or deleted', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');

    const [{ id: auditId }] = await sql<{ id: string }[]>`
      select id from audit_log where entity_id = ${id} and action = 'am_assigned' limit 1`;
    await expect(sql`update audit_log set action = 'tampered' where id = ${auditId}`).rejects.toBeTruthy();
    await expect(sql`delete from audit_log where id = ${auditId}`).rejects.toBeTruthy();
  });
});
