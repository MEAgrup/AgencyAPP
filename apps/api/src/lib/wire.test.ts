/**
 * Unit tests for the wire mappers (camelCase domain → snake_case FE contract).
 * No DB, no Next — pure shape translation.
 */
import { describe, expect, it } from 'vitest';
import type { leads, msl, notifications } from '@cdps/domain';
import {
  attemptStubToWire,
  leadDetailToWire,
  leadRowToWire,
  leadStubToWire,
  masterServiceToWire,
  notificationRowToWire,
  poolRowToWire,
} from './wire';

describe('masterServiceToWire', () => {
  it('maps every ServiceView field to its snake_case wire key', () => {
    const view: msl.ServiceView = {
      id: 'SVC-202607-0001',
      name: 'Meta Ads Management',
      standardPrice: '5000000',
      commissionRule: '10% of standard price',
      category: 'Ads',
      unit: 'bulan',
      minQty: '1',
      pricingMode: 'fixed',
      applyPPN: true,
      frequency: 'monthly',
      priceNote: 'per campaign',
      description: 'Full-funnel Meta ads',
      active: true,
      requiresStrategyPlan: false,
      versionNo: 3,
      effectiveFrom: '2026-07-01',
    };
    expect(masterServiceToWire(view)).toEqual({
      id: 'SVC-202607-0001',
      name: 'Meta Ads Management',
      standard_price: '5000000',
      commission_rule: '10% of standard price',
      category: 'Ads',
      unit: 'bulan',
      min_qty: '1',
      pricing_mode: 'fixed',
      apply_ppn: true,
      frequency: 'monthly',
      price_note: 'per campaign',
      description: 'Full-funnel Meta ads',
      active: true,
      requires_strategy_plan: false,
      version_no: 3,
      effective_from: '2026-07-01',
    });
  });
});

describe('leads wire mappers', () => {
  it('leadStubToWire maps Lead → snake_case LeadStub', () => {
    const lead: leads.Lead = {
      id: 'LEAD-202607-0001', leadName: 'ABC Media', phoneNumber: '0812',
      email: 'a@b.c', source: 'Scouting', recordStatus: '[Pool]',
    };
    expect(leadStubToWire(lead)).toEqual({
      id: 'LEAD-202607-0001', lead_name: 'ABC Media', phone_number: '0812',
      source: 'Scouting', record_status: '[Pool]',
    });
  });

  it('attemptStubToWire maps Attempt (owner → owner_employee_id)', () => {
    const attempt: leads.Attempt = {
      id: 'PRSP-202607-0001', leadId: 'LEAD-202607-0001', owner: 'EMP-1', status: 'New Lead',
    };
    expect(attemptStubToWire(attempt)).toEqual({
      id: 'PRSP-202607-0001', lead_id: 'LEAD-202607-0001', owner_employee_id: 'EMP-1', status: 'New Lead',
    });
  });

  it('poolRowToWire maps PoolBoardRow with an ISO created_at', () => {
    const row: leads.PoolBoardRow = {
      id: 'LEAD-1', leadName: 'X', phoneNumber: '08', source: 'Scouting',
      originCampaignId: null, createdAt: new Date('2026-07-01T00:00:00.000Z'),
      stale: true, openAttemptCount: 2, myOpenAttempt: false,
    };
    expect(poolRowToWire(row)).toEqual({
      id: 'LEAD-1', lead_name: 'X', phone_number: '08', source: 'Scouting',
      origin_campaign_id: null, created_at: '2026-07-01T00:00:00.000Z',
      stale: true, open_attempt_count: 2, my_open_attempt: false,
    });
  });

  it('leadRowToWire maps LeadsDbRow (nullable campaign ids + ISO date)', () => {
    const row: leads.LeadsDbRow = {
      id: 'LEAD-1', leadName: 'X', phoneNumber: '08', email: null, source: 'Scouting',
      originDivision: 'Sales', originCampaignId: 'CMP-1', lastTouchCampaignId: null,
      recordStatus: 'active', winningAttemptId: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'), openAttemptCount: 1,
    };
    expect(leadRowToWire(row)).toEqual({
      id: 'LEAD-1', lead_name: 'X', phone_number: '08', email: null, source: 'Scouting',
      origin_division: 'Sales', origin_campaign_id: 'CMP-1', last_touch_campaign_id: null,
      record_status: 'active', winning_attempt_id: null,
      created_at: '2026-07-01T00:00:00.000Z', open_attempt_count: 1,
    });
  });

  it('leadDetailToWire maps the lead core (no rollup) + attempts', () => {
    const detail: leads.LeadDetailView = {
      lead: {
        id: 'LEAD-1', leadName: 'X', phoneNumber: '08', email: null, source: 'Scouting',
        originDivision: 'Sales', originCampaignId: null, lastTouchCampaignId: null,
        recordStatus: 'active', winningAttemptId: null, createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      attempts: [
        { id: 'PRSP-1', ownerEmployeeId: 'EMP-1', ownerNama: 'Budi', status: 'New Lead', claimedAt: new Date('2026-07-02T00:00:00.000Z') },
      ],
    };
    const wire = leadDetailToWire(detail);
    expect(wire.lead).not.toHaveProperty('open_attempt_count');
    expect(wire.lead.created_at).toBe('2026-07-01T00:00:00.000Z');
    expect(wire.attempts).toEqual([
      { id: 'PRSP-1', owner_employee_id: 'EMP-1', owner_nama: 'Budi', status: 'New Lead', claimed_at: '2026-07-02T00:00:00.000Z' },
    ]);
  });
});

describe('notificationRowToWire', () => {
  it('maps NotificationRow → snake_case NotificationItem (actor + ISO dates + null read_at)', () => {
    const row: notifications.NotificationRow = {
      id: '42',
      eventType: 'm0m5.installment.due',
      entityType: 'installment',
      entityId: 'INST-1',
      deepLink: '/transactions/TRX-1',
      actor: 'SYSTEM',
      createdAt: new Date('2026-07-01T03:04:05.000Z'),
      readAt: null,
    };
    expect(notificationRowToWire(row)).toEqual({
      id: '42',
      event_type: 'm0m5.installment.due',
      entity_type: 'installment',
      entity_id: 'INST-1',
      deep_link: '/transactions/TRX-1',
      actor: 'SYSTEM',
      created_at: '2026-07-01T03:04:05.000Z',
      read_at: null,
    });
  });

  it('serializes a set read_at as an ISO string', () => {
    const row: notifications.NotificationRow = {
      id: '7', eventType: 'e', entityType: 't', entityId: 'X', deepLink: '/x', actor: 'A',
      createdAt: new Date('2026-07-01T00:00:00.000Z'), readAt: new Date('2026-07-02T00:00:00.000Z'),
    };
    expect(notificationRowToWire(row).read_at).toBe('2026-07-02T00:00:00.000Z');
  });
});
