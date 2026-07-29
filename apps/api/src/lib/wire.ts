/**
 * Wire mappers — translate the camelCase domain read-models (@cdps/domain) into
 * the snake_case JSON shapes web-internal consumes (its lib/types.ts mirror the
 * legacy Go structs). Response mapping is the API route's job: the domain layer
 * stays camelCase, the route is the boundary. Request bodies are mapped the
 * other way inline in each route (`toInput`).
 */
import { money } from '@cdps/core';
import type { account, admin, ads, board, campaign, client, creative, health, kol, leads, livestream, marketing, msl, notification, performance, portal, sales, task } from '@cdps/domain';

/** MasterService as web-internal's `MasterService` type expects it. */
export interface MasterServiceWire {
  id: string;
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  requires_strategy_plan: boolean;
  version_no: number;
  effective_from: string;
}

/** Maps a domain ServiceView (camelCase) to the MasterService wire shape. */
export function masterServiceToWire(v: msl.ServiceView): MasterServiceWire {
  return {
    id: v.id,
    name: v.name,
    standard_price: v.standardPrice,
    commission_rule: v.commissionRule,
    category: v.category,
    unit: v.unit,
    min_qty: v.minQty,
    pricing_mode: v.pricingMode,
    apply_ppn: v.applyPPN,
    frequency: v.frequency,
    price_note: v.priceNote,
    description: v.description,
    active: v.active,
    requires_strategy_plan: v.requiresStrategyPlan,
    version_no: v.versionNo,
    effective_from: v.effectiveFrom,
  };
}

// --- M1 Leads (contract HANDOFF_SESSION_20260719_FE_M0M1 §1/§3/§4/§5) ---

/** module1_leads.Lead subset returned by register/claim (web-internal LeadStub). */
export interface LeadStubWire {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  record_status: string;
}

export function leadStubToWire(l: leads.Lead): LeadStubWire {
  return {
    id: l.id,
    lead_name: l.leadName,
    phone_number: l.phoneNumber,
    source: l.source,
    record_status: l.recordStatus,
  };
}

/** module1_leads.Attempt subset returned by register/claim (web-internal AttemptStub). */
export interface AttemptStubWire {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  status: string;
}

export function attemptStubToWire(a: leads.Attempt): AttemptStubWire {
  return {
    id: a.id,
    lead_id: a.leadId,
    owner_employee_id: a.owner,
    status: a.status,
  };
}

/** Sales Pool board row (web-internal PoolRow). */
export interface PoolRowWire {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  origin_campaign_id: string | null;
  created_at: string;
  stale: boolean;
  open_attempt_count: number;
  my_open_attempt: boolean;
}

export function poolRowToWire(r: leads.PoolBoardRow): PoolRowWire {
  return {
    id: r.id,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    source: r.source,
    origin_campaign_id: r.originCampaignId,
    created_at: r.createdAt.toISOString(),
    stale: r.stale,
    open_attempt_count: r.openAttemptCount,
    my_open_attempt: r.myOpenAttempt,
  };
}

/** Leads Database row (web-internal LeadRow). */
export interface LeadRowWire {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  origin_division: string;
  origin_campaign_id: string | null;
  last_touch_campaign_id: string | null;
  record_status: string;
  winning_attempt_id: string | null;
  created_at: string;
  open_attempt_count: number;
}

export function leadRowToWire(r: leads.LeadsDbRow): LeadRowWire {
  return {
    id: r.id,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    email: r.email,
    source: r.source,
    origin_division: r.originDivision,
    origin_campaign_id: r.originCampaignId,
    last_touch_campaign_id: r.lastTouchCampaignId,
    record_status: r.recordStatus,
    winning_attempt_id: r.winningAttemptId,
    created_at: r.createdAt.toISOString(),
    open_attempt_count: r.openAttemptCount,
  };
}

/** Lead detail (web-internal LeadDetail): lead core + attempt contest. */
export interface LeadDetailWire {
  lead: Omit<LeadRowWire, 'open_attempt_count'>;
  attempts: {
    id: string;
    owner_employee_id: string;
    owner_nama: string;
    status: string;
    claimed_at: string;
  }[];
}

// --- M6 Account & Service, Cluster 1 (intake & AM assignment) ---

/** module6_account.IntakeClient — one Unassigned Intake Queue row (§3 Rule 1). */
export interface IntakeClientWire {
  client_id: string;
  nama_pic: string;
  toko: string;
  kota: string;
  kategori: string;
  service_count: number;
  released_to_account_at: string | null;
}

export function intakeClientToWire(c: account.IntakeClient): IntakeClientWire {
  return {
    client_id: c.clientId,
    nama_pic: c.namaPic,
    toko: c.toko,
    kota: c.kota,
    kategori: c.kategori,
    service_count: c.serviceCount,
    released_to_account_at: c.releasedToAccountAt ? c.releasedToAccountAt.toISOString() : null,
  };
}

/** module6_account.AMWorkload — one AM's active-client count (§3 Rule 5). */
export interface AMWorkloadWire {
  am_employee_id: string;
  active_client_count: number;
}

export function amWorkloadToWire(w: account.AMWorkload): AMWorkloadWire {
  return { am_employee_id: w.amEmployeeId, active_client_count: w.activeClientCount };
}

/** module6_account.Assignment — the outcome of an assign / reassign action. */
export interface AssignmentWire {
  client_id: string;
  previous_am?: string;
  assigned_am: string;
  assigned_by: string;
  reason?: string;
}

export function assignmentToWire(a: account.Assignment): AssignmentWire {
  return {
    client_id: a.clientId,
    ...(a.previousAm ? { previous_am: a.previousAm } : {}),
    assigned_am: a.assignedAm,
    assigned_by: a.assignedBy,
    ...(a.reason ? { reason: a.reason } : {}),
  };
}

// --- M6 Account & Service, Cluster 2 (Strategy & Plan) ---

/** module6_account.Strategy — a Strategy & Plan record (approved_by/revision_notes omitempty). */
export interface StrategyWire {
  id: string;
  service_id: string;
  objective: string;
  target_kpi: string;
  divisions_involved: string[];
  planned_brief_outline: string;
  timeline_start: string;
  timeline_end: string;
  status: string;
  approved_by?: string;
  revision_notes?: string;
  revision_count: number;
  created_by: string;
  created_at: string;
}

export function strategyToWire(s: account.Strategy): StrategyWire {
  return {
    id: s.id,
    service_id: s.serviceId,
    objective: s.objective,
    target_kpi: s.targetKpi,
    divisions_involved: s.divisionsInvolved,
    planned_brief_outline: s.plannedBriefOutline,
    timeline_start: s.timelineStart,
    timeline_end: s.timelineEnd,
    status: s.status,
    ...(s.approvedBy ? { approved_by: s.approvedBy } : {}),
    ...(s.revisionNotes ? { revision_notes: s.revisionNotes } : {}),
    revision_count: s.revisionCount,
    created_by: s.createdBy,
    created_at: s.createdAt.toISOString(),
  };
}

/** module6_account.StrategyRequirement — the M6-OA-1 override outcome. */
export interface StrategyRequirementWire {
  service_id: string;
  requires_strategy_plan: boolean;
  pinned_requires_strategy_plan: boolean;
  overridden: boolean;
  set_by: string;
  reason: string;
}

export function strategyRequirementToWire(r: account.StrategyRequirement): StrategyRequirementWire {
  return {
    service_id: r.serviceId,
    requires_strategy_plan: r.requiresStrategyPlan,
    pinned_requires_strategy_plan: r.pinnedRequirement,
    overridden: r.overridden,
    set_by: r.setBy,
    reason: r.reason,
  };
}

/** Request body → StrategyInput (snake_case wire → camelCase domain). */
export function toStrategyInput(b: {
  objective?: string;
  target_kpi?: string;
  divisions_involved?: string[];
  planned_brief_outline?: string;
  timeline_start?: string;
  timeline_end?: string;
}): account.StrategyInput {
  return {
    objective: b.objective ?? '',
    targetKpi: b.target_kpi ?? '',
    divisionsInvolved: b.divisions_involved ?? [],
    plannedBriefOutline: b.planned_brief_outline ?? '',
    timelineStart: b.timeline_start ?? '',
    timelineEnd: b.timeline_end ?? '',
  };
}

// --- M6 Account & Service, Cluster 3 (Briefs) ---

/** module6_account.Brief — a Brief record (path-dependent + recurring fields omitempty). */
export interface BriefWire {
  id: string;
  service_id: string;
  strategy_id?: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  quantity_target: number;
  due_date: string;
  priority: string;
  recurring: boolean;
  recurring_frequency?: string;
  recurring_count?: number;
  recurring_end_date?: string;
  instructions?: string;
  reference_attachments?: string;
  title: string;
  status: string;
  revision_count: number;
  revision_flagged: boolean;
  created_by: string;
  created_at: string;
}

export function briefToWire(b: account.Brief): BriefWire {
  return {
    id: b.id,
    service_id: b.serviceId,
    ...(b.strategyId ? { strategy_id: b.strategyId } : {}),
    assigned_division: b.assignedDivision,
    ...(b.assignedPic ? { assigned_pic: b.assignedPic } : {}),
    deliverable_type: b.deliverableType,
    quantity_target: b.quantityTarget,
    due_date: b.dueDate,
    priority: b.priority,
    recurring: b.recurring,
    ...(b.recurringFrequency ? { recurring_frequency: b.recurringFrequency } : {}),
    ...(b.recurringCount ? { recurring_count: b.recurringCount } : {}),
    ...(b.recurringEndDate ? { recurring_end_date: b.recurringEndDate } : {}),
    ...(b.instructions ? { instructions: b.instructions } : {}),
    ...(b.referenceAttachments ? { reference_attachments: b.referenceAttachments } : {}),
    title: b.title,
    status: b.status,
    revision_count: b.revisionCount,
    revision_flagged: b.revisionFlagged,
    created_by: b.createdBy,
    created_at: b.createdAt.toISOString(),
  };
}

/** Request body → BriefInput (snake_case wire → camelCase domain). */
export function toBriefInput(b: {
  title?: string;
  strategy_id?: string;
  assigned_division?: string;
  assigned_pic?: string;
  deliverable_type?: string;
  quantity_target?: number;
  due_date?: string;
  priority?: string;
  recurring?: boolean;
  recurring_frequency?: string;
  recurring_count?: number;
  recurring_end_date?: string;
  instructions?: string;
  reference_attachments?: string;
  is_addendum?: boolean;
}): account.BriefInput {
  return {
    title: b.title ?? '',
    strategyId: b.strategy_id ?? '',
    assignedDivision: b.assigned_division ?? '',
    assignedPic: b.assigned_pic ?? '',
    deliverableType: b.deliverable_type ?? '',
    quantityTarget: b.quantity_target ?? 0,
    dueDate: b.due_date ?? '',
    priority: b.priority ?? '',
    recurring: b.recurring === true,
    recurringFrequency: b.recurring_frequency ?? '',
    recurringCount: b.recurring_count ?? 0,
    recurringEndDate: b.recurring_end_date ?? '',
    instructions: b.instructions ?? '',
    referenceAttachments: b.reference_attachments ?? '',
    isAddendum: b.is_addendum === true,
  };
}

// --- M6 Account & Service, Cluster 4b (Complaints) ---

/** module6_account.Complaint — a Complaint record (related_ref/assigned_to/resolution_notes omitempty). */
export interface ComplaintWire {
  id: string;
  client_id: string;
  related_ref?: string;
  source: string;
  description: string;
  severity: string;
  status: string;
  assigned_to?: string;
  resolution_notes?: string;
  created_by: string;
  created_at: string;
}

export function complaintToWire(c: account.Complaint): ComplaintWire {
  return {
    id: c.id,
    client_id: c.clientId,
    ...(c.relatedRef ? { related_ref: c.relatedRef } : {}),
    source: c.source,
    description: c.description,
    severity: c.severity,
    status: c.status,
    ...(c.assignedTo ? { assigned_to: c.assignedTo } : {}),
    ...(c.resolutionNotes ? { resolution_notes: c.resolutionNotes } : {}),
    created_by: c.createdBy,
    created_at: c.createdAt.toISOString(),
  };
}

/** Request body → ComplaintInput (snake_case wire → camelCase domain). */
export function toComplaintInput(b: { description?: string; severity?: string; related_ref?: string }): account.ComplaintInput {
  return {
    description: b.description ?? '',
    severity: b.severity ?? '',
    relatedRef: b.related_ref ?? '',
  };
}

export function leadDetailToWire(d: leads.LeadDetailView): LeadDetailWire {
  const l = d.lead;
  return {
    lead: {
      id: l.id,
      lead_name: l.leadName,
      phone_number: l.phoneNumber,
      email: l.email,
      source: l.source,
      origin_division: l.originDivision,
      origin_campaign_id: l.originCampaignId,
      last_touch_campaign_id: l.lastTouchCampaignId,
      record_status: l.recordStatus,
      winning_attempt_id: l.winningAttemptId,
      created_at: l.createdAt.toISOString(),
    },
    attempts: d.attempts.map((a) => ({
      id: a.id,
      owner_employee_id: a.ownerEmployeeId,
      owner_nama: a.ownerNama,
      status: a.status,
      claimed_at: a.claimedAt.toISOString(),
    })),
  };
}

// --- M12 Task Execution ---

/** module12_task.Metrics — the recompute-from-log Task metrics (§5.1). The
 *  asset-only revision-SLA fields are always null / "N/A" for a Brief-as-task. */
export interface MetricsWire {
  brief_id: string;
  status: string;
  sla_target_hours: number | null;
  turnaround_hours: number | null;
  revision_turnaround_hours: number | null;
  speed_score_pct: number | null;
  speed_score_display: string;
  revision_sla_target_hours: number | null;
  revision_speed_score_pct: number | null;
  revision_speed_score_display: string;
  revision_count: number;
  revision_flagged: boolean;
  approved_at: string | null;
  approved_period_wib: string;
}

export function metricsToWire(m: task.Metrics): MetricsWire {
  return {
    brief_id: m.briefId,
    status: m.status,
    sla_target_hours: m.slaTargetHours,
    turnaround_hours: m.turnaroundHours,
    revision_turnaround_hours: m.revisionTurnaroundHours,
    speed_score_pct: m.speedScorePct,
    speed_score_display: m.speedScoreDisplay,
    // Populated for a Creative Asset (M7-OA-3); always null / "N/A" for a Brief-as-task.
    revision_sla_target_hours: m.revisionSlaTargetHours,
    revision_speed_score_pct: m.revisionSpeedScorePct,
    revision_speed_score_display: m.revisionSpeedScoreDisplay,
    revision_count: m.revisionCount,
    revision_flagged: m.revisionFlagged,
    approved_at: m.approvedAt ? m.approvedAt.toISOString() : null,
    approved_period_wib: m.approvedPeriodWib,
  };
}

/** module12_task.BlockRequest — returned by the block-request POST edge. */
export interface BlockRequestWire {
  id: string;
  entity_id: string;
  reason: string;
  status: string;
  requested_by: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function blockRequestToWire(b: task.BlockRequest): BlockRequestWire {
  return {
    id: b.id,
    entity_id: b.entityId,
    reason: b.reason,
    status: b.status,
    requested_by: b.requestedBy,
    resolved_by: b.resolvedBy,
    resolved_at: b.resolvedAt ? b.resolvedAt.toISOString() : null,
    created_at: b.createdAt.toISOString(),
  };
}

/** module12_task.PendingBlockRequest — one open request in the SPV/Lead queue. */
export interface PendingBlockRequestWire {
  id: string;
  source: string;
  entity_id: string;
  division: string;
  client_id: string;
  reason: string;
  requested_by: string;
  created_at: string;
}

export function pendingBlockRequestToWire(b: task.PendingBlockRequest): PendingBlockRequestWire {
  return {
    id: b.id,
    source: b.source,
    entity_id: b.entityId,
    division: b.division,
    client_id: b.clientId,
    reason: b.reason,
    requested_by: b.requestedBy,
    created_at: b.createdAt.toISOString(),
  };
}

// --- M7 Creative (Asset) ---

/** module7_creative.Asset — one Asset record (nullable numeric fields omitempty). */
export interface AssetWire {
  id: string;
  brief_id: string;
  asset_type: string;
  sequence_no: number;
  assigned_pic?: string;
  output_link?: string;
  status: string;
  sla_target_hours?: number;
  revision_sla_target_hours?: number;
  hours_logged?: number;
  attributed_gmv?: number;
  revision_count: number;
  revision_flagged: boolean;
  created_by: string;
  created_at: string;
}

export function assetToWire(a: creative.Asset): AssetWire {
  return {
    id: a.id,
    brief_id: a.briefId,
    asset_type: a.assetType,
    sequence_no: a.sequenceNo,
    ...(a.assignedPic ? { assigned_pic: a.assignedPic } : {}),
    ...(a.outputLink ? { output_link: a.outputLink } : {}),
    status: a.status,
    ...(a.slaTargetHours !== null ? { sla_target_hours: a.slaTargetHours } : {}),
    ...(a.revisionSlaHours !== null ? { revision_sla_target_hours: a.revisionSlaHours } : {}),
    ...(a.hoursLogged !== null ? { hours_logged: a.hoursLogged } : {}),
    ...(a.attributedGmv !== null ? { attributed_gmv: a.attributedGmv } : {}),
    revision_count: a.revisionCount,
    revision_flagged: a.revisionFlagged,
    created_by: a.createdBy,
    created_at: a.createdAt.toISOString(),
  };
}

/** Request body → AssetInput (snake_case wire → camelCase domain). */
export function toAssetInput(b: { sequence_no?: number; assigned_pic?: string }): creative.AssetInput {
  return { sequenceNo: b.sequence_no ?? 0, assignedPic: b.assigned_pic ?? '' };
}

// --- M8 Ads ---

/** module8_ads.Campaign — an Ad Campaign with its derived §5 performance view. */
export interface CampaignWire {
  id: string;
  brief_id: string;
  client_id: string;
  platform: string;
  objective: string;
  budget: number;
  budget_display: string;
  start_date: string;
  end_date: string;
  target_kpi: string;
  status: string;
  total_spend: number;
  total_spend_display: string;
  total_gmv: number;
  total_gmv_display: string;
  roas: number | null;
  roas_display: string;
  linked_asset_ids: string[];
  metric_entry_count: number;
  optimization_count: number;
  underperforming_streak: number;
  escalation_flagged: boolean;
  created_by: string;
  created_at: string;
}

export function campaignToWire(c: ads.Campaign): CampaignWire {
  return {
    id: c.id, brief_id: c.briefId, client_id: c.clientId, platform: c.platform, objective: c.objective,
    budget: c.budget, budget_display: c.budgetDisplay, start_date: c.startDate, end_date: c.endDate,
    target_kpi: c.targetKpi, status: c.status, total_spend: c.totalSpend, total_spend_display: c.totalSpendDisplay,
    total_gmv: c.totalGmv, total_gmv_display: c.totalGmvDisplay, roas: c.roas, roas_display: c.roasDisplay,
    linked_asset_ids: c.linkedAssetIds, metric_entry_count: c.metricEntryCount, optimization_count: c.optimizationCount,
    underperforming_streak: c.underperformingStreak, escalation_flagged: c.escalationFlagged,
    created_by: c.createdBy, created_at: c.createdAt.toISOString(),
  };
}

/** module8_ads.MetricEntry — one recorded §9.4 Metric Entry. */
export interface MetricEntryWire {
  id: string;
  campaign_id: string;
  period_start: string;
  period_end: string;
  spend: number;
  gmv: number;
  entry_method: string;
  entered_by: string;
  created_at: string;
}

export function metricEntryToWire(m: ads.MetricEntry): MetricEntryWire {
  return {
    id: m.id, campaign_id: m.campaignId, period_start: m.periodStart, period_end: m.periodEnd,
    spend: m.spend, gmv: m.gmv, entry_method: m.entryMethod, entered_by: m.enteredBy, created_at: m.createdAt.toISOString(),
  };
}

/** module8_ads.Optimization — one recorded OPT- Optimization Log entry. */
export interface OptimizationWire {
  id: string;
  campaign_id: string;
  change_type: string;
  before_value: string;
  after_value: string;
  reason: string;
  actor: string;
  created_at: string;
}

export function optimizationToWire(o: ads.Optimization): OptimizationWire {
  return {
    id: o.id, campaign_id: o.campaignId, change_type: o.changeType, before_value: o.beforeValue,
    after_value: o.afterValue, reason: o.reason, actor: o.actor, created_at: o.createdAt.toISOString(),
  };
}

/** Request body → CampaignInput. */
export function toCampaignInput(b: {
  platform?: string; objective?: string; budget?: string; start_date?: string; end_date?: string; target_kpi?: string;
}): ads.CampaignInput {
  return {
    platform: b.platform ?? '', objective: b.objective ?? '', budget: b.budget ?? '',
    startDate: b.start_date ?? '', endDate: b.end_date ?? '', targetKpi: b.target_kpi ?? '',
  };
}

/** Request body → MetricInput. */
export function toMetricInput(b: {
  period_start?: string; period_end?: string; spend?: string; gmv?: string; ctr?: number | null; cvr?: number | null; entry_method?: string;
}): ads.MetricInput {
  return {
    periodStart: b.period_start ?? '', periodEnd: b.period_end ?? '', spend: b.spend ?? '', gmv: b.gmv ?? '',
    ctr: b.ctr ?? null, cvr: b.cvr ?? null, entryMethod: b.entry_method ?? '',
  };
}

/** Request body → OptimizationInput. */
export function toOptimizationInput(b: {
  change_type?: string; before_value?: string; after_value?: string; reason?: string; old_asset_id?: string; new_asset_id?: string;
}): ads.OptimizationInput {
  return {
    changeType: b.change_type ?? '', beforeValue: b.before_value ?? '', afterValue: b.after_value ?? '',
    reason: b.reason ?? '', oldAssetId: b.old_asset_id ?? '', newAssetId: b.new_asset_id ?? '',
  };
}

// --- M9 KOL ---

/** module9_kol.Booking — a Creator Booking with its derived fields. */
export interface BookingWire {
  id: string;
  brief_id: string;
  creator_name: string;
  creator_handle?: string;
  platform: string;
  niche?: string;
  source_pool: string;
  pool_reference?: string;
  agreed_rate: number;
  agreed_rate_display: string;
  status: string;
  content_link?: string;
  qc_notes?: string;
  sla_target_hours?: number;
  hours_logged?: number;
  assigned_coordinator?: string;
  attributed_gmv?: number;
  revision_count: number;
  payment_status: string;
  created_by: string;
  created_at: string;
}

export function bookingToWire(b: kol.Booking): BookingWire {
  return {
    id: b.id, brief_id: b.briefId, creator_name: b.creatorName,
    ...(b.creatorHandle ? { creator_handle: b.creatorHandle } : {}),
    platform: b.platform, ...(b.niche ? { niche: b.niche } : {}), source_pool: b.sourcePool,
    ...(b.poolReference ? { pool_reference: b.poolReference } : {}),
    agreed_rate: b.agreedRate, agreed_rate_display: b.agreedRateDisplay, status: b.status,
    ...(b.contentLink ? { content_link: b.contentLink } : {}), ...(b.qcNotes ? { qc_notes: b.qcNotes } : {}),
    ...(b.slaTargetHours !== null ? { sla_target_hours: b.slaTargetHours } : {}),
    ...(b.hoursLogged !== null ? { hours_logged: b.hoursLogged } : {}),
    ...(b.assignedCoordinator ? { assigned_coordinator: b.assignedCoordinator } : {}),
    ...(b.attributedGmv !== null ? { attributed_gmv: b.attributedGmv } : {}),
    revision_count: b.revisionCount, payment_status: b.paymentStatus, created_by: b.createdBy,
    created_at: b.createdAt.toISOString(),
  };
}

/** module9_kol.PaymentRequest — one Creator Payment Request. */
export interface PaymentRequestWire {
  id: string;
  booking_id: string;
  amount: number;
  amount_display: string;
  payment_details: string;
  status: string;
  rejection_reason?: string;
  requested_by: string;
  paid_by?: string;
  created_by: string;
  created_at: string;
}

export function paymentRequestToWire(p: kol.PaymentRequest): PaymentRequestWire {
  return {
    id: p.id, booking_id: p.bookingId, amount: p.amount, amount_display: p.amountDisplay,
    payment_details: p.paymentDetails, status: p.status,
    ...(p.rejectionReason ? { rejection_reason: p.rejectionReason } : {}),
    requested_by: p.requestedBy, ...(p.paidBy ? { paid_by: p.paidBy } : {}),
    created_by: p.createdBy, created_at: p.createdAt.toISOString(),
  };
}

/** module9_kol.BookingMetrics — the §7/§11 recompute-from-log Booking metrics. */
export interface BookingMetricsWire {
  booking_id: string;
  status: string;
  sla_target_hours: number | null;
  sourcing_turnaround_hours: number | null;
  delivery_turnaround_hours: number | null;
  overall_turnaround_hours: number | null;
  speed_score_pct: number | null;
  speed_score_display: string;
  revision_count: number;
  excluded_from_speed_score: boolean;
  approved_period_wib: string;
}

export function bookingMetricsToWire(m: kol.BookingMetrics): BookingMetricsWire {
  return {
    booking_id: m.bookingId, status: m.status, sla_target_hours: m.slaTargetHours,
    sourcing_turnaround_hours: m.sourcingTurnaroundHours, delivery_turnaround_hours: m.deliveryTurnaroundHours,
    overall_turnaround_hours: m.overallTurnaroundHours, speed_score_pct: m.speedScorePct,
    speed_score_display: m.speedScoreDisplay, revision_count: m.revisionCount,
    excluded_from_speed_score: m.excludedFromSpeedScore, approved_period_wib: m.approvedPeriodWib,
  };
}

/** module9_kol.CreatorList — the Brief-level compiled Creator List. */
export interface CreatorListWire {
  brief_id: string;
  creator_list_link?: string;
  included_bookings: string[];
  last_compiled: string | null;
  eligible_bookings: string[];
}

export function creatorListToWire(c: kol.CreatorList): CreatorListWire {
  return {
    brief_id: c.briefId, ...(c.creatorListLink ? { creator_list_link: c.creatorListLink } : {}),
    included_bookings: c.includedBookings, last_compiled: c.lastCompiled ? c.lastCompiled.toISOString() : null,
    eligible_bookings: c.eligibleBookings,
  };
}

/** Request body → BookingInput. */
export function toBookingInput(b: {
  creator_name?: string; creator_handle?: string; platform?: string; niche?: string;
  source_pool?: string; pool_reference?: string; agreed_rate?: string; assigned_coordinator?: string;
}): kol.BookingInput {
  return {
    creatorName: b.creator_name ?? '', creatorHandle: b.creator_handle ?? '', platform: b.platform ?? '',
    niche: b.niche ?? '', sourcePool: b.source_pool ?? '', poolReference: b.pool_reference ?? '',
    agreedRate: b.agreed_rate ?? '', assignedCoordinator: b.assigned_coordinator ?? '',
  };
}

// --- M14 Team Performance (mirrors Go's module14_performance JSON structs) ---

/** module14_performance.Component wire shape (snake_case, per §5.5 full breakdown). */
export interface PerfComponentWire {
  name: string;
  included: boolean;
  diagnostic: boolean;
  raw: number | null;
  capped: number | null;
  base_weight: number;
  effective_weight: number;
  excluded_reason: string;
}

function perfComponentToWire(c: performance.Component): PerfComponentWire {
  return {
    name: c.name,
    included: c.included,
    diagnostic: c.diagnostic,
    raw: c.raw,
    capped: c.capped,
    base_weight: c.baseWeight,
    effective_weight: c.effectiveWeight,
    excluded_reason: c.excludedReason,
  };
}

/** module14_performance.Modifier wire shape (§5.3 Client-Outcome Modifier). */
export interface PerfModifierWire {
  present: boolean;
  value: number;
  source_component: string;
  source_clients: string[];
  raw_average: number | null;
}

function perfModifierToWire(m: performance.Modifier): PerfModifierWire {
  return {
    present: m.present,
    value: m.value,
    source_component: m.sourceComponent,
    source_clients: m.sourceClients,
    raw_average: m.rawAverage,
  };
}

/** module14_performance.Snapshot wire shape (the full breakdown is mandatory, §2 Rule 8). */
export interface PerfSnapshotWire {
  id: string;
  staff_id: string;
  role_type: string;
  period_start: string;
  period_end: string;
  profile_score: number | null;
  modifier: PerfModifierWire;
  final_score: number | null;
  score_display: string;
  components: PerfComponentWire[];
  targets_placeholder: boolean;
  computed_at: string | null;
  computed_by: string;
  preview: boolean;
}

export function perfSnapshotToWire(s: performance.Snapshot): PerfSnapshotWire {
  return {
    id: s.id,
    staff_id: s.staffId,
    role_type: s.roleType,
    period_start: s.periodStart,
    period_end: s.periodEnd,
    profile_score: s.profileScore,
    modifier: perfModifierToWire(s.modifier),
    final_score: s.finalScore,
    score_display: s.scoreDisplay,
    components: s.components.map(perfComponentToWire),
    targets_placeholder: s.targetsPlaceholder,
    computed_at: s.computedAt ? s.computedAt.toISOString() : null,
    computed_by: s.computedBy,
    preview: s.preview,
  };
}

/** module14_performance.TeamRollup wire shape (§2 Rule 5 simple average, derived on read). */
export interface PerfTeamRollupWire {
  division: string;
  period: string;
  members: { staff_id: string; role_type: string; final_score: number | null; score_display: string }[];
  team_average: number | null;
  average_display: string;
}

export function perfTeamRollupToWire(r: performance.TeamRollup): PerfTeamRollupWire {
  return {
    division: r.division,
    period: r.period,
    members: r.members.map((m) => ({
      staff_id: m.staffId,
      role_type: m.roleType,
      final_score: m.finalScore,
      score_display: m.scoreDisplay,
    })),
    team_average: r.teamAverage,
    average_display: r.averageDisplay,
  };
}

/** module14_performance.KPIWeight wire shape (admin KPI-config surface). */
export interface PerfWeightWire {
  role_type: string;
  component: string;
  weight: number;
  updated_at: string;
  updated_by: string;
}

export function perfWeightToWire(w: performance.KPIWeight): PerfWeightWire {
  return {
    role_type: w.roleType,
    component: w.component,
    weight: w.weight,
    updated_at: w.updatedAt.toISOString(),
    updated_by: w.updatedBy,
  };
}

/** module14_performance.PeriodTarget wire shape (OA-2 / O9 normalisation targets). */
export interface PerfTargetWire {
  role_type: string;
  component: string;
  period_start: string;
  target_value: number;
  is_placeholder: boolean;
  updated_at: string;
  updated_by: string;
}

export function perfTargetToWire(t: performance.PeriodTarget): PerfTargetWire {
  return {
    role_type: t.roleType,
    component: t.component,
    period_start: t.periodStart,
    target_value: t.targetValue,
    is_placeholder: t.isPlaceholder,
    updated_at: t.updatedAt.toISOString(),
    updated_by: t.updatedBy,
  };
}

// ---------------------------------------------------------------------------
// M13 Client Health — Snapshot / Component / ROAS toggle / scan result.
// ---------------------------------------------------------------------------

export interface HealthComponentWire {
  name: string;
  included: boolean;
  raw: number | null;
  capped: number | null;
  base_weight: number;
  effective_weight: number;
  excluded_reason?: string;
}

function healthComponentToWire(c: health.Component): HealthComponentWire {
  return {
    name: c.name, included: c.included, raw: c.raw, capped: c.capped,
    base_weight: c.baseWeight, effective_weight: c.effectiveWeight,
    ...(c.excludedReason ? { excluded_reason: c.excludedReason } : {}),
  };
}

/** module13_health.Snapshot — a stored CHR- snapshot or a live preview. */
export interface HealthSnapshotWire {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  final_health_score: number | null;
  score_display: string;
  band: string;
  roas_toggle_state: boolean;
  components: HealthComponentWire[];
  computed_at?: string;
  computed_by?: string;
  preview: boolean;
}

export function healthSnapshotToWire(s: health.Snapshot): HealthSnapshotWire {
  return {
    id: s.id, client_id: s.clientId, period_start: s.periodStart, period_end: s.periodEnd,
    final_health_score: s.finalHealthScore, score_display: s.scoreDisplay, band: s.band,
    roas_toggle_state: s.roasToggleState, components: s.components.map(healthComponentToWire),
    ...(s.computedAt ? { computed_at: s.computedAt.toISOString() } : {}),
    ...(s.computedBy ? { computed_by: s.computedBy } : {}),
    preview: s.preview,
  };
}

/** module13_health.ROASToggle. */
export interface RoasToggleWire {
  client_id: string;
  override: boolean | null;
  has_ads: boolean;
  has_active: boolean;
  effective: boolean;
}

export function roasToggleToWire(t: health.RoasToggle): RoasToggleWire {
  return { client_id: t.clientId, override: t.override, has_ads: t.hasAds, has_active: t.hasActive, effective: t.effective };
}

/** module13_health.ScanResult. */
export interface HealthScanResultWire {
  period: string;
  snapshots_made: number;
  band_drops_flagged: number;
}

export function healthScanResultToWire(r: health.ScanResult): HealthScanResultWire {
  return { period: r.period, snapshots_made: r.snapshotsMade, band_drops_flagged: r.bandDropsFlagged };
}

// ---------------------------------------------------------------------------
// M11 Board — Dependency (DEP-) + Client Board / My Tasks cards.
// ---------------------------------------------------------------------------

/** module11_board.Dependency — a DEP- row + its DERIVED status. */
export interface DependencyWire {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  type: string;
  note?: string;
  client_id: string;
  status: string;
  created_by: string;
  created_at: string;
}

export function dependencyToWire(d: board.Dependency): DependencyWire {
  return {
    id: d.id, source_type: d.sourceType, source_id: d.sourceId, target_type: d.targetType,
    target_id: d.targetId, type: d.type, ...(d.note ? { note: d.note } : {}), client_id: d.clientId,
    status: d.status, created_by: d.createdBy, created_at: d.createdAt.toISOString(),
  };
}

/** module11_board.Card — one work unit on the Client Board / My Tasks. */
export interface CardWire {
  id: string;
  type: string;
  division: string;
  client_id: string;
  brief_id: string;
  pic?: string;
  native_status: string;
  universal_column: string;
  due_date?: string;
  overdue: boolean;
  dependency_badge?: string;
  created_at?: string;
}

export function cardToWire(c: board.Card): CardWire {
  return {
    id: c.id, type: c.type, division: c.division, client_id: c.clientId, brief_id: c.briefId,
    ...(c.pic ? { pic: c.pic } : {}), native_status: c.nativeStatus, universal_column: c.universalColumn,
    ...(c.dueDate ? { due_date: c.dueDate } : {}), overdue: c.overdue,
    ...(c.dependencyBadge ? { dependency_badge: c.dependencyBadge } : {}),
    ...(c.createdAt ? { created_at: c.createdAt.toISOString() } : {}),
  };
}

// ---------------------------------------------------------------------------
// M7 Daily Output (§7) + Hours Logged reminder scan (M7-OA-2).
// ---------------------------------------------------------------------------

/** module7_creative.OutputEntry — one auto-logged Daily Output record (§9.4). */
export interface OutputEntryWire {
  output_id: number;
  pic: string;
  output_unit_type: string;
  asset_id: string;
  brief_id: string;
  client_id: string;
  transition: string;
  timestamp: string;
  date_wib: string;
  locked: boolean;
}

/** module7_creative.DailyOutputDay — one PIC's WIB-day auto-logged output feed (§7). */
export interface DailyOutputDayWire {
  pic: string;
  date_wib: string;
  locked: boolean;
  total: number;
  approved_count: number;
  entries: OutputEntryWire[];
}

/** Maps the camelCase DailyOutputDay to the snake_case wire shape (Go §9.4 JSON). */
export function dailyOutputToWire(d: creative.DailyOutputDay): DailyOutputDayWire {
  return {
    pic: d.pic, date_wib: d.dateWib, locked: d.locked, total: d.total, approved_count: d.approved,
    entries: d.entries.map((e) => ({
      output_id: e.outputId, pic: e.pic, output_unit_type: e.outputUnitType, asset_id: e.assetId,
      brief_id: e.briefId, client_id: e.clientId, transition: e.transition,
      timestamp: e.timestamp.toISOString(), date_wib: e.dateWib, locked: e.locked,
    })),
  };
}

/** module7_creative.ScanHoursReminderResult — the reminder sweep tally. */
export interface ScanHoursReminderResultWire {
  reminders_sent: number;
}

export function scanHoursReminderResultToWire(r: creative.ScanHoursReminderResult): ScanHoursReminderResultWire {
  return { reminders_sent: r.remindersSent };
}

// --- M10 Live Stream (contract mirrors backend/internal/module10_livestream
//     Session json tags + web-internal/src/lib/livestream.ts Session) ---

/**
 * module10_livestream.Session as web-internal's `Session` expects it. Result-only
 * fields are `omitempty` in the Go source and simply ABSENT from JSON until they
 * are set (the FE treats missing the same as empty — never coerced to 0/false),
 * so the mapper omits them while null/empty. Money follows the M10 contract: `gmv`
 * is the raw rupiah NUMBER (calc/sort only) and `gmv_display` is the pre-formatted
 * "Rp. X.XXX.XXX,00" — the FE never reformats `gmv` (house rule #7).
 */
export interface SessionWire {
  id: string;
  brief_id: string;
  platform: string;
  requested_datetime: string;
  target_duration_hours: number;
  products_talent?: string;
  special_instructions?: string;
  status: string;
  actual_datetime?: string;
  actual_duration_hours?: number;
  viewers_peak?: number;
  viewers_avg?: number;
  orders_generated?: number;
  gmv?: number;
  gmv_display?: string;
  vendor_report_link?: string;
  reconciliation_notes?: string;
  data_confidence_tier: string;
  created_by: string;
  created_at: string;
}

/** Maps a domain Session (camelCase) to the snake_case Session wire shape. */
export function sessionToWire(s: livestream.Session): SessionWire {
  const w: SessionWire = {
    id: s.id,
    brief_id: s.briefId,
    platform: s.platform,
    requested_datetime: s.requestedDatetime.toISOString(),
    target_duration_hours: s.targetDurationHours,
    status: s.status,
    data_confidence_tier: s.dataConfidenceTier,
    created_by: s.createdBy,
    created_at: s.createdAt.toISOString(),
  };
  // Optional request fields (omitempty: absent while empty).
  if (s.productsTalent) w.products_talent = s.productsTalent;
  if (s.specialInstructions) w.special_instructions = s.specialInstructions;
  // Result-only fields (omitempty: absent until [Completed] / [Discrepancy Flagged]).
  if (s.actualDatetime) w.actual_datetime = s.actualDatetime.toISOString();
  if (s.actualDurationHours !== null) w.actual_duration_hours = s.actualDurationHours;
  if (s.viewersPeak !== null) w.viewers_peak = s.viewersPeak;
  if (s.viewersAvg !== null) w.viewers_avg = s.viewersAvg;
  if (s.ordersGenerated !== null) w.orders_generated = s.ordersGenerated;
  if (s.gmv !== null) w.gmv = Number(s.gmv); // raw rupiah number for calc/sort only
  if (s.gmvDisplay) w.gmv_display = s.gmvDisplay;
  if (s.vendorReportLink) w.vendor_report_link = s.vendorReportLink;
  if (s.reconciliationNotes) w.reconciliation_notes = s.reconciliationNotes;
  return w;
}

// --- M3 Campaign (acquisition CMP-): mirror the Go module3_campaign JSON tags ---

/** module3_campaign.Campaign — the acquisition Campaign (CMP-) record (end_date nullable). */
export interface MarketingCampaignWire {
  id: string;
  name: string;
  channel: string;
  online: boolean;
  offline: boolean;
  start_date: string;
  end_date: string | null;
  owner_employee_id: string;
  status: string;
  created_by: string;
  created_at: string;
}

export function marketingCampaignToWire(c: campaign.Campaign): MarketingCampaignWire {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    online: c.online,
    offline: c.offline,
    start_date: c.startDate,
    end_date: c.endDate,
    owner_employee_id: c.owner,
    status: c.status,
    created_by: c.createdBy,
    created_at: c.createdAt.toISOString(),
  };
}

/** module3_campaign.Rollup — the Campaign's read-only linkage funnel (M3 §4 Rule 4). */
export interface CampaignRollupWire {
  campaign_id: string;
  leads_generated: number;
  real_leads: number;
  clients_won: number;
  total_value_won: string;
  total_value_won_idr: string;
}

export function campaignRollupToWire(r: campaign.Rollup): CampaignRollupWire {
  return {
    campaign_id: r.campaignId,
    leads_generated: r.leadsGenerated,
    real_leads: r.realLeads,
    clients_won: r.clientsWon,
    total_value_won: r.totalValueWon,
    total_value_won_idr: r.totalValueWonIdr,
  };
}

// --- M2 Marketing (performance record + auto-metrics): mirror the Go module2 JSON tags ---

/** module2_marketing.Record — the stored performance record (budget + 1:1 Online/Offline). */
export interface PerformanceRecordWire {
  campaign_id: string;
  budget: string;
  budget_idr: string;
  online: boolean;
  offline: boolean;
  created_by: string;
}

export function performanceRecordToWire(r: marketing.Record): PerformanceRecordWire {
  return {
    campaign_id: r.campaignId,
    budget: r.budget,
    budget_idr: r.budgetIdr,
    online: r.online,
    offline: r.offline,
    created_by: r.createdBy,
  };
}

/** module2_marketing.Metrics — the read-only Auto-Metrics view (M2 §4). */
export interface MarketingMetricsWire {
  campaign_id: string;
  online: boolean;
  offline: boolean;
  budget: string;
  budget_idr: string;
  lead_by_dashboard: number;
  lead_real_by_sales: number;
  lead_quality_rate: string;
  attributed_sales: string;
  attributed_sales_decimal: string;
  cost_per_lead: string;
  cost_per_real_lead: string;
  roas: string;
  collected_sales: string;
  collected_sales_decimal: string;
  collected_roas: string;
  junk_breakdown: { reason: string; count: number }[];
}

export function marketingMetricsToWire(m: marketing.Metrics): MarketingMetricsWire {
  return {
    campaign_id: m.campaignId,
    online: m.online,
    offline: m.offline,
    budget: m.budget,
    budget_idr: m.budgetIdr,
    lead_by_dashboard: m.leadByDashboard,
    lead_real_by_sales: m.leadRealBySales,
    lead_quality_rate: m.leadQualityRate,
    attributed_sales: m.attributedSales,
    attributed_sales_decimal: m.attributedSalesDecimal,
    cost_per_lead: m.costPerLead,
    cost_per_real_lead: m.costPerRealLead,
    roas: m.roas,
    collected_sales: m.collectedSales,
    collected_sales_decimal: m.collectedSalesDecimal,
    collected_roas: m.collectedRoas,
    junk_breakdown: m.junkBreakdown.map((j) => ({ reason: j.reason, count: j.count })),
  };
}

// --- M15 Team Portal (aggregates M11/M12/M13/M14; mirrors module15_portal structs) ---

/** module15_portal.StaffLanding — own open tasks (SLA-risk first) + running score + trend. */
export interface StaffLandingWire {
  employee_id: string;
  open_tasks: CardWire[];
  running_score: PerfSnapshotWire | null;
  trend: PerfSnapshotWire[];
}

export function staffLandingToWire(l: portal.StaffLanding): StaffLandingWire {
  return {
    employee_id: l.employeeId,
    open_tasks: l.openTasks.map(cardToWire),
    running_score: l.runningScore === null ? null : perfSnapshotToWire(l.runningScore),
    trend: l.trend.map(perfSnapshotToWire),
  };
}

/** module15_portal.ClientShortcut — a Client-Board drill-through reference (Rule 10). */
export interface ClientShortcutWire {
  client_id: string;
  client_name: string;
  assigned_am: string;
  board_ref: string;
}

/** module15_portal.TeamPortal — division rollup + client shortcuts + block-approval queue. */
export interface TeamPortalWire {
  division: string;
  performance_rollup: PerfTeamRollupWire;
  client_shortcuts: ClientShortcutWire[];
  block_queue: PendingBlockRequestWire[];
}

export function teamPortalToWire(t: portal.TeamPortal): TeamPortalWire {
  return {
    division: t.division,
    performance_rollup: perfTeamRollupToWire(t.rollup),
    client_shortcuts: t.clients.map((c) => ({
      client_id: c.clientId, client_name: c.clientName, assigned_am: c.assignedAm, board_ref: c.boardRef,
    })),
    block_queue: t.blockQueue.map(pendingBlockRequestToWire),
  };
}

/** module15_portal.MgmtRow — one Client's latest health band + trend + dragging component. */
export interface MgmtRowWire {
  client_id: string;
  client_name: string;
  assigned_am: string;
  snapshot_id: string;
  period: string;
  score_display: string;
  band: string;
  trend_direction: string;
  dragging_component: string;
  dragging_capped: number | null;
}

/** module15_portal.ManagementDashboard — the portfolio-wide health scan (Rule 11). */
export interface ManagementDashboardWire {
  filter_band: string;
  filter_am: string;
  sort: string;
  rows: MgmtRowWire[];
}

export function managementDashboardToWire(d: portal.ManagementDashboard): ManagementDashboardWire {
  return {
    filter_band: d.filterBand,
    filter_am: d.filterAm,
    sort: d.sort,
    rows: d.rows.map((r) => ({
      client_id: r.clientId, client_name: r.clientName, assigned_am: r.assignedAm,
      snapshot_id: r.snapshotId, period: r.period, score_display: r.scoreDisplay, band: r.band,
      trend_direction: r.trendDirection, dragging_component: r.draggingComponent, dragging_capped: r.draggingCapped,
    })),
  };
}

// ---------------------------------------------------------------------------
// Notification inbox (Phase 0 v2 §9) — C-02.
// ---------------------------------------------------------------------------

/** core/notification.Notification as web-internal's `NotificationItem` expects it. */
export interface NotificationWire {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor: string;
  created_at: string;
  read_at: string | null;
}

/** GET /notifications body — web-internal's `NotificationsResponse`. */
export interface NotificationsResponseWire {
  data: NotificationWire[];
  unread_count: number;
}

export function notificationToWire(n: notification.Notification): NotificationWire {
  return {
    id: n.id,
    event_type: n.eventType,
    entity_type: n.entityType,
    entity_id: n.entityId,
    deep_link: n.deepLink,
    actor: n.actor,
    created_at: n.createdAt.toISOString(),
    read_at: n.readAt ? n.readAt.toISOString() : null,
  };
}

/** Wraps the inbox in the `{ data, unread_count }` envelope Go and the FE use. */
export function inboxToWire(i: notification.Inbox): NotificationsResponseWire {
  return { data: i.items.map(notificationToWire), unread_count: i.unreadCount };
}

// ---------------------------------------------------------------------------
// M0 quote preview (MSL v2 calculator) — C-03 finding.
// ---------------------------------------------------------------------------

/** module0_sales.LineQuote — one priced service line as web-internal expects it. */
export interface LineQuoteWire {
  service_id: string;
  name: string;
  quantity: number;
  unit: string;
  standard_price_idr: string;
  komisi_idr: string;
  subtotal_idr: string;
}

/** module0_sales.Quote — web-internal's `Quote` (lib/sales.ts). */
export interface QuoteWire {
  lines: LineQuoteWire[];
  estimasi_nilai_idr: string;
  total_komisi_idr: string;
}

/**
 * Maps the domain Quote to the wire shape.
 *
 * The raw `estimasiNilai` / `totalKomisi` are `money.Money` = **bigint**, which
 * JSON.stringify cannot serialize (it throws TypeError). Go marks the very same
 * fields `json:"-"`; this mapper is that contract. Only the pre-formatted IDR
 * strings cross the boundary — which is also house rule #4: the client never
 * sees a raw money scalar it could re-derive differently.
 */
export function quoteToWire(q: sales.Quote): QuoteWire {
  return {
    lines: q.lines.map((l) => ({
      service_id: l.serviceId,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      standard_price_idr: l.standardPriceIdr,
      komisi_idr: l.komisiIdr,
      subtotal_idr: l.subtotalIdr,
    })),
    estimasi_nilai_idr: q.estimasiNilaiIdr,
    total_komisi_idr: q.totalKomisiIdr,
  };
}

// --- M4 Client Record detail (Go clientView / serviceViews) ---

/** module4_client.ServiceLine — web-internal's `ServiceLine` (lib/clients.ts). */
export interface ServiceLineWire {
  id: string;
  master_service_id: string;
  name: string;
  standard_price: string;
  status: string;
}

/** client_platforms row — web-internal's `Platform` (lib/clients.ts). */
export interface PlatformWire {
  platform: string;
  store_link?: string;
  managed_since: string | null;
  active: boolean;
}

/** client_sales_allocations row — web-internal's `Allocation` (lib/clients.ts). */
export interface AllocationWire {
  salesperson_id: string;
  basis_points: number;
}

/** module4_client.Client as web-internal's `Client` type expects it. */
export interface ClientDetailWire {
  id: string;
  nama_pic: string;
  toko: string;
  kota: string;
  kategori: string;
  link_toko: string;
  gmv_baseline: string;
  target_gmv: string;
  total_sales: string;
  marketing_budget: string | null;
  origin_campaign_id: string;
  sales_pic_id: string;
  commission_payment_pic_id: string;
  transaction_id: string;
  payment_intent: string;
  released_to_account_at: string | null;
  platforms: PlatformWire[];
  sales_allocation: AllocationWire[];
  services: ServiceLineWire[];
}

/**
 * idr formats a raw DB decimal ("9000000.00") as the house IDR string
 * ("Rp. 9.000.000,00").
 *
 * Formatting happens HERE rather than in the domain because `sales.getClient` is
 * a read model straight over `numeric(15,2)` columns, and Go formats the very
 * same fields at the same boundary (`clientView` calls `money.Format()`). House
 * rule #4 still holds either way: only the formatted string crosses the wire, so
 * the client can never re-derive a money value differently than the server did.
 */
function idr(decimal: string): string {
  return money.format(money.parse(decimal));
}

/**
 * Maps the domain ClientDetail (camelCase, raw decimals, Date objects) to the
 * snake_case wire shape web-internal reads — a 1:1 port of Go's `clientView`.
 *
 * Fields Go renders as `""`/omitted for a NULL column are normalized to `''`
 * here (`origin_campaign_id`, `transaction_id`, `payment_intent`) so the FE never
 * has to distinguish null from absent; `marketing_budget` stays nullable because
 * Go's `moneyPtr` returns JSON null for it.
 *
 * `sales_pic_nama`, `lead_id`, `winning_attempt_id`, `created_at` and the nested
 * `transaction` are deliberately NOT emitted: Go's clientView has no such keys,
 * and the FE `Client` type does not declare them. The installment schedule
 * reaches the FE through the M5 transaction endpoints instead.
 */
export function clientDetailToWire(c: sales.ClientDetail): ClientDetailWire {
  return {
    id: c.id,
    nama_pic: c.namaPic,
    toko: c.toko,
    kota: c.kota,
    kategori: c.kategori,
    link_toko: c.linkToko,
    gmv_baseline: idr(c.gmvBaseline),
    target_gmv: idr(c.targetGmv),
    total_sales: idr(c.totalSales),
    marketing_budget: c.marketingBudget === null ? null : idr(c.marketingBudget),
    origin_campaign_id: c.originCampaignId ?? '',
    sales_pic_id: c.salesPicId,
    commission_payment_pic_id: c.commissionPaymentPicId,
    transaction_id: c.transactionId ?? '',
    payment_intent: c.paymentIntent ?? '',
    released_to_account_at: c.releasedToAccountAt ? c.releasedToAccountAt.toISOString() : null,
    platforms: c.platforms.map((p) => ({
      platform: p.platform,
      store_link: p.storeLink ?? undefined,
      managed_since: p.managedSince ? p.managedSince.toISOString() : null,
      active: p.active,
    })),
    sales_allocation: c.allocations.map((a) => ({
      salesperson_id: a.salespersonId,
      basis_points: a.basisPoints,
    })),
    services: c.services.map((s) => ({
      id: s.id,
      master_service_id: s.masterServiceId,
      name: s.name,
      standard_price: idr(s.standardPrice),
      status: s.status,
    })),
  };
}

/**
 * One row of the client roster — web-internal's clients list page reads
 * `id, toko, kota, kategori, sales_pic_id, payment_intent, released_to_account_at`.
 *
 * NARROWER than Go's `handleListClients`, which renders a full `clientView` per
 * row. The domain read (`client.listClients`) is deliberately a narrow projection,
 * and widening it to full detail would mean an N+1 over platforms/allocations/
 * services for a list nobody reads those from. Every field the FE actually
 * consumes is present; the extra Go keys are not. Logged as an open question
 * (DECISIONS O43) rather than silently settled either way.
 */
export interface ClientListRowWire {
  id: string;
  toko: string;
  nama_pic: string;
  kota: string;
  kategori: string;
  sales_pic_id: string;
  sales_pic_nama: string;
  assigned_am_id: string | null;
  payment_intent: string;
  released_to_account_at: string | null;
  created_at: string;
}

export function clientListRowToWire(r: client.ClientListRow): ClientListRowWire {
  return {
    id: r.id,
    toko: r.toko,
    nama_pic: r.namaPic,
    kota: r.kota,
    kategori: r.kategori,
    sales_pic_id: r.salesPicId,
    sales_pic_nama: r.salesPicNama,
    assigned_am_id: r.assignedAmId,
    payment_intent: r.paymentIntent ?? '',
    released_to_account_at: r.releasedToAccountAt ? r.releasedToAccountAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Admin plane (employees / role mappings / layered roles) — O44.
// ---------------------------------------------------------------------------

/**
 * `admin.EmployeeRow` as web-internal's `AdminEmployee` expects it.
 *
 * `synced_at` is emitted even though `AdminEmployee` does not declare it: Go's
 * `EmployeeRow` carries it and the field is genuinely useful for "is this
 * directory stale?" — the very question behind O42. Extra keys are inert for the
 * FE, a MISSING key is what breaks a page (O43).
 */
export interface AdminEmployeeWire {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  status_aktif: boolean;
  flagged: boolean;
  synced_at: string | null;
}

/** admin.EmployeeRow → wire (snake_case; dates as ISO strings). */
export function adminEmployeeToWire(e: admin.EmployeeRow): AdminEmployeeWire {
  return {
    employee_id: e.employeeId,
    nama: e.nama,
    email: e.email,
    divisi: e.divisi,
    jabatan: e.jabatan,
    status_aktif: e.statusAktif,
    flagged: e.flagged,
    synced_at: e.syncedAt ? e.syncedAt.toISOString() : null,
  };
}

/** `admin.RoleMapping` as web-internal's `RoleMapping` expects it (`id` string). */
export interface RoleMappingWire {
  id: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
  created_at: string;
}

/** admin.RoleMapping → wire. `id` stays a string — it is a bigint (C03-F2). */
export function roleMappingToWire(m: admin.RoleMapping): RoleMappingWire {
  return {
    id: m.id,
    divisi: m.divisi,
    jabatan: m.jabatan,
    division: m.division,
    level: m.level,
    created_at: m.createdAt.toISOString(),
  };
}

/** `admin.LayeredRole` as web-internal's `LayeredRole` expects it. */
export interface LayeredRoleWire {
  id: string;
  employee_id: string;
  role: string;
  enabled: boolean;
  created_at: string;
}

/** admin.LayeredRole → wire. */
export function layeredRoleToWire(r: admin.LayeredRole): LayeredRoleWire {
  return {
    id: r.id,
    employee_id: r.employeeId,
    role: r.role,
    enabled: r.enabled,
    created_at: r.createdAt.toISOString(),
  };
}
