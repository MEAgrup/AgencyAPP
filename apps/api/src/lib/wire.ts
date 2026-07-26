/**
 * Wire mappers — translate the camelCase domain read-models (@cdps/domain) into
 * the snake_case JSON shapes web-internal consumes (its lib/types.ts mirror the
 * legacy Go structs). Response mapping is the API route's job: the domain layer
 * stays camelCase, the route is the boundary. Request bodies are mapped the
 * other way inline in each route (`toInput`).
 */
import type { account, ads, creative, kol, leads, msl, performance, task } from '@cdps/domain';

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

// --- M14 Team Performance: mirror the Go module14_performance JSON tags ---

/** module14_performance.Component — one scored/excluded/diagnostic component. */
export interface PerfComponentWire {
  name: string;
  included: boolean;
  diagnostic?: boolean;
  raw: number | null;
  capped: number | null;
  base_weight: number;
  effective_weight: number;
  excluded_reason?: string;
}

function perfComponentToWire(c: performance.Component): PerfComponentWire {
  return {
    name: c.name,
    included: c.included,
    ...(c.diagnostic ? { diagnostic: true } : {}),
    raw: c.raw,
    capped: c.capped,
    base_weight: c.baseWeight,
    effective_weight: c.effectiveWeight,
    ...(c.excludedReason ? { excluded_reason: c.excludedReason } : {}),
  };
}

/** module14_performance.Modifier — the Client-Outcome Modifier (Rule 3 / §5.3). */
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

/** module14_performance.Snapshot — a stored snapshot or a live preview (computed_at/by omitempty). */
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
  computed_at?: string;
  computed_by?: string;
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
    ...(s.computedAt ? { computed_at: s.computedAt.toISOString() } : {}),
    ...(s.computedBy ? { computed_by: s.computedBy } : {}),
    preview: s.preview,
  };
}

/** module14_performance.ScanResult — one snapshot-sweep tally. */
export interface PerfScanResultWire {
  period: string;
  snapshots_made: number;
}

export function perfScanResultToWire(r: performance.ScanResult): PerfScanResultWire {
  return { period: r.period, snapshots_made: r.snapshotsMade };
}

/** module14_performance.TeamRollup — the simple-average team view (OA-8). */
export interface PerfTeamRowWire {
  staff_id: string;
  role_type: string;
  final_score: number | null;
  score_display: string;
}

export interface PerfTeamRollupWire {
  division: string;
  period: string;
  members: PerfTeamRowWire[];
  team_average: number | null;
  average_display: string;
}

export function perfTeamRollupToWire(t: performance.TeamRollup): PerfTeamRollupWire {
  return {
    division: t.division,
    period: t.period,
    members: t.members.map((m) => ({ staff_id: m.staffId, role_type: m.roleType, final_score: m.finalScore, score_display: m.scoreDisplay })),
    team_average: t.teamAverage,
    average_display: t.averageDisplay,
  };
}

/** module14_performance.KPIWeight — one KPI Profile weight row. */
export interface PerfWeightWire {
  role_type: string;
  component: string;
  weight: number;
  updated_at: string;
  updated_by: string;
}

export function perfWeightToWire(w: performance.KpiWeight): PerfWeightWire {
  return { role_type: w.roleType, component: w.component, weight: w.weight, updated_at: w.updatedAt.toISOString(), updated_by: w.updatedBy };
}

/** module14_performance.PeriodTarget — one normalisation target row (O9). */
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
