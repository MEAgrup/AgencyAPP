/**
 * Integration tests against a real Postgres with the CDPS migrations applied.
 *
 * Skipped unless DATABASE_URL is set (e.g. in CI after `supabase start` + migrate,
 * or a dev pooler URL). Everything runs inside a transaction that is ROLLED BACK
 * at the end, so no sequence numbers are consumed and no rows persist.
 *
 * Run: DATABASE_URL=postgres://... npm test  (in packages/db)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Sql, type TransactionSql } from './client.js';
import { executors } from './executors.js';

const URL = process.env.DATABASE_URL;
const d = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

/** Run fn inside a transaction, then force a ROLLBACK (nothing persists). */
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

d('ident_next', () => {
  it('allocates sequential, WIB-bucketed, zero-padded IDs', async () => {
    const at = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01
    const [a, b] = await inRollback(async (tx) => {
      const ex = executors(tx).ident;
      return [await ex.identNext('TST', at), await ex.identNext('TST', at)];
    });
    expect(a).toMatch(/^TST-202607-\d{4}$/);
    // Sequential within the same (prefix, period).
    const na = Number(a.slice(-4));
    const nb = Number(b.slice(-4));
    expect(nb).toBe(na + 1);
  });
});

d('sm_transition', () => {
  it('applies a valid edge and writes an audit row; blocks an invalid one', async () => {
    const result = await inRollback(async (tx) => {
      const ex = executors(tx);
      const id = 'DEMO-INT-' + Math.random().toString(36).slice(2, 8);
      await tx`insert into demo_tasks (id, title, division, status, created_by)
               values (${id}, 'int test', 'Creative', '[To Do]', 'EMP-1')`;
      const ok = await ex.sm.smTransition({
        machine: 'brief_task', entityType: 'demo_task', table: 'demo_tasks',
        idCol: 'id', statusCol: 'status', entityId: id, to: '[In Progress]',
        actorEmployeeId: 'EMP-1', roleDirector: false, roleLead: false,
      });
      const blocked = await ex.sm.smTransition({
        machine: 'brief_task', entityType: 'demo_task', table: 'demo_tasks',
        idCol: 'id', statusCol: 'status', entityId: id, to: '[Approved]',
        actorEmployeeId: 'EMP-1', roleDirector: false, roleLead: false,
      });
      const audit = await tx<{ n: number }[]>`
        select count(*)::int as n from audit_log where entity_id = ${id}`;
      return { ok, blocked, auditCount: audit[0].n };
    });
    expect(result.ok).toEqual({ ok: true, from: '[To Do]', to: '[In Progress]' });
    expect(result.blocked.ok).toBe(false);
    if (!result.blocked.ok) expect(result.blocked.code).toBe('blocked');
    expect(result.auditCount).toBe(1);
  });

  it('denies a requireLead edge to a non-lead, allows it to a lead', async () => {
    const { staff, lead } = await inRollback(async (tx) => {
      const ex = executors(tx);
      const id = 'DEMO-INT-' + Math.random().toString(36).slice(2, 8);
      await tx`insert into demo_tasks (id, title, division, status, created_by)
               values (${id}, 'int test', 'Creative', '[In Progress]', 'EMP-1')`;
      const base = {
        machine: 'brief_task', entityType: 'demo_task', table: 'demo_tasks',
        idCol: 'id', statusCol: 'status', entityId: id, to: '[Blocked]', actorEmployeeId: 'EMP-1',
      };
      const staff = await ex.sm.smTransition({ ...base, roleDirector: false, roleLead: false });
      const lead = await ex.sm.smTransition({ ...base, roleDirector: false, roleLead: true });
      return { staff, lead };
    });
    expect(staff.ok).toBe(false);
    if (!staff.ok) expect(staff.code).toBe('role_denied');
    expect(lead.ok).toBe(true);
  });
});

d('audit immutability', () => {
  it('rejects UPDATE and DELETE on audit_log (forbid_mutation trigger)', async () => {
    await inRollback(async (tx) => {
      const id = 'DEMO-INT-' + Math.random().toString(36).slice(2, 8);
      await executors(tx).audit.insertAudit({
        entityType: 'demo_task', entityId: id, actorEmployeeId: 'EMP-1',
        action: 'create', beforeJson: null, afterJson: null, createdBy: 'EMP-1',
      });
      // Each expected failure is wrapped in a SAVEPOINT: a trigger error aborts
      // the current (sub)transaction, so without savepoints the second statement
      // would fail with "transaction is aborted" instead of the trigger message.
      await expect(tx.savepoint((sp) => sp`update audit_log set action = 'x' where entity_id = ${id}`)).rejects.toThrow(
        /append-only/,
      );
      await expect(tx.savepoint((sp) => sp`delete from audit_log where entity_id = ${id}`)).rejects.toThrow(
        /append-only/,
      );
      return null;
    });
  });
});

d('notify_emit', () => {
  it('inserts one notification per explicit recipient, excluding the actor', async () => {
    const notified = await inRollback(async (tx) => {
      return executors(tx).notify.notifyEmit({
        event: 'm0.negotiation.decision', entityType: 'prospect', entityId: 'PRSP-1',
        actor: 'EMP-1', deepLink: '', division: '', explicit: ['EMP-2', 'EMP-1', 'EMP-3'],
        notifyActor: false,
      });
    });
    expect(notified.ok).toBe(true);
    // Actor EMP-1 excluded; EMP-2 and EMP-3 notified.
    expect(new Set(notified.notified)).toEqual(new Set(['EMP-2', 'EMP-3']));
  });
});
