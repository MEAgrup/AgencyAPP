import { describe, expect, it, vi } from 'vitest';
import {
  type AuditExecutor,
  type AuditRow,
  NoActorError,
  hasSecretKey,
  write,
} from './audit.js';

function fakeExec(): { exec: AuditExecutor; rows: AuditRow[] } {
  const rows: AuditRow[] = [];
  return {
    rows,
    exec: { insertAudit: vi.fn(async (row: AuditRow) => { rows.push(row); }) },
  };
}

describe('write', () => {
  it('rejects a write with no actor (ErrNoActor parity)', async () => {
    const { exec } = fakeExec();
    await expect(write(exec, { entityType: 'x', entityId: '1', actor: '', action: 'y' })).rejects.toThrow(
      NoActorError,
    );
    expect(exec.insertAudit).not.toHaveBeenCalled();
  });

  it('inserts an entry with before/after and actor as created_by', async () => {
    const { exec, rows } = fakeExec();
    await write(exec, {
      entityType: 'demo_task',
      entityId: 'DEMO-1',
      actor: 'EMP-1',
      action: 'transition:[To Do]->[In Progress]',
      before: { status: '[To Do]' },
      after: { status: '[In Progress]' },
    });
    expect(rows[0]).toEqual({
      entityType: 'demo_task',
      entityId: 'DEMO-1',
      actorEmployeeId: 'EMP-1',
      action: 'transition:[To Do]->[In Progress]',
      beforeJson: { status: '[To Do]' },
      afterJson: { status: '[In Progress]' },
      createdBy: 'EMP-1',
    });
  });

  it('stores null json when before/after are omitted', async () => {
    const { exec, rows } = fakeExec();
    await write(exec, { entityType: 'e', entityId: '1', actor: 'EMP-1', action: 'create' });
    expect(rows[0].beforeJson).toBeNull();
    expect(rows[0].afterJson).toBeNull();
  });
});

describe('hasSecretKey (no-secret-in-payload guard)', () => {
  it('flags credential-shaped payloads', () => {
    expect(hasSecretKey({ password_hash: 'x' })).toBe(true);
    expect(hasSecretKey({ user: { token: 'abc' } })).toBe(true);
    expect(hasSecretKey([{ ok: 1 }, { secret: 2 }])).toBe(true);
    expect(hasSecretKey({ apiCredential: 'z' })).toBe(true);
  });

  it('passes clean status payloads', () => {
    expect(hasSecretKey({ status: '[To Do]' })).toBe(false);
    expect(hasSecretKey({ before: { status: 'a' }, after: { status: 'b' } })).toBe(false);
    expect(hasSecretKey(null)).toBe(false);
    expect(hasSecretKey('a string')).toBe(false);
  });

  it('a typical transition audit payload is clean', () => {
    const before = { status: '[Menunggu Verifikasi]' };
    const after = { status: '[Lunas]' };
    expect(hasSecretKey(before)).toBe(false);
    expect(hasSecretKey(after)).toBe(false);
  });
});
