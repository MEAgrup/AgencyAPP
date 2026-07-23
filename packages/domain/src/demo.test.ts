/**
 * Tests for the demo-task service.
 *
 * - Unit: mandatory-field gates (they reject BEFORE any DB access, so they run
 *   without a database).
 * - Integration (skipped unless DATABASE_URL is set): the full ident / sm /
 *   audit / notify vertical against a migrated Postgres. These functions own
 *   their own transactions (the handler pattern), so they commit; each test
 *   namespaces its actor ids with `ZZ-` and afterEach deletes the rows it made.
 *   (audit_log / notifications are append-only and left as harmless residue on
 *   the ephemeral CI database.)
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { bi, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  type Actor,
  approveBlockRequest,
  create,
  ForbiddenError,
  get,
  list,
  submitBlockRequest,
  transition,
} from './demo.js';

const staff = (): Actor => ({
  employeeId: 'ZZ-STAFF', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const lead = (): Actor => ({
  employeeId: 'ZZ-LEAD', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const otherLead = (): Actor => ({
  employeeId: 'ZZ-LEAD-OTHER', divisi: 'Creative',
  role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});

describe('mandatory-field gates (no DB)', () => {
  const noSql = null as unknown as Sql; // never reached — validation throws first

  it('create rejects an empty title with the exact BI message', async () => {
    await expect(create(noSql, staff(), { title: '   ' })).rejects.toThrow(bi.INCOMPLETE_DATA);
  });

  it('submitBlockRequest rejects an empty reason with the exact BI message', async () => {
    await expect(submitBlockRequest(noSql, staff(), 'DEMO-x', '')).rejects.toThrow(bi.INCOMPLETE_DATA);
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
  // demo_task_block_requests FK -> demo_tasks, so delete children first.
  await sql`delete from demo_task_block_requests where requested_by like 'ZZ-%'`;
  await sql`delete from demo_tasks where created_by like 'ZZ-%'`;
});

describeDb('create', () => {
  it('mints a DEMO- id, starts in [To Do], audits, and is readable', async () => {
    const t = await create(sql, staff(), { title: 'Design a banner', description: 'A/B two hooks' });
    expect(t.id).toMatch(/^DEMO-\d{6}-\d{4}$/);
    expect(t.status).toBe('[To Do]');
    expect(t.division).toBe('Sales');

    const got = await get(sql, t.id);
    expect(got.title).toBe('Design a banner');

    const audits = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_type = 'demo_task' and entity_id = ${t.id} and action = 'create'`;
    expect(audits[0].n).toBe(1);
  });

  it('appears in list newest-first', async () => {
    const a = await create(sql, staff(), { title: 'First' });
    const b = await create(sql, staff(), { title: 'Second' });
    const ids = (await list(sql)).map((t) => t.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });
});

describeDb('get', () => {
  it('throws NotFoundError for an unknown id', async () => {
    await expect(get(sql, 'DEMO-209901-9999')).rejects.toThrow(/not found/);
  });
});

describeDb('transition', () => {
  it('drives a valid unrestricted edge [To Do] -> [In Progress]', async () => {
    const t = await create(sql, staff(), { title: 'x' });
    const res = await transition(sql, staff(), t.id, '[In Progress]');
    expect(res.ok).toBe(true);
    expect((await get(sql, t.id)).status).toBe('[In Progress]');
  });

  it('blocks an invalid edge', async () => {
    const t = await create(sql, staff(), { title: 'x' });
    const res = await transition(sql, staff(), t.id, '[Approved]');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('blocked');
  });

  it('enforces role on a restricted edge (staff denied, lead allowed)', async () => {
    const t = await create(sql, staff(), { title: 'x' });
    const denied = await transition(sql, staff(), t.id, '[Cancelled — Service Voided]');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('role_denied');

    const ok = await transition(sql, lead(), t.id, '[Cancelled — Service Voided]');
    expect(ok.ok).toBe(true);
  });

  it('throws NotFoundError transitioning an unknown task', async () => {
    await expect(transition(sql, lead(), 'DEMO-209901-9999', '[In Progress]')).rejects.toThrow(/not found/);
  });
});

describeDb('block-request flow', () => {
  it('staff submits a pending request (audited), lead approves -> [Blocked]', async () => {
    const t = await create(sql, staff(), { title: 'x' });
    await transition(sql, staff(), t.id, '[In Progress]'); // [Blocked] is only reachable from [In Progress]

    const req = await submitBlockRequest(sql, staff(), t.id, 'waiting on client assets');
    expect(req.status).toBe('pending');
    const submittedAudit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${t.id} and action = 'block_request_submitted'`;
    expect(submittedAudit[0].n).toBe(1);

    const res = await approveBlockRequest(sql, lead(), t.id, req.id);
    expect(res.ok).toBe(true);
    expect((await get(sql, t.id)).status).toBe('[Blocked]');

    const reqRow = await sql<{ status: string }[]>`
      select status from demo_task_block_requests where id = ${req.id}`;
    expect(reqRow[0].status).toBe('approved');
  });

  it('a non-lead cannot approve (ForbiddenError)', async () => {
    const t = await create(sql, staff(), { title: 'x' });
    await transition(sql, staff(), t.id, '[In Progress]');
    const req = await submitBlockRequest(sql, staff(), t.id, 'reason');
    await expect(approveBlockRequest(sql, staff(), t.id, req.id)).rejects.toBeInstanceOf(ForbiddenError);
    // A lead of another division is not this task's lead either.
    await expect(approveBlockRequest(sql, otherLead(), t.id, req.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
