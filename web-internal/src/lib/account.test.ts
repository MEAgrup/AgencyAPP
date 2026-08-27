/**
 * Onboarding-step derivation (M6 §2 / §4 Rule 5 / §5 Rule 3 & 5).
 *
 * This is the table the AM's queue renders its call-to-action from. It decides
 * only WHICH BUTTON to show — the server still owns what is allowed — so the
 * assertions below encode the same gate ORDER the write paths enforce
 * (`createStrategy` / `guardBriefCreation` / `createBrief` in
 * packages/domain/src/account.ts). If those move, this file should fail.
 */
import { describe, expect, it } from 'vitest';
import {
  SERVICE_AWAITING_ONBOARDING,
  SERVICE_BRIEFED,
  SERVICE_IN_EXECUTION,
  SERVICE_STRATEGY_APPROVED,
  SERVICE_VOIDED,
  STRATEGY_APPROVED,
  STRATEGY_DRAFTING,
  STRATEGY_SUBMITTED,
  canEditClientProfile,
  needsOnboarding,
  nextOnboardingStep,
  type ServiceQueueRow,
} from './account';
import type { Role } from './types';

function role(over: Partial<Role> = {}): Role {
  return { division: 'Creative', level: 'staff', od: false, director: false, ...over };
}

function svc(over: Partial<ServiceQueueRow> = {}): ServiceQueueRow {
  return {
    service_id: 'SVC-202608-0001',
    client_id: 'CLI-202608-0001',
    toko: 'Alpha Digital',
    nama_pic: 'PIC',
    name: 'TikTok Shop Full Management',
    status: SERVICE_AWAITING_ONBOARDING,
    requires_strategy_plan: true,
    pinned_requires_strategy_plan: true,
    overridden: false,
    plan_tier: 'plan_wajib',
    gate_decision: null,
    plan_determination_pending: false,
    assigned_am_id: 'EMP-0002',
    strategy_id: null,
    strategy_status: null,
    brief_count: 0,
    client_target_gmv: '20000000.00',
    released_to_account_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

describe('plan-gated path (§4)', () => {
  it('starts at "draft the Plan" — the step that had no UI door at all', () => {
    expect(nextOnboardingStep(svc()).kind).toBe('draft_strategy');
  });

  it('asks the AM to submit a Plan still in [Strategy Drafting]', () => {
    const step = nextOnboardingStep(
      svc({ strategy_id: 'STR-202608-0001', strategy_status: STRATEGY_DRAFTING }),
    );
    expect(step.kind).toBe('submit_strategy');
  });

  it('waits (no AM action) while the Plan sits with the SPV', () => {
    const step = nextOnboardingStep(
      svc({ strategy_id: 'STR-202608-0001', strategy_status: STRATEGY_SUBMITTED }),
    );
    expect(step.kind).toBe('await_approval');
  });

  it('unlocks Brief creation only once the Service itself reached [Strategy Approved]', () => {
    const approved = svc({
      status: SERVICE_STRATEGY_APPROVED,
      strategy_id: 'STR-202608-0001',
      strategy_status: STRATEGY_APPROVED,
    });
    expect(nextOnboardingStep(approved).kind).toBe('create_brief');
  });

  it('never offers Brief creation while plan-gated and un-drafted (§5 Rule 5)', () => {
    // The server would reject it with
    // [layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief];
    // the UI must not invite the click in the first place.
    expect(nextOnboardingStep(svc()).kind).not.toBe('create_brief');
  });
});

describe('Direct path (§5 Rule 3)', () => {
  it('goes straight to Brief creation, with no Plan step', () => {
    const step = nextOnboardingStep(svc({ requires_strategy_plan: false, pinned_requires_strategy_plan: false }));
    expect(step.kind).toBe('create_brief');
  });

  it('follows the EFFECTIVE gate, not the MSL pin (M6-OA-1 override)', () => {
    // Pinned Yes, overridden to No for this engagement → Direct.
    const direct = svc({ requires_strategy_plan: false, pinned_requires_strategy_plan: true, overridden: true });
    expect(nextOnboardingStep(direct).kind).toBe('create_brief');
    // Pinned No, overridden to Yes → plan-gated.
    const gated = svc({ requires_strategy_plan: true, pinned_requires_strategy_plan: false, overridden: true });
    expect(nextOnboardingStep(gated).kind).toBe('draft_strategy');
  });
});

describe('past onboarding', () => {
  it('switches to monitoring once Briefs exist', () => {
    expect(nextOnboardingStep(svc({ status: SERVICE_BRIEFED, brief_count: 2 })).kind).toBe('monitor');
    expect(nextOnboardingStep(svc({ status: SERVICE_IN_EXECUTION, brief_count: 2 })).kind).toBe('monitor');
  });

  it('offers nothing on a voided Service (M4-OA-5)', () => {
    expect(nextOnboardingStep(svc({ status: SERVICE_VOIDED })).kind).toBe('none');
  });
});

describe('needsOnboarding — the queue filter', () => {
  it('keeps every step that still needs the AM, including "waiting on SPV"', () => {
    expect(needsOnboarding(svc())).toBe(true);
    expect(needsOnboarding(svc({ strategy_id: 'STR-1', strategy_status: STRATEGY_SUBMITTED }))).toBe(true);
    expect(needsOnboarding(svc({ status: SERVICE_STRATEGY_APPROVED }))).toBe(true);
  });

  it('drops dispatched and voided Services', () => {
    expect(needsOnboarding(svc({ status: SERVICE_BRIEFED }))).toBe(false);
    expect(needsOnboarding(svc({ status: SERVICE_VOIDED }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Module 6C — the middle tier must be ANSWERED before anything else (Rule 1).
// ---------------------------------------------------------------------------
describe('plan-gate determination (M6C Rule 1)', () => {
  it('asks for the determination first, ahead of every other step', () => {
    // The trap this guards: `requires_strategy_plan` is false for an unanswered
    // `ditentukan_am` Service, so a check that looked at the flag first would
    // read it as Direct and offer a Brief the server always rejects.
    const step = nextOnboardingStep(
      svc({
        plan_tier: 'ditentukan_am',
        requires_strategy_plan: false,
        pinned_requires_strategy_plan: false,
        plan_determination_pending: true,
      }),
    );
    expect(step.kind).toBe('determine_plan');
  });

  it('moves on to the Plan once the AM answered "butuh_plan"', () => {
    const step = nextOnboardingStep(
      svc({
        plan_tier: 'ditentukan_am',
        requires_strategy_plan: true,
        pinned_requires_strategy_plan: false,
        gate_decision: 'butuh_plan',
        plan_determination_pending: false,
      }),
    );
    expect(step.kind).toBe('draft_strategy');
  });

  it('goes straight to Brief once the AM answered "tanpa_plan"', () => {
    const step = nextOnboardingStep(
      svc({
        plan_tier: 'ditentukan_am',
        requires_strategy_plan: false,
        pinned_requires_strategy_plan: false,
        gate_decision: 'tanpa_plan',
        plan_determination_pending: false,
      }),
    );
    expect(step.kind).toBe('create_brief');
  });

  it('counts an unanswered determination as onboarding work', () => {
    expect(
      needsOnboarding(
        svc({
          plan_tier: 'ditentukan_am',
          requires_strategy_plan: false,
          plan_determination_pending: true,
        }),
      ),
    ).toBe(true);
  });

  it('never asks for a determination on the two locked tiers', () => {
    expect(nextOnboardingStep(svc({ plan_tier: 'plan_wajib' })).kind).toBe('draft_strategy');
    expect(
      nextOnboardingStep(
        svc({ plan_tier: 'tanpa_plan', requires_strategy_plan: false, pinned_requires_strategy_plan: false }),
      ).kind,
    ).toBe('create_brief');
  });
});

describe('canEditClientProfile (mirrors domain client.canEditProfile — M4-OA-4)', () => {
  it('admits Account Lead, OD, and Director', () => {
    expect(canEditClientProfile(role({ division: 'Account', level: 'lead' }))).toBe(true);
    expect(canEditClientProfile(role({ od: true }))).toBe(true);
    expect(canEditClientProfile(role({ director: true }))).toBe(true);
  });

  it('denies Account staff (non-lead) and null', () => {
    expect(canEditClientProfile(role({ division: 'Account', level: 'staff' }))).toBe(false);
    expect(canEditClientProfile(null)).toBe(false);
  });
});
