/**
 * C-02 — the notification inbox: list / unreadCount / markRead.
 *
 * Rows are produced through the REAL emitter (`@cdps/core` emit → the
 * `notify_emit` SQL function), not raw INSERTs, so the tests exercise the same
 * path the modules use and would notice if the emitter's column mapping drifted.
 *
 * Notifications are never deletable (house rule §8 — BEFORE DELETE trigger), so
 * nothing is cleaned up: every run uses fresh recipient ids and every assertion
 * is scoped to them, the convention the other suites already follow
 * (leads.test.ts, task.test.ts).
 *
 * The unit half (parseId) runs without a DB; the rest is skipped unless
 * DATABASE_URL is set.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { notification as core, permission } from '@cdps/core';
import { createClient, executors, withClaims, type Sql } from '@cdps/db';
import {
  inbox,
  list,
  markRead,
  MSG_INVALID_ID,
  parseId,
  unreadCount,
  ValidationError,
  type Actor,
} from './notification';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

/** Unique per run — notification rows can never be deleted. */
const RUN = `ZZN${String(Date.now()).slice(-8)}`;
const RECIPIENT = `${RUN}-A`;
const OTHER = `${RUN}-B`;

const staff = (employeeId: string): Actor => ({
  employeeId,
  divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

/** Emits one cataloged event to `to`, returning the row id it produced. */
async function emitTo(to: string, entityId: string): Promise<string> {
  await core.emit(executors(sql).notify, {
    event: core.EVENTS.NegotiationDecision,
    entityType: 'attempt',
    entityId,
    actor: `${RUN}-ACTOR`,
    deepLink: `/attempts/${entityId}`,
    explicitRecipients: [to],
  });
  const rows = await sql<{ id: string }[]>`
    select id from notifications
     where recipient_employee_id = ${to} and entity_id = ${entityId}
     order by id desc limit 1`;
  return rows[0].id;
}

describe('parseId (unit — no DB)', () => {
  it('accepts a numeric id', () => {
    expect(parseId('42')).toBe('42');
    expect(parseId(' 42 ')).toBe('42');
  });

  it('rejects a non-numeric id with the verbatim BI message', () => {
    for (const bad of ['abc', '', '1;drop', '-1', '1.5', '1e3']) {
      expect(() => parseId(bad)).toThrow(ValidationError);
    }
    expect(() => parseId('abc')).toThrow(MSG_INVALID_ID);
  });
});

describeDb('notification inbox', () => {
  it('returns only the actor\'s own rows, newest first', async () => {
    const first = await emitTo(RECIPIENT, `${RUN}-E1`);
    const second = await emitTo(RECIPIENT, `${RUN}-E2`);
    await emitTo(OTHER, `${RUN}-E3`);

    const mine = await list(sql, staff(RECIPIENT));
    expect(mine.map((n) => n.id)).toEqual([second, first]);
    expect(mine.every((n) => n.entityId.startsWith(RUN))).toBe(true);
    expect(mine[0].eventType).toBe(core.EVENTS.NegotiationDecision);
    expect(mine[0].deepLink).toBe(`/attempts/${RUN}-E2`);
    expect(mine[0].actor).toBe(`${RUN}-ACTOR`);
    expect(mine[0].readAt).toBeNull();

    // The other recipient's row is invisible here and vice versa.
    const theirs = await list(sql, staff(OTHER));
    expect(theirs.map((n) => n.entityId)).toEqual([`${RUN}-E3`]);
  });

  it('marks one row read — idempotently — and leaves the rest alone', async () => {
    const target = await emitTo(RECIPIENT, `${RUN}-E4`);
    const before = await unreadCount(sql, staff(RECIPIENT));

    await markRead(sql, staff(RECIPIENT), target);
    const after = await unreadCount(sql, staff(RECIPIENT));
    expect(after).toBe(before - 1);

    const [row] = await sql<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${target}::bigint`;
    expect(row.read_at).not.toBeNull();
    const stamp = row.read_at;

    // Second call changes nothing at all — not even the timestamp.
    await markRead(sql, staff(RECIPIENT), target);
    const [again] = await sql<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${target}::bigint`;
    expect(again.read_at).toEqual(stamp);
    expect(await unreadCount(sql, staff(RECIPIENT))).toBe(after);
  });

  it('cannot mark another employee\'s notification read', async () => {
    const theirs = await emitTo(OTHER, `${RUN}-E5`);

    // Silent no-op, exactly like Go: no error is raised (a 404/403 would confirm
    // the id exists), but the row is untouched.
    await expect(markRead(sql, staff(RECIPIENT), theirs)).resolves.toBeUndefined();

    const [row] = await sql<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${theirs}::bigint`;
    expect(row.read_at).toBeNull();
  });

  it('markRead on an unknown id is a silent no-op', async () => {
    await expect(markRead(sql, staff(RECIPIENT), '999999999')).resolves.toBeUndefined();
  });

  it('markRead rejects a malformed id before touching the DB', async () => {
    await expect(markRead(sql, staff(RECIPIENT), 'abc')).rejects.toThrow(MSG_INVALID_ID);
  });

  it('?unread=1 filters the list but never the count', async () => {
    const recipient = `${RUN}-C`;
    const kept = await emitTo(recipient, `${RUN}-E6`);
    const acked = await emitTo(recipient, `${RUN}-E7`);
    await markRead(sql, staff(recipient), acked);

    const all = await inbox(sql, staff(recipient), false);
    expect(all.items.map((n) => n.id).sort()).toEqual([kept, acked].sort());
    expect(all.unreadCount).toBe(1);

    const unread = await inbox(sql, staff(recipient), true);
    expect(unread.items.map((n) => n.id)).toEqual([kept]);
    // Same total on the filtered view — the badge does not change with the tab.
    expect(unread.unreadCount).toBe(1);
  });

  it('has no delete path — the row survives an attempted DELETE (house rule §8)', async () => {
    const id = await emitTo(RECIPIENT, `${RUN}-E8`);
    await expect(sql`delete from notifications where id = ${id}::bigint`).rejects.toThrow();
    const [row] = await sql<{ n: string }[]>`
      select count(*) as n from notifications where id = ${id}::bigint`;
    expect(Number(row.n)).toBe(1);
  });
});

describeDb('notification inbox under real RLS (O37 read path)', () => {
  /** Serializes the claim envelope exactly as apps/api `actorClaims` does. */
  const claims = (employeeId: string): string =>
    JSON.stringify({
      app_metadata: { employee_id: employeeId, division: 'Sales', level: 'staff', od: false, director: false },
    });

  it('shows a recipient their own row and hides it from everyone else', async () => {
    const owner = `${RUN}-R1`;
    const stranger = `${RUN}-R2`;
    await emitTo(owner, `${RUN}-E9`);

    const own = await withClaims(sql, claims(owner), (tx) => list(tx, staff(owner)));
    expect(own.map((n) => n.entityId)).toEqual([`${RUN}-E9`]);

    // The stranger asking for the OWNER's rows gets nothing: the policy filters
    // by the JWT recipient, so even a forged actor argument cannot widen scope.
    const forged = await withClaims(sql, claims(stranger), (tx) => list(tx, staff(owner)));
    expect(forged).toEqual([]);
    const forgedCount = await withClaims(sql, claims(stranger), (tx) => unreadCount(tx, staff(owner)));
    expect(forgedCount).toBe(0);
  });

  it('does not exempt a Director — notifications are personal, not oversight data', async () => {
    const owner = `${RUN}-R3`;
    await emitTo(owner, `${RUN}-E10`);

    const directorClaims = JSON.stringify({
      app_metadata: { employee_id: `${RUN}-DIR`, division: 'Sales', level: 'lead', od: false, director: true },
    });
    const seen = await withClaims(sql, directorClaims, (tx) => list(tx, staff(owner)));
    expect(seen).toEqual([]);
  });
});
