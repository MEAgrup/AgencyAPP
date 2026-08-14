/**
 * T-4c (RM-11) — Client Milestones: create + list + transition, under the real
 * schema (machine `client_milestone`, prefix MLS, client-scoped gates).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createMilestone,
  listMilestones,
  transitionMilestone,
  type Actor,
} from './milestone';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER_AM = 'ZZM-AM';
const accountStaff = (id = OWNER_AM): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZZM-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (): Actor => ({ employeeId: 'ZZM-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });
const od = (): Actor => ({ employeeId: 'ZZM-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const creativeStaff = (): Actor => ({ employeeId: 'ZZM-CRE', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });

let seq = 0;
async function insClient(amId = OWNER_AM): Promise<string> {
  seq += 1;
  const id = `ZZM-CLI-${seq}`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0', '0', '0',
      'ZZM-SALES', 'ZZM-SALES', now(), ${amId}, 'ZZM-TEST')`;
  return id;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_milestones where created_by like 'ZZM-%' or client_id like 'ZZM-CLI-%'`;
  await sql`delete from clients where id like 'ZZM-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('createMilestone (T-4c)', () => {
  it('creates an [Upcoming] milestone with an MLS id + audit row; owner-AM gate + validation', async () => {
    const client = await insClient();
    // Non-Account cannot create; OD is read-only.
    await expect(createMilestone(sql, creativeStaff(), client, { title: 'x', targetDate: '2026-09-01' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(createMilestone(sql, od(), client, { title: 'x', targetDate: '2026-09-01' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    // A different AM (not the owner) is refused.
    await expect(createMilestone(sql, accountStaff('ZZM-OTHER'), client, { title: 'x', targetDate: '2026-09-01' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    // Missing title / bad date → validation.
    await expect(createMilestone(sql, accountStaff(), client, { title: '  ', targetDate: '2026-09-01' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createMilestone(sql, accountStaff(), client, { title: 'x', targetDate: 'besok' }))
      .rejects.toBeInstanceOf(ValidationError);

    const m = await createMilestone(sql, accountStaff(), client, { title: 'Launch Ramadhan', targetDate: '2026-09-15' });
    expect(m.id).toMatch(/^MLS-\d{6}-\d{4}$/);
    expect(m.status).toBe('[Upcoming]');
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${m.id} and action = 'milestone_created'`;
    expect(audit[0].n).toBe(1);
  });
});

describeDb('listMilestones + transitionMilestone (T-4c)', () => {
  it('lists soonest-first; marks done; rejects bad target and a terminal re-move', async () => {
    const client = await insClient();
    const later = await createMilestone(sql, accountLead(), client, { title: 'later', targetDate: '2026-12-01' });
    const soon = await createMilestone(sql, accountLead(), client, { title: 'soon', targetDate: '2026-09-01' });

    const rows = await listMilestones(sql, accountStaff(), client);
    expect(rows.map((r) => r.id)).toEqual([soon.id, later.id]); // target_date asc

    // A non-terminal target is rejected (only [Done]/[Cancelled] allowed).
    await expect(transitionMilestone(sql, accountLead(), soon.id, '[Upcoming]')).rejects.toBeInstanceOf(ConflictError);
    // Mark done through the engine.
    const done = await transitionMilestone(sql, director(), soon.id, '[Done]');
    expect(done.status).toBe('[Done]');
    const row = await sql<{ status: string }[]>`select status from client_milestones where id = ${soon.id}`;
    expect(row[0].status).toBe('[Done]');
    // Re-moving a terminal milestone is rejected by the engine.
    await expect(transitionMilestone(sql, director(), soon.id, '[Cancelled]')).rejects.toBeInstanceOf(ConflictError);
    // Cancel the other one.
    const cancelled = await transitionMilestone(sql, accountLead(), later.id, '[Cancelled]');
    expect(cancelled.status).toBe('[Cancelled]');
  });

  it('read scope: creative staff forbidden; unknown client 404', async () => {
    const client = await insClient();
    await createMilestone(sql, accountLead(), client, { title: 'x', targetDate: '2026-09-01' });
    await expect(listMilestones(sql, creativeStaff(), client)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMilestones(sql, director(), 'ZZM-CLI-nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
