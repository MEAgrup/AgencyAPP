/**
 * Tests for the notifications inbox read/mark-read slice (house convention #8).
 *
 * - Unit: markRead short-circuits on a non-numeric id without touching the DB.
 * - Integration (skipped unless DATABASE_URL is set): own-inbox scoping, the
 *   unread filter + full-total count, and the scoped/idempotent mark-read
 *   against a migrated Postgres. Each test namespaces recipients with `ZZ-` and
 *   afterEach deletes only the rows it made (notifications forbids DELETE via a
 *   trigger, so cleanup runs with the trigger session-disabled — see afterEach).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { list, markRead, type Actor } from './notifications';

const actorFor = (employeeId: string): Actor => ({
  employeeId,
  divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Unit (no DB).
// ---------------------------------------------------------------------------
describe('markRead input guard (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('a non-numeric id is a silent no-op (never queries)', async () => {
    await expect(markRead(noSql, actorFor('ZZ-A'), 'not-a-bigint')).resolves.toBeUndefined();
    await expect(markRead(noSql, actorFor('ZZ-A'), '')).resolves.toBeUndefined();
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

/** Insert one notification for `recipient`, returning its id. */
async function emit(recipient: string, opts: { read?: boolean } = {}): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into notifications
      (recipient_employee_id, event_type, entity_type, entity_id, actor_employee_id,
       deep_link, read_at, created_by)
    values (${recipient}, 'demo.event', 'lead', 'LEAD-ZZ', 'ZZ-ACTOR',
            '/leads/LEAD-ZZ', ${opts.read ? new Date() : null}, 'ZZ-ACTOR')
    returning id::text as id`;
  return rows[0].id;
}

describeDb('notifications inbox (integration)', () => {
  afterEach(async () => {
    // notifications_no_delete forbids DELETE; disable session triggers to clean up.
    await sql`set session_replication_role = replica`;
    await sql`delete from notifications where recipient_employee_id like 'ZZ-%'`;
    await sql`set session_replication_role = origin`;
  });
  afterAll(async () => {
    await sql.end();
  });

  it('list returns only the actor own inbox, newest first', async () => {
    await emit('ZZ-A');
    await emit('ZZ-A');
    await emit('ZZ-B'); // another employee — must not leak into A's inbox

    const inbox = await list(sql, actorFor('ZZ-A'));
    expect(inbox.rows).toHaveLength(2);
    expect(inbox.rows.every((r) => r.actor === 'ZZ-ACTOR')).toBe(true);
    // newest first: created_at desc, id desc.
    expect(Number(inbox.rows[0].id)).toBeGreaterThan(Number(inbox.rows[1].id));
  });

  it('unread filter narrows rows but unreadCount stays the full unread total', async () => {
    await emit('ZZ-A', { read: true });
    await emit('ZZ-A'); // unread
    await emit('ZZ-A'); // unread

    const all = await list(sql, actorFor('ZZ-A'), false);
    expect(all.rows).toHaveLength(3);
    expect(all.unreadCount).toBe(2);

    const unread = await list(sql, actorFor('ZZ-A'), true);
    expect(unread.rows).toHaveLength(2);
    expect(unread.rows.every((r) => r.readAt === null)).toBe(true);
    expect(unread.unreadCount).toBe(2); // full total, unaffected by the filter
  });

  it('markRead flips read_at once, scoped to the owner, idempotent', async () => {
    const id = await emit('ZZ-A');

    // Another employee cannot mark A's notification: 0 rows touched.
    await markRead(sql, actorFor('ZZ-B'), id);
    expect((await list(sql, actorFor('ZZ-A'))).unreadCount).toBe(1);

    // Owner marks it read.
    await markRead(sql, actorFor('ZZ-A'), id);
    const after = await list(sql, actorFor('ZZ-A'));
    expect(after.unreadCount).toBe(0);
    expect(after.rows[0].readAt).not.toBeNull();

    // Re-marking is a no-op (does not error, stays read).
    await markRead(sql, actorFor('ZZ-A'), id);
    expect((await list(sql, actorFor('ZZ-A'))).unreadCount).toBe(0);
  });
});
