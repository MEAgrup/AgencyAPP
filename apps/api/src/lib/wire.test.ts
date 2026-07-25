/**
 * Unit tests for the wire mappers (camelCase domain → snake_case FE contract).
 * No DB, no Next — pure shape translation.
 */
import { describe, expect, it } from 'vitest';
import type { account, ads, creative, kol, leads, livestream, msl, task } from '@cdps/domain';
import {
  amWorkloadToWire,
  assetToWire,
  assignmentToWire,
  attemptStubToWire,
  blockRequestToWire,
  briefToWire,
  complaintToWire,
  intakeClientToWire,
  leadDetailToWire,
  leadRowToWire,
  leadStubToWire,
  bookingToWire,
  campaignToWire,
  creatorListToWire,
  masterServiceToWire,
  metricEntryToWire,
  metricsToWire,
  optimizationToWire,
  pendingBlockRequestToWire,
  poolRowToWire,
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
