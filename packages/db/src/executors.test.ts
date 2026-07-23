/**
 * Unit tests for the executor SQL wiring using a fake tagged-template `sql`
 * (no database). Verifies each executor calls the right function with the right
 * values and returns the row payload. Also exercises the @cdps/core runtime
 * alias (importing a value, not just types) so the vitest alias config is covered.
 */
import { ident as identCore } from '@cdps/core';
import { describe, expect, it } from 'vitest';
import type { Queryable } from './client';
import { auditExecutor, identExecutor, notifyExecutor, smExecutor } from './executors';

interface Captured {
  text: string;
  values: unknown[];
}

/** A fake `sql` tagged template that records the flattened query + values. */
function fakeSql(rows: unknown[], sink: Captured[]): Queryable {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    sink.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    return Promise.resolve(rows);
  };
  return fn as unknown as Queryable;
}

describe('identExecutor', () => {
  it('calls ident_next and returns the id', async () => {
    const sink: Captured[] = [];
    const at = new Date(Date.UTC(2026, 6, 1));
    const id = await identExecutor(fakeSql([{ id: 'CLI-202607-0001' }], sink)).identNext('CLI', at);
    expect(id).toBe('CLI-202607-0001');
    expect(sink[0].text).toContain('ident_next');
    expect(sink[0].values).toEqual(['CLI', at]);
    // Parity: the returned id is a valid house id per @cdps/core (alias works at runtime).
    expect(identCore.isValid(id)).toBe(true);
  });
});

describe('smExecutor', () => {
  it('passes all ten params to sm_transition and returns the jsonb result', async () => {
    const sink: Captured[] = [];
    const result = await smExecutor(fakeSql([{ r: { ok: true, from: '[To Do]', to: '[In Progress]' } }], sink)).smTransition({
      machine: 'brief_task', entityType: 'demo_task', table: 'demo_tasks', idCol: 'id', statusCol: 'status',
      entityId: 'DEMO-1', to: '[In Progress]', actorEmployeeId: 'EMP-1', roleDirector: false, roleLead: true,
    });
    expect(result).toEqual({ ok: true, from: '[To Do]', to: '[In Progress]' });
    expect(sink[0].text).toContain('sm_transition');
    expect(sink[0].values).toEqual([
      'brief_task', 'demo_task', 'demo_tasks', 'id', 'status', 'DEMO-1', '[In Progress]', 'EMP-1', false, true,
    ]);
  });
});

describe('auditExecutor', () => {
  it('inserts into audit_log with actor as created_by', async () => {
    const sink: Captured[] = [];
    await auditExecutor(fakeSql([], sink)).insertAudit({
      entityType: 'demo_task', entityId: 'DEMO-1', actorEmployeeId: 'EMP-1', action: 'create',
      beforeJson: null, afterJson: { status: '[To Do]' }, createdBy: 'EMP-1',
    });
    expect(sink[0].text).toContain('insert into audit_log');
    expect(sink[0].values).toEqual(['demo_task', 'DEMO-1', 'EMP-1', 'create', null, { status: '[To Do]' }, 'EMP-1']);
  });
});

describe('notifyExecutor', () => {
  it('calls notify_emit with an explicit array and returns notified recipients', async () => {
    const sink: Captured[] = [];
    const res = await notifyExecutor(fakeSql([{ r: { ok: true, notified: ['EMP-2'] } }], sink)).notifyEmit({
      event: 'm0.negotiation.decision', entityType: 'prospect', entityId: 'PRSP-1', actor: 'EMP-1',
      deepLink: '', division: '', explicit: ['EMP-2'], notifyActor: false,
    });
    expect(res).toEqual({ ok: true, notified: ['EMP-2'] });
    expect(sink[0].text).toContain('notify_emit');
    expect(sink[0].values).toContain('m0.negotiation.decision');
    expect(sink[0].values).toContainEqual(['EMP-2']);
  });
});
