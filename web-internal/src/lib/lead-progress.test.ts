/**
 * Per-role tests for the lead → attempt progression panel (CLAUDE.md DoD
 * "permission tests per role", incl. the layered OD/Director roles).
 *
 * The assertions encode the SERVER gates this module mirrors —
 * `sales.canWriteAttempt` (M0 §9.1) and `leads.decideClaim` (M1 §6). If one of
 * those moves, this file should fail and be updated together with
 * `lead-progress.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from './types';
import type { LeadAttemptRow } from './leads';
import {
  ATTEMPT_NEXT_STEP,
  TERMINAL_ATTEMPT_STATUSES,
  isTerminalAttempt,
  leadProgress,
  nextStepLabel,
} from './lead-progress';

function role(division: string, level: string, extra: Partial<Role> = {}): Role {
  return { division, level, od: false, director: false, ...extra };
}

function attempt(id: string, ownerEmployeeId: string, status: string): LeadAttemptRow {
  return {
    id,
    owner_employee_id: ownerEmployeeId,
    owner_nama: ownerEmployeeId,
    status,
    claimed_at: '2026-08-03T10:43:56.000Z',
  };
}

const SALES_STAFF = role('Sales', 'staff');
const SALES_LEAD = role('Sales', 'lead');
const DIRECTOR = role('', 'staff', { director: true });
const OD_ONLY = role('', 'staff', { od: true });
const OD_DIRECTOR = role('', 'staff', { od: true, director: true });
const CREATIVE_STAFF = role('Creative', 'staff');

describe('isTerminalAttempt', () => {
  it('covers exactly the statuses with no outgoing edge', () => {
    expect([...TERMINAL_ATTEMPT_STATUSES]).toEqual([
      'Not Qualified',
      'Closed-Success',
      'Closed-Lost',
      '[Closed - Kalah Kompetisi]',
    ]);
    for (const s of TERMINAL_ATTEMPT_STATUSES) {
      expect(isTerminalAttempt(s)).toBe(true);
      expect(nextStepLabel(s)).toBeNull();
    }
  });

  it('treats every live status as non-terminal with a next step', () => {
    for (const status of Object.keys(ATTEMPT_NEXT_STEP)) {
      expect(isTerminalAttempt(status)).toBe(false);
      expect(nextStepLabel(status)).not.toBeNull();
    }
  });

  it('names the first two steps of the flow the user follows', () => {
    expect(nextStepLabel('New Lead')).toBe('Tandai Contacted');
    expect(nextStepLabel('Contacted')).toBe('Isi Qualified Lead Form (data toko)');
  });

  it('[Unrespon] (L1/L4) points back at reviving the attempt, not a dead end', () => {
    expect(nextStepLabel('[Unrespon]')).toBe('Hubungi ulang & tandai Contacted');
    expect(isTerminalAttempt('[Unrespon]')).toBe(false);
  });
});

describe('leadProgress — which attempt the panel points at', () => {
  it('points at the actor own open attempt over an older competing one', () => {
    const p = leadProgress({
      recordStatus: '[Pool]',
      attempts: [attempt('PRSP-1', 'OTHER', 'Contacted'), attempt('PRSP-2', 'ME', 'New Lead')],
      employeeId: 'ME',
      role: SALES_STAFF,
    });
    expect(p.attempt?.id).toBe('PRSP-2');
    expect(p.isMine).toBe(true);
    expect(p.nextStep).toBe('Tandai Contacted');
    expect(p.canAct).toBe(true);
  });

  it('falls back to the oldest open attempt when the actor holds none', () => {
    const p = leadProgress({
      recordStatus: 'active',
      attempts: [attempt('PRSP-1', 'OTHER', 'Qualified'), attempt('PRSP-2', 'OTHER2', 'New Lead')],
      employeeId: 'ME',
      role: SALES_LEAD,
    });
    expect(p.attempt?.id).toBe('PRSP-1');
    expect(p.isMine).toBe(false);
  });

  it('ignores terminal attempts entirely', () => {
    const p = leadProgress({
      recordStatus: '[Not Qualified]',
      attempts: [attempt('PRSP-1', 'ME', 'Not Qualified'), attempt('PRSP-2', 'OTHER', 'Closed-Lost')],
      employeeId: 'ME',
      role: SALES_STAFF,
    });
    expect(p.attempt).toBeNull();
    expect(p.nextStep).toBeNull();
    expect(p.canAct).toBe(false);
  });

  it('has no next step while a proposal waits on the Superior', () => {
    const p = leadProgress({
      recordStatus: 'active',
      attempts: [attempt('PRSP-1', 'ME', 'Negotiation - Pending Approval')],
      employeeId: 'ME',
      role: SALES_STAFF,
    });
    expect(p.nextStep).toBe('Menunggu keputusan Superior');
  });
});

describe('leadProgress — canAct mirrors canWriteAttempt (M0 §9.1)', () => {
  const attempts = [attempt('PRSP-1', 'OWNER', 'New Lead')];
  const base = { recordStatus: 'active', attempts };

  it('lets the Director act on anyone attempt', () => {
    expect(leadProgress({ ...base, employeeId: '200000002', role: DIRECTOR }).canAct).toBe(true);
  });

  it('lets a Sales Lead act division-wide', () => {
    expect(leadProgress({ ...base, employeeId: 'HEAD', role: SALES_LEAD }).canAct).toBe(true);
  });

  it('lets Sales staff act only on their own attempt', () => {
    expect(leadProgress({ ...base, employeeId: 'OWNER', role: SALES_STAFF }).canAct).toBe(true);
    expect(leadProgress({ ...base, employeeId: 'OTHER', role: SALES_STAFF }).canAct).toBe(false);
  });

  it('never lets a non-Sales division act', () => {
    expect(leadProgress({ ...base, employeeId: 'OWNER', role: CREATIVE_STAFF }).canAct).toBe(false);
  });

  it('keeps a pure OD read-only but honours OD layered on Director', () => {
    expect(leadProgress({ ...base, employeeId: 'OWNER', role: OD_ONLY }).canAct).toBe(false);
    expect(leadProgress({ ...base, employeeId: 'OWNER', role: OD_DIRECTOR }).canAct).toBe(true);
  });

  it('grants nothing without a resolved role', () => {
    const p = leadProgress({ ...base, employeeId: null, role: null });
    expect(p.canAct).toBe(false);
    expect(p.canClaim).toBe(false);
  });
});

describe('leadProgress — canClaim mirrors decideClaim (M1 §6)', () => {
  const none: LeadAttemptRow[] = [];

  it('offers the claim on [Pool] and on re-claimable terminal records', () => {
    for (const recordStatus of ['[Pool]', '[Rejected]', '[Not Qualified]']) {
      expect(leadProgress({ recordStatus, attempts: none, employeeId: 'ME', role: SALES_STAFF }).canClaim).toBe(true);
    }
  });

  it('never offers it on a record the Pool flow may not touch', () => {
    for (const recordStatus of ['active', '[Closed-Success]', '[Deleted]']) {
      expect(leadProgress({ recordStatus, attempts: none, employeeId: 'ME', role: SALES_STAFF }).canClaim).toBe(false);
    }
  });

  it('never offers a double-claim to an actor already holding an open attempt', () => {
    const p = leadProgress({
      recordStatus: '[Pool]',
      attempts: [attempt('PRSP-1', 'ME', 'Contacted')],
      employeeId: 'ME',
      role: SALES_STAFF,
    });
    expect(p.canClaim).toBe(false);
  });

  it('still offers it while a colleague pursues the same pool lead (M1-OA-1)', () => {
    const p = leadProgress({
      recordStatus: '[Pool]',
      attempts: [attempt('PRSP-1', 'OTHER', 'Contacted')],
      employeeId: 'ME',
      role: SALES_STAFF,
    });
    expect(p.canClaim).toBe(true);
  });

  it('is Sales-or-Director only, and never for a pure OD', () => {
    const pool = { recordStatus: '[Pool]', attempts: none, employeeId: 'ME' };
    expect(leadProgress({ ...pool, role: DIRECTOR }).canClaim).toBe(true);
    expect(leadProgress({ ...pool, role: SALES_LEAD }).canClaim).toBe(true);
    expect(leadProgress({ ...pool, role: CREATIVE_STAFF }).canClaim).toBe(false);
    expect(leadProgress({ ...pool, role: OD_ONLY }).canClaim).toBe(false);
    expect(leadProgress({ ...pool, role: OD_DIRECTOR }).canClaim).toBe(true);
  });
});
