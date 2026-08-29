/**
 * PAKET A — field-by-field parity for the 25 delivery-path wire mappers
 * (board · tasks · creative · ads · kol · livestream · health · performance).
 *
 * These are the "converter EXISTS but a field might be wrong/missing" class
 * (O43 Fase 2 class 2). The route already answers 200, so route-parity stays
 * green even when a page blanks — nothing here fails until a key drifts. Each
 * block locks the FULL snake_case shape with `toEqual` plus a recursive
 * "no camelCase key anywhere in the tree" assertion, so a future rename or a
 * dropped field is caught at unit-test time rather than on a blank page.
 *
 * New file on purpose: the parallel commerce session owns wire.commerce.test.ts
 * and the shared wire.test.ts is not edited by either account (see
 * docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md §3.1).
 *
 * Oracle for key names & nullability: the json tags in backend/internal/moduleN.
 * Oracle for a key's PRESENCE (absent vs explicit null): the web-internal FE
 * type it serves — a MISSING key blanks the page, an explicit null does not
 * (O43 lesson), so where the FE declares `x | null` we send null and where it
 * declares `x?` we omit. This is the one deliberate divergence from Go's
 * `omitempty` (logged in docs/DECISIONS.md).
 */
import { describe, expect, it } from 'vitest';
import type { account, ads, board, creative, health, kol, livestream, performance, task } from '@cdps/domain';
import {
  assetToWire,
  blockRequestToWire,
  bookingMetricsToWire,
  bookingToWire,
  briefToWire,
  campaignToWire,
  cardToWire,
  complaintToWire,
  creatorListToWire,
  dailyOutputToWire,
  dependencyToWire,
  healthScanResultToWire,
  healthSnapshotToWire,
  metricEntryToWire,
  metricsToWire,
  optimizationToWire,
  paymentRequestToWire,
  pendingBlockRequestToWire,
  perfSnapshotToWire,
  perfTargetToWire,
  perfTeamRollupToWire,
  perfWeightToWire,
  roasToggleToWire,
  scanHoursReminderResultToWire,
  sessionToWire,
} from './wire';

/**
 * Recursively assert that no object key anywhere in a wire tree carries an
 * uppercase letter — the tell of a camelCase domain key leaking through the
 * mapper. Arrays and nested objects are walked; primitives are ignored.
 */
function expectNoCamelKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectNoCamelKeys(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(key, `key "${key}" is not snake_case`).not.toMatch(/[A-Z]/);
      expectNoCamelKeys(child);
    }
  }
}

// ---------------------------------------------------------------------------
// M11 Board — cardToWire · dependencyToWire (views.go Card, board.go Dependency)
// ---------------------------------------------------------------------------

describe('M11 cardToWire (Client Board / My Tasks card)', () => {
  const full: board.Card = {
    id: 'BRF-202607-0001',
    type: 'brief',
    division: 'Creative',
    clientId: 'CLI-202607-0001',
    briefId: 'BRF-202607-0001',
    pic: '2409230432',
    nativeStatus: '[In Progress]',
    universalColumn: 'In Progress',
    dueDate: '2026-07-25',
    overdue: true,
    dependencyBadge: 'Menunggu Dependency',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Card field to its snake_case wire key', () => {
    expect(cardToWire(full)).toEqual({
      id: 'BRF-202607-0001',
      type: 'brief',
      division: 'Creative',
      client_id: 'CLI-202607-0001',
      brief_id: 'BRF-202607-0001',
      pic: '2409230432',
      native_status: '[In Progress]',
      universal_column: 'In Progress',
      due_date: '2026-07-25',
      overdue: true,
      dependency_badge: 'Menunggu Dependency',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(cardToWire(full));
  });

  it('emits the four formerly-omitempty keys as explicit null when empty (M11-G3), never dropping them', () => {
    // M11-G3: Go marks pic/due_date/dependency_badge/created_at omitempty, but the
    // house rule forbids omitempty — a MISSING key is what blanks a page (O43), so
    // each is emitted explicitly as `null`. overdue has no omitempty and is always
    // present even when false.
    const bare: board.Card = {
      id: 'AST-202607-0001', type: 'asset', division: 'Creative',
      clientId: 'CLI-202607-0001', briefId: 'BRF-202607-0001',
      pic: '', nativeStatus: '[To Do]', universalColumn: 'To Do',
      dueDate: '', overdue: false, dependencyBadge: '', createdAt: null,
    };
    const wire = cardToWire(bare) as unknown as Record<string, unknown>;
    expect('pic' in wire).toBe(true);
    expect(wire.pic).toBeNull();
    expect('due_date' in wire).toBe(true);
    expect(wire.due_date).toBeNull();
    expect('dependency_badge' in wire).toBe(true);
    expect(wire.dependency_badge).toBeNull();
    expect('created_at' in wire).toBe(true);
    expect(wire.created_at).toBeNull();
    expect('overdue' in wire).toBe(true);
    expect(wire.overdue).toBe(false);
  });
});

describe('M11 dependencyToWire (DEP- row + derived status)', () => {
  const full: board.Dependency = {
    id: 'DEP-202607-0001',
    sourceType: 'brief',
    sourceId: 'BRF-202607-0001',
    targetType: 'brief',
    targetId: 'BRF-202607-0002',
    type: 'Blocking',
    note: 'menunggu aset kreatif',
    clientId: 'CLI-202607-0001',
    status: 'Blocking',
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Dependency field to its snake_case wire key', () => {
    expect(dependencyToWire(full)).toEqual({
      id: 'DEP-202607-0001',
      source_type: 'brief',
      source_id: 'BRF-202607-0001',
      target_type: 'brief',
      target_id: 'BRF-202607-0002',
      type: 'Blocking',
      note: 'menunggu aset kreatif',
      client_id: 'CLI-202607-0001',
      status: 'Blocking',
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(dependencyToWire(full));
  });

  it('emits note as explicit null when empty (M11-G3), never dropping the key', () => {
    const wire = dependencyToWire({ ...full, note: '' }) as unknown as Record<string, unknown>;
    expect('note' in wire).toBe(true);
    expect(wire.note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M6 Brief / Complaint — briefToWire · complaintToWire (module6_account)
// ---------------------------------------------------------------------------

describe('M6 briefToWire (Brief entity — creative.ts/tasks.ts Brief)', () => {
  const full: account.Brief = {
    id: 'BRF-202607-0001',
    serviceId: 'SVC-202607-0001',
    strategyId: 'STR-202607-0001',
    assignedDivision: 'Creative',
    assignedPic: '2409230432',
    deliverableType: 'Feed Design',
    quantityTarget: 3,
    dueDate: '2026-07-25',
    priority: 'High',
    recurring: true,
    recurringFrequency: 'weekly',
    recurringCount: 4,
    recurringEndDate: '2026-08-25',
    instructions: 'ikuti brand guideline',
    referenceAttachments: 'https://drive/…',
    title: 'Konten Juli',
    status: '[In Progress]',
    revisionCount: 1,
    revisionFlagged: false,
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Brief field to its snake_case wire key', () => {
    expect(briefToWire(full)).toEqual({
      id: 'BRF-202607-0001',
      service_id: 'SVC-202607-0001',
      strategy_id: 'STR-202607-0001',
      assigned_division: 'Creative',
      assigned_pic: '2409230432',
      deliverable_type: 'Feed Design',
      quantity_target: 3,
      due_date: '2026-07-25',
      priority: 'High',
      recurring: true,
      recurring_frequency: 'weekly',
      recurring_count: 4,
      recurring_end_date: '2026-08-25',
      instructions: 'ikuti brand guideline',
      reference_attachments: 'https://drive/…',
      title: 'Konten Juli',
      status: '[In Progress]',
      revision_count: 1,
      revision_flagged: false,
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(briefToWire(full));
  });

  it('drops the seven omitempty keys on a bare non-recurring Brief', () => {
    const bare: account.Brief = {
      ...full, strategyId: '', assignedPic: '', recurring: false,
      recurringFrequency: '', recurringCount: 0, recurringEndDate: '',
      instructions: '', referenceAttachments: '',
    };
    const wire = briefToWire(bare) as unknown as Record<string, unknown>;
    for (const k of ['strategy_id', 'assigned_pic', 'recurring_frequency',
      'recurring_count', 'recurring_end_date', 'instructions', 'reference_attachments']) {
      expect(k in wire, `${k} should be omitted when empty`).toBe(false);
    }
    // recurring itself is never omitempty — the FE reads it unconditionally.
    expect(wire.recurring).toBe(false);
  });
});

describe('M6 complaintToWire (Complaint record)', () => {
  const full: account.Complaint = {
    id: 'CMP-202607-0001',
    clientId: 'CLI-202607-0001',
    relatedRef: 'BRF-202607-0001',
    source: 'Client',
    description: 'hasil tidak sesuai brief',
    severity: 'High',
    status: '[Open]',
    assignedTo: '2409230432',
    resolutionNotes: 'revisi dijadwalkan',
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Complaint field to its snake_case wire key', () => {
    expect(complaintToWire(full)).toEqual({
      id: 'CMP-202607-0001',
      client_id: 'CLI-202607-0001',
      related_ref: 'BRF-202607-0001',
      source: 'Client',
      description: 'hasil tidak sesuai brief',
      severity: 'High',
      status: '[Open]',
      assigned_to: '2409230432',
      resolution_notes: 'revisi dijadwalkan',
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(complaintToWire(full));
  });

  it('omits related_ref/assigned_to/resolution_notes when empty', () => {
    const wire = complaintToWire({ ...full, relatedRef: '', assignedTo: '', resolutionNotes: '' }) as unknown as Record<string, unknown>;
    expect('related_ref' in wire).toBe(false);
    expect('assigned_to' in wire).toBe(false);
    expect('resolution_notes' in wire).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M12 Task — metricsToWire · blockRequestToWire · pendingBlockRequestToWire
// ---------------------------------------------------------------------------

describe('M12 metricsToWire (recompute-from-log Task metrics)', () => {
  const full: task.Metrics = {
    briefId: 'BRF-202607-0001',
    status: '[Approved]',
    slaTargetHours: 48,
    turnaroundHours: 30.5,
    revisionTurnaroundHours: 4,
    speedScorePct: 112.5,
    speedScoreDisplay: '112.50%',
    revisionSlaTargetHours: 12,
    revisionSpeedScorePct: 75,
    revisionSpeedScoreDisplay: '75.00%',
    revisionCount: 1,
    revisionFlagged: false,
    approvedAt: new Date('2026-07-22T05:00:00Z'),
    approvedPeriodWib: '2026-07',
  };

  it('maps every Metrics field, all keys always present (no omitempty)', () => {
    expect(metricsToWire(full)).toEqual({
      brief_id: 'BRF-202607-0001',
      status: '[Approved]',
      sla_target_hours: 48,
      turnaround_hours: 30.5,
      revision_turnaround_hours: 4,
      speed_score_pct: 112.5,
      speed_score_display: '112.50%',
      revision_sla_target_hours: 12,
      revision_speed_score_pct: 75,
      revision_speed_score_display: '75.00%',
      revision_count: 1,
      revision_flagged: false,
      approved_at: '2026-07-22T05:00:00.000Z',
      approved_period_wib: '2026-07',
    });
    expectNoCamelKeys(metricsToWire(full));
  });

  it('sends explicit null (not a missing key) for a not-yet-measured task', () => {
    // Go's metrics pointers carry NO omitempty, so a nil metric arrives as JSON
    // null; the FE types every numeric metric `number | null`. A dropped key
    // would blank the metrics panel instead of showing "—".
    const wire = metricsToWire({
      ...full, slaTargetHours: null, turnaroundHours: null,
      revisionTurnaroundHours: null, speedScorePct: null,
      revisionSlaTargetHours: null, revisionSpeedScorePct: null, approvedAt: null,
    });
    expect(wire.sla_target_hours).toBeNull();
    expect(wire.turnaround_hours).toBeNull();
    expect(wire.speed_score_pct).toBeNull();
    expect(wire.approved_at).toBeNull();
    for (const k of ['sla_target_hours', 'turnaround_hours', 'speed_score_pct', 'approved_at']) {
      expect(k in (wire as unknown as Record<string, unknown>)).toBe(true);
    }
  });
});

describe('M12 blockRequestToWire (block-request POST result)', () => {
  const full: task.BlockRequest = {
    id: 'BRQ-202607-0001',
    entityId: 'BRF-202607-0001',
    reason: 'menunggu aset',
    status: '[Pending]',
    requestedBy: '2409230432',
    resolvedBy: '2409230411',
    resolvedAt: new Date('2026-07-20T02:00:00Z'),
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every BlockRequest field to its snake_case wire key', () => {
    expect(blockRequestToWire(full)).toEqual({
      id: 'BRQ-202607-0001',
      entity_id: 'BRF-202607-0001',
      reason: 'menunggu aset',
      status: '[Pending]',
      requested_by: '2409230432',
      resolved_by: '2409230411',
      resolved_at: '2026-07-20T02:00:00.000Z',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(blockRequestToWire(full));
  });

  it('sends resolved_by / resolved_at as explicit null while unresolved', () => {
    // Go marks both pointers WITHOUT omitempty; the FE types them `string|null`.
    const wire = blockRequestToWire({ ...full, resolvedBy: null, resolvedAt: null });
    expect(wire.resolved_by).toBeNull();
    expect(wire.resolved_at).toBeNull();
  });
});

describe('M12 pendingBlockRequestToWire (SPV/Lead approval queue row)', () => {
  const full: task.PendingBlockRequest = {
    id: 'BRQ-202607-0001',
    source: 'brief',
    entityId: 'BRF-202607-0001',
    division: 'Creative',
    clientId: 'CLI-202607-0001',
    reason: 'menunggu aset',
    requestedBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every PendingBlockRequest field to its snake_case wire key', () => {
    expect(pendingBlockRequestToWire(full)).toEqual({
      id: 'BRQ-202607-0001',
      source: 'brief',
      entity_id: 'BRF-202607-0001',
      division: 'Creative',
      client_id: 'CLI-202607-0001',
      reason: 'menunggu aset',
      requested_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(pendingBlockRequestToWire(full));
  });
});

// ---------------------------------------------------------------------------
// M7 Creative — assetToWire · dailyOutputToWire · scanHoursReminderResultToWire
// ---------------------------------------------------------------------------

describe('M7 assetToWire (Asset entity)', () => {
  const full: creative.Asset = {
    id: 'AST-202607-0001',
    briefId: 'BRF-202607-0001',
    assetType: 'Feed Design',
    sequenceNo: 1,
    assignedPic: '2409230432',
    outputLink: 'https://drive/asset',
    status: '[In Progress]',
    slaTargetHours: 48,
    revisionSlaHours: 12,
    hoursLogged: 6,
    attributedGmv: 5000000,
    revisionCount: 0,
    revisionFlagged: false,
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Asset field to its snake_case wire key', () => {
    expect(assetToWire(full)).toEqual({
      id: 'AST-202607-0001',
      brief_id: 'BRF-202607-0001',
      asset_type: 'Feed Design',
      sequence_no: 1,
      assigned_pic: '2409230432',
      output_link: 'https://drive/asset',
      status: '[In Progress]',
      sla_target_hours: 48,
      revision_sla_target_hours: 12,
      hours_logged: 6,
      attributed_gmv: 5000000,
      revision_count: 0,
      revision_flagged: false,
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(assetToWire(full));
  });

  it('omits the four *float64 omitempty keys when null, but keeps a recorded 0', () => {
    // Go marks sla/revision-sla/hours/gmv `*float64,omitempty`: nil is omitted,
    // but a recorded 0.0 is a non-nil pointer and IS sent (attributed_gmv:0
    // means "recorded, zero", distinct from "never recorded" == absent).
    const nulled = assetToWire({
      ...full, slaTargetHours: null, revisionSlaHours: null, hoursLogged: null, attributedGmv: null,
    }) as unknown as Record<string, unknown>;
    for (const k of ['sla_target_hours', 'revision_sla_target_hours', 'hours_logged', 'attributed_gmv']) {
      expect(k in nulled, `${k} should be omitted when null`).toBe(false);
    }
    const zeroed = assetToWire({ ...full, attributedGmv: 0 }) as unknown as Record<string, unknown>;
    expect('attributed_gmv' in zeroed).toBe(true);
    expect(zeroed.attributed_gmv).toBe(0);
  });
});

describe('M7 dailyOutputToWire (per-PIC WIB-day auto-logged output)', () => {
  const full: creative.DailyOutputDay = {
    pic: '2409230432',
    dateWib: '2026-07-19',
    locked: true,
    total: 2,
    approved: 1,
    entries: [{
      outputId: 42,
      pic: '2409230432',
      outputUnitType: 'Feed Design',
      assetId: 'AST-202607-0001',
      briefId: 'BRF-202607-0001',
      clientId: 'CLI-202607-0001',
      transition: '[Approved]',
      timestamp: new Date('2026-07-19T03:00:00Z'),
      dateWib: '2026-07-19',
      locked: true,
    }],
  };

  it('maps the day and its nested entries to snake_case', () => {
    expect(dailyOutputToWire(full)).toEqual({
      pic: '2409230432',
      date_wib: '2026-07-19',
      locked: true,
      total: 2,
      approved_count: 1,
      entries: [{
        output_id: 42,
        pic: '2409230432',
        output_unit_type: 'Feed Design',
        asset_id: 'AST-202607-0001',
        brief_id: 'BRF-202607-0001',
        client_id: 'CLI-202607-0001',
        transition: '[Approved]',
        timestamp: '2026-07-19T03:00:00.000Z',
        date_wib: '2026-07-19',
        locked: true,
      }],
    });
    expectNoCamelKeys(dailyOutputToWire(full));
  });
});

describe('M7 scanHoursReminderResultToWire (reminder sweep tally)', () => {
  it('maps remindersSent → reminders_sent', () => {
    const r: creative.ScanHoursReminderResult = { remindersSent: 3 };
    expect(scanHoursReminderResultToWire(r)).toEqual({ reminders_sent: 3 });
    expectNoCamelKeys(scanHoursReminderResultToWire(r));
  });
});

// ---------------------------------------------------------------------------
// M8 Ads — campaignToWire · metricEntryToWire · optimizationToWire
// ---------------------------------------------------------------------------

describe('M8 campaignToWire (Campaign + derived §5 performance view)', () => {
  const full: ads.Campaign = {
    id: 'CMP-202607-0001',
    briefId: 'BRF-202607-0001',
    clientId: 'CLI-202607-0001',
    platform: 'Shopee Ads',
    objective: 'Sales',
    budget: 10000000,
    budgetDisplay: 'Rp. 10.000.000,00',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    targetKpi: 'ROAS 4x',
    status: '[Active]',
    tipeIklan: 'GMV Max Product',
    additionalDays: 0,
    totalSpend: 8000000,
    totalSpendDisplay: 'Rp. 8.000.000,00',
    totalGmv: 31000000,
    totalGmvDisplay: 'Rp. 31.000.000,00',
    roas: 3.875,
    roasDisplay: '3.875x',
    linkedAssetIds: ['AST-202607-0001'],
    metricEntryCount: 4,
    optimizationCount: 2,
    underperformingStreak: 0,
    escalationFlagged: false,
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Campaign field to its snake_case wire key', () => {
    expect(campaignToWire(full)).toEqual({
      id: 'CMP-202607-0001',
      brief_id: 'BRF-202607-0001',
      client_id: 'CLI-202607-0001',
      platform: 'Shopee Ads',
      objective: 'Sales',
      budget: 10000000,
      budget_display: 'Rp. 10.000.000,00',
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      target_kpi: 'ROAS 4x',
      status: '[Active]',
      tipe_iklan: 'GMV Max Product',
      additional_days: 0,
      total_spend: 8000000,
      total_spend_display: 'Rp. 8.000.000,00',
      total_gmv: 31000000,
      total_gmv_display: 'Rp. 31.000.000,00',
      roas: 3.875,
      roas_display: '3.875x',
      linked_asset_ids: ['AST-202607-0001'],
      metric_entry_count: 4,
      optimization_count: 2,
      underperforming_streak: 0,
      escalation_flagged: false,
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(campaignToWire(full));
  });

  it('sends roas as explicit null when spend is zero (FE roas: number|null)', () => {
    const wire = campaignToWire({ ...full, roas: null, roasDisplay: '—' });
    expect(wire.roas).toBeNull();
    expect(wire.roas_display).toBe('—');
  });
});

describe('M8 metricEntryToWire (one recorded Metric Entry)', () => {
  const full: ads.MetricEntry = {
    id: 'AME-202607-0001',
    campaignId: 'CMP-202607-0001',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    spend: 2000000,
    gmv: 8000000,
    entryMethod: 'Manual',
    enteredBy: '2409230432',
    createdAt: new Date('2026-07-08T02:00:00Z'),
  };

  it('maps every MetricEntry field (no ctr/cvr — input-only, never read back)', () => {
    expect(metricEntryToWire(full)).toEqual({
      id: 'AME-202607-0001',
      campaign_id: 'CMP-202607-0001',
      period_start: '2026-07-01',
      period_end: '2026-07-07',
      spend: 2000000,
      gmv: 8000000,
      entry_method: 'Manual',
      entered_by: '2409230432',
      created_at: '2026-07-08T02:00:00.000Z',
    });
    expectNoCamelKeys(metricEntryToWire(full));
  });
});

describe('M8 optimizationToWire (OPT- log entry)', () => {
  const full: ads.Optimization = {
    id: 'OPT-202607-0001',
    campaignId: 'CMP-202607-0001',
    changeType: 'Budget',
    beforeValue: '5000000',
    afterValue: '10000000',
    reason: 'scale winner',
    actor: '2409230432',
    createdAt: new Date('2026-07-10T02:00:00Z'),
  };

  it('maps every Optimization field to its snake_case wire key', () => {
    expect(optimizationToWire(full)).toEqual({
      id: 'OPT-202607-0001',
      campaign_id: 'CMP-202607-0001',
      change_type: 'Budget',
      before_value: '5000000',
      after_value: '10000000',
      reason: 'scale winner',
      actor: '2409230432',
      created_at: '2026-07-10T02:00:00.000Z',
    });
    expectNoCamelKeys(optimizationToWire(full));
  });
});

// ---------------------------------------------------------------------------
// M9 KOL — bookingToWire · paymentRequestToWire · bookingMetricsToWire ·
//          creatorListToWire
// ---------------------------------------------------------------------------

describe('M9 bookingToWire (Creator Booking + derived fields)', () => {
  const full: kol.Booking = {
    id: 'BKG-202607-0001',
    briefId: 'BRF-202607-0001',
    creatorName: 'Selebgram A',
    creatorHandle: '@selebgram_a',
    platform: 'TikTok',
    niche: 'Fashion',
    sourcePool: 'MCN MEA Roster',
    poolReference: 'ROSTER-12',
    agreedRate: 1500000,
    agreedRateDisplay: 'Rp. 1.500.000,00',
    status: '[QC Passed]',
    contentLink: 'https://tiktok/x',
    qcNotes: 'ok',
    slaTargetHours: 72,
    hoursLogged: 10,
    assignedCoordinator: '2409230432',
    attributedGmv: 4000000,
    qtyVideo: 3,
    qtyLive: 1,
    revisionCount: 0,
    paymentStatus: '[Paid]',
    sourcingStallFlagged: false,
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps every Booking field to its snake_case wire key', () => {
    expect(bookingToWire(full)).toEqual({
      id: 'BKG-202607-0001',
      brief_id: 'BRF-202607-0001',
      creator_name: 'Selebgram A',
      creator_handle: '@selebgram_a',
      platform: 'TikTok',
      niche: 'Fashion',
      source_pool: 'MCN MEA Roster',
      pool_reference: 'ROSTER-12',
      agreed_rate: 1500000,
      agreed_rate_display: 'Rp. 1.500.000,00',
      status: '[QC Passed]',
      content_link: 'https://tiktok/x',
      qc_notes: 'ok',
      sla_target_hours: 72,
      hours_logged: 10,
      assigned_coordinator: '2409230432',
      attributed_gmv: 4000000,
      qty_video: 3,
      qty_live: 1,
      revision_count: 0,
      payment_status: '[Paid]',
      sourcing_stall_flagged: false,
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(bookingToWire(full));
  });

  it('omits the omitempty optionals, but always sends revision_count and payment_status', () => {
    const bare: kol.Booking = {
      ...full, creatorHandle: '', niche: '', poolReference: '', contentLink: '',
      qcNotes: '', slaTargetHours: null, hoursLogged: null, assignedCoordinator: '',
      attributedGmv: null, paymentStatus: '',
    };
    const wire = bookingToWire(bare) as unknown as Record<string, unknown>;
    for (const k of ['creator_handle', 'niche', 'pool_reference', 'content_link',
      'qc_notes', 'sla_target_hours', 'hours_logged', 'assigned_coordinator', 'attributed_gmv']) {
      expect(k in wire, `${k} should be omitted when empty/null`).toBe(false);
    }
    // payment_status carries no omitempty in Go (§8 Rule 4: "" if none) and the
    // FE reads it unconditionally — it must be present even as "".
    expect('payment_status' in wire).toBe(true);
    expect(wire.payment_status).toBe('');
    expect(wire.revision_count).toBe(0);
    // qty_video/qty_live carry a DB default (0) — always present, never omitempty.
    expect('qty_video' in wire).toBe(true);
    expect('qty_live' in wire).toBe(true);
    // sourcing_stall_flagged is a derived bool — always present (C6a).
    expect('sourcing_stall_flagged' in wire).toBe(true);
  });
});

describe('M9 paymentRequestToWire (Creator Payment Request)', () => {
  const full: kol.PaymentRequest = {
    id: 'CPR-202607-0001',
    bookingId: 'BKG-202607-0001',
    amount: 1500000,
    amountDisplay: 'Rp. 1.500.000,00',
    paymentDetails: 'BCA 123',
    status: '[Paid]',
    rejectionReason: '',
    requestedBy: '2409230432',
    paidBy: '2409230411',
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps a Paid request (paid_by present, rejection_reason omitted)', () => {
    expect(paymentRequestToWire(full)).toEqual({
      id: 'CPR-202607-0001',
      booking_id: 'BKG-202607-0001',
      amount: 1500000,
      amount_display: 'Rp. 1.500.000,00',
      payment_details: 'BCA 123',
      status: '[Paid]',
      requested_by: '2409230432',
      paid_by: '2409230411',
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(paymentRequestToWire(full));
  });

  it('sends rejection_reason and omits paid_by on a Rejected request', () => {
    const wire = paymentRequestToWire({
      ...full, status: '[Rejected]', rejectionReason: 'detail salah', paidBy: '',
    }) as unknown as Record<string, unknown>;
    expect(wire.rejection_reason).toBe('detail salah');
    expect('paid_by' in wire).toBe(false);
  });
});

describe('M9 bookingMetricsToWire (recompute-from-log Booking metrics)', () => {
  const full: kol.BookingMetrics = {
    bookingId: 'BKG-202607-0001',
    status: '[QC Passed]',
    slaTargetHours: 72,
    sourcingTurnaroundHours: 20,
    deliveryTurnaroundHours: 30,
    overallTurnaroundHours: 50,
    speedScorePct: 112.5,
    speedScoreDisplay: '112.50%',
    revisionCount: 0,
    excludedFromSpeedScore: false,
    approvedPeriodWib: '2026-07',
  };

  it('maps every BookingMetrics field, all present (no omitempty)', () => {
    expect(bookingMetricsToWire(full)).toEqual({
      booking_id: 'BKG-202607-0001',
      status: '[QC Passed]',
      sla_target_hours: 72,
      sourcing_turnaround_hours: 20,
      delivery_turnaround_hours: 30,
      overall_turnaround_hours: 50,
      speed_score_pct: 112.5,
      speed_score_display: '112.50%',
      revision_count: 0,
      excluded_from_speed_score: false,
      approved_period_wib: '2026-07',
    });
    expectNoCamelKeys(bookingMetricsToWire(full));
  });

  it('sends explicit null for the *float64 turnaround/score fields when unset', () => {
    const wire = bookingMetricsToWire({
      ...full, slaTargetHours: null, sourcingTurnaroundHours: null,
      deliveryTurnaroundHours: null, overallTurnaroundHours: null, speedScorePct: null,
    });
    expect(wire.sla_target_hours).toBeNull();
    expect(wire.speed_score_pct).toBeNull();
  });
});

describe('M9 creatorListToWire (Brief-level compiled Creator List)', () => {
  const full: kol.CreatorList = {
    briefId: 'BRF-202607-0001',
    creatorListLink: 'https://sheet/list',
    includedBookings: ['BKG-202607-0001'],
    lastCompiled: new Date('2026-07-19T02:00:00Z'),
    eligibleBookings: ['BKG-202607-0001', 'BKG-202607-0002'],
  };

  it('maps every CreatorList field to its snake_case wire key', () => {
    expect(creatorListToWire(full)).toEqual({
      brief_id: 'BRF-202607-0001',
      creator_list_link: 'https://sheet/list',
      included_bookings: ['BKG-202607-0001'],
      last_compiled: '2026-07-19T02:00:00.000Z',
      eligible_bookings: ['BKG-202607-0001', 'BKG-202607-0002'],
    });
    expectNoCamelKeys(creatorListToWire(full));
  });

  it('omits creator_list_link but sends last_compiled:null before first compile', () => {
    // creator_list_link is omitempty in Go and `?` on the FE → omit when empty.
    // last_compiled is sent as explicit null (deliberate O43 divergence from
    // Go's omitempty): the KOL brief page reads it through a null-guarding
    // formatDateTime that renders "—", so a null is safe and unambiguous.
    const wire = creatorListToWire({ ...full, creatorListLink: '', lastCompiled: null }) as unknown as Record<string, unknown>;
    expect('creator_list_link' in wire).toBe(false);
    expect('last_compiled' in wire).toBe(true);
    expect(wire.last_compiled).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M10 Live Stream — sessionToWire
// ---------------------------------------------------------------------------

describe('M10 sessionToWire (Live Stream Session)', () => {
  const full: livestream.Session = {
    id: 'LSS-202607-0001',
    briefId: 'BRF-202607-0001',
    platform: 'TikTok Shop Live',
    requestedDatetime: new Date('2026-07-20T12:00:00Z'),
    targetDurationHours: 2,
    productsTalent: 'Produk A',
    specialInstructions: 'pakai script X',
    status: '[Reconciled]',
    actualDatetime: new Date('2026-07-20T12:05:00Z'),
    actualDurationHours: 2.5,
    viewersPeak: 1200,
    viewersAvg: 800,
    ordersGenerated: 45,
    gmv: '5000000.00',
    gmvDisplay: 'Rp. 5.000.000,00',
    vendorReportLink: 'https://vendor/report',
    reconciliationNotes: 'sesuai',
    dataConfidenceTier: 'Vendor-Reported',
    createdBy: '2409230432',
    createdAt: new Date('2026-07-19T02:00:00Z'),
  };

  it('maps a fully-reconciled Session (all result fields present)', () => {
    expect(sessionToWire(full)).toEqual({
      id: 'LSS-202607-0001',
      brief_id: 'BRF-202607-0001',
      platform: 'TikTok Shop Live',
      requested_datetime: '2026-07-20T12:00:00.000Z',
      target_duration_hours: 2,
      products_talent: 'Produk A',
      special_instructions: 'pakai script X',
      status: '[Reconciled]',
      actual_datetime: '2026-07-20T12:05:00.000Z',
      actual_duration_hours: 2.5,
      viewers_peak: 1200,
      viewers_avg: 800,
      orders_generated: 45,
      gmv: 5000000,
      gmv_display: 'Rp. 5.000.000,00',
      vendor_report_link: 'https://vendor/report',
      reconciliation_notes: 'sesuai',
      data_confidence_tier: 'Vendor-Reported',
      created_by: '2409230432',
      created_at: '2026-07-19T02:00:00.000Z',
    });
    expectNoCamelKeys(sessionToWire(full));
  });

  it('omits every result-only field on a freshly [Requested] session', () => {
    const requested: livestream.Session = {
      ...full, status: '[Requested]', productsTalent: '', specialInstructions: '',
      actualDatetime: null, actualDurationHours: null, viewersPeak: null,
      viewersAvg: null, ordersGenerated: null, gmv: null, gmvDisplay: '',
      vendorReportLink: '', reconciliationNotes: '',
    };
    const wire = sessionToWire(requested) as unknown as Record<string, unknown>;
    for (const k of ['products_talent', 'special_instructions', 'actual_datetime',
      'actual_duration_hours', 'viewers_peak', 'viewers_avg', 'orders_generated',
      'gmv', 'gmv_display', 'vendor_report_link', 'reconciliation_notes']) {
      expect(k in wire, `${k} should be omitted before results are logged`).toBe(false);
    }
    // The five always-present fields survive.
    expect(wire.requested_datetime).toBe('2026-07-20T12:00:00.000Z');
    expect(wire.data_confidence_tier).toBe('Vendor-Reported');
  });

  it('sends gmv as a raw number and gmv_display as the pre-formatted IDR string', () => {
    const wire = sessionToWire(full);
    expect(typeof wire.gmv).toBe('number');
    expect(wire.gmv).toBe(5000000);
    expect(wire.gmv_display).toBe('Rp. 5.000.000,00');
  });
});

// ---------------------------------------------------------------------------
// M13 Client Health — healthSnapshotToWire · roasToggleToWire · healthScanResultToWire
// ---------------------------------------------------------------------------

describe('M13 healthSnapshotToWire (CHR- snapshot / live preview)', () => {
  const component: health.Component = {
    name: 'gmv_growth',
    included: true,
    raw: 82.4,
    capped: 82.4,
    baseWeight: 30,
    effectiveWeight: 30,
    excludedReason: '',
  };
  const full: health.Snapshot = {
    id: 'CHR-202607-0001',
    clientId: 'CLI-202607-0001',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    finalHealthScore: 74.6,
    scoreDisplay: '74.60',
    band: 'Healthy',
    roasToggleState: true,
    components: [component],
    computedAt: new Date('2026-07-31T17:00:00Z'),
    computedBy: 'system',
    preview: false,
  };

  it('maps a stored snapshot (computed_at/computed_by present, excluded_reason omitted)', () => {
    expect(healthSnapshotToWire(full)).toEqual({
      id: 'CHR-202607-0001',
      client_id: 'CLI-202607-0001',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      final_health_score: 74.6,
      score_display: '74.60',
      band: 'Healthy',
      roas_toggle_state: true,
      components: [{
        name: 'gmv_growth',
        included: true,
        raw: 82.4,
        capped: 82.4,
        base_weight: 30,
        effective_weight: 30,
      }],
      computed_at: '2026-07-31T17:00:00.000Z',
      computed_by: 'system',
      preview: false,
    });
    expectNoCamelKeys(healthSnapshotToWire(full));
  });

  it('drops computed_at/computed_by on a live preview but keeps final_health_score:null', () => {
    // computed_* are omitempty in Go and `?` on the FE; final_health_score has
    // no omitempty and the FE types it `number|null` — an all-excluded snapshot
    // must still carry the key as null so the page renders "—".
    const preview = healthSnapshotToWire({
      ...full, id: '', finalHealthScore: null, scoreDisplay: '—', band: '',
      computedAt: null, computedBy: '', preview: true,
    }) as unknown as Record<string, unknown>;
    expect('computed_at' in preview).toBe(false);
    expect('computed_by' in preview).toBe(false);
    expect('final_health_score' in preview).toBe(true);
    expect(preview.final_health_score).toBeNull();
  });

  it('omits excluded_reason on an included component, sends it on an excluded one', () => {
    const excluded = healthSnapshotToWire({
      ...full, components: [{ ...component, included: false, raw: null, capped: null, effectiveWeight: 0, excludedReason: 'no data' }],
    });
    const c = excluded.components[0] as unknown as Record<string, unknown>;
    expect('excluded_reason' in c).toBe(true);
    expect(c.excluded_reason).toBe('no data');
    expect(c.raw).toBeNull();
    const includedC = healthSnapshotToWire(full).components[0] as unknown as Record<string, unknown>;
    expect('excluded_reason' in includedC).toBe(false);
  });
});

describe('M13 roasToggleToWire (ROAS inclusion toggle)', () => {
  const full: health.RoasToggle = {
    clientId: 'CLI-202607-0001',
    override: true,
    hasAds: true,
    hasActive: true,
    effective: true,
  };

  it('maps every field, keeping override as an explicit tri-state', () => {
    expect(roasToggleToWire(full)).toEqual({
      client_id: 'CLI-202607-0001',
      override: true,
      has_ads: true,
      has_active: true,
      effective: true,
    });
    expectNoCamelKeys(roasToggleToWire(full));
  });

  it('sends override:null when no override is set (FE override: boolean|null)', () => {
    const wire = roasToggleToWire({ ...full, override: null });
    expect(wire.override).toBeNull();
  });
});

describe('M13 healthScanResultToWire (monthly scan tally)', () => {
  it('maps the three counters to snake_case', () => {
    const r: health.ScanResult = { period: '202607', snapshotsMade: 12, bandDropsFlagged: 2 };
    expect(healthScanResultToWire(r)).toEqual({
      period: '202607',
      snapshots_made: 12,
      band_drops_flagged: 2,
    });
    expectNoCamelKeys(healthScanResultToWire(r));
  });
});

// ---------------------------------------------------------------------------
// M14 Team Performance — perfSnapshotToWire · perfTeamRollupToWire ·
//                        perfWeightToWire · perfTargetToWire
// ---------------------------------------------------------------------------

describe('M14 perfSnapshotToWire (Team-member Performance snapshot)', () => {
  const component: performance.Component = {
    name: 'speed_score',
    included: true,
    diagnostic: false,
    raw: 90,
    capped: 90,
    baseWeight: 40,
    effectiveWeight: 40,
    excludedReason: '',
  };
  const modifier: performance.Modifier = {
    present: true,
    value: 5,
    sourceComponent: 'roas_attainment',
    sourceClients: ['CLI-202607-0001'],
    rawAverage: 82.5,
  };
  const full: performance.Snapshot = {
    id: 'PERF-202607-0001',
    staffId: '2409230432',
    roleType: 'Creative',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    profileScore: 83.4,
    modifier,
    finalScore: 88.4,
    scoreDisplay: '88.40',
    components: [component],
    targetsPlaceholder: false,
    computedAt: new Date('2026-07-31T17:00:00Z'),
    computedBy: 'system',
    preview: false,
  };

  it('maps the whole snapshot tree — id, modifier and components included', () => {
    expect(perfSnapshotToWire(full)).toEqual({
      id: 'PERF-202607-0001',
      staff_id: '2409230432',
      role_type: 'Creative',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      profile_score: 83.4,
      modifier: {
        present: true,
        value: 5,
        source_component: 'roas_attainment',
        source_clients: ['CLI-202607-0001'],
        raw_average: 82.5,
      },
      final_score: 88.4,
      score_display: '88.40',
      components: [{
        name: 'speed_score',
        included: true,
        diagnostic: false,
        raw: 90,
        capped: 90,
        base_weight: 40,
        effective_weight: 40,
        excluded_reason: '',
      }],
      targets_placeholder: false,
      computed_at: '2026-07-31T17:00:00.000Z',
      computed_by: 'system',
      preview: false,
    });
    expectNoCamelKeys(perfSnapshotToWire(full));
  });

  it('sends profile_score/final_score/computed_at as null on a preview', () => {
    // The FE types profile_score/final_score/computed_at `... | null`; Go marks
    // computed_at omitempty but the mapper deliberately sends null (O43) so the
    // running-score preview panel renders "—" instead of blanking.
    const preview = perfSnapshotToWire({
      ...full, profileScore: null, finalScore: null, scoreDisplay: '—',
      computedAt: null, computedBy: '', preview: true,
    });
    expect(preview.profile_score).toBeNull();
    expect(preview.final_score).toBeNull();
    expect(preview.computed_at).toBeNull();
    expect(preview.preview).toBe(true);
  });
});

describe('M14 perfTeamRollupToWire (division roll-up, §2 Rule 5)', () => {
  const full: performance.TeamRollup = {
    division: 'Creative',
    period: '202607',
    members: [{ staffId: '2409230432', roleType: 'Creative', finalScore: 88.4, scoreDisplay: '88.40' }],
    teamAverage: 88.4,
    averageDisplay: '88.40',
  };

  it('maps the roll-up and its nested member rows to snake_case', () => {
    expect(perfTeamRollupToWire(full)).toEqual({
      division: 'Creative',
      period: '202607',
      members: [{ staff_id: '2409230432', role_type: 'Creative', final_score: 88.4, score_display: '88.40' }],
      team_average: 88.4,
      average_display: '88.40',
    });
    expectNoCamelKeys(perfTeamRollupToWire(full));
  });

  it('sends team_average:null and member final_score:null when no member has a score', () => {
    const wire = perfTeamRollupToWire({
      ...full,
      members: [{ staffId: '2409230432', roleType: 'Creative', finalScore: null, scoreDisplay: '—' }],
      teamAverage: null, averageDisplay: '—',
    });
    expect(wire.team_average).toBeNull();
    expect(wire.members[0].final_score).toBeNull();
  });
});

describe('M14 perfWeightToWire (admin KPI-weight row)', () => {
  it('maps every KPIWeight field to its snake_case wire key', () => {
    const w: performance.KPIWeight = {
      roleType: 'Creative', component: 'speed_score', weight: 40,
      updatedAt: new Date('2026-07-19T02:00:00Z'), updatedBy: '2409230411',
    };
    expect(perfWeightToWire(w)).toEqual({
      role_type: 'Creative',
      component: 'speed_score',
      weight: 40,
      updated_at: '2026-07-19T02:00:00.000Z',
      updated_by: '2409230411',
    });
    expectNoCamelKeys(perfWeightToWire(w));
  });
});

describe('M14 perfTargetToWire (O9 normalisation target)', () => {
  it('maps every PeriodTarget field to its snake_case wire key', () => {
    const t: performance.PeriodTarget = {
      roleType: 'Ads', component: 'roas_attainment', staffId: '*', periodStart: '2026-07-01',
      targetValue: 4, isPlaceholder: true,
      updatedAt: new Date('2026-07-19T02:00:00Z'), updatedBy: '2409230411',
    };
    expect(perfTargetToWire(t)).toEqual({
      role_type: 'Ads',
      component: 'roas_attainment',
      staff_id: '*',
      period_start: '2026-07-01',
      target_value: 4,
      is_placeholder: true,
      updated_at: '2026-07-19T02:00:00.000Z',
      updated_by: '2409230411',
    });
    expectNoCamelKeys(perfTargetToWire(t));
  });
});
