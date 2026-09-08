import { describe, expect, it, vi } from 'vitest';
import { makeRole, type Actor } from './permission';
import {
  type SmExecutor,
  type SmTransitionArgs,
  type TransitionResult,
  isBlocked,
  isRoleDenied,
  transition,
} from './statemachine';

const actor = (id: string, role: Parameters<typeof makeRole>[0]): Actor => ({
  employeeId: id,
  role: makeRole(role),
});

/** Fake executor capturing the args and returning a canned result. */
function fakeExec(result: TransitionResult): { exec: SmExecutor; calls: SmTransitionArgs[] } {
  const calls: SmTransitionArgs[] = [];
  return {
    calls,
    exec: {
      smTransition: vi.fn(async (args: SmTransitionArgs) => {
        calls.push(args);
        return result;
      }),
    },
  };
}

describe('transition wrapper — arg mapping', () => {
  it('fills id/status column defaults and derives role booleans (staff)', async () => {
    const { exec, calls } = fakeExec({ ok: true, from: '[To Do]', to: '[In Progress]' });
    const res = await transition(exec, {
      machine: 'brief_task',
      entityType: 'demo_task',
      table: 'demo_tasks',
      entityId: 'DEMO-1',
      to: '[In Progress]',
      actor: actor('EMP-1', { division: 'Creative', level: 'staff' }),
    });
    expect(res).toEqual({ ok: true, from: '[To Do]', to: '[In Progress]' });
    expect(calls[0]).toEqual({
      machine: 'brief_task',
      entityType: 'demo_task',
      table: 'demo_tasks',
      idCol: 'id',
      statusCol: 'status',
      entityId: 'DEMO-1',
      to: '[In Progress]',
      actorEmployeeId: 'EMP-1',
      roleDirector: false,
      roleLead: false,
      roleDivision: 'Creative',
    });
  });

  it('carries the actor division through, so an edge can narrow its lead branch', async () => {
    // Migration 20260924010000 lets an edge say "lead of THIS division". The
    // wrapper is the only thing that knows which division the actor writes
    // from, so a Finance lead and a Creative lead must not arrive at
    // `sm_transition` looking identical.
    const { exec, calls } = fakeExec({ ok: true, from: '[Terbuka]', to: '[Tertutup]' });
    await transition(exec, {
      machine: 'book_period', entityType: 'book_period', table: 'book_periods',
      idColumn: 'periode', entityId: '2026-08-01', to: '[Tertutup]',
      actor: actor('EMP-FIN', { division: 'Finance', level: 'lead' }),
    });
    expect(calls[0].roleDivision).toBe('Finance');
    expect(calls[0].roleLead).toBe(true);
  });

  it('sends an empty division for an unmapped actor rather than omitting it', async () => {
    // `role.division` is '' when the HRIS jabatan has no mapping. That must
    // travel as '' — an omitted field would let an edge requiring 'Finance'
    // read "nobody said" as "close enough".
    const { exec, calls } = fakeExec({ ok: true, from: 'a', to: 'b' });
    await transition(exec, {
      machine: 'm', entityType: 'e', table: 't', entityId: '1', to: 'b',
      actor: actor('EMP-X', {}),
    });
    expect(calls[0]).toHaveProperty('roleDivision', '');
  });

  it('derives roleLead=true for a lead, roleDirector=true for a director', async () => {
    const { exec, calls } = fakeExec({ ok: true, from: 'a', to: 'b' });
    await transition(exec, {
      machine: 'm', entityType: 'e', table: 't', entityId: '1', to: 'b',
      actor: actor('L', { division: 'Creative', level: 'lead' }),
    });
    await transition(exec, {
      machine: 'm', entityType: 'e', table: 't', entityId: '1', to: 'b',
      actor: actor('D', { director: true }),
    });
    expect(calls[0].roleLead).toBe(true);
    expect(calls[0].roleDirector).toBe(false);
    expect(calls[1].roleLead).toBe(false);
    expect(calls[1].roleDirector).toBe(true);
  });

  it('honours custom id/status columns', async () => {
    const { exec, calls } = fakeExec({ ok: true, from: 'a', to: 'b' });
    await transition(exec, {
      machine: 'm', entityType: 'e', table: 't', entityId: '1', to: 'b',
      actor: actor('S', { division: 'X', level: 'staff' }),
      idColumn: 'booking_id', statusColumn: 'state',
    });
    expect(calls[0].idCol).toBe('booking_id');
    expect(calls[0].statusCol).toBe('state');
  });
});

describe('transition wrapper — result narrowing', () => {
  it('surfaces a blocked result with the BI message', async () => {
    const { exec } = fakeExec({ ok: false, code: 'blocked', message: '[transisi status tidak diizinkan]' });
    const res = await transition(exec, {
      machine: 'm', entityType: 'e', table: 't', entityId: '1', to: 'z',
      actor: actor('S', { division: 'X', level: 'staff' }),
    });
    expect(isBlocked(res)).toBe(true);
    expect(isRoleDenied(res)).toBe(false);
    if (!res.ok) expect(res.message).toBe('[transisi status tidak diizinkan]');
  });

  it('surfaces a role_denied result', async () => {
    const { exec } = fakeExec({
      ok: false,
      code: 'role_denied',
      message: '[anda tidak memiliki akses untuk melakukan transisi ini]',
    });
    const res = await transition(exec, {
      machine: 'brief_task', entityType: 'demo_task', table: 'demo_tasks', entityId: 'DEMO-1', to: '[Blocked]',
      actor: actor('S', { division: 'Creative', level: 'staff' }),
    });
    expect(isRoleDenied(res)).toBe(true);
    expect(isBlocked(res)).toBe(false);
  });
});
