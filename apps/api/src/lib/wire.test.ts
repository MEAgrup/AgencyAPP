/**
 * Unit tests for the wire mappers (camelCase domain → snake_case FE contract).
 * No DB, no Next — pure shape translation.
 */
import { describe, expect, it } from 'vitest';
import type { account, admin, ads, campaign, client, creative, kol, leads, livestream, marketing, msl, notification, sales, task } from '@cdps/domain';
import {
  adminEmployeeToWire,
  amWorkloadToWire,
  assetToWire,
  assignmentToWire,
  attemptStubToWire,
  blockRequestToWire,
  briefToWire,
  campaignRollupToWire,
  complaintToWire,
  intakeClientToWire,
  marketingCampaignToWire,
  marketingMetricsToWire,
  performanceRecordToWire,
  leadDetailToWire,
  leadRowToWire,
  leadStubToWire,
  bookingToWire,
  campaignToWire,
  creatorListToWire,
  inboxToWire,
  clientDetailToWire,
  clientListRowToWire,
  layeredRoleToWire,
  roleMappingToWire,
  masterServiceToWire,
  metricEntryToWire,
  metricsToWire,
  notificationToWire,
  optimizationToWire,
  pendingBlockRequestToWire,
  poolRowToWire,
  quoteToWire,
  sessionToWire,
  strategyRequirementToWire,
  strategyToWire,
  toAssetInput,
  toBriefInput,
  toComplaintInput,
  toStrategyInput,
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

describe('M6 account wire mappers', () => {
  it('intakeClientToWire maps IntakeClient (ISO released_to_account_at)', () => {
    const c: account.IntakeClient = {
      clientId: 'CLI-202607-0001', namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta',
      kategori: 'Fashion', serviceCount: 2, releasedToAccountAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(intakeClientToWire(c)).toEqual({
      client_id: 'CLI-202607-0001', nama_pic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta',
      kategori: 'Fashion', service_count: 2, released_to_account_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('intakeClientToWire renders a null release timestamp as null', () => {
    const c: account.IntakeClient = {
      clientId: 'CLI-1', namaPic: 'P', toko: 'T', kota: 'K', kategori: 'F',
      serviceCount: 0, releasedToAccountAt: null,
    };
    expect(intakeClientToWire(c).released_to_account_at).toBeNull();
  });

  it('amWorkloadToWire maps AMWorkload', () => {
    const w: account.AMWorkload = { amEmployeeId: 'EMP-SINTA', activeClientCount: 3 };
    expect(amWorkloadToWire(w)).toEqual({ am_employee_id: 'EMP-SINTA', active_client_count: 3 });
  });

  it('assignmentToWire omits previous_am/reason on an assign', () => {
    const a: account.Assignment = { clientId: 'CLI-1', assignedAm: 'EMP-SINTA', assignedBy: 'EMP-ALEAD' };
    expect(assignmentToWire(a)).toEqual({
      client_id: 'CLI-1', assigned_am: 'EMP-SINTA', assigned_by: 'EMP-ALEAD',
    });
  });

  it('assignmentToWire includes previous_am + reason on a reassign', () => {
    const a: account.Assignment = {
      clientId: 'CLI-1', previousAm: 'EMP-SINTA', assignedAm: 'EMP-RANI', assignedBy: 'EMP-ALEAD',
      reason: 'Sinta cuti panjang',
    };
    expect(assignmentToWire(a)).toEqual({
      client_id: 'CLI-1', previous_am: 'EMP-SINTA', assigned_am: 'EMP-RANI', assigned_by: 'EMP-ALEAD',
      reason: 'Sinta cuti panjang',
    });
  });

  it('strategyToWire maps a Strategy; omits empty approved_by/revision_notes', () => {
    const s: account.Strategy = {
      id: 'STR-202607-0001', serviceId: 'SVC-1', objective: 'grow', targetKpi: 'GMV +30%',
      divisionsInvolved: ['Creative', 'Ads'], plannedBriefOutline: '12 videos', timelineStart: '2026-07-01',
      timelineEnd: '2026-08-30', status: '[Strategy Drafting]', approvedBy: '', revisionNotes: '',
      revisionCount: 0, createdBy: 'EMP-SINTA', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(strategyToWire(s)).toEqual({
      id: 'STR-202607-0001', service_id: 'SVC-1', objective: 'grow', target_kpi: 'GMV +30%',
      divisions_involved: ['Creative', 'Ads'], planned_brief_outline: '12 videos', timeline_start: '2026-07-01',
      timeline_end: '2026-08-30', status: '[Strategy Drafting]', revision_count: 0, created_by: 'EMP-SINTA',
      created_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('strategyToWire includes approved_by/revision_notes when set', () => {
    const s: account.Strategy = {
      id: 'STR-1', serviceId: 'SVC-1', objective: 'o', targetKpi: 'k', divisionsInvolved: [],
      plannedBriefOutline: 'p', timelineStart: '2026-07-01', timelineEnd: '2026-07-02',
      status: '[Strategy Approved]', approvedBy: 'EMP-ALEAD', revisionNotes: 'fix kpi', revisionCount: 1,
      createdBy: 'EMP-SINTA', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const w = strategyToWire(s);
    expect(w.approved_by).toBe('EMP-ALEAD');
    expect(w.revision_notes).toBe('fix kpi');
    expect(w.revision_count).toBe(1);
  });

  it('strategyRequirementToWire maps the M6-OA-1 override outcome', () => {
    const r: account.StrategyRequirement = {
      serviceId: 'SVC-1', requiresStrategyPlan: true, pinnedRequirement: false,
      overridden: true, setBy: 'EMP-SINTA', reason: 'butuh strategi',
    };
    expect(strategyRequirementToWire(r)).toEqual({
      service_id: 'SVC-1', requires_strategy_plan: true, pinned_requires_strategy_plan: false,
      overridden: true, set_by: 'EMP-SINTA', reason: 'butuh strategi',
    });
  });

  it('toStrategyInput maps snake_case body → camelCase StrategyInput (defaults)', () => {
    expect(toStrategyInput({ objective: 'o', target_kpi: 'k', divisions_involved: ['Ads'] })).toEqual({
      objective: 'o', targetKpi: 'k', divisionsInvolved: ['Ads'],
      plannedBriefOutline: '', timelineStart: '', timelineEnd: '',
    });
  });

  it('briefToWire maps a Brief; omits empty path-dependent + recurring fields', () => {
    const b: account.Brief = {
      id: 'BRF-202607-0001', serviceId: 'SVC-1', strategyId: '', assignedDivision: 'Creative',
      assignedPic: '', deliverableType: 'Video', quantityTarget: 12, dueDate: '2026-08-15', priority: 'High',
      recurring: false, recurringFrequency: '', recurringCount: 0, recurringEndDate: '', instructions: '',
      referenceAttachments: '', title: 'Promo', status: '[To Do]', revisionCount: 0, revisionFlagged: false,
      createdBy: 'EMP-SINTA', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(briefToWire(b)).toEqual({
      id: 'BRF-202607-0001', service_id: 'SVC-1', assigned_division: 'Creative', deliverable_type: 'Video',
      quantity_target: 12, due_date: '2026-08-15', priority: 'High', recurring: false, title: 'Promo',
      status: '[To Do]', revision_count: 0, revision_flagged: false, created_by: 'EMP-SINTA',
      created_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('briefToWire includes strategy_id + recurring block when set', () => {
    const b: account.Brief = {
      id: 'BRF-1', serviceId: 'SVC-1', strategyId: 'STR-1', assignedDivision: 'Ads', assignedPic: 'EMP-A',
      deliverableType: 'Campaign', quantityTarget: 2, dueDate: '2026-08-15', priority: 'Medium',
      recurring: true, recurringFrequency: 'Weekly', recurringCount: 4, recurringEndDate: '2026-09-15',
      instructions: 'brief detail', referenceAttachments: 'link', title: 'Ads Q3', status: '[Approved]',
      revisionCount: 3, revisionFlagged: true, createdBy: 'EMP-SINTA', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const w = briefToWire(b);
    expect(w.strategy_id).toBe('STR-1');
    expect(w.assigned_pic).toBe('EMP-A');
    expect(w.recurring_frequency).toBe('Weekly');
    expect(w.recurring_count).toBe(4);
    expect(w.recurring_end_date).toBe('2026-09-15');
    expect(w.revision_flagged).toBe(true);
  });

  it('toBriefInput maps snake_case body → camelCase BriefInput (defaults)', () => {
    expect(toBriefInput({ title: 'T', assigned_division: 'Creative', deliverable_type: 'Video', quantity_target: 5, due_date: '2026-08-15', priority: 'High' })).toEqual({
      title: 'T', strategyId: '', assignedDivision: 'Creative', assignedPic: '', deliverableType: 'Video',
      quantityTarget: 5, dueDate: '2026-08-15', priority: 'High', recurring: false, recurringFrequency: '',
      recurringCount: 0, recurringEndDate: '', instructions: '', referenceAttachments: '', isAddendum: false,
    });
  });

  it('complaintToWire maps a Complaint; omits empty related_ref/assigned_to/resolution_notes', () => {
    const c: account.Complaint = {
      id: 'CPL-202607-0001', clientId: 'CLI-1', relatedRef: '', source: 'WhatsApp (AM-logged)',
      description: 'telat', severity: 'High', status: '[Open]', assignedTo: '', resolutionNotes: '',
      createdBy: 'EMP-SINTA', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(complaintToWire(c)).toEqual({
      id: 'CPL-202607-0001', client_id: 'CLI-1', source: 'WhatsApp (AM-logged)', description: 'telat',
      severity: 'High', status: '[Open]', created_by: 'EMP-SINTA', created_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('toComplaintInput maps snake_case body → camelCase ComplaintInput', () => {
    expect(toComplaintInput({ description: 'd', severity: 'Low', related_ref: 'SVC-1' })).toEqual({
      description: 'd', severity: 'Low', relatedRef: 'SVC-1',
    });
  });
});

describe('M12 task wire mappers', () => {
  it('metricsToWire maps Metrics; revision-SLA fields are N/A for a Brief-as-task', () => {
    const m: task.Metrics = {
      briefId: 'BRF-1', status: '[Approved]', slaTargetHours: 24, turnaroundHours: 12,
      revisionTurnaroundHours: null, speedScorePct: 50, speedScoreDisplay: '50.00%',
      revisionSlaTargetHours: null, revisionSpeedScorePct: null, revisionSpeedScoreDisplay: 'N/A', revisionCount: 1,
      revisionFlagged: false, approvedAt: new Date('2026-07-01T00:00:00.000Z'), approvedPeriodWib: '2026-07',
    };
    expect(metricsToWire(m)).toEqual({
      brief_id: 'BRF-1', status: '[Approved]', sla_target_hours: 24, turnaround_hours: 12,
      revision_turnaround_hours: null, speed_score_pct: 50, speed_score_display: '50.00%',
      revision_sla_target_hours: null, revision_speed_score_pct: null, revision_speed_score_display: 'N/A',
      revision_count: 1, revision_flagged: false, approved_at: '2026-07-01T00:00:00.000Z', approved_period_wib: '2026-07',
    });
  });

  it('blockRequestToWire maps a BlockRequest (nullable resolve fields)', () => {
    const b: task.BlockRequest = {
      id: 'BBR-1', entityId: 'BRF-1', reason: 'wait', status: 'pending', requestedBy: 'ZZ-C',
      resolvedBy: null, resolvedAt: null, createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(blockRequestToWire(b)).toEqual({
      id: 'BBR-1', entity_id: 'BRF-1', reason: 'wait', status: 'pending', requested_by: 'ZZ-C',
      resolved_by: null, resolved_at: null, created_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('pendingBlockRequestToWire maps a PendingBlockRequest', () => {
    const b: task.PendingBlockRequest = {
      id: 'BBR-1', source: 'brief', entityId: 'BRF-1', division: 'Creative', clientId: 'CLI-1',
      reason: 'wait', requestedBy: 'ZZ-C', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(pendingBlockRequestToWire(b)).toEqual({
      id: 'BBR-1', source: 'brief', entity_id: 'BRF-1', division: 'Creative', client_id: 'CLI-1',
      reason: 'wait', requested_by: 'ZZ-C', created_at: '2026-07-01T00:00:00.000Z',
    });
  });
});

describe('M7 creative wire mappers', () => {
  it('assetToWire maps an Asset; omits absent PIC/link and null numeric fields', () => {
    const a: creative.Asset = {
      id: 'AST-202607-0001', briefId: 'BRF-1', assetType: 'Product Video', sequenceNo: 1, assignedPic: '',
      outputLink: '', status: '[To Do]', slaTargetHours: null, revisionSlaHours: null, hoursLogged: null,
      attributedGmv: null, revisionCount: 0, revisionFlagged: false, createdBy: 'ZZ-C',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(assetToWire(a)).toEqual({
      id: 'AST-202607-0001', brief_id: 'BRF-1', asset_type: 'Product Video', sequence_no: 1, status: '[To Do]',
      revision_count: 0, revision_flagged: false, created_by: 'ZZ-C', created_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('assetToWire includes PIC, link, and numeric fields when set', () => {
    const a: creative.Asset = {
      id: 'AST-1', briefId: 'BRF-1', assetType: 'Video', sequenceNo: 2, assignedPic: 'ZZ-C',
      outputLink: 'https://drive/x', status: '[Approved]', slaTargetHours: 24, revisionSlaHours: 8,
      hoursLogged: 4.5, attributedGmv: 1000000, revisionCount: 2, revisionFlagged: false, createdBy: 'ZZ-C',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const w = assetToWire(a);
    expect(w.assigned_pic).toBe('ZZ-C');
    expect(w.output_link).toBe('https://drive/x');
    expect(w.sla_target_hours).toBe(24);
    expect(w.revision_sla_target_hours).toBe(8);
    expect(w.hours_logged).toBe(4.5);
    expect(w.attributed_gmv).toBe(1000000);
  });

  it('toAssetInput maps snake_case body → camelCase AssetInput (defaults)', () => {
    expect(toAssetInput({ sequence_no: 3 })).toEqual({ sequenceNo: 3, assignedPic: '' });
    expect(toAssetInput({ sequence_no: 1, assigned_pic: 'ZZ-C' })).toEqual({ sequenceNo: 1, assignedPic: 'ZZ-C' });
  });
});

describe('M8 ads wire mappers', () => {
  it('campaignToWire maps a Campaign with its derived metrics', () => {
    const c: ads.Campaign = {
      id: 'ADC-202607-0001', briefId: 'BRF-1', clientId: 'CLI-1', platform: 'Shopee Ads', objective: 'Sales',
      budget: 8000000, budgetDisplay: 'Rp. 8.000.000,00', startDate: '2026-07-01', endDate: '2026-08-31',
      targetKpi: 'ROAS ≥ 4x', status: '[Active]', totalSpend: 1000000, totalSpendDisplay: 'Rp. 1.000.000,00',
      totalGmv: 4000000, totalGmvDisplay: 'Rp. 4.000.000,00', roas: 4, roasDisplay: '4x', linkedAssetIds: ['AST-1'],
      metricEntryCount: 1, optimizationCount: 0, underperformingStreak: 0, escalationFlagged: false,
      createdBy: 'ZZ-ADV', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const w = campaignToWire(c);
    expect(w.budget_display).toBe('Rp. 8.000.000,00');
    expect(w.roas).toBe(4);
    expect(w.roas_display).toBe('4x');
    expect(w.linked_asset_ids).toEqual(['AST-1']);
    expect(w.escalation_flagged).toBe(false);
    expect(w.created_at).toBe('2026-07-01T00:00:00.000Z');
  });

  it('metricEntryToWire + optimizationToWire map their records', () => {
    const m: ads.MetricEntry = {
      id: 'MTR-1', campaignId: 'ADC-1', periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: 1000000,
      gmv: 4000000, entryMethod: 'Manual', enteredBy: 'ZZ-ADV', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(metricEntryToWire(m)).toEqual({
      id: 'MTR-1', campaign_id: 'ADC-1', period_start: '2026-07-01', period_end: '2026-07-07', spend: 1000000,
      gmv: 4000000, entry_method: 'Manual', entered_by: 'ZZ-ADV', created_at: '2026-07-01T00:00:00.000Z',
    });
    const o: ads.Optimization = {
      id: 'OPT-1', campaignId: 'ADC-1', changeType: 'Budget', beforeValue: '8000000', afterValue: '9000000',
      reason: 'scale', actor: 'ZZ-ADV', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(optimizationToWire(o).change_type).toBe('Budget');
    expect(optimizationToWire(o).before_value).toBe('8000000');
  });
});

describe('M9 kol wire mappers', () => {
  it('bookingToWire maps a Booking; omits absent optionals + null numerics', () => {
    const b: kol.Booking = {
      id: 'BKG-202607-0001', briefId: 'BRF-1', creatorName: 'Creator A', creatorHandle: '', platform: 'TikTok',
      niche: '', sourcePool: 'MCN MEA Roster', poolReference: '', agreedRate: 1500000,
      agreedRateDisplay: 'Rp. 1.500.000,00', status: '[Sourcing]', contentLink: '', qcNotes: '',
      slaTargetHours: null, hoursLogged: null, assignedCoordinator: 'ZZ-COORD', attributedGmv: null,
      revisionCount: 0, paymentStatus: '', createdBy: 'ZZ-COORD', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const w = bookingToWire(b);
    expect(w.agreed_rate_display).toBe('Rp. 1.500.000,00');
    expect(w.assigned_coordinator).toBe('ZZ-COORD');
    expect(w).not.toHaveProperty('sla_target_hours');
    expect(w).not.toHaveProperty('content_link');
    expect(w.payment_status).toBe('');
  });

  it('creatorListToWire maps the compiled list (nullable last_compiled)', () => {
    const c: kol.CreatorList = {
      briefId: 'BRF-1', creatorListLink: 'https://drive/x', includedBookings: ['BKG-1'],
      lastCompiled: new Date('2026-07-01T00:00:00.000Z'), eligibleBookings: ['BKG-1'],
    };
    expect(creatorListToWire(c)).toEqual({
      brief_id: 'BRF-1', creator_list_link: 'https://drive/x', included_bookings: ['BKG-1'],
      last_compiled: '2026-07-01T00:00:00.000Z', eligible_bookings: ['BKG-1'],
    });
  });
});

describe('sessionToWire', () => {
  const base: livestream.Session = {
    id: 'LSS-202608-0001',
    briefId: 'BRF-202608-0001',
    platform: 'TikTok Shop Live',
    requestedDatetime: new Date('2026-08-01T15:00:00.000Z'),
    targetDurationHours: 2,
    productsTalent: '',
    specialInstructions: '',
    status: '[Requested]',
    actualDatetime: null,
    actualDurationHours: null,
    viewersPeak: null,
    viewersAvg: null,
    ordersGenerated: null,
    gmv: null,
    gmvDisplay: '',
    vendorReportLink: '',
    reconciliationNotes: '',
    dataConfidenceTier: 'Vendor-Reported',
    createdBy: 'ZZ-AM',
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
  };

  it('maps a fresh [Requested] session, omitting every unset result field', () => {
    expect(sessionToWire(base)).toEqual({
      id: 'LSS-202608-0001',
      brief_id: 'BRF-202608-0001',
      platform: 'TikTok Shop Live',
      requested_datetime: '2026-08-01T15:00:00.000Z',
      target_duration_hours: 2,
      status: '[Requested]',
      data_confidence_tier: 'Vendor-Reported',
      created_by: 'ZZ-AM',
      created_at: '2026-07-25T00:00:00.000Z',
    });
  });

  it('maps a [Completed] session: gmv as a raw number + pre-formatted gmv_display', () => {
    const wire = sessionToWire({
      ...base,
      status: '[Completed]',
      productsTalent: 'Skincare',
      actualDatetime: new Date('2026-08-01T15:05:00.000Z'),
      actualDurationHours: 2.5,
      viewersPeak: 1200,
      ordersGenerated: 150,
      gmv: '5000000.00',
      gmvDisplay: 'Rp. 5.000.000,00',
      vendorReportLink: 'https://vendor/report/1',
    });
    expect(wire.gmv).toBe(5000000); // raw rupiah number for calc/sort
    expect(wire.gmv_display).toBe('Rp. 5.000.000,00'); // never reformatted in FE
    expect(wire.actual_datetime).toBe('2026-08-01T15:05:00.000Z');
    expect(wire.actual_duration_hours).toBe(2.5);
    expect(wire.viewers_peak).toBe(1200);
    expect(wire).not.toHaveProperty('viewers_avg'); // still unset → omitted
    expect(wire.orders_generated).toBe(150);
    expect(wire.products_talent).toBe('Skincare');
    expect(wire.vendor_report_link).toBe('https://vendor/report/1');
  });

  it('keeps orders_generated: 0 (a real zero is not "unset")', () => {
    expect(sessionToWire({ ...base, ordersGenerated: 0 }).orders_generated).toBe(0);
  });
});

describe('M3 campaign wire mappers', () => {
  it('marketingCampaignToWire maps a Campaign (owner→owner_employee_id, nullable end_date)', () => {
    const c: campaign.Campaign = {
      id: 'CMP-202603-0001', name: 'Promo', channel: 'TikTok Ads', online: true, offline: false,
      startDate: '2026-03-02', endDate: null, owner: 'EMP-LIA', status: 'Draft',
      createdBy: 'EMP-LIA', createdAt: new Date('2026-03-01T00:00:00.000Z'),
    };
    expect(marketingCampaignToWire(c)).toEqual({
      id: 'CMP-202603-0001', name: 'Promo', channel: 'TikTok Ads', online: true, offline: false,
      start_date: '2026-03-02', end_date: null, owner_employee_id: 'EMP-LIA', status: 'Draft',
      created_by: 'EMP-LIA', created_at: '2026-03-01T00:00:00.000Z',
    });
    expect(marketingCampaignToWire({ ...c, endDate: '2026-03-31' }).end_date).toBe('2026-03-31');
  });

  it('campaignRollupToWire maps the derived funnel', () => {
    const r: campaign.Rollup = {
      campaignId: 'CMP-1', leadsGenerated: 3, realLeads: 1, clientsWon: 2,
      totalValueWon: '26900000.00', totalValueWonIdr: 'Rp. 26.900.000,00',
    };
    expect(campaignRollupToWire(r)).toEqual({
      campaign_id: 'CMP-1', leads_generated: 3, real_leads: 1, clients_won: 2,
      total_value_won: '26900000.00', total_value_won_idr: 'Rp. 26.900.000,00',
    });
  });
});

describe('M2 marketing wire mappers', () => {
  it('performanceRecordToWire maps the record', () => {
    const r: marketing.Record = {
      campaignId: 'CMP-1', budget: '5000000.00', budgetIdr: 'Rp. 5.000.000,00',
      online: true, offline: false, createdBy: 'EMP-LIA',
    };
    expect(performanceRecordToWire(r)).toEqual({
      campaign_id: 'CMP-1', budget: '5000000.00', budget_idr: 'Rp. 5.000.000,00',
      online: true, offline: false, created_by: 'EMP-LIA',
    });
  });

  it('marketingMetricsToWire maps every metric field incl. junk breakdown', () => {
    const m: marketing.Metrics = {
      campaignId: 'CMP-1', online: true, offline: false, budget: '5000000.00', budgetIdr: 'Rp. 5.000.000,00',
      leadByDashboard: 46, leadRealBySales: 12, leadQualityRate: '26%',
      attributedSales: 'Rp. 21.900.000,00', attributedSalesDecimal: '21900000.00',
      costPerLead: 'Rp. 108.695,00', costPerRealLead: 'Rp. 416.666,00', roas: '4.38',
      collectedSales: 'Rp. 4.000.000,00', collectedSalesDecimal: '4000000.00', collectedRoas: '0.80',
      junkBreakdown: [{ reason: '[Bukan seller]', count: 2 }],
    };
    expect(marketingMetricsToWire(m)).toEqual({
      campaign_id: 'CMP-1', online: true, offline: false, budget: '5000000.00', budget_idr: 'Rp. 5.000.000,00',
      lead_by_dashboard: 46, lead_real_by_sales: 12, lead_quality_rate: '26%',
      attributed_sales: 'Rp. 21.900.000,00', attributed_sales_decimal: '21900000.00',
      cost_per_lead: 'Rp. 108.695,00', cost_per_real_lead: 'Rp. 416.666,00', roas: '4.38',
      collected_sales: 'Rp. 4.000.000,00', collected_sales_decimal: '4000000.00', collected_roas: '0.80',
      junk_breakdown: [{ reason: '[Bukan seller]', count: 2 }],
    });
  });
});

describe('notification wire mappers (C-02)', () => {
  const read: notification.Notification = {
    id: '9007199254740993', // beyond Number.MAX_SAFE_INTEGER — must stay a string
    eventType: 'm0.negotiation.decision',
    entityType: 'attempt',
    entityId: 'PRSP-202607-0001',
    deepLink: '/attempts/PRSP-202607-0001',
    actor: 'EMP-SPV',
    createdAt: new Date('2026-07-28T03:00:00.000Z'),
    readAt: new Date('2026-07-28T04:30:00.000Z'),
  };

  it('notificationToWire maps every field, ids as strings and dates as ISO', () => {
    expect(notificationToWire(read)).toEqual({
      id: '9007199254740993',
      event_type: 'm0.negotiation.decision',
      entity_type: 'attempt',
      entity_id: 'PRSP-202607-0001',
      deep_link: '/attempts/PRSP-202607-0001',
      actor: 'EMP-SPV',
      created_at: '2026-07-28T03:00:00.000Z',
      read_at: '2026-07-28T04:30:00.000Z',
    });
  });

  it('an unread row carries read_at: null, not an omitted key', () => {
    const wire = notificationToWire({ ...read, readAt: null });
    expect(wire.read_at).toBeNull();
    expect('read_at' in wire).toBe(true);
  });

  it('inboxToWire builds the { data, unread_count } envelope the FE expects', () => {
    expect(inboxToWire({ items: [read], unreadCount: 3 })).toEqual({
      data: [notificationToWire(read)],
      unread_count: 3,
    });
    expect(inboxToWire({ items: [], unreadCount: 0 })).toEqual({ data: [], unread_count: 0 });
  });
});

describe('M0 quote preview wire mapper (C-03 finding)', () => {
  const quote: sales.Quote = {
    lines: [
      {
        serviceId: 'MSV-202607-0001',
        name: 'Shopee Ads Management',
        quantity: 2,
        unit: 'bulan',
        standardPriceIdr: 'Rp. 3.500.000,00',
        komisiIdr: 'Rp. 350.000,00',
        subtotalIdr: 'Rp. 7.000.000,00',
      },
    ],
    // bigint — JSON.stringify throws on these; the mapper must drop them.
    estimasiNilai: 7_000_000n,
    totalKomisi: 350_000n,
    estimasiNilaiIdr: 'Rp. 7.000.000,00',
    totalKomisiIdr: 'Rp. 350.000,00',
  };

  it('maps to the snake_case shape web-internal declares', () => {
    expect(quoteToWire(quote)).toEqual({
      lines: [
        {
          service_id: 'MSV-202607-0001',
          name: 'Shopee Ads Management',
          quantity: 2,
          unit: 'bulan',
          standard_price_idr: 'Rp. 3.500.000,00',
          komisi_idr: 'Rp. 350.000,00',
          subtotal_idr: 'Rp. 7.000.000,00',
        },
      ],
      estimasi_nilai_idr: 'Rp. 7.000.000,00',
      total_komisi_idr: 'Rp. 350.000,00',
    });
  });

  it('is JSON-serializable — the raw domain Quote is NOT (the actual bug)', () => {
    // Guards the regression: returning the domain object produced a 500
    // "Do not know how to serialize a BigInt" on every successful quote.
    expect(() => JSON.stringify(quote)).toThrow(TypeError);
    expect(() => JSON.stringify(quoteToWire(quote))).not.toThrow();
  });

  it('exposes no raw money scalar (house rule #4 — Go marks them json:"-")', () => {
    const wire = quoteToWire(quote) as unknown as Record<string, unknown>;
    expect('estimasiNilai' in wire).toBe(false);
    expect('totalKomisi' in wire).toBe(false);
    expect(JSON.stringify(wire)).not.toMatch(/7000000|350000(?!,)/);
  });
});

describe('M4 clientDetailToWire (O41 #1 — the Client Record contract)', () => {
  const detail: sales.ClientDetail = {
    id: 'CLI-202607-0001',
    leadId: 'LEAD-202607-0001',
    winningAttemptId: 'ATT-202607-0001',
    namaPic: 'Ibu Alpha',
    toko: 'Alpha Digital',
    kota: 'Jakarta',
    linkToko: 'https://shopee/alpha',
    kategori: 'Fashion',
    gmvBaseline: '50000000.00',
    targetGmv: '80000000.00',
    marketingBudget: '15000000.00',
    totalSales: '9000000.00',
    transactionId: 'TRX-202607-0001',
    originCampaignId: null,
    salesPicId: 'EMP-BUDI',
    salesPicNama: 'Budi',
    commissionPaymentPicId: 'EMP-BUDI',
    paymentIntent: '[Termin]',
    releasedToAccountAt: null,
    createdAt: new Date('2026-07-01T03:00:00.000Z'),
    platforms: [
      { platform: 'Shopee', storeLink: 'https://shopee/alpha', managedSince: new Date('2026-05-01T00:00:00.000Z'), active: true },
      { platform: 'TikTok Shop', storeLink: null, managedSince: null, active: false },
    ],
    allocations: [{ salespersonId: 'EMP-BUDI', salespersonNama: 'Budi', basisPoints: 10000 }],
    services: [{
      id: 'SVC-202607-0001', masterServiceId: 'MSV-202607-0001', name: 'Shopee Ads Management',
      standardPrice: '9000000.00', commissionRule: '10% of standard price', status: 'Ongoing',
      requiresStrategyPlan: true,
    }],
    transaction: null,
  };

  it('maps to the snake_case shape web-internal declares, money as IDR strings', () => {
    expect(clientDetailToWire(detail)).toEqual({
      id: 'CLI-202607-0001',
      nama_pic: 'Ibu Alpha',
      toko: 'Alpha Digital',
      kota: 'Jakarta',
      kategori: 'Fashion',
      link_toko: 'https://shopee/alpha',
      gmv_baseline: 'Rp. 50.000.000,00',
      target_gmv: 'Rp. 80.000.000,00',
      total_sales: 'Rp. 9.000.000,00',
      marketing_budget: 'Rp. 15.000.000,00',
      origin_campaign_id: '',
      sales_pic_id: 'EMP-BUDI',
      commission_payment_pic_id: 'EMP-BUDI',
      transaction_id: 'TRX-202607-0001',
      payment_intent: '[Termin]',
      released_to_account_at: null,
      platforms: [
        { platform: 'Shopee', store_link: 'https://shopee/alpha', managed_since: '2026-05-01T00:00:00.000Z', active: true },
        { platform: 'TikTok Shop', store_link: undefined, managed_since: null, active: false },
      ],
      sales_allocation: [{ salesperson_id: 'EMP-BUDI', basis_points: 10000 }],
      services: [{
        id: 'SVC-202607-0001', master_service_id: 'MSV-202607-0001', name: 'Shopee Ads Management',
        standard_price: 'Rp. 9.000.000,00', status: 'Ongoing',
      }],
    });
  });

  it('emits every key the FE `Client` type declares — the actual O41 #1 defect', () => {
    // Returning the raw domain object gave the FE camelCase keys, so every field
    // on the Client Record page read `undefined`. Assert the contract by name.
    const wire = clientDetailToWire(detail) as unknown as Record<string, unknown>;
    for (const key of [
      'id', 'nama_pic', 'toko', 'kota', 'link_toko', 'kategori', 'gmv_baseline', 'target_gmv',
      'total_sales', 'marketing_budget', 'origin_campaign_id', 'sales_pic_id',
      'commission_payment_pic_id', 'transaction_id', 'payment_intent', 'released_to_account_at',
      'platforms', 'sales_allocation', 'services',
    ]) {
      expect(wire).toHaveProperty(key);
    }
    // …and none of the camelCase originals leak through.
    for (const leaked of ['namaPic', 'linkToko', 'gmvBaseline', 'targetGmv', 'totalSales', 'transactionId', 'paymentIntent']) {
      expect(leaked in wire).toBe(false);
    }
  });

  it('drops the keys Go clientView does not have (no lead/attempt/PIC-name leak)', () => {
    const wire = clientDetailToWire(detail) as unknown as Record<string, unknown>;
    for (const absent of ['lead_id', 'winning_attempt_id', 'sales_pic_nama', 'created_at', 'transaction']) {
      expect(absent in wire).toBe(false);
    }
  });

  it('nullable money stays null; a null origin campaign / intent becomes an empty string', () => {
    const wire = clientDetailToWire({
      ...detail, marketingBudget: null, paymentIntent: null, transactionId: null, releasedToAccountAt: new Date('2026-07-05T09:30:00.000Z'),
    });
    expect(wire.marketing_budget).toBeNull();
    expect(wire.payment_intent).toBe('');
    expect(wire.transaction_id).toBe('');
    expect(wire.released_to_account_at).toBe('2026-07-05T09:30:00.000Z');
  });

  it('renders zero money as Rp. 0,00 rather than throwing or emitting a bare 0', () => {
    const wire = clientDetailToWire({ ...detail, totalSales: '0.00', gmvBaseline: '0' });
    expect(wire.total_sales).toBe('Rp. 0,00');
    expect(wire.gmv_baseline).toBe('Rp. 0,00');
  });
});

describe('M4 clientListRowToWire (the roster page read res.data)', () => {
  const row: client.ClientListRow = {
    id: 'CLI-202607-0001',
    toko: 'Alpha Digital',
    namaPic: 'Ibu Alpha',
    kota: 'Jakarta',
    kategori: 'Fashion',
    salesPicId: 'EMP-BUDI',
    salesPicNama: 'Budi',
    assignedAmId: null,
    paymentIntent: '[Termin]',
    releasedToAccountAt: null,
    createdAt: new Date('2026-07-01T03:00:00.000Z'),
  };

  it('maps to snake_case', () => {
    expect(clientListRowToWire(row)).toEqual({
      id: 'CLI-202607-0001',
      toko: 'Alpha Digital',
      nama_pic: 'Ibu Alpha',
      kota: 'Jakarta',
      kategori: 'Fashion',
      sales_pic_id: 'EMP-BUDI',
      sales_pic_nama: 'Budi',
      assigned_am_id: null,
      payment_intent: '[Termin]',
      released_to_account_at: null,
      created_at: '2026-07-01T03:00:00.000Z',
    });
  });

  it('covers every field the roster page renders', () => {
    const wire = clientListRowToWire(row) as unknown as Record<string, unknown>;
    for (const key of ['id', 'toko', 'kota', 'kategori', 'sales_pic_id', 'payment_intent', 'released_to_account_at']) {
      expect(wire).toHaveProperty(key);
    }
  });

  it('a client with no intent yet renders as an empty string, not null', () => {
    expect(clientListRowToWire({ ...row, paymentIntent: null }).payment_intent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Admin plane (O44) — the shapes the two previously-dead admin pages read.
// ---------------------------------------------------------------------------

describe('adminEmployeeToWire', () => {
  const row: admin.EmployeeRow = {
    employeeId: '2504240539',
    nama: 'NIKEN SEPTA ARISANDHY',
    email: 'arisandhyyy@gmail.com',
    divisi: 'BUSINESS DEVELOPMENT',
    jabatan: 'MARKETING STRATEGIST',
    statusAktif: true,
    flagged: false,
    syncedAt: new Date('2026-07-29T02:00:00Z'),
  };

  it('emits snake_case with the date as an ISO string', () => {
    expect(adminEmployeeToWire(row)).toEqual({
      employee_id: '2504240539',
      nama: 'NIKEN SEPTA ARISANDHY',
      email: 'arisandhyyy@gmail.com',
      divisi: 'BUSINESS DEVELOPMENT',
      jabatan: 'MARKETING STRATEGIST',
      status_aktif: true,
      flagged: false,
      synced_at: '2026-07-29T02:00:00.000Z',
    });
  });

  it('covers every field the Karyawan page renders', () => {
    // O43's lesson: a MISSING key is what blanks a page, so assert presence of
    // exactly what the table body reads.
    const wire = adminEmployeeToWire(row) as unknown as Record<string, unknown>;
    for (const key of ['employee_id', 'nama', 'email', 'divisi', 'jabatan', 'status_aktif', 'flagged']) {
      expect(wire).toHaveProperty(key);
    }
  });

  it('a never-synced employee renders synced_at as null, not a bogus date', () => {
    expect(adminEmployeeToWire({ ...row, syncedAt: null }).synced_at).toBeNull();
  });
});

describe('roleMappingToWire', () => {
  const m: admin.RoleMapping = {
    id: '31',
    divisi: 'BUSINESS DEVELOPMENT',
    jabatan: 'MARKETING STRATEGIST',
    division: 'Marketing',
    level: 'staff',
    createdAt: new Date('2026-07-29T02:00:00Z'),
  };

  it('keeps id a STRING — it is a bigint (the C03-F2 class of bug)', () => {
    const wire = roleMappingToWire(m);
    expect(wire.id).toBe('31');
    expect(typeof wire.id).toBe('string');
  });

  it('emits every field the role-mappings page renders', () => {
    expect(roleMappingToWire(m)).toEqual({
      id: '31',
      divisi: 'BUSINESS DEVELOPMENT',
      jabatan: 'MARKETING STRATEGIST',
      division: 'Marketing',
      level: 'staff',
      created_at: '2026-07-29T02:00:00.000Z',
    });
  });
});

describe('layeredRoleToWire', () => {
  it('emits snake_case with a string id', () => {
    const wire = layeredRoleToWire({
      id: '7',
      employeeId: '2409200431',
      role: 'od',
      enabled: true,
      createdAt: new Date('2026-07-29T02:00:00Z'),
    });
    expect(wire).toEqual({
      id: '7',
      employee_id: '2409200431',
      role: 'od',
      enabled: true,
      created_at: '2026-07-29T02:00:00.000Z',
    });
    expect(typeof wire.id).toBe('string');
  });
});
