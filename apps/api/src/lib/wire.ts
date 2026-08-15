/**
 * Wire mappers — translate the camelCase domain read-models (@cdps/domain) into
 * the snake_case JSON shapes web-internal consumes (its lib/types.ts mirror the
 * legacy Go structs). Response mapping is the API route's job: the domain layer
 * stays camelCase, the route is the boundary. Request bodies are mapped the
 * other way inline in each route (`toInput`).
 */
import { money, tz } from '@cdps/core';
import type { interview as ivcore } from '@cdps/core';
import type { account, activity, admin, ads, audit, auth, board, campaign, client, contract, creative, demo, directory, finance, health, internaltask, interview, kol, leads, livestream, marketing, milestone, msl, notification, performance, plangate, portal, recap, sales, strategi, task, vendor } from '@cdps/domain';

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
  plan_tier: string;
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
    plan_tier: v.planTier,
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
  registered_by_me: boolean;
  claimed_by_me: boolean;
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
    registered_by_me: r.registeredByMe,
    claimed_by_me: r.claimedByMe,
  };
}

/** One row of the lead's attempt contest — web-internal's `LeadAttemptRow`. */
export interface LeadAttemptWire {
  id: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
}

/**
 * Lead detail (web-internal LeadDetail): lead core + attempt contest.
 *
 * `registered_by_me` / `claimed_by_me` are omitted alongside the rollup: they
 * answer "what is the CALLER's relation to this row" for the Lead Saya board's
 * Peran column, and the detail page already renders the full attempt contest —
 * which says who owns what by name, for everyone, not just the reader.
 */
export interface LeadDetailWire {
  lead: Omit<LeadRowWire, 'open_attempt_count' | 'registered_by_me' | 'claimed_by_me'>;
  attempts: LeadAttemptWire[];
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

/** module6_account.DivisionTask — one per-division task-satuan quota (QA revisi). */
export interface DivisionTaskWire {
  divisi: string;
  jenis: string;
  jumlah: string;
}

/**
 * module6_account.Strategy — a Strategy & Plan record (approved_by/revision_notes
 * omitempty). The structured KPI + GMV-gate + task-satuan keys (QA revisi
 * 2026-08-12) are ALWAYS present — nullable numbers are sent as explicit `null`,
 * never omitted, because a MISSING key blanks the form (O43 failure mode).
 */
export interface StrategyWire {
  id: string;
  service_id: string;
  objective: string;
  target_kpi: string;
  target_gmv: string | null;
  target_roas: string | null;
  target_ctr: string | null;
  target_cvr: string | null;
  client_target_gmv: string | null;
  gmv_adjustment_status: string;
  gmv_adjustment_reason: string | null;
  gmv_adjustment_approved_by: string | null;
  division_tasks: DivisionTaskWire[];
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
    target_gmv: s.targetGmv,
    target_roas: s.targetRoas,
    target_ctr: s.targetCtr,
    target_cvr: s.targetCvr,
    client_target_gmv: s.clientTargetGmv,
    gmv_adjustment_status: s.gmvAdjustmentStatus,
    gmv_adjustment_reason: s.gmvAdjustmentReason,
    gmv_adjustment_approved_by: s.gmvAdjustmentApprovedBy,
    division_tasks: s.divisionTasks.map((t) => ({ divisi: t.divisi, jenis: t.jenis, jumlah: t.jumlah })),
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

/**
 * module6_account.ServiceQueueRow — one Service in an AM's personal queue (§3
 * Rule 4). NO key is omitted: `strategy_id`/`strategy_status` are sent as
 * explicit `null` for a Service without a Plan, because a MISSING key is the O43
 * failure mode (the page renders blank while the route answers 200), and here
 * "no Plan yet" is exactly the state the UI must react to.
 */
export interface ServiceQueueRowWire {
  service_id: string;
  client_id: string;
  toko: string;
  nama_pic: string;
  name: string;
  status: string;
  requires_strategy_plan: boolean;
  pinned_requires_strategy_plan: boolean;
  overridden: boolean;
  /** M6C: which of the three catalog tiers this Service was pinned to. */
  plan_tier: string;
  /** the recorded G-B decision, explicit null while the middle tier is unanswered. */
  gate_decision: string | null;
  /** true when the tier is `ditentukan_am` and G-B has not been answered yet. */
  plan_determination_pending: boolean;
  assigned_am_id: string | null;
  strategy_id: string | null;
  strategy_status: string | null;
  brief_count: number;
  /** the client's target GMV — anchor + ±20% baseline for a new Strategy (QA revisi). */
  client_target_gmv: string | null;
  released_to_account_at: string | null;
}

export function serviceQueueRowToWire(r: account.ServiceQueueRow): ServiceQueueRowWire {
  return {
    service_id: r.serviceId,
    client_id: r.clientId,
    toko: r.toko,
    nama_pic: r.namaPic,
    name: r.name,
    status: r.status,
    requires_strategy_plan: r.requiresStrategyPlan,
    pinned_requires_strategy_plan: r.pinnedRequiresStrategyPlan,
    overridden: r.overridden,
    plan_tier: r.planTier,
    gate_decision: r.gateDecision,
    plan_determination_pending: r.planDeterminationPending,
    assigned_am_id: r.assignedAmId,
    strategy_id: r.strategyId,
    strategy_status: r.strategyStatus,
    brief_count: r.briefCount,
    client_target_gmv: r.clientTargetGmv,
    released_to_account_at: r.releasedToAccountAt ? r.releasedToAccountAt.toISOString() : null,
  };
}

/** Request body → StrategyInput (snake_case wire → camelCase domain). */
export function toStrategyInput(b: {
  objective?: string;
  target_kpi?: string;
  target_gmv?: string | null;
  target_roas?: string | null;
  target_ctr?: string | null;
  target_cvr?: string | null;
  gmv_adjustment_reason?: string | null;
  division_tasks?: { divisi?: string; jenis?: string; jumlah?: string }[];
  divisions_involved?: string[];
  planned_brief_outline?: string;
  timeline_start?: string;
  timeline_end?: string;
}): account.StrategyInput {
  return {
    objective: b.objective ?? '',
    targetKpi: b.target_kpi ?? '',
    targetGmv: b.target_gmv ?? null,
    targetRoas: b.target_roas ?? null,
    targetCtr: b.target_ctr ?? null,
    targetCvr: b.target_cvr ?? null,
    gmvAdjustmentReason: b.gmv_adjustment_reason ?? null,
    divisionTasks: (b.division_tasks ?? []).map((t) => ({
      divisi: t.divisi ?? '', jenis: t.jenis ?? '', jumlah: t.jumlah ?? '',
    })),
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

/** A lead delete request as raised (POST) — no lead join yet. */
export interface DeleteRequestWire {
  id: string;
  lead_id: string;
  reason: string;
  status: string;
  decision_note: string;
  requested_by: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
}

export function deleteRequestToWire(r: leads.DeleteRequest): DeleteRequestWire {
  return {
    id: r.id,
    lead_id: r.leadId,
    reason: r.reason,
    status: r.status,
    decision_note: r.decisionNote,
    requested_by: r.requestedBy,
    resolved_by: r.resolvedBy,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
  };
}

/** One row of the Head's delete-ACC queue — the request joined to its lead. */
export interface DeleteRequestQueueRowWire extends DeleteRequestWire {
  lead_name: string;
  phone_number: string;
  record_status: string;
  origin_division: string;
  requested_by_nama: string;
  resolved_by_nama: string;
}

export function deleteRequestQueueRowToWire(r: leads.DeleteRequestQueueRow): DeleteRequestQueueRowWire {
  return {
    ...deleteRequestToWire(r),
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    record_status: r.recordStatus,
    origin_division: r.originDivision,
    requested_by_nama: r.requestedByNama,
    resolved_by_nama: r.resolvedByNama,
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

/** One fan-out line on the wire: how many units to which PIC (M7 §3 Rule 4). */
export interface AssetAssignmentWire {
  assigned_pic?: string;
  quantity?: number;
}

/**
 * Request body → AssetAssignment[] (fan-out batch). A missing/garbage quantity is
 * carried through as NaN so the domain answers its own BI message rather than
 * having the shape silently degrade into a valid, differently-sized request.
 */
export function toAssetAssignments(rows: AssetAssignmentWire[] | undefined): creative.AssetAssignment[] {
  return (rows ?? []).map((r) => ({ assignedPic: r.assigned_pic ?? '', quantity: Number(r.quantity ?? NaN) }));
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
  period_start?: string; period_end?: string; spend?: string; gmv?: string; ctr?: number | null; cvr?: number | null;
  clicks?: number | null; impressions?: number | null; conversions?: number | null; entry_method?: string;
}): ads.MetricInput {
  return {
    periodStart: b.period_start ?? '', periodEnd: b.period_end ?? '', spend: b.spend ?? '', gmv: b.gmv ?? '',
    ctr: b.ctr ?? null, cvr: b.cvr ?? null,
    clicks: b.clicks ?? null, impressions: b.impressions ?? null, conversions: b.conversions ?? null,
    entryMethod: b.entry_method ?? '',
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
  qty_video: number;
  qty_live: number;
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
    qty_video: b.qtyVideo, qty_live: b.qtyLive,
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
  qty_video?: number | string; qty_live?: number | string;
}): kol.BookingInput {
  const toQty = (v: number | string | undefined): number | undefined =>
    v === undefined || v === null || v === '' ? undefined : Number(v);
  return {
    creatorName: b.creator_name ?? '', creatorHandle: b.creator_handle ?? '', platform: b.platform ?? '',
    niche: b.niche ?? '', sourcePool: b.source_pool ?? '', poolReference: b.pool_reference ?? '',
    agreedRate: b.agreed_rate ?? '', assignedCoordinator: b.assigned_coordinator ?? '',
    qtyVideo: toQty(b.qty_video), qtyLive: toQty(b.qty_live),
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
/** One member row of a division rollup — web-internal's `TeamMember`. */
export interface PerfTeamMemberWire {
  staff_id: string;
  role_type: string;
  final_score: number | null;
  score_display: string;
}

export interface PerfTeamRollupWire {
  division: string;
  period: string;
  members: PerfTeamMemberWire[];
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
  staff_id: string;
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
    staff_id: t.staffId,
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

/** module13_health.PortfolioRow — one active client's line on the /health landing (D-12). */
export interface HealthPortfolioRowWire {
  client_id: string;
  toko: string;
  owner_am: string;
  band: string;
  score_display: string;
  band_drop: boolean;
  open_complaints: number;
  last_closed_recap_week: string | null;
  last_closed_recap_end: string | null;
  on_hold: boolean;
}

export function healthPortfolioRowToWire(r: health.PortfolioRow): HealthPortfolioRowWire {
  return {
    client_id: r.clientId, toko: r.toko, owner_am: r.ownerAm, band: r.band,
    score_display: r.scoreDisplay, band_drop: r.bandDrop, open_complaints: r.openComplaints,
    last_closed_recap_week: r.lastClosedRecapWeek, last_closed_recap_end: r.lastClosedRecapEnd,
    on_hold: r.onHold,
  };
}

// ---------------------------------------------------------------------------
// T-4c — Client Milestone (Upcoming Milestones, RM-11).
// ---------------------------------------------------------------------------

export interface MilestoneWire {
  id: string;
  client_id: string;
  title: string;
  target_date: string;
  status: string;
  created_at: string;
  created_by: string;
}

export function milestoneToWire(m: milestone.Milestone): MilestoneWire {
  return {
    id: m.id, client_id: m.clientId, title: m.title, target_date: m.targetDate,
    status: m.status, created_at: m.createdAt.toISOString(), created_by: m.createdBy,
  };
}

// ---------------------------------------------------------------------------
// Penugasan Internal (TSK-) — atasan → anggota tim, di luar rantai klien.
//
// The three lateness keys are DERIVED server-side and sent explicitly. They are
// deliberately not left for the page to compute: "am I late" would then have two
// implementations that disagree the moment one of them forgets that the
// comparison is in WIB, and the one the staff member sees would not be the one
// the discipline report counts.
// ---------------------------------------------------------------------------

export interface InternalTaskWire {
  id: string;
  judul: string;
  deskripsi: string;
  assignee_id: string;
  assignee_division: string;
  due_date: string;
  lampiran_link: string;
  link_hasil: string;
  status: string;
  dimulai_pada: string | null;
  selesai_pada: string | null;
  dibatalkan_pada: string | null;
  alasan_pembatalan: string;
  created_at: string;
  created_by: string;
  terlambat_berjalan: boolean;
  selesai_terlambat: boolean;
  hari_terlambat: number;
}

export function internalTaskToWire(t: internaltask.InternalTask): InternalTaskWire {
  return {
    id: t.id, judul: t.judul, deskripsi: t.deskripsi,
    assignee_id: t.assigneeId, assignee_division: t.assigneeDivision,
    due_date: t.dueDate, lampiran_link: t.lampiranLink, link_hasil: t.linkHasil,
    status: t.status,
    // Explicit null, never omitted: a MISSING key blanks a page far more
    // confusingly than a null one (CLAUDE.md, wire boundary).
    dimulai_pada: t.dimulaiPada ? t.dimulaiPada.toISOString() : null,
    selesai_pada: t.selesaiPada ? t.selesaiPada.toISOString() : null,
    dibatalkan_pada: t.dibatalkanPada ? t.dibatalkanPada.toISOString() : null,
    alasan_pembatalan: t.alasanPembatalan,
    created_at: t.createdAt.toISOString(), created_by: t.createdBy,
    terlambat_berjalan: t.terlambatBerjalan,
    selesai_terlambat: t.selesaiTerlambat,
    hari_terlambat: t.hariTerlambat,
  };
}

export interface DisciplineRowWire {
  assignee_id: string;
  assignee_division: string;
  total: number;
  selesai_tepat_waktu: number;
  selesai_terlambat: number;
  terlambat_berjalan: number;
  berjalan: number;
  dibatalkan: number;
  ketepatan_pct: number | null;
  ketepatan_display: string;
  total_hari_terlambat: number;
}

export function disciplineRowToWire(r: internaltask.DisciplineRow): DisciplineRowWire {
  return {
    assignee_id: r.assigneeId, assignee_division: r.assigneeDivision, total: r.total,
    selesai_tepat_waktu: r.selesaiTepatWaktu, selesai_terlambat: r.selesaiTerlambat,
    terlambat_berjalan: r.terlambatBerjalan, berjalan: r.berjalan, dibatalkan: r.dibatalkan,
    // Both forms travel: the raw ratio for sorting/graphing, the pre-formatted
    // string for rendering ("—" on a zero denominator, house rule #7). The page
    // renders `ketepatan_display` VERBATIM and never reformats it.
    ketepatan_pct: r.ketepatanPct, ketepatan_display: r.ketepatanDisplay,
    total_hari_terlambat: r.totalHariTerlambat,
  };
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

/**
 * One row of the lead-intake campaign picker — web-internal's
 * `marketing.ts::SelectableCampaign`.
 *
 * Deliberately NOT MarketingCampaignWire: the picker is served to Sales, so it
 * carries only what identifies a campaign in a dropdown plus the derived lead
 * funnel. No `owner_employee_id`, no `created_by`, no `end_date`, and no money —
 * budget/CPL/CPRL/ROAS stay on the M2 surface. `status` IS carried: it is what
 * lets the UI mark a Paused/Closed/Draft pick instead of presenting it as live.
 *
 * The three counts keep M2's own wire names (`lead_by_dashboard`,
 * `lead_real_by_sales`) so the same number never travels under two spellings;
 * `lead_not_qualified` is their mirror and has no M2 counterpart.
 */
export interface SelectableCampaignWire {
  id: string;
  name: string;
  channel: string;
  status: string;
  start_date: string;
  lead_by_dashboard: number;
  lead_real_by_sales: number;
  lead_not_qualified: number;
}

export function selectableCampaignToWire(c: campaign.SelectableCampaign): SelectableCampaignWire {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    status: c.status,
    start_date: c.startDate,
    lead_by_dashboard: c.leadByDashboard,
    lead_real_by_sales: c.leadRealBySales,
    lead_not_qualified: c.leadNotQualified,
  };
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

/** One junk-reason tally of the Auto-Metrics view — web-internal's `JunkReason`. */
export interface JunkReasonWire {
  reason: string;
  count: number;
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
  junk_breakdown: JunkReasonWire[];
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

// --- M0 attempt list + detail (Go module0_sales/reads.go) ---

/** GET /attempts row — web-internal's `AttemptRow` (lib/sales.ts). */
export interface AttemptRowWire {
  id: string;
  lead_id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
  created_at: string;
}

export function attemptRowToWire(r: sales.AttemptListRow): AttemptRowWire {
  return {
    id: r.id,
    lead_id: r.leadId,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    source: r.source,
    owner_employee_id: r.ownerEmployeeId,
    owner_nama: r.ownerNama,
    status: r.status,
    claimed_at: r.claimedAt.toISOString(),
    created_at: r.createdAt.toISOString(),
  };
}

/** qualified_form_services line — web-internal's `QualifiedFormServiceRow`. */
export interface QualifiedFormServiceWire {
  master_service_id: string;
  master_version_no: number;
  name: string;
  quantity: string;
  unit: string | null;
  pricing_mode: string;
  standard_price: string;
  input_amount: string | null;
  subtotal: string;
  commission_rule: string;
}

/** The persisted Qualified form snapshot — web-internal's `QualifiedFormSnapshot`. */
export interface QualifiedFormWire {
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  platform: string;
  store_link: string | null;
  gmv_baseline: string;
  target_gmv: string;
  marketing_budget: string | null;
  services: QualifiedFormServiceWire[];
}

/** One line of a negotiation proposal — web-internal's `ProposalLineRow`. */
export interface ProposalLineWire {
  master_service_id: string;
  name: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms: string | null;
}

/** One negotiation proposal + its lines — web-internal's `NegotiationProposalRow`. */
export interface ProposalWire {
  id: string;
  version_no: number;
  proposed_by: string;
  proposed_by_nama: string;
  decision_note: string | null;
  created_at: string;
  lines: ProposalLineWire[];
}

/** The attempt block of GET /attempts/{id} — web-internal's `AttemptDetailAttempt`. */
export interface AttemptDetailAttemptWire {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
  created_at: string;
}

/**
 * The lead block of GET /attempts/{id} — web-internal's `AttemptDetailLead`.
 *
 * Deliberately NARROWER than `LeadRowWire`: this is the lead as the closing page
 * reads it, so it carries no `origin_division` / `open_attempt_count`. Extending
 * `LeadRowWire` here would emit columns no consumer declares.
 */
export interface AttemptDetailLeadWire {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  record_status: string;
  origin_campaign_id: string | null;
  last_touch_campaign_id: string | null;
  winning_attempt_id: string | null;
}

/** GET /attempts/{id} — web-internal's `AttemptDetail` (lib/sales.ts). */
export interface AttemptDetailWire {
  attempt: AttemptDetailAttemptWire;
  lead: AttemptDetailLeadWire;
  qualified_form: QualifiedFormWire | null;
  proposals: ProposalWire[];
  nq_reasons: string[];
  allowed_transitions: string[];
}

/**
 * Maps the domain AttemptDetail to the wire shape — a 1:1 port of Go's
 * `AttemptDetail` json tags.
 *
 * `qualified_form` is sent as an explicit `null` when there is no draft yet, not
 * omitted: the FE type declares `QualifiedFormSnapshot | null` and a MISSING key
 * is what blanks the page (the O43 lesson). Same reasoning for the three nullable
 * campaign/email ids on the lead block.
 *
 * `proposals`, `nq_reasons` and `allowed_transitions` are always arrays, never
 * null — Go initializes all three to `[]`, and the FE maps over them unguarded.
 */
export function attemptDetailToWire(d: sales.AttemptDetail): AttemptDetailWire {
  const q = d.qualifiedForm;
  return {
    attempt: {
      id: d.attempt.id,
      lead_id: d.attempt.leadId,
      owner_employee_id: d.attempt.ownerEmployeeId,
      owner_nama: d.attempt.ownerNama,
      status: d.attempt.status,
      claimed_at: d.attempt.claimedAt.toISOString(),
      created_at: d.attempt.createdAt.toISOString(),
    },
    lead: {
      id: d.lead.id,
      lead_name: d.lead.leadName,
      phone_number: d.lead.phoneNumber,
      email: d.lead.email,
      source: d.lead.source,
      record_status: d.lead.recordStatus,
      origin_campaign_id: d.lead.originCampaignId,
      last_touch_campaign_id: d.lead.lastTouchCampaignId,
      winning_attempt_id: d.lead.winningAttemptId,
    },
    qualified_form: q === null ? null : {
      nama_pic: q.namaPic,
      toko: q.toko,
      kota: q.kota,
      link_toko: q.linkToko,
      kategori: q.kategori,
      platform: q.platform,
      store_link: q.storeLink,
      gmv_baseline: q.gmvBaseline,
      target_gmv: q.targetGmv,
      marketing_budget: q.marketingBudget,
      services: q.services.map((s) => ({
        master_service_id: s.masterServiceId,
        master_version_no: s.masterVersionNo,
        name: s.name,
        quantity: s.quantity,
        unit: s.unit,
        pricing_mode: s.pricingMode,
        standard_price: s.standardPrice,
        input_amount: s.inputAmount,
        subtotal: s.subtotal,
        commission_rule: s.commissionRule,
      })),
    },
    proposals: d.proposals.map((p) => ({
      id: p.id,
      version_no: p.versionNo,
      proposed_by: p.proposedBy,
      proposed_by_nama: p.proposedByNama,
      decision_note: p.decisionNote,
      created_at: p.createdAt.toISOString(),
      lines: p.lines.map((l) => ({
        master_service_id: l.masterServiceId,
        name: l.name,
        proposed_price: l.proposedPrice,
        commission_rule: l.commissionRule,
        payment_terms: l.paymentTerms,
      })),
    })),
    nq_reasons: d.nqReasons,
    allowed_transitions: d.allowedTransitions,
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
      managed_since: p.managedSince ? tz.dateString(p.managedSince) : null,
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

/**
 * `directory.AssignableEmployee` as web-internal's `AssignableEmployee` expects
 * it — the payload of every "who does this?" dropdown.
 *
 * NARROWER than `AdminEmployeeWire` on purpose: no `email`, no `flagged`, no
 * `synced_at`. The admin roster is Director/OD; this one is read by every actor
 * with a division scope, so it carries only what is needed to pick a person and
 * what the assignment endpoints validate against (`division`/`level`).
 */
export interface AssignableEmployeeWire {
  employee_id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

/** directory.AssignableEmployee → wire (snake_case). */
export function assignableEmployeeToWire(e: directory.AssignableEmployee): AssignableEmployeeWire {
  return {
    employee_id: e.employeeId,
    nama: e.nama,
    divisi: e.divisi,
    jabatan: e.jabatan,
    division: e.division,
    level: e.level,
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

/** `auth.CredentialInfo` as the admin credential-status table expects it. */
export interface CredentialInfoWire {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  has_password: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  password_changed_at: string | null;
}

/**
 * auth.CredentialInfo → wire. Carries NO hash and no password field: the audit
 * and wire layers must never surface credential material
 * (SUPABASE_MIGRATION_TECH_APPENDIX §B.3), only its status.
 */
export function credentialInfoToWire(c: auth.CredentialInfo): CredentialInfoWire {
  return {
    employee_id: c.employeeId,
    nama: c.nama,
    email: c.email,
    divisi: c.divisi,
    jabatan: c.jabatan,
    has_password: c.hasPassword,
    must_change_password: c.mustChangePassword,
    locked_until: c.lockedUntil ? c.lockedUntil.toISOString() : null,
    password_changed_at: c.passwordChangedAt ? c.passwordChangedAt.toISOString() : null,
  };
}

// --- M5 Admin & Finance (Go trxView / instViews / reminderViews /
//     outstandingViews / BermasalahStatus) ---
//
// This whole section was MISSING: `finance` was the only domain module with no
// wire mappers at all, so every M5 route either shipped camelCase straight to a
// snake_case client or invented an ad-hoc `{ok:true}`. That is the O43 defect
// class, and in M5 it covered the entire money path — see the route diffs in the
// handoff. Shapes below mirror web-internal/src/lib/finance.ts exactly.
//
// One deliberate difference from Go: Go tags these fields `omitempty`, so a null
// due date DROPS the key. Here a null is emitted explicitly, because the FE types
// declare `string | null` and a MISSING key is what blanks a page (O43's lesson).
// Never "simplify" these back to omitting.

/** module5_finance.InstallmentRow as web-internal's `Installment` expects it. */
export interface InstallmentWire {
  id: string;
  installment_no: number;
  amount: string;
  amount_verified: string;
  due_date: string | null;
  status: string;
  jatuh_tempo: boolean;
  verified_date: string | null;
  verified_by: string;
  proof_of_payment: string;
}

/** Maps a domain InstallmentRow to the wire shape. */
export function installmentToWire(i: finance.InstallmentRow): InstallmentWire {
  return {
    id: i.id,
    installment_no: i.installmentNo,
    // Money is formatted HERE, exactly like Go's `instViews`/`trxView` call
    // `.Format()` — these fields crossed the wire as raw decimals ("9000000.00"),
    // and the finance pages render them as-is, so every amount on Module 5 read
    // "9000000.00" instead of the house "Rp. 9.000.000,00" (rule #7).
    amount: idr(i.amount),
    amount_verified: idr(i.amountVerified),
    // Both are `date` columns (`installments.due_date`, `.verified_date`) and the
    // FE declares them `// YYYY-MM-DD` (account.ts). See remindersToWire for why
    // toISOString() is wrong here. `null` stays explicit — a MISSING key blanks
    // the page, `null` does not (O43 house stance).
    due_date: i.dueDate ? tz.dateString(i.dueDate) : null,
    status: i.status,
    jatuh_tempo: i.jatuhTempo,
    verified_date: i.verifiedDate ? tz.dateString(i.verifiedDate) : null,
    verified_by: i.verifiedBy ?? '',
    proof_of_payment: i.proofOfPayment ?? '',
  };
}

/** module5_finance.TransactionRecord as web-internal's `Transaction` expects it. */
export interface TransactionWire {
  id: string;
  client_id: string;
  payment_intent_scheme: string;
  total_agreed_value: string;
  amount_verified: string;
  amount_outstanding: string;
  payment_status: string;
  bermasalah: boolean;
  contract_attachment: string;
  released_to_account_at: string | null;
  installments: InstallmentWire[];
}

/** Maps the domain Transaction aggregate to the wire shape (Go trxView). */
export function transactionToWire(t: finance.TransactionAggregate): TransactionWire {
  return {
    id: t.id,
    client_id: t.clientId,
    payment_intent_scheme: t.scheme,
    // Same as installmentToWire: Go's trxView formats all three with `.Format()`,
    // and web-internal's `Transaction` documents them as pre-formatted IDR.
    total_agreed_value: idr(t.totalAgreedValue),
    amount_verified: idr(t.amountVerified),
    amount_outstanding: idr(t.amountOutstanding),
    payment_status: t.paymentStatus,
    bermasalah: t.bermasalah,
    contract_attachment: t.contractAttachment ?? '',
    released_to_account_at: t.releasedToAccountAt ? t.releasedToAccountAt.toISOString() : null,
    installments: t.installments.map(installmentToWire),
  };
}

/** One [Bermasalah] vote as web-internal's `BermasalahVote` expects it. */
export interface BermasalahVoteWire {
  division: string;
  decision: string;
  note: string;
  actor: string;
  created_at: string;
}

/** BermasalahStatus as web-internal expects it. */
export interface BermasalahStatusWire {
  transaction_id: string;
  flagged: boolean;
  finance_vote: string;
  account_vote: string;
  director_vote: string;
  escalated: boolean;
  votes: BermasalahVoteWire[];
}

/** Maps the domain [Bermasalah] status view to the wire shape. */
export function bermasalahStatusToWire(s: finance.BermasalahStatusView): BermasalahStatusWire {
  return {
    transaction_id: s.transactionId,
    flagged: s.flagged,
    finance_vote: s.financeVote,
    account_vote: s.accountVote,
    director_vote: s.directorVote,
    escalated: s.escalated,
    votes: s.votes.map((v) => ({
      division: v.division,
      decision: v.decision,
      note: v.note,
      actor: v.actor,
      created_at: v.createdAt.toISOString(),
    })),
  };
}

/**
 * One filed transaction change (M5-OA-7) as web-internal's
 * `SchemeChangeRequest` expects it. Every amount — including the ones inside
 * `schedule` — is pre-formatted `Rp. X.XXX.XXX,00` like the rest of M5 (rule
 * #7), because this body is only ever RENDERED. A re-filing does not echo it
 * back: the form posts freshly typed plain numbers, which the server re-parses.
 */
export interface SchemeChangeScheduleItemWire {
  amount: string;
  due_date: string;
}

export interface SchemeChangeRequestWire {
  id: string;
  transaction_id: string;
  from_scheme: string;
  to_scheme: string;
  schedule: SchemeChangeScheduleItemWire[];
  amount_outstanding: string;
  reason: string;
  status: string;
  decision_note: string;
  requested_by: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
  // Joined context — present only on the queue projection, always emitted so a
  // missing key never blanks the page (O43 house stance).
  client_id: string;
  toko: string;
  total_agreed_value: string;
  payment_status: string;
  requested_by_nama: string;
  resolved_by_nama: string;
}

export function schemeChangeRequestToWire(
  r: finance.SchemeChangeRequest | finance.SchemeChangeQueueRow,
): SchemeChangeRequestWire {
  const q = r as finance.SchemeChangeQueueRow;
  return {
    id: r.id,
    transaction_id: r.transactionId,
    from_scheme: r.fromScheme,
    to_scheme: r.toScheme,
    schedule: r.schedule.map((s) => ({ amount: idr(s.amount), due_date: s.dueDate })),
    amount_outstanding: idr(r.amountOutstanding),
    reason: r.reason,
    status: r.status,
    decision_note: r.decisionNote,
    requested_by: r.requestedBy,
    resolved_by: r.resolvedBy,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
    client_id: q.clientId ?? '',
    toko: q.toko ?? '',
    total_agreed_value: q.totalAgreedValue ? idr(q.totalAgreedValue) : '',
    payment_status: q.paymentStatus ?? '',
    requested_by_nama: q.requestedByNama ?? '',
    resolved_by_nama: q.resolvedByNama ?? '',
  };
}

/** One reminder row as web-internal's `ReminderRow` expects it. */
export interface ReminderRowWire {
  client_id: string;
  toko: string;
  transaction_id: string;
  installment_id: string;
  installment_no: number;
  amount: string;
  due_date: string;
  status: string;
  days_overdue: number;
  label: string;
}

/** One outstanding-no-due-date row as web-internal's `OutstandingRow` expects it. */
export interface OutstandingRowWire {
  client_id: string;
  toko: string;
  transaction_id: string;
  amount_outstanding: string;
}

/** The reminder dashboard as web-internal's `RemindersResponse` expects it. */
export interface RemindersWire {
  reminders: ReminderRowWire[];
  outstanding_no_due_date: OutstandingRowWire[];
}

/**
 * Maps the reminder dashboard. The domain splits overdue/upcoming; Go's wire
 * shape is ONE `reminders` list, overdue first (most-overdue leading) then
 * upcoming — so they are concatenated in that order here, not exposed as two
 * keys. The route used to hand the FE the raw camelCase
 * `{overdue, upcoming, outstandingNoDueDate}`, which matched none of the three
 * keys the reminders page reads.
 */
export function remindersToWire(d: finance.ReminderDashboard): RemindersWire {
  const row = (r: finance.ReminderRow): ReminderRowWire => ({
    client_id: r.clientId,
    toko: r.toko,
    transaction_id: r.transactionId,
    installment_id: r.installmentId,
    installment_no: r.installmentNo,
    // House IDR at the boundary, like Go's `reminderViews` (`.Format()`) — the
    // reminders page prints this raw, so an unformatted decimal shows up as
    // "15000000.00" next to a Bahasa Indonesia overdue label (rule #7).
    amount: idr(r.amount),
    // WIB calendar date, matching Go's Format("2006-01-02") and the FE contract
    // (`// YYYY-MM-DD`). NOT toISOString(): `installments.due_date` is a `date`
    // column, and RFC3339 renders as "2026-07-30T00:00:00.000Z" on a page that
    // prints the value raw. `tz.daysBetween(due_date, today)` drives daysOverdue,
    // so the date shown must be the same calendar date the overdue count used.
    due_date: r.dueDate ? tz.dateString(r.dueDate) : '',
    status: r.status,
    days_overdue: r.daysOverdue,
    label: r.label,
  });
  return {
    reminders: [...d.overdue, ...d.upcoming].map(row),
    outstanding_no_due_date: d.outstandingNoDueDate.map((o) => ({
      client_id: o.clientId,
      toko: o.toko,
      transaction_id: o.transactionId,
      amount_outstanding: idr(o.amountOutstanding), // Go outstandingViews: .Format()
    })),
  };
}

/** The reminder-scan tally as web-internal's finance `ScanResult` expects it. */
export interface FinanceScanResultWire {
  overdue_flagged: number;
  h3_reminders_sent: number;
  contract_flags_raised: number;
}

/**
 * Maps the reminder-scan tally — a 1:1 port of Go's `ScanResult` json tags, and
 * the three keys the finance page reads. Two things were wrong before: the route
 * nested the tally under a `summary` key Go has no equivalent of, and the domain's
 * four camelCase counters share no name with the wire's three.
 *
 * The domain's `overdueNotified` deliberately does NOT cross the wire: Go's
 * `OverdueFlagged` counts installments actually TRANSITIONED to [Jatuh Tempo]
 * (its `fireOverdue` returns true only then), which is `markedOverdue` here. Go
 * has no separate notification counter, and inventing a fourth wire key would be
 * a field the PRD never defined.
 */
export function financeScanResultToWire(s: finance.ScanSummary): FinanceScanResultWire {
  return {
    overdue_flagged: s.markedOverdue,
    h3_reminders_sent: s.upcomingNotified,
    contract_flags_raised: s.contractFlagged,
  };
}

// --- M4 service void (Go module4_client.VoidResult) ---

/** The void cascade result as web-internal's `VoidResult` (lib/clients.ts) expects it. */
export interface VoidResultWire {
  service_id: string;
  voided_briefs: string[];
  skipped_approved_briefs: string[];
}

/**
 * Maps the void cascade result. The route used to hand the FE the raw camelCase
 * domain object, so all three keys read `undefined` — including the list of
 * [Approved] briefs the void deliberately left standing, which is the one thing
 * the actor needs to see afterwards.
 */
export function voidResultToWire(v: client.VoidResult): VoidResultWire {
  return {
    service_id: v.serviceId,
    voided_briefs: v.voidedBriefs,
    skipped_approved_briefs: v.skippedApprovedBriefs,
  };
}

// --- Sprint-0 demo task (Go internal/demo.Task) ---

/** A demo task as web-internal's `DemoTask` / `DemoTaskDetail.task` expects it. */
export interface DemoTaskWire {
  id: string;
  title: string;
  description: string;
  division: string;
  status: string;
  created_by: string;
  created_at: string;
}

export function demoTaskToWire(t: demo.Task): DemoTaskWire {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    division: t.division,
    status: t.status,
    created_by: t.createdBy,
    created_at: t.createdAt.toISOString(),
  };
}

/** GET /demo-tasks/{id} — web-internal's `DemoTaskDetail` (lib/types.ts). */
export interface DemoTaskDetailWire {
  task: DemoTaskWire;
  allowed_transitions: string[];
  audit: AuditEntryWire[];
}

/**
 * Maps the demo-task detail — a 1:1 port of Go's handleGetDemoTask envelope.
 *
 * All three keys are mandatory, not decoration: the page destructures
 * `{task, allowed_transitions, audit}` and immediately reads
 * `allowed_transitions.length` and `findPendingBlockRequest(audit)`. Sending only
 * `{task}` left both undefined, so the page threw a TypeError instead of merely
 * rendering empty — the loudest failure mode in the whole O43 class.
 */
export function demoTaskDetailToWire(
  task: demo.Task,
  allowed: string[],
  trail: audit.AuditEntry[],
): DemoTaskDetailWire {
  return {
    task: demoTaskToWire(task),
    allowed_transitions: allowed,
    audit: trail.map(auditEntryToWire),
  };
}

// --- Cross-module audit trail (Go audit.Entry) ---

/** One audit entry as web-internal's `AuditEntry` (lib/types.ts) expects it. */
export interface AuditEntryWire {
  entity_type: string;
  entity_id: string;
  actor_employee_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

/** Maps a domain AuditEntry to the wire shape. */
export function auditEntryToWire(e: audit.AuditEntry): AuditEntryWire {
  return {
    entity_type: e.entityType,
    entity_id: e.entityId,
    actor_employee_id: e.actorEmployeeId,
    action: e.action,
    before_json: e.beforeJson,
    after_json: e.afterJson,
    created_at: e.createdAt.toISOString(),
  };
}

// --- M1 Marketing bulk import (Go BulkReport / BulkRowResult) ---

/** Per-row verdict as web-internal's `BulkRowResult` expects it. */
export interface BulkRowResultWire {
  row_number: number;
  lead_name: string;
  phone_number: string;
  imported: boolean;
  reopened: boolean;
  lead_id: string;
  reason: string;
}

/** The bulk-import report as web-internal's `BulkReport` expects it. */
export interface BulkReportWire {
  imported: number;
  rejected: number;
  summary: string;
  rows: BulkRowResultWire[];
  rejections: BulkRowResultWire[];
}

/**
 * Maps the bulk-import report. `summary` and `rejections` are part of the body
 * (Go computes them in the handler from BulkReport methods), not client-derived —
 * the FE renders the summary line verbatim and offers `rejections` as the
 * downloadable reject list (M1 §3 Flow 7).
 */
export function bulkReportToWire(r: leads.BulkReport): BulkReportWire {
  const row = (v: leads.BulkRowResult): BulkRowResultWire => ({
    row_number: v.rowNumber,
    lead_name: v.leadName,
    phone_number: v.phoneNumber,
    imported: v.imported,
    reopened: v.reopened,
    lead_id: v.leadId,
    reason: v.reason,
  });
  return {
    imported: r.imported,
    rejected: r.rejected,
    summary: r.summary,
    rows: r.rows.map(row),
    rejections: r.rejections.map(row),
  };
}

// --- M0 §5 negotiation proposal lines (request body → domain) ---

/** One `lines[]` entry on the negotiation / resubmit / Edit Service bodies. */
export interface ProposalLineBody {
  master_service_id?: string;
  proposed_price?: string;
  commission_rule?: string;
  payment_terms?: string;
  quantity?: number;
  amount?: string;
}

/**
 * toProposalLines maps proposal-line bodies to domain lines, shared by the three
 * routes that accept them (`/negotiation`, `/negotiation/resubmit`, `/services`).
 *
 * `proposed_price` / `commission_rule` are passed through UNTOUCHED including the
 * empty string, because empty is meaningful: it is what tells the domain "price
 * this line from the MSL at standard terms" (sales.isCustomLine). Defaulting them
 * to anything else would turn a standard line into a custom one and, on the
 * no-negotiation path, get the whole submission refused.
 */
export function toProposalLines(rows: ProposalLineBody[] | undefined): sales.ProposalLine[] {
  return (rows ?? []).map((l) => ({
    masterServiceId: l.master_service_id ?? '',
    proposedPrice: l.proposed_price ?? '',
    commissionRule: l.commission_rule ?? '',
    paymentTerms: l.payment_terms,
    quantity: l.quantity,
    amount: l.amount,
  }));
}

// --- M0 §3 batch lead registration (QA revisi 2026-08-07) ---

/** Per-row verdict as web-internal's `BatchRegisterRowResult` expects it. */
export interface BatchRegisterRowResultWire {
  row_number: number;
  lead_name: string;
  phone_number: string;
  registered: boolean;
  lead_id: string;
  attempt_id: string;
  notice: string;
  reason: string;
}

/** The batch-registration report as web-internal's `BatchRegisterReport` expects it. */
export interface BatchRegisterReportWire {
  registered: number;
  rejected: number;
  summary: string;
  rows: BatchRegisterRowResultWire[];
  rejections: BatchRegisterRowResultWire[];
}

/**
 * Maps the batch-registration report. Every field is emitted explicitly — a
 * MISSING key is worse than a null one here (CLAUDE.md §camelCase boundary): the
 * page renders `notice` / `reason` per row, and an omitted `registered` would read
 * as `false` and paint a successful row as rejected.
 */
export function batchRegisterReportToWire(r: leads.BatchRegisterReport): BatchRegisterReportWire {
  const row = (v: leads.BatchRegisterRowResult): BatchRegisterRowResultWire => ({
    row_number: v.rowNumber,
    lead_name: v.leadName,
    phone_number: v.phoneNumber,
    registered: v.registered,
    lead_id: v.leadId,
    attempt_id: v.attemptId,
    notice: v.notice,
    reason: v.reason,
  });
  return {
    registered: r.registered,
    rejected: r.rejected,
    summary: r.summary,
    rows: r.rows.map(row),
    rejections: r.rejections.map(row),
  };
}

/** One logged prospect activity — web-internal's `ActivityRow`. */
export interface ActivityWire {
  id: string;
  attempt_id: string;
  lead_id: string;
  activity_type: string;
  occurred_at: string;
  summary: string;
  created_by: string;
  created_by_nama: string;
  created_at: string;
}

/** Maps one activity log entry (ACT-). */
export function activityToWire(a: activity.Activity): ActivityWire {
  return {
    id: a.id,
    attempt_id: a.attemptId,
    lead_id: a.leadId,
    activity_type: a.activityType,
    occurred_at: a.occurredAt.toISOString(),
    summary: a.summary,
    created_by: a.createdBy,
    created_by_nama: a.createdByNama,
    created_at: a.createdAt.toISOString(),
  };
}

/** The derived effort rollup for one attempt — web-internal's `EffortSummary`. */
export interface EffortSummaryWire {
  attempt_id: string;
  total: number;
  by_type: Record<string, number>;
  last_activity_at: string | null;
}

/**
 * Maps the effort rollup. `last_activity_at` is sent as an EXPLICIT null when
 * there is no activity yet — a missing key would render the panel blank rather
 * than "belum ada aktivitas" (CLAUDE.md: kunci yang HILANG lebih berbahaya
 * daripada null).
 */
export function effortToWire(e: activity.EffortSummary): EffortSummaryWire {
  return {
    attempt_id: e.attemptId,
    total: e.total,
    by_type: e.byType,
    last_activity_at: e.lastActivityAt === null ? null : e.lastActivityAt.toISOString(),
  };
}

/**
 * module6C.Gate + its G-A context — the plan-gate determination for one Service.
 *
 * Every optional field is sent as an EXPLICIT null, including the whole `gate`
 * object when no determination exists yet: "belum ditentukan" is precisely the
 * state the form must react to, and a missing key renders the panel blank while
 * the route answers 200 (the O43 failure mode).
 *
 * `pemicu_*` are sent as-is rather than recomputed client-side. They are the
 * STORED triggers (M6C §10) — the numbers that actually fired when the decision
 * was made, which is what makes an old decision auditable after a threshold
 * change.
 */
export interface PlanGateTriggerWire {
  kode: string;
  label: string;
  dasar: string;
}

/** GB-8 — the four fields the no-Plan path leaves behind. Named (not inline)
 *  so the shape guard can follow it to `account.ts::AssignmentSummary`. */
export interface PlanGateAssignmentSummaryWire {
  deliverable: string;
  deadline: string;
  divisi_pic: string;
  hasil_diharapkan: string;
}

export interface PlanGateWire {
  service_id: string;
  tier_katalog: string;
  divisi_terlibat: string[];
  deliverable: string;
  kuota_per_periode: number | null;
  durasi_bulan: number | null;
  berulang: boolean;
  nilai_per_bulan: string | null;
  target_angka_jenis: string | null;
  target_angka_nilai: string | null;
  sequence_dependency: boolean;
  laporan_periodik: boolean;
  floor_price: unknown | null;
  pemicu_keras: PlanGateTriggerWire[];
  pemicu_lunak: PlanGateTriggerWire[];
  config_version_no: number;
  rekomendasi: string;
  keputusan_am: string;
  kesesuaian: string;
  alasan: string | null;
  pemantauan_alternatif: string | null;
  tanggal_tinjau_ulang: string;
  ringkasan_penugasan: PlanGateAssignmentSummaryWire | null;
  plan_id: string | null;
  decided_by: string;
  decided_at: string;
}

export function planGateToWire(g: plangate.Gate): PlanGateWire {
  return {
    service_id: g.serviceId,
    tier_katalog: g.tierKatalog,
    divisi_terlibat: g.divisiTerlibat,
    deliverable: g.deliverable,
    kuota_per_periode: g.kuotaPerPeriode,
    durasi_bulan: g.durasiBulan,
    berulang: g.berulang,
    nilai_per_bulan: g.nilaiPerBulan,
    target_angka_jenis: g.targetJenis,
    target_angka_nilai: g.targetNilai,
    sequence_dependency: g.sequenceDependency,
    laporan_periodik: g.laporanPeriodik,
    floor_price: g.floorPrice ?? null,
    pemicu_keras: g.pemicuKeras,
    pemicu_lunak: g.pemicuLunak,
    config_version_no: g.configVersionNo,
    rekomendasi: g.rekomendasi,
    keputusan_am: g.keputusanAm,
    kesesuaian: g.kesesuaian,
    alasan: g.alasan,
    pemantauan_alternatif: g.pemantauanAlternatif,
    tanggal_tinjau_ulang: g.tanggalTinjauUlang,
    ringkasan_penugasan:
      g.ringkasanPenugasan === null
        ? null
        : {
            deliverable: g.ringkasanPenugasan.deliverable,
            deadline: g.ringkasanPenugasan.deadline,
            divisi_pic: g.ringkasanPenugasan.divisiPic,
            hasil_diharapkan: g.ringkasanPenugasan.hasilDiharapkan,
          },
    plan_id: g.planId,
    decided_by: g.decidedBy,
    decided_at: g.decidedAt,
  };
}

export interface PlanGateConfigWire {
  version_no: number;
  kuota_threshold: number;
  nilai_threshold: string;
  durasi_threshold_bulan: number;
  notif_join_threshold: string;
}

export interface PlanGateContextWire {
  service_id: string;
  service_name: string;
  client_id: string;
  toko: string | null;
  tier_katalog: string;
  standard_price: string;
  frequency: string | null;
  unit: string | null;
  min_qty: number | null;
  category: string | null;
  plan_satuan_status: string;
  ada_kontrak_full_management: boolean;
  config: PlanGateConfigWire;
  gate: PlanGateWire | null;
  requires_plan: boolean;
  perlu_penentuan: boolean;
}

export function planGateContextToWire(c: plangate.GateContext): PlanGateContextWire {
  return {
    service_id: c.serviceId,
    service_name: c.serviceName,
    client_id: c.clientId,
    toko: c.toko,
    tier_katalog: c.tierKatalog,
    standard_price: c.standardPrice,
    frequency: c.frequency,
    unit: c.unit,
    min_qty: c.minQty,
    category: c.category,
    plan_satuan_status: c.planSatuanStatus,
    ada_kontrak_full_management: c.adaKontrakFullManagement,
    config: {
      version_no: c.config.versionNo,
      kuota_threshold: c.config.kuotaThreshold,
      nilai_threshold: c.config.nilaiThreshold,
      durasi_threshold_bulan: c.config.durasiThresholdBulan,
      notif_join_threshold: c.config.notifJoinThreshold,
    },
    gate: c.gate === null ? null : planGateToWire(c.gate),
    requires_plan: c.requiresPlan,
    perlu_penentuan: c.perluPenentuan,
  };
}

/** The live recommendation preview (GB-1/GB-2) with no write. */
export interface PlanGateRecommendationWire {
  pemicu_keras: PlanGateTriggerWire[];
  pemicu_lunak: PlanGateTriggerWire[];
  rekomendasi: string;
  ringkasan: string;
}

export function planGateRecommendationToWire(
  r: plangate.Recommendation,
): PlanGateRecommendationWire {
  return {
    pemicu_keras: r.pemicuKeras,
    pemicu_lunak: r.pemicuLunak,
    rekomendasi: r.rekomendasi,
    ringkasan: r.ringkasan,
  };
}

/**
 * Inbound counterpart for the GB-8 summary: wire (snake_case) → domain
 * (camelCase).
 *
 * This exists because it was missing, and the HTTP walk caught it: the
 * plan-gate routes handed `b.ringkasan_penugasan` straight into the domain,
 * whose `AssignmentSummary` reads `divisiPic`/`hasilDiharapkan`. Every field
 * arrived `undefined`, so a de-escalation that DID carry a complete summary was
 * rejected with `[ringkasan penugasan wajib diisi untuk jalur tanpa Plan]` — a
 * validation error blaming the caller for a translation the route never did.
 *
 * Returns null for a missing or non-object body value; the domain's own GB-8
 * completeness check then produces the BI message, so a partial summary is still
 * rejected here rather than silently stored half-filled.
 */
export function assignmentSummaryFromWire(
  v: unknown,
): plangate.AssignmentSummary | null {
  if (v === null || typeof v !== 'object') return null;
  const r = v as Partial<PlanGateAssignmentSummaryWire>;
  return {
    deliverable: r.deliverable ?? '',
    deadline: r.deadline ?? '',
    divisiPic: r.divisi_pic ?? '',
    hasilDiharapkan: r.hasil_diharapkan ?? '',
  };
}

// ===========================================================================
// Module 6A — Vendor (VND-) and Strategi (STRG-).
// ===========================================================================
//
// Every field is listed explicitly, including the nulls. A MISSING key is worse
// than a null one (CLAUDE.md): the page renders `undefined` and the reader
// concludes the record is broken rather than empty.

/** One attachment on a vendor record (§7 `dokumen`). */
export interface VendorDocumentWire {
  nama: string;
  url: string;
}

/** M6A §7 / D19 — the vendor record E-8 and F-4 point at. */
export interface VendorWire {
  id: string;
  nama_vendor: string;
  jenis_layanan: string;
  status: string;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: string;
  tarif: string | null;
  bagi_hasil_persen: number | null;
  catatan_kinerja: string;
  dokumen: VendorDocumentWire[];
  created_by: string;
  created_at: string;
}

export function vendorToWire(v: vendor.Vendor): VendorWire {
  return {
    id: v.id,
    nama_vendor: v.namaVendor,
    jenis_layanan: v.jenisLayanan,
    status: v.status,
    pic_nama: v.picNama,
    pic_kontak: v.picKontak,
    skema_biaya: v.skemaBiaya,
    tarif: v.tarif,
    bagi_hasil_persen: v.bagiHasilPersen,
    catatan_kinerja: v.catatanKinerja,
    dokumen: v.dokumen.map((d) => ({ nama: d.nama, url: d.url })),
    created_by: v.createdBy,
    created_at: v.createdAt,
  };
}

// ---------------------------------------------------------------------------
// O57 — Contract (CTR-)
// ---------------------------------------------------------------------------

/** The agreement one client signed, covering n Services (O57). */
export interface ContractWire {
  id: string;
  client_id: string;
  durasi_bulan: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  catatan: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function contractToWire(c: contract.Contract): ContractWire {
  return {
    id: c.id,
    client_id: c.clientId,
    durasi_bulan: c.durasiBulan,
    tanggal_mulai: c.tanggalMulai,
    tanggal_akhir: c.tanggalAkhir,
    catatan: c.catatan,
    created_by: c.createdBy,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

/** Inbound: the window an AM declares. */
export function contractFromWire(v: unknown): contract.ContractInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    durasiBulan: Number(b.durasi_bulan ?? 0),
    tanggalMulai: String(b.tanggal_mulai ?? ''),
    tanggalAkhir: String(b.tanggal_akhir ?? ''),
    catatan:
      b.catatan === undefined || b.catatan === null ? null : String(b.catatan),
  };
}

/** A-12 — who may approve at the client, and how to escalate past them. */
export interface StrategiDecisionMakerWire {
  nama: string;
  jabatan: string;
  berhak_approve: boolean;
  jalur_eskalasi: string;
}

/** B-3.3 — a top SKU by GMV. */
export interface StrategiTopSkuWire {
  nama: string;
  gmv: string;
  unit_terjual: number;
  harga_jual: string;
  margin_persen: number;
}

/** B-5.4 — a keyword/audience that produced orders. */
export interface StrategiTopKeywordWire {
  keyword: string;
  jumlah_order: number;
}

/** B-5.5 — spend with no orders behind it. */
export interface StrategiKampanyeBoncosWire {
  nama: string;
  spend: string;
}

/** B-6.4 — a top creator by GMV. */
export interface StrategiTopKreatorWire {
  nama: string;
  gmv: string;
}

/** B-8.1 — an active voucher/promo. */
export interface StrategiVoucherWire {
  tipe: string;
  nilai: string;
  syarat: string;
}

/** B-9.1 — a competing store on this channel. */
export interface StrategiKompetitorWire {
  nama: string;
  url: string;
  harga_sebanding: string;
  estimasi_penjualan_bulan: string;
}

/** A-15 + A-16 — one row per (channel, akses); the blocker is a flag on it. */
export interface StrategiAksesWire {
  id: number;
  channel: string;
  akses: string;
  status: string;
  memblokir: boolean;
  target_tanggal_beres: string | null;
  catatan: string;
}

// ---------------------------------------------------------------------------
// Section C (A-07) wire types
// ---------------------------------------------------------------------------

/** C-1/C-2/C-3/C-4 — one row per contracted channel. */
export interface StrategiDiagnosaWire {
  id: number;
  channel: string;
  bottleneck: string;
  /** Rule 6: array of baseline field-ID strings, min 1. */
  field_ids: string[];
  akar_masalah: string | null;
  gap_kompetitor: string | null;
}

/** C-5 — quick wins in the first 14 days. */
export interface StrategiQuickWinWire {
  id: number;
  aksi: string;
  channel: string;
  pic_divisi: string;
  dampak_diharapkan: string;
  urutan: number;
}

/** C-6 — structural risks. */
export interface StrategiRisikoStrukturalWire {
  id: number;
  risiko: string;
  urutan: number;
}

/** C-7 — client prerequisites. */
export interface StrategiPrasyaratKlienWire {
  id: number;
  item: string;
  pic_klien: string;
  deadline: string | null;
  urutan: number;
}

/** The Strategi header (Section J-1 + the contract window) plus Section A. */
export interface StrategiWire {
  id: string;
  /**
   * O57 — the agreement, not a Service. A Strategi covers every Service under
   * the contract, so `service_id` was replaced rather than kept alongside: one
   * id there would name an arbitrary member of the set.
   */
  contract_id: string;
  client_id: string;
  versi_no: number;
  strategi_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  status: string;
  /** Derived from `contracts` — read-only here (house rule #4). */
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
  tanggal_mulai_siklus: string | null;
  siklus_terkunci: boolean;
  toleransi_over_persen: number;
  diajukan_pada: string | null;
  disetujui_pada: string | null;
  disetujui_oleh: string | null;
  catatan_reviewer: string | null;
  created_by: string;
  created_at: string;
  // Section A — Konteks Klien & Bisnis (A-05). Nullable because the record is
  // born `Draft` and the form autosaves; presence is a submit-gate concern.
  nama_brand: string | null;
  kategori_utama: string | null;
  sub_kategori: string[];
  model_bisnis: string | null;
  margin_kotor_persen: number | null;
  posisi_harga: string | null;
  usp: string[];
  kapasitas_stok: string | null;
  lead_time_restock_hari: number | null;
  plafon_unit_per_bulan: number | null;
  titik_kirim_kota: string | null;
  titik_kirim_detail: string | null;
  ekspektasi_klien: string | null;
  riwayat_agensi: string | null;
  pantangan_klien: string[];
  pantangan_klien_tidak_ada: boolean;
  decision_maker: StrategiDecisionMakerWire[];
  sla_klien_jam: number | null;
  sla_klien_catatan: string | null;
  aset_dari_klien: string[];
  aset_dari_klien_tidak_ada: boolean;
  aset_catatan: string | null;
  // Section D header (A-08). D-1/D-2/D-4 ride in `targets`, D-8/D-9 in
  // `assumptions`, and D-3 is derived (`komposisi_kontribusi`) — these four are
  // what is neither a matrix nor a list.
  definisi_berhasil_30: string | null;
  definisi_berhasil_60: string | null;
  definisi_berhasil_90: string | null;
  leading_indicator: string[];
  /**
   * D-7 — §4.1 HARD-INTERNAL. Present here because this body serves the INTERNAL
   * app only; the client-facing `/s/{token}` renderer (A-11) is a separate
   * serialiser that applies the visibility filter BEFORE serialising, so it must
   * never reuse this shape.
   */
  sanggahan_alasan: string | null;
  /** Money ⇒ string, integer minor units (frozen invariant), like `nilai_floor`. */
  sanggahan_angka_pembanding: string | null;
  sanggahan_target_realistis: string | null;
  sanggahan_diajukan_pada: string | null;
  sanggahan_diajukan_oleh: string | null;
  // Section E/H narrative header fields (A-09a). The rest of E/H are child rows:
  // E-3…E-11 in `pillars`, H-1 in `risks`.
  growth_thesis: string | null;
  urutan_eksekusi_alasan: string | null;
  skenario_mundur: string | null;
  /** H-4 — §4.1 HARD-INTERNAL, same caveat as `sanggahan_*` above. */
  kondisi_stop_scope: string | null;
  // Section G/I header fields (A-09b). G-1/G-2 are child rows below.
  review_klien_frekuensi: string | null;
  review_klien_format: string | null;
  review_klien_pic: string | null;
  review_internal_frekuensi: string | null;
  metrik_laporan_klien: string[];
}

export function strategiToWire(s: strategi.Strategi): StrategiWire {
  return {
    id: s.id,
    contract_id: s.contractId,
    client_id: s.clientId,
    versi_no: s.versiNo,
    strategi_induk_id: s.strategiIndukId,
    versi_sebelumnya_id: s.versiSebelumnyaId,
    status: s.status,
    durasi_kontrak_bulan: s.durasiKontrakBulan,
    tanggal_mulai_kontrak: s.tanggalMulaiKontrak,
    tanggal_akhir_kontrak: s.tanggalAkhirKontrak,
    tanggal_mulai_siklus: s.tanggalMulaiSiklus,
    siklus_terkunci: s.siklusTerkunci,
    toleransi_over_persen: s.toleransiOverPersen,
    diajukan_pada: s.diajukanPada,
    disetujui_pada: s.disetujuiPada,
    disetujui_oleh: s.disetujuiOleh,
    catatan_reviewer: s.catatanReviewer,
    created_by: s.createdBy,
    created_at: s.createdAt,
    nama_brand: s.namaBrand,
    kategori_utama: s.kategoriUtama,
    sub_kategori: s.subKategori,
    model_bisnis: s.modelBisnis,
    margin_kotor_persen: s.marginKotorPersen,
    posisi_harga: s.posisiHarga,
    usp: s.usp,
    kapasitas_stok: s.kapasitasStok,
    lead_time_restock_hari: s.leadTimeRestockHari,
    plafon_unit_per_bulan: s.plafonUnitPerBulan,
    titik_kirim_kota: s.titikKirimKota,
    titik_kirim_detail: s.titikKirimDetail,
    ekspektasi_klien: s.ekspektasiKlien,
    riwayat_agensi: s.riwayatAgensi,
    pantangan_klien: s.pantanganKlien,
    pantangan_klien_tidak_ada: s.pantanganKlienTidakAda,
    decision_maker: s.decisionMaker.map((d) => ({
      nama: d.nama,
      jabatan: d.jabatan,
      berhak_approve: d.berhakApprove,
      jalur_eskalasi: d.jalurEskalasi,
    })),
    sla_klien_jam: s.slaKlienJam,
    sla_klien_catatan: s.slaKlienCatatan,
    aset_dari_klien: s.asetDariKlien,
    aset_dari_klien_tidak_ada: s.asetDariKlienTidakAda,
    aset_catatan: s.asetCatatan,
    definisi_berhasil_30: s.definisiBerhasil30,
    definisi_berhasil_60: s.definisiBerhasil60,
    definisi_berhasil_90: s.definisiBerhasil90,
    leading_indicator: s.leadingIndicator,
    sanggahan_alasan: s.sanggahanAlasan,
    sanggahan_angka_pembanding: s.sanggahanAngkaPembanding,
    sanggahan_target_realistis: s.sanggahanTargetRealistis,
    sanggahan_diajukan_pada: s.sanggahanDiajukanPada,
    sanggahan_diajukan_oleh: s.sanggahanDiajukanOleh,
    growth_thesis: s.growthThesis,
    urutan_eksekusi_alasan: s.urutanEksekusiAlasan,
    skenario_mundur: s.skenarioMundur,
    kondisi_stop_scope: s.kondisiStopScope,
    review_klien_frekuensi: s.reviewKlienFrekuensi,
    review_klien_format: s.reviewKlienFormat,
    review_klien_pic: s.reviewKlienPic,
    review_internal_frekuensi: s.reviewInternalFrekuensi,
    metrik_laporan_klien: s.metrikLaporanKlien,
  };
}

/** B-1 / B-5 — one row per month of the declared window (D11). */
export interface StrategiBaselineMonthWire {
  month_index: number;
  gmv: string;
  jumlah_pesanan: number;
  persen_batal: number;
  ad_spend: string;
  roas: number;
  acos: number;
  aov: string | null;
}

/** Section B-0 block, with its baseline months nested. */
export interface StrategiChannelWire {
  id: number;
  channel: string;
  channel_lain: string | null;
  status_channel: string;
  nama_toko: string;
  url_toko: string;
  umur_toko_bulan: number | null;
  badge: string | null;
  target_tanggal_live: string | null;
  prasyarat_pembukaan: string[];
  sumber_data: string | null;
  tanggal_ambil_data: string | null;
  lampiran: string | null;
  periode_baseline_bulan: number | null;
  periode_mulai: string | null;
  periode_akhir: string | null;
  alasan_periode_pendek: string | null;
  /** E-2 (A-09b) — Section E, stored per channel because that is its grain. */
  prioritas: string | null;
  prioritas_alasan: string | null;
  catatan_periode_pendek: string | null;
  // Section B groups B-2 … B-9 (A-06). One figure per channel; the monthly ones
  // (B-1, B-5.1/5.2) are rows in `baseline`.
  pengunjung_per_bulan: number | null;
  conversion_rate_persen: number | null;
  trafik_organik_persen: number | null;
  trafik_iklan_persen: number | null;
  trafik_affiliate_persen: number | null;
  trafik_live_persen: number | null;
  trafik_video_persen: number | null;
  trafik_luar_persen: number | null;
  entry_point_utama: string | null;
  entry_point_catatan: string | null;
  sku_listed: number | null;
  sku_aktif: number | null;
  sku_pareto_80: number | null;
  top_sku: StrategiTopSkuWire[];
  sku_slow_moving: number | null;
  sku_stok_kritis: string[];
  listing_layak_persen: number | null;
  rating_toko: number | null;
  jumlah_ulasan: number | null;
  chat_response_rate_persen: number | null;
  chat_response_menit: number | null;
  pesanan_terlambat_persen: number | null;
  poin_penalti: number | null;
  catatan_penalti: string | null;
  tema_keluhan: string[];
  tipe_kampanye: string[];
  tipe_kampanye_tidak_ada: boolean;
  jumlah_kampanye_aktif: number | null;
  top_keyword: StrategiTopKeywordWire[];
  kampanye_boncos: StrategiKampanyeBoncosWire[];
  affiliate_aktif_30hari: number | null;
  gmv_affiliate: string | null;
  gmv_affiliate_persen: number | null;
  komisi_open_persen: number | null;
  komisi_target_persen: number | null;
  top_kreator: StrategiTopKreatorWire[];
  program_sampel: string | null;
  program_sampel_catatan: string | null;
  jumlah_video_per_bulan: number | null;
  total_views: number | null;
  gmv_video: string | null;
  jam_live_per_bulan: number | null;
  gmv_live: string | null;
  // B-7.2 third figure — computed, `null` at zero live hours (renders `—`).
  gmv_per_jam_live: string | null;
  host_live: string | null;
  studio_live: string | null;
  studio_catatan: string | null;
  voucher_aktif: StrategiVoucherWire[];
  voucher_aktif_tidak_ada: boolean;
  program_platform: string[];
  program_platform_tidak_ada: boolean;
  beban_promo_persen: number | null;
  kompetitor: StrategiKompetitorWire[];
  kompetitor_lebih_baik: string[];
  kompetitor_catatan: string | null;
  celah_kompetitor: string | null;
  // B-1.5 — derived from `baseline`, never stored.
  tren: string | null;
  tren_persen: number | null;
  baseline: StrategiBaselineMonthWire[];
}

export interface StrategiTargetWire {
  channel: string;
  month_index: number;
  metric: string;
  nilai_floor: string | null;
  nilai_stretch: string;
  sumber_floor: string | null;
}

/**
 * D-3 — komposisi kontribusi channel. TURUNAN (X-11), tidak pernah disimpan.
 * `persen` null saat total GMV nol — klien merender `—` (aturan rumah #7).
 */
export interface StrategiKomposisiWire {
  channel: string;
  target_gmv: string;
  persen: number | null;
}

export interface StrategiAssumptionWire {
  kode: string;
  asumsi: string;
  pemilik: string;
  cara_verifikasi: string;
  status: string;
  target_terkait: string[];
}

export interface StrategiPillarWire {
  id: number;
  jenis: string;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  harga_normal: string | null;
  harga_promo: string | null;
  floor_price: string | null;
  vendor_id: string | null;
  slot_jam: number | null;
  tarif: string | null;
  target_gmv_per_jam: string | null;
  detail: Record<string, unknown>;
}

export interface StrategiResourceWire {
  id: number;
  jenis: string;
  channel: string | null;
  divisi: string | null;
  nilai: string | null;
  jumlah: number | null;
  satuan: string | null;
  sumber_dana: string | null;
  vendor_id: string | null;
  skema_biaya: string | null;
  catatan: string;
}

export interface StrategiRiskWire {
  id: number;
  risiko: string;
  dampak: string;
  kemungkinan: string;
  mitigasi: string;
  pic: string;
  urutan: number;
}

/** E-12 — client dependency during execution (A-09b). */
export interface StrategiKetergantunganWire {
  id: number;
  item: string;
  kapan: string;
  konsekuensi: string;
  urutan: number;
}

/** G-1 — work phase (A-09b). */
export interface StrategiFaseWire {
  id: number;
  nama: string;
  tanggal_mulai: string;
  tanggal_akhir: string;
  tujuan: string;
  kriteria_lulus: string;
  urutan: number;
}

/** G-2 — big date inside the contract window (A-09b). */
export interface StrategiTanggalBesarWire {
  id: number;
  tanggal: string;
  nama: string;
  peran: string;
  urutan: number;
}

/**
 * H-2 — a declared revision trigger (A-09b).
 * `ambang` is a COUNT (percent or days), not money, so it stays a number — the
 * string rule on this boundary is specifically about rupiah.
 */
export interface StrategiTriggerRevisiWire {
  id: number;
  kode: string;
  ambang: number | null;
  catatan: string | null;
  urutan: number;
}

/** I-2 + I-4 — Brief-receiving division, dispatch position, division note. */
export interface StrategiDispatchWire {
  id: number;
  divisi: string;
  urutan: number;
  catatan: string | null;
}

/**
 * A-10 / Rule 16 — one field's visibility, with everything the form needs to
 * draw the switch.
 *
 * `tier` and `dapat_diubah` are DERIVED and shipped anyway: without them the FE
 * would have to carry its own copy of the §4.1 map to know which switches to
 * render as locked, and a third copy of that map is exactly the leak
 * `packages/core/src/visibility.ts` was centralised to prevent.
 */
export interface StrategiFieldVisibilityWire {
  field_id: string;
  visibilitas: string;
  tier: string;
  dapat_diubah: boolean;
  diubah_oleh: string | null;
  diubah_pada: string | null;
}

export function strategiFieldVisibilityToWire(
  v: strategi.StrategiFieldVisibility,
): StrategiFieldVisibilityWire {
  return {
    field_id: v.fieldId,
    visibilitas: v.visibilitas,
    tier: v.tier,
    dapat_diubah: v.dapatDiubah,
    diubah_oleh: v.diubahOleh,
    diubah_pada: v.diubahPada,
  };
}

/** A-11 — the share link's status, secret never included. */
export interface ShareLinkStatusWire {
  status: 'none' | 'aktif' | 'dicabut';
  tanggal_kedaluwarsa: string | null;
  created_at: string | null;
  created_by: string | null;
  dicabut_pada: string | null;
}

export function shareLinkStatusToWire(s: strategi.ShareLinkStatus): ShareLinkStatusWire {
  return {
    status: s.status,
    tanggal_kedaluwarsa: s.tanggalKedaluwarsa,
    created_at: s.createdAt,
    created_by: s.createdBy,
    dicabut_pada: s.dicabutPada,
  };
}

/** A-11 — the create response, carrying the plaintext token exactly once. */
export interface ShareTokenCreatedWire extends ShareLinkStatusWire {
  token: string;
}

export function shareTokenCreatedToWire(s: strategi.ShareTokenCreated): ShareTokenCreatedWire {
  return { ...shareLinkStatusToWire(s), token: s.token };
}

export interface StrategiEventWire {
  versi_no: number;
  peristiwa: string;
  aktor: string;
  catatan: string | null;
  trigger_revisi: string[];
  alasan_revisi: string | null;
  asumsi_gugur: string[];
  created_at: string;
}

/**
 * J-4 — one changed field in the auto-diff. Flat (not a discriminated union) so
 * the response-shape guard checks it as one interface: `jenis` says which half
 * is meaningful — scalar rows carry `sebelum`/`sesudah` (collections leave them
 * null), collection rows carry `ditambah`/`dihapus`/`diubah` (scalars leave them
 * empty/0). Every key is always present (never `omitempty`): a missing key is the
 * O43 blank-page defect, so the inactive half is sent explicitly.
 */
export interface StrategiDiffEntryWire {
  jenis: 'skalar' | 'koleksi';
  field_id: string;
  seksi: string;
  label: string;
  sebelum: string | null;
  sesudah: string | null;
  ditambah: string[];
  dihapus: string[];
  diubah: number;
}

export interface StrategiDiffWire {
  versi_no: number;
  versi_sebelumnya_id: string | null;
  versi_sebelumnya_no: number | null;
  ada_perbandingan: boolean;
  entri: StrategiDiffEntryWire[];
}

export function strategiDiffToWire(d: strategi.StrategiDiff): StrategiDiffWire {
  return {
    versi_no: d.versiNo,
    versi_sebelumnya_id: d.versiSebelumnyaId,
    versi_sebelumnya_no: d.versiSebelumnyaNo,
    ada_perbandingan: d.adaPerbandingan,
    entri: d.entri.map((e) => ({
      jenis: e.jenis,
      field_id: e.fieldId,
      seksi: e.seksi,
      label: e.label,
      sebelum: e.jenis === 'skalar' ? e.sebelum : null,
      sesudah: e.jenis === 'skalar' ? e.sesudah : null,
      ditambah: e.jenis === 'koleksi' ? e.ditambah : [],
      dihapus: e.jenis === 'koleksi' ? e.dihapus : [],
      diubah: e.jenis === 'koleksi' ? e.diubah : 0,
    })),
  };
}

/** The whole record as the Section A→J form loads it. */
export interface StrategiDetailWire extends StrategiWire {
  channels: StrategiChannelWire[];
  akses: StrategiAksesWire[];
  /** A-07 Section C: per-channel diagnosis. */
  diagnosa: StrategiDiagnosaWire[];
  quick_wins: StrategiQuickWinWire[];
  risiko_struktural: StrategiRisikoStrukturalWire[];
  prasyarat_klien: StrategiPrasyaratKlienWire[];
  targets: StrategiTargetWire[];
  komposisi_kontribusi: StrategiKomposisiWire[];
  assumptions: StrategiAssumptionWire[];
  pillars: StrategiPillarWire[];
  resources: StrategiResourceWire[];
  risks: StrategiRiskWire[];
  // A-09b — Section E-12 / G-1 / G-2 / H-2 / I-2+I-4.
  ketergantungan: StrategiKetergantunganWire[];
  fase: StrategiFaseWire[];
  tanggal_besar: StrategiTanggalBesarWire[];
  trigger_revisi: StrategiTriggerRevisiWire[];
  dispatch: StrategiDispatchWire[];
  /** A-10 — the §4.1 visibility overlay, one entry per field ID. */
  visibilitas: StrategiFieldVisibilityWire[];
  riwayat: StrategiEventWire[];
}

export function strategiDetailToWire(d: strategi.StrategiDetail): StrategiDetailWire {
  return {
    ...strategiToWire(d),
    channels: d.channels.map((c) => ({
      id: c.id,
      channel: c.channel,
      channel_lain: c.channelLain,
      status_channel: c.statusChannel,
      nama_toko: c.namaToko,
      url_toko: c.urlToko,
      umur_toko_bulan: c.umurTokoBulan,
      badge: c.badge,
      target_tanggal_live: c.targetTanggalLive,
      prasyarat_pembukaan: c.prasyaratPembukaan,
      sumber_data: c.sumberData,
      tanggal_ambil_data: c.tanggalAmbilData,
      lampiran: c.lampiran,
      periode_baseline_bulan: c.periodeBaselineBulan,
      periode_mulai: c.periodeMulai,
      periode_akhir: c.periodeAkhir,
      alasan_periode_pendek: c.alasanPeriodePendek,
      prioritas: c.prioritas,
      prioritas_alasan: c.prioritasAlasan,
      catatan_periode_pendek: c.catatanPeriodePendek,
      pengunjung_per_bulan: c.pengunjungPerBulan,
      conversion_rate_persen: c.conversionRatePersen,
      trafik_organik_persen: c.trafikOrganikPersen,
      trafik_iklan_persen: c.trafikIklanPersen,
      trafik_affiliate_persen: c.trafikAffiliatePersen,
      trafik_live_persen: c.trafikLivePersen,
      trafik_video_persen: c.trafikVideoPersen,
      trafik_luar_persen: c.trafikLuarPersen,
      entry_point_utama: c.entryPointUtama,
      entry_point_catatan: c.entryPointCatatan,
      sku_listed: c.skuListed,
      sku_aktif: c.skuAktif,
      sku_pareto_80: c.skuPareto80,
      top_sku: c.topSku.map((s) => ({
        nama: s.nama,
        gmv: s.gmv,
        unit_terjual: s.unitTerjual,
        harga_jual: s.hargaJual,
        margin_persen: s.marginPersen,
      })),
      sku_slow_moving: c.skuSlowMoving,
      sku_stok_kritis: c.skuStokKritis,
      listing_layak_persen: c.listingLayakPersen,
      rating_toko: c.ratingToko,
      jumlah_ulasan: c.jumlahUlasan,
      chat_response_rate_persen: c.chatResponseRatePersen,
      chat_response_menit: c.chatResponseMenit,
      pesanan_terlambat_persen: c.pesananTerlambatPersen,
      poin_penalti: c.poinPenalti,
      catatan_penalti: c.catatanPenalti,
      tema_keluhan: c.temaKeluhan,
      tipe_kampanye: c.tipeKampanye,
      tipe_kampanye_tidak_ada: c.tipeKampanyeTidakAda,
      jumlah_kampanye_aktif: c.jumlahKampanyeAktif,
      top_keyword: c.topKeyword.map((k) => ({
        keyword: k.keyword,
        jumlah_order: k.jumlahOrder,
      })),
      kampanye_boncos: c.kampanyeBoncos.map((k) => ({ nama: k.nama, spend: k.spend })),
      affiliate_aktif_30hari: c.affiliateAktif30Hari,
      gmv_affiliate: c.gmvAffiliate,
      gmv_affiliate_persen: c.gmvAffiliatePersen,
      komisi_open_persen: c.komisiOpenPersen,
      komisi_target_persen: c.komisiTargetPersen,
      top_kreator: c.topKreator.map((k) => ({ nama: k.nama, gmv: k.gmv })),
      program_sampel: c.programSampel,
      program_sampel_catatan: c.programSampelCatatan,
      jumlah_video_per_bulan: c.jumlahVideoPerBulan,
      total_views: c.totalViews,
      gmv_video: c.gmvVideo,
      jam_live_per_bulan: c.jamLivePerBulan,
      gmv_live: c.gmvLive,
      gmv_per_jam_live: c.gmvPerJamLive,
      host_live: c.hostLive,
      studio_live: c.studioLive,
      studio_catatan: c.studioCatatan,
      voucher_aktif: c.voucherAktif.map((v) => ({
        tipe: v.tipe,
        nilai: v.nilai,
        syarat: v.syarat,
      })),
      voucher_aktif_tidak_ada: c.voucherAktifTidakAda,
      program_platform: c.programPlatform,
      program_platform_tidak_ada: c.programPlatformTidakAda,
      beban_promo_persen: c.bebanPromoPersen,
      kompetitor: c.kompetitor.map((k) => ({
        nama: k.nama,
        url: k.url,
        harga_sebanding: k.hargaSebanding,
        estimasi_penjualan_bulan: k.estimasiPenjualanBulan,
      })),
      kompetitor_lebih_baik: c.kompetitorLebihBaik,
      kompetitor_catatan: c.kompetitorCatatan,
      celah_kompetitor: c.celahKompetitor,
      tren: c.tren,
      tren_persen: c.trenPersen,
      baseline: c.baseline.map((b) => ({
        month_index: b.monthIndex,
        gmv: b.gmv,
        jumlah_pesanan: b.jumlahPesanan,
        persen_batal: b.persenBatal,
        ad_spend: b.adSpend,
        roas: b.roas,
        acos: b.acos,
        aov: b.aov,
      })),
    })),
    akses: d.akses.map((a) => ({
      id: a.id,
      channel: a.channel,
      akses: a.akses,
      status: a.status,
      memblokir: a.memblokir,
      target_tanggal_beres: a.targetTanggalBeres,
      catatan: a.catatan,
    })),
    diagnosa: d.diagnosa.map((diag) => ({
      id: diag.id,
      channel: diag.channel,
      bottleneck: diag.bottleneck,
      field_ids: diag.fieldIds,
      akar_masalah: diag.akarMasalah,
      gap_kompetitor: diag.gapKompetitor,
    })),
    quick_wins: d.quickWins.map((q) => ({
      id: q.id,
      aksi: q.aksi,
      channel: q.channel,
      pic_divisi: q.picDivisi,
      dampak_diharapkan: q.dampakDiharapkan,
      urutan: q.urutan,
    })),
    risiko_struktural: d.risikoStruktural.map((r) => ({
      id: r.id,
      risiko: r.risiko,
      urutan: r.urutan,
    })),
    prasyarat_klien: d.prasyaratKlien.map((p) => ({
      id: p.id,
      item: p.item,
      pic_klien: p.picKlien,
      deadline: p.deadline,
      urutan: p.urutan,
    })),
    targets: d.targets.map((t) => ({
      channel: t.channel,
      month_index: t.monthIndex,
      metric: t.metric,
      nilai_floor: t.nilaiFloor,
      nilai_stretch: t.nilaiStretch,
      sumber_floor: t.sumberFloor,
    })),
    komposisi_kontribusi: d.komposisiKontribusi.map((k) => ({
      channel: k.channel,
      target_gmv: k.targetGmv,
      // Sent explicitly as `null`, never omitted: a MISSING key blanks the cell
      // in a way the page cannot distinguish from "no data loaded" (O43).
      persen: k.persen,
    })),
    assumptions: d.assumptions.map((a) => ({
      kode: a.kode,
      asumsi: a.asumsi,
      pemilik: a.pemilik,
      cara_verifikasi: a.caraVerifikasi,
      status: a.status,
      target_terkait: a.targetTerkait,
    })),
    pillars: d.pillars.map((p) => ({
      id: p.id,
      jenis: p.jenis,
      channel: p.channel,
      urutan: p.urutan,
      sku: p.sku,
      peran: p.peran,
      aksi: p.aksi,
      target: p.target,
      harga_normal: p.hargaNormal,
      harga_promo: p.hargaPromo,
      floor_price: p.floorPrice,
      vendor_id: p.vendorId,
      slot_jam: p.slotJam,
      tarif: p.tarif,
      target_gmv_per_jam: p.targetGmvPerJam,
      detail: p.detail,
    })),
    resources: d.resources.map((r) => ({
      id: r.id,
      jenis: r.jenis,
      channel: r.channel,
      divisi: r.divisi,
      nilai: r.nilai,
      jumlah: r.jumlah,
      satuan: r.satuan,
      sumber_dana: r.sumberDana,
      vendor_id: r.vendorId,
      skema_biaya: r.skemaBiaya,
      catatan: r.catatan,
    })),
    risks: d.risks.map((r) => ({
      id: r.id,
      risiko: r.risiko,
      dampak: r.dampak,
      kemungkinan: r.kemungkinan,
      mitigasi: r.mitigasi,
      pic: r.pic,
      urutan: r.urutan,
    })),
    ketergantungan: d.ketergantungan.map((k) => ({
      id: k.id,
      item: k.item,
      kapan: k.kapan,
      konsekuensi: k.konsekuensi,
      urutan: k.urutan,
    })),
    fase: d.fase.map((f) => ({
      id: f.id,
      nama: f.nama,
      tanggal_mulai: f.tanggalMulai,
      tanggal_akhir: f.tanggalAkhir,
      tujuan: f.tujuan,
      kriteria_lulus: f.kriteriaLulus,
      urutan: f.urutan,
    })),
    tanggal_besar: d.tanggalBesar.map((t) => ({
      id: t.id,
      tanggal: t.tanggal,
      nama: t.nama,
      peran: t.peran,
      urutan: t.urutan,
    })),
    trigger_revisi: d.triggerRevisi.map((t) => ({
      id: t.id,
      kode: t.kode,
      ambang: t.ambang,
      catatan: t.catatan,
      urutan: t.urutan,
    })),
    dispatch: d.dispatch.map((x) => ({
      id: x.id,
      divisi: x.divisi,
      urutan: x.urutan,
      catatan: x.catatan,
    })),
    visibilitas: d.visibilitas.map(strategiFieldVisibilityToWire),
    riwayat: d.riwayat.map((e) => ({
      versi_no: e.versiNo,
      peristiwa: e.peristiwa,
      aktor: e.aktor,
      catatan: e.catatan,
      trigger_revisi: e.triggerRevisi,
      alasan_revisi: e.alasanRevisi,
      asumsi_gugur: e.asumsiGugur,
      created_at: e.createdAt,
    })),
  };
}

/** §5 step 5 — the live "still missing" list, not a first-error message. */
export interface StrategiKekuranganWire {
  kode: string;
  pesan: string;
}

export function strategiKekuranganToWire(k: strategi.Kekurangan): StrategiKekuranganWire {
  return { kode: k.kode, pesan: k.pesan };
}

/**
 * Inbound: the vendor write body (snake_case) → the domain input (camelCase).
 *
 * It lives here, not in the route, for the reason `assignmentSummaryFromWire`
 * exists: last session a plan-gate route handed a raw wire body to a domain
 * function that reads camelCase, every field arrived `undefined`, and a valid
 * request was rejected with a message blaming the caller. One translation site,
 * used by both the create and the update route.
 *
 * Missing fields become empty strings / nulls rather than being dropped, so the
 * domain's own validation produces the BI message — the route never decides
 * whether a payload is complete.
 */
export function vendorInputFromWire(v: unknown): vendor.VendorInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const dokumen = Array.isArray(b.dokumen)
    ? b.dokumen
        .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
        .map((d) => ({ nama: String(d.nama ?? ''), url: String(d.url ?? '') }))
    : [];
  return {
    namaVendor: String(b.nama_vendor ?? ''),
    jenisLayanan: (b.jenis_layanan ?? '') as vendor.VendorService,
    picNama: String(b.pic_nama ?? ''),
    picKontak: String(b.pic_kontak ?? ''),
    skemaBiaya: (b.skema_biaya ?? '') as vendor.VendorFeeScheme,
    tarif: b.tarif === undefined || b.tarif === null ? null : String(b.tarif),
    bagiHasilPersen:
      b.bagi_hasil_persen === undefined || b.bagi_hasil_persen === null
        ? null
        : Number(b.bagi_hasil_persen),
    catatanKinerja: String(b.catatan_kinerja ?? ''),
    dokumen,
  };
}

/** Inbound: the Strategi header body (§ contract window + G-0 + F-7). */
export function strategiHeaderFromWire(v: unknown): strategi.StrategiHeaderInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    durasiKontrakBulan: Number(b.durasi_kontrak_bulan ?? 0),
    tanggalMulaiKontrak: String(b.tanggal_mulai_kontrak ?? ''),
    tanggalAkhirKontrak: String(b.tanggal_akhir_kontrak ?? ''),
    tanggalMulaiSiklus:
      b.tanggal_mulai_siklus === undefined || b.tanggal_mulai_siklus === null
        ? null
        : String(b.tanggal_mulai_siklus),
    toleransiOverPersen:
      b.toleransi_over_persen === undefined || b.toleransi_over_persen === null
        ? null
        : Number(b.toleransi_over_persen),
  };
}

function asRecords(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : [];
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function strOrNull(v: unknown): string | null {
  return v === undefined || v === null || v === '' ? null : String(v);
}

function numOrNull(v: unknown): number | null {
  return v === undefined || v === null || v === '' ? null : Number(v);
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/**
 * Inbound: Section A — Konteks Klien & Bisnis (A-05).
 *
 * Absent fields become `null`/`[]` rather than being dropped, so the domain's own
 * validator decides what is invalid and produces the BI message. The route never
 * gets to rule on completeness — and here that matters more than usual, because
 * an incomplete Section A is the NORMAL state of an autosaving draft.
 */
export function strategiKonteksFromWire(v: unknown): strategi.KonteksInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    namaBrand: strOrNull(b.nama_brand),
    kategoriUtama: strOrNull(b.kategori_utama),
    subKategori: strList(b.sub_kategori),
    modelBisnis: (strOrNull(b.model_bisnis) as strategi.BusinessModel | null) ?? null,
    marginKotorPersen: numOrNull(b.margin_kotor_persen),
    posisiHarga: (strOrNull(b.posisi_harga) as strategi.PricePosition | null) ?? null,
    usp: strList(b.usp),
    kapasitasStok: (strOrNull(b.kapasitas_stok) as strategi.StockCapacity | null) ?? null,
    leadTimeRestockHari: numOrNull(b.lead_time_restock_hari),
    plafonUnitPerBulan: numOrNull(b.plafon_unit_per_bulan),
    titikKirimKota: strOrNull(b.titik_kirim_kota),
    titikKirimDetail: strOrNull(b.titik_kirim_detail),
    ekspektasiKlien: strOrNull(b.ekspektasi_klien),
    riwayatAgensi: strOrNull(b.riwayat_agensi),
    pantanganKlien: strList(b.pantangan_klien),
    pantanganKlienTidakAda: b.pantangan_klien_tidak_ada === true,
    decisionMaker: asRecords(b.decision_maker).map((d) => ({
      nama: str(d.nama),
      jabatan: str(d.jabatan),
      berhakApprove: d.berhak_approve === true,
      jalurEskalasi: str(d.jalur_eskalasi),
    })),
    slaKlienJam: numOrNull(b.sla_klien_jam),
    slaKlienCatatan: strOrNull(b.sla_klien_catatan),
    asetDariKlien: strList(b.aset_dari_klien),
    asetDariKlienTidakAda: b.aset_dari_klien_tidak_ada === true,
    asetCatatan: strOrNull(b.aset_catatan),
  };
}

/** Inbound: A-15 matrix rows (A-16 rides on `memblokir` + the target date). */
export function strategiAksesFromWire(v: unknown): strategi.AksesInput[] {
  return asRecords(v).map((a) => ({
    channel: str(a.channel) as strategi.AccessChannel,
    akses: str(a.akses) as strategi.AccessKind,
    status: str(a.status) as strategi.AccessState,
    memblokir: a.memblokir === true,
    targetTanggalBeres: strOrNull(a.target_tanggal_beres),
    catatan: str(a.catatan),
  }));
}

/** Inbound: Section B-0 channel blocks plus the B-2…B-9 groups (A-06). */
export function strategiChannelsFromWire(v: unknown): strategi.ChannelInput[] {
  return asRecords(v).map((c) => ({
    channel: str(c.channel) as strategi.Channel,
    channelLain: strOrNull(c.channel_lain),
    statusChannel: str(c.status_channel) as strategi.ChannelState,
    namaToko: str(c.nama_toko),
    urlToko: str(c.url_toko),
    umurTokoBulan: numOrNull(c.umur_toko_bulan),
    badge: strOrNull(c.badge),
    targetTanggalLive: strOrNull(c.target_tanggal_live),
    prasyaratPembukaan: Array.isArray(c.prasyarat_pembukaan)
      ? c.prasyarat_pembukaan.map((p) => String(p))
      : [],
    sumberData: strOrNull(c.sumber_data),
    tanggalAmbilData: strOrNull(c.tanggal_ambil_data),
    lampiran: strOrNull(c.lampiran),
    periodeBaselineBulan: numOrNull(c.periode_baseline_bulan),
    periodeMulai: strOrNull(c.periode_mulai),
    periodeAkhir: strOrNull(c.periode_akhir),
    alasanPeriodePendek: strOrNull(c.alasan_periode_pendek),
    prioritas: strOrNull(c.prioritas) as strategi.ChannelPrioritas | null,
    prioritasAlasan: strOrNull(c.prioritas_alasan),
    catatanPeriodePendek: strOrNull(c.catatan_periode_pendek),
    // Section B (A-06). Numbers stay `null` when absent for the same reason the
    // baseline months do: Rule 5 distinguishes blank from `0`, and coercing here
    // would erase the distinction before the validator ever sees it.
    pengunjungPerBulan: numOrNull(c.pengunjung_per_bulan),
    conversionRatePersen: numOrNull(c.conversion_rate_persen),
    trafikOrganikPersen: numOrNull(c.trafik_organik_persen),
    trafikIklanPersen: numOrNull(c.trafik_iklan_persen),
    trafikAffiliatePersen: numOrNull(c.trafik_affiliate_persen),
    trafikLivePersen: numOrNull(c.trafik_live_persen),
    trafikVideoPersen: numOrNull(c.trafik_video_persen),
    trafikLuarPersen: numOrNull(c.trafik_luar_persen),
    entryPointUtama: (strOrNull(c.entry_point_utama) as strategi.EntryPoint | null) ?? null,
    entryPointCatatan: strOrNull(c.entry_point_catatan),
    skuListed: numOrNull(c.sku_listed),
    skuAktif: numOrNull(c.sku_aktif),
    skuPareto80: numOrNull(c.sku_pareto_80),
    topSku: asRecords(c.top_sku).map((s) => ({
      nama: str(s.nama),
      gmv: str(s.gmv),
      unitTerjual: Number(s.unit_terjual ?? 0),
      hargaJual: str(s.harga_jual),
      marginPersen: Number(s.margin_persen ?? 0),
    })),
    skuSlowMoving: numOrNull(c.sku_slow_moving),
    skuStokKritis: strList(c.sku_stok_kritis),
    listingLayakPersen: numOrNull(c.listing_layak_persen),
    ratingToko: numOrNull(c.rating_toko),
    jumlahUlasan: numOrNull(c.jumlah_ulasan),
    chatResponseRatePersen: numOrNull(c.chat_response_rate_persen),
    chatResponseMenit: numOrNull(c.chat_response_menit),
    pesananTerlambatPersen: numOrNull(c.pesanan_terlambat_persen),
    poinPenalti: numOrNull(c.poin_penalti),
    catatanPenalti: strOrNull(c.catatan_penalti),
    temaKeluhan: strList(c.tema_keluhan),
    tipeKampanye: strList(c.tipe_kampanye),
    tipeKampanyeTidakAda: c.tipe_kampanye_tidak_ada === true,
    jumlahKampanyeAktif: numOrNull(c.jumlah_kampanye_aktif),
    topKeyword: asRecords(c.top_keyword).map((k) => ({
      keyword: str(k.keyword),
      jumlahOrder: Number(k.jumlah_order ?? 0),
    })),
    kampanyeBoncos: asRecords(c.kampanye_boncos).map((k) => ({
      nama: str(k.nama),
      spend: str(k.spend),
    })),
    affiliateAktif30Hari: numOrNull(c.affiliate_aktif_30hari),
    gmvAffiliate: strOrNull(c.gmv_affiliate),
    gmvAffiliatePersen: numOrNull(c.gmv_affiliate_persen),
    komisiOpenPersen: numOrNull(c.komisi_open_persen),
    komisiTargetPersen: numOrNull(c.komisi_target_persen),
    topKreator: asRecords(c.top_kreator).map((k) => ({ nama: str(k.nama), gmv: str(k.gmv) })),
    programSampel: (strOrNull(c.program_sampel) as strategi.SampleProgram | null) ?? null,
    programSampelCatatan: strOrNull(c.program_sampel_catatan),
    jumlahVideoPerBulan: numOrNull(c.jumlah_video_per_bulan),
    totalViews: numOrNull(c.total_views),
    gmvVideo: strOrNull(c.gmv_video),
    jamLivePerBulan: numOrNull(c.jam_live_per_bulan),
    gmvLive: strOrNull(c.gmv_live),
    hostLive: (strOrNull(c.host_live) as strategi.LiveHost | null) ?? null,
    studioLive: (strOrNull(c.studio_live) as strategi.StudioState | null) ?? null,
    studioCatatan: strOrNull(c.studio_catatan),
    voucherAktifTidakAda: c.voucher_aktif_tidak_ada === true,
    voucherAktif: asRecords(c.voucher_aktif).map((v2) => ({
      tipe: str(v2.tipe),
      nilai: str(v2.nilai),
      syarat: str(v2.syarat),
    })),
    programPlatform: strList(c.program_platform),
    programPlatformTidakAda: c.program_platform_tidak_ada === true,
    bebanPromoPersen: numOrNull(c.beban_promo_persen),
    kompetitor: asRecords(c.kompetitor).map((k) => ({
      nama: str(k.nama),
      url: str(k.url),
      hargaSebanding: str(k.harga_sebanding),
      estimasiPenjualanBulan: str(k.estimasi_penjualan_bulan),
    })),
    kompetitorLebihBaik: strList(c.kompetitor_lebih_baik),
    kompetitorCatatan: strOrNull(c.kompetitor_catatan),
    celahKompetitor: strOrNull(c.celah_kompetitor),
  }));
}

/**
 * Inbound: B-1 / B-5 monthly rows.
 *
 * Absent numbers are passed through as `null`, NOT coerced to 0: Rule 5 says
 * blank is invalid and `0` is a valid answer, so silently turning one into the
 * other would defeat the only rule this section has.
 */
export function strategiBaselineFromWire(v: unknown): strategi.BaselineInput[] {
  return asRecords(v).map((m) => ({
    monthIndex: Number(m.month_index ?? 0),
    gmv: strOrNull(m.gmv),
    jumlahPesanan: numOrNull(m.jumlah_pesanan),
    persenBatal: numOrNull(m.persen_batal),
    adSpend: strOrNull(m.ad_spend),
    roas: numOrNull(m.roas),
    acos: numOrNull(m.acos),
  }));
}

/** Inbound: D-1 / D-2 / D-4 target rows. */
export function strategiTargetsFromWire(v: unknown): strategi.TargetInput[] {
  return asRecords(v).map((t) => ({
    channel: str(t.channel),
    monthIndex: Number(t.month_index ?? 0),
    metric: str(t.metric) as strategi.TargetMetric,
    nilaiFloor: strOrNull(t.nilai_floor),
    nilaiStretch: str(t.nilai_stretch),
    // `sumber_floor` is deliberately NOT read from the wire (O57 item (b)): it is
    // the approval path, set by the server at Head approval. Accepting it here
    // would let the AM who types the floor also declare it approved.
  }));
}

/** Inbound: D-8 / D-9 assumptions. */
export function strategiAssumptionsFromWire(v: unknown): strategi.AssumptionInput[] {
  return asRecords(v).map((a) => ({
    kode: str(a.kode),
    asumsi: str(a.asumsi),
    pemilik: str(a.pemilik),
    caraVerifikasi: str(a.cara_verifikasi),
    status: (strOrNull(a.status) as strategi.AssumptionState | null) ?? undefined,
    targetTerkait: Array.isArray(a.target_terkait) ? a.target_terkait.map((k) => String(k)) : [],
  }));
}

/**
 * Inbound: Section D-5 + D-6 (A-08).
 *
 * The three horizons pass through as `undefined` when the key is ABSENT and as
 * `null`/`''` when the form cleared them — `saveKpi` collapses both to `null`, so
 * the distinction dies here rather than becoming a third state the gate has to
 * know about. `leading_indicator` is not narrowed to the enum here: an unknown
 * value must reach the domain to be refused with the BI message, not be silently
 * dropped on the way in.
 */
export function strategiKpiFromWire(v: unknown): strategi.KpiInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    definisiBerhasil30: strOrNull(b.definisi_berhasil_30),
    definisiBerhasil60: strOrNull(b.definisi_berhasil_60),
    definisiBerhasil90: strOrNull(b.definisi_berhasil_90),
    leadingIndicator: Array.isArray(b.leading_indicator)
      ? (b.leading_indicator.map((k) => String(k)) as strategi.LeadingIndicator[])
      : [],
  };
}

/**
 * Inbound: Section E/H narrative fields (A-09a).
 *
 * Absent key and cleared key both collapse to `null` in `saveNarasi`, so the
 * distinction dies here rather than becoming a third state the submit gate has to
 * know about — same contract as `strategiKpiFromWire`.
 */
export function strategiNarasiFromWire(v: unknown): strategi.NarasiInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    growthThesis: strOrNull(b.growth_thesis),
    urutanEksekusiAlasan: strOrNull(b.urutan_eksekusi_alasan),
    skenarioMundur: strOrNull(b.skenario_mundur),
    kondisiStopScope: strOrNull(b.kondisi_stop_scope),
  };
}

/** Inbound: Section D-7 Sanggahan Target (A-08). */
export function strategiSanggahanFromWire(v: unknown): strategi.SanggahanInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    alasan: str(b.alasan),
    // Currency stays a STRING across the wire (frozen invariant: integer minor
    // units, never a float). `Number()` here would reintroduce the drift the
    // money rules exist to prevent.
    angkaPembanding: str(b.angka_pembanding),
    targetRealistis: str(b.target_realistis),
  };
}

/** Inbound: Section E pillars. */
export function strategiPillarsFromWire(v: unknown): strategi.PillarInput[] {
  return asRecords(v).map((p, i) => ({
    jenis: str(p.jenis) as strategi.PillarKind,
    channel: strOrNull(p.channel),
    urutan: numOrNull(p.urutan) ?? i,
    sku: strOrNull(p.sku),
    peran: strOrNull(p.peran),
    aksi: str(p.aksi),
    target: str(p.target),
    hargaNormal: strOrNull(p.harga_normal),
    hargaPromo: strOrNull(p.harga_promo),
    floorPrice: strOrNull(p.floor_price),
    vendorId: strOrNull(p.vendor_id),
    slotJam: numOrNull(p.slot_jam),
    tarif: strOrNull(p.tarif),
    targetGmvPerJam: strOrNull(p.target_gmv_per_jam),
    detail: (typeof p.detail === 'object' && p.detail !== null ? p.detail : {}) as Record<
      string,
      unknown
    >,
  }));
}

/** Inbound: Section F resource commitments. */
export function strategiResourcesFromWire(v: unknown): strategi.ResourceInput[] {
  return asRecords(v).map((r) => ({
    jenis: str(r.jenis) as strategi.ResourceKind,
    channel: strOrNull(r.channel),
    divisi: strOrNull(r.divisi),
    nilai: strOrNull(r.nilai),
    jumlah: numOrNull(r.jumlah),
    satuan: strOrNull(r.satuan),
    sumberDana: (strOrNull(r.sumber_dana) as 'klien' | 'paket_mea' | null) ?? null,
    vendorId: strOrNull(r.vendor_id),
    skemaBiaya: strOrNull(r.skema_biaya),
    catatan: str(r.catatan),
  }));
}

/** Inbound: H-1 risk register. */
export function strategiRisksFromWire(v: unknown): strategi.RiskInput[] {
  return asRecords(v).map((r, i) => ({
    risiko: str(r.risiko),
    dampak: str(r.dampak) as strategi.RiskLevel,
    kemungkinan: str(r.kemungkinan) as strategi.RiskLevel,
    mitigasi: str(r.mitigasi),
    pic: str(r.pic),
    urutan: numOrNull(r.urutan) ?? i,
  }));
}

// ---------------------------------------------------------------------------
// Section E-12 / G / H-2 / I inbound parsers (A-09b)
// ---------------------------------------------------------------------------

/** Inbound: E-12 client dependencies. */
export function strategiKetergantunganFromWire(v: unknown): strategi.KetergantunganInput[] {
  return asRecords(v).map((k, i) => ({
    item: str(k.item),
    kapan: str(k.kapan),
    konsekuensi: str(k.konsekuensi),
    urutan: numOrNull(k.urutan) ?? i,
  }));
}

/**
 * Inbound: Section G — G-1 phases, G-2 big dates, G-3/G-4 review cadence.
 *
 * A missing `fase`/`tanggal_besar` key parses to `[]`, which CLEARS the list.
 * That is the same contract every other list endpoint here has (pillars, risks,
 * akses): the body is the new state, not a patch. The submit gate is what
 * reports an empty G-1 as `G-1` still missing.
 */
export function strategiKalenderFromWire(v: unknown): strategi.KalenderInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    fase: asRecords(b.fase).map((f, i) => ({
      nama: str(f.nama),
      tanggalMulai: str(f.tanggal_mulai),
      tanggalAkhir: str(f.tanggal_akhir),
      tujuan: str(f.tujuan),
      kriteriaLulus: str(f.kriteria_lulus),
      urutan: numOrNull(f.urutan) ?? i,
    })),
    tanggalBesar: asRecords(b.tanggal_besar).map((t, i) => ({
      tanggal: str(t.tanggal),
      nama: str(t.nama),
      peran: str(t.peran),
      urutan: numOrNull(t.urutan) ?? i,
    })),
    reviewKlienFrekuensi: strOrNull(b.review_klien_frekuensi),
    reviewKlienFormat: strOrNull(b.review_klien_format),
    reviewKlienPic: strOrNull(b.review_klien_pic),
    reviewInternalFrekuensi: strOrNull(b.review_internal_frekuensi),
  };
}

/** Inbound: H-2 declared revision triggers. */
export function strategiTriggerRevisiFromWire(v: unknown): strategi.TriggerRevisiInput[] {
  return asRecords(v).map((t, i) => ({
    kode: str(t.kode) as strategi.TriggerRevisiCode,
    // A COUNT, not money — see StrategiTriggerRevisiWire.
    ambang: numOrNull(t.ambang),
    catatan: strOrNull(t.catatan),
    urutan: numOrNull(t.urutan) ?? i,
  }));
}

/** Inbound: Section I — I-2 dispatch order, I-3 report metrics, I-4 notes. */
export function strategiHandoffFromWire(v: unknown): strategi.HandoffInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    dispatch: asRecords(b.dispatch).map((d, i) => ({
      divisi: str(d.divisi) as strategi.DispatchDivision,
      urutan: numOrNull(d.urutan) ?? i + 1,
      catatan: strOrNull(d.catatan),
    })),
    metrikLaporanKlien: Array.isArray(b.metrik_laporan_klien)
      ? (b.metrik_laporan_klien.map((m) => String(m)) as strategi.LaporanMetric[])
      : [],
  };
}

/** Inbound: the Rule 13 revision declaration (trigger + reason + broken assumptions). */
export function strategiRevisionFromWire(v: unknown): strategi.RevisionInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    triggerRevisi: Array.isArray(b.trigger_revisi) ? b.trigger_revisi.map((t) => String(t)) : [],
    alasanRevisi: str(b.alasan_revisi),
    asumsiGugur: Array.isArray(b.asumsi_gugur) ? b.asumsi_gugur.map((a) => String(a)) : [],
  };
}

// ---------------------------------------------------------------------------
// Section C inbound parsers (A-07)
// ---------------------------------------------------------------------------

/** Inbound: PUT /strategi/{id}/diagnosa body → DiagnosaPayload. */
export function strategiDiagnosaFromWire(v: unknown): strategi.DiagnosaPayload {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    diagnosa: asRecords(b.diagnosa).map((d) => ({
      channel: str(d.channel),
      bottleneck: str(d.bottleneck) as strategi.BottleneckKind,
      fieldIds: Array.isArray(d.field_ids) ? d.field_ids.map((f) => String(f)) : [],
      akarMasalah: strOrNull(d.akar_masalah),
      gapKompetitor: strOrNull(d.gap_kompetitor),
    })),
    quickWins: asRecords(b.quick_wins).map((q, i) => ({
      aksi: str(q.aksi),
      channel: str(q.channel),
      picDivisi: str(q.pic_divisi),
      dampakDiharapkan: str(q.dampak_diharapkan),
      urutan: numOrNull(q.urutan) ?? i,
    })),
    risikoStruktural: asRecords(b.risiko_struktural).map((r, i) => ({
      risiko: str(r.risiko),
      urutan: numOrNull(r.urutan) ?? i,
    })),
    prasyaratKlien: asRecords(b.prasyarat_klien).map((p, i) => ({
      item: str(p.item),
      picKlien: str(p.pic_klien),
      deadline: strOrNull(p.deadline),
      urutan: numOrNull(p.urutan) ?? i,
    })),
  };
}

// ===========================================================================
// Modul Interview ("Kelola Klien" tab 1) — langkah 6
// ===========================================================================
//
// The domain read-models speak camelCase; web-internal consumes snake_case.
// Missing keys are more dangerous than nulls (O43: a blank page behind a 200),
// so every field is emitted explicitly — `null`, never omitted.

export interface InterviewWire {
  id: string;
  client_id: string;
  contract_id: string | null;
  service_id: string | null;
  am_pengisi_id: string;
  acting_for_am_id: string | null;
  sales_closing_id: string | null;
  status: string;
  versi_no: number;
  interview_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  interview_profile: string;
  retroaktif: boolean;
  alasan_kekosongan: string | null;
  alasan_pembatalan: string | null;
  created_at: string;
  created_by: string;
}

export interface InterviewJadwalWire {
  tanggal_waktu: string | null;
  durasi_menit: number | null;
  format: string | null;
  lokasi_link: string | null;
  peserta_klien: unknown;
  peserta_mea: unknown;
  catatan_persiapan: string | null;
  data_diminta: unknown;
}

export interface InterviewKualifikasiWire {
  skor_kualifikasi: number;
  skor_per_blok: unknown;
  verdict_kualifikasi: string;
  hambatan_mendasar: unknown;
  prasyarat_status: string;
  margin_bersih: number | null;
  margin_bersih_basis: string;
  margin_kotor: number | null;
  margin_derivasi_input: unknown;
  kualitas_data: string;
  bep_roas: number | null;
  rasio_target: number | null;
  dihitung_pada: string;
}

export interface InterviewAnswerWire {
  section: string;
  field_key: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  nilai_uang: string | null;
  nilai_bool: boolean | null;
  nilai_enum: string | null;
  nilai_jsonb: unknown;
  sumber_angka: string | null;
  dasar_estimasi: string | null;
}

/**
 * Riset Awal — langkah 1 of "Kelola Klien". `durasi_menit` is DERIVED server-side
 * from the two anchors (there is no duration column); it stays `null` while the
 * work is running, which the UI renders as `—`.
 */
export interface InterviewRisetAwalWire {
  interview_id: string;
  status: string;
  dimulai_pada: string;
  dimulai_oleh: string;
  disubmit_pada: string | null;
  disubmit_oleh: string | null;
  durasi_menit: number | null;
  retroaktif: boolean;
}

export interface InterviewDetailWire {
  interview: InterviewWire;
  riset_awal: InterviewRisetAwalWire | null;
  jadwal: InterviewJadwalWire | null;
  kualifikasi: InterviewKualifikasiWire | null;
  answers: InterviewAnswerWire[];
}

/** verdict + prasyarat ONLY — the Sales-facing surface. */
export interface InterviewVerdictWire {
  interview_id: string;
  verdict: string;
  prasyarat_status: string;
}

/** One row of the client's interview log (list surface). */
export interface InterviewListRowWire {
  id: string;
  client_id: string;
  service_id: string | null;
  status: string;
  versi_no: number;
  interview_profile: string;
  retroaktif: boolean;
  verdict: string | null;
  prasyarat_status: string | null;
  skor_kualifikasi: number | null;
  riset_awal_status: string | null;
  riset_awal_dimulai_pada: string | null;
  riset_awal_disubmit_pada: string | null;
  riset_awal_durasi_menit: number | null;
  created_at: string;
}

export function interviewListToWire(rows: interview.InterviewListRow[]): InterviewListRowWire[] {
  return rows.map((r) => ({
    id: r.id,
    client_id: r.clientId,
    service_id: r.serviceId,
    status: r.status,
    versi_no: r.versiNo,
    interview_profile: r.interviewProfile,
    retroaktif: r.retroaktif,
    verdict: r.verdict,
    prasyarat_status: r.prasyaratStatus,
    skor_kualifikasi: r.skorKualifikasi,
    riset_awal_status: r.risetAwalStatus,
    riset_awal_dimulai_pada: r.risetAwalDimulaiPada,
    riset_awal_disubmit_pada: r.risetAwalDisubmitPada,
    riset_awal_durasi_menit: r.risetAwalDurasiMenit,
    created_at: r.createdAt,
  }));
}

/**
 * One measured step of the Kelola Klien timeline. `hari_kerja` is working days
 * (Mon–Fri minus `hari_libur`) computed server-side — `null` while the step has
 * not started, which the UI renders as `—`.
 */
export interface TimelineStepWire {
  langkah: number;
  nama: string;
  mulai_pada: string | null;
  selesai_pada: string | null;
  hari_kerja: number | null;
  target_hari: number;
  batas_hari: number;
  status: string;
  selesai: boolean;
}

export interface KelolaKlienTimelineWire {
  interview_id: string;
  config_version: number;
  langkah: TimelineStepWire[];
}

export function kelolaKlienTimelineToWire(t: interview.KelolaKlienTimeline): KelolaKlienTimelineWire {
  return {
    interview_id: t.interviewId,
    config_version: t.configVersion,
    langkah: t.langkah.map((s) => ({
      langkah: s.langkah,
      nama: s.nama,
      mulai_pada: s.mulaiPada,
      selesai_pada: s.selesaiPada,
      hari_kerja: s.hariKerja,
      target_hari: s.targetHari,
      batas_hari: s.batasHari,
      status: s.status,
      selesai: s.selesai,
    })),
  };
}

/** One row of the national-holiday calendar (admin plane). */
export interface HariLiburWire {
  tanggal: string;
  keterangan: string;
  created_at: string;
  created_by: string;
}

export function hariLiburToWire(h: admin.HariLibur): HariLiburWire {
  return {
    tanggal: h.tanggal,
    keterangan: h.keterangan,
    created_at: h.createdAt,
    created_by: h.createdBy,
  };
}

export function interviewRisetAwalToWire(r: interview.RisetAwal): InterviewRisetAwalWire {
  return {
    interview_id: r.interviewId,
    status: r.status,
    dimulai_pada: r.dimulaiPada,
    dimulai_oleh: r.dimulaiOleh,
    disubmit_pada: r.disubmitPada,
    disubmit_oleh: r.disubmitOleh,
    durasi_menit: r.durasiMenit,
    retroaktif: r.retroaktif,
  };
}

export function interviewToWire(i: interview.Interview): InterviewWire {
  return {
    id: i.id,
    client_id: i.clientId,
    contract_id: i.contractId,
    service_id: i.serviceId,
    am_pengisi_id: i.amPengisiId,
    acting_for_am_id: i.actingForAmId,
    sales_closing_id: i.salesClosingId,
    status: i.status,
    versi_no: i.versiNo,
    interview_induk_id: i.interviewIndukId,
    versi_sebelumnya_id: i.versiSebelumnyaId,
    interview_profile: i.interviewProfile,
    retroaktif: i.retroaktif,
    alasan_kekosongan: i.alasanKekosongan,
    alasan_pembatalan: i.alasanPembatalan,
    created_at: i.createdAt,
    created_by: i.createdBy,
  };
}

function interviewKualifikasiToWire(k: interview.Kualifikasi): InterviewKualifikasiWire {
  return {
    skor_kualifikasi: k.skorKualifikasi,
    skor_per_blok: k.skorPerBlok,
    verdict_kualifikasi: k.verdictKualifikasi,
    hambatan_mendasar: k.hambatanMendasar,
    prasyarat_status: k.prasyaratStatus,
    margin_bersih: k.marginBersih,
    margin_bersih_basis: k.marginBersihBasis,
    margin_kotor: k.marginKotor,
    margin_derivasi_input: k.marginDerivasiInput,
    kualitas_data: k.kualitasData,
    bep_roas: k.bepRoas,
    rasio_target: k.rasioTarget,
    dihitung_pada: k.dihitungPada,
  };
}

export function interviewDetailToWire(d: interview.InterviewDetail): InterviewDetailWire {
  return {
    interview: interviewToWire(d.interview),
    riset_awal: d.risetAwal ? interviewRisetAwalToWire(d.risetAwal) : null,
    jadwal: d.jadwal
      ? {
          tanggal_waktu: d.jadwal.tanggalWaktu,
          durasi_menit: d.jadwal.durasiMenit,
          format: d.jadwal.format,
          lokasi_link: d.jadwal.lokasiLink,
          peserta_klien: d.jadwal.pesertaKlien,
          peserta_mea: d.jadwal.pesertaMea,
          catatan_persiapan: d.jadwal.catatanPersiapan,
          data_diminta: d.jadwal.dataDiminta,
        }
      : null,
    kualifikasi: d.kualifikasi ? interviewKualifikasiToWire(d.kualifikasi) : null,
    answers: d.answers.map((a) => ({
      section: a.section,
      field_key: a.fieldKey,
      nilai_teks: a.nilaiTeks,
      nilai_angka: a.nilaiAngka,
      nilai_uang: a.nilaiUang,
      nilai_bool: a.nilaiBool,
      nilai_enum: a.nilaiEnum,
      nilai_jsonb: a.nilaiJsonb,
      sumber_angka: a.sumberAngka,
      dasar_estimasi: a.dasarEstimasi,
    })),
  };
}

export function interviewKualifikasiResultToWire(k: interview.Kualifikasi): InterviewKualifikasiWire {
  return interviewKualifikasiToWire(k);
}

export function interviewVerdictToWire(v: interview.InterviewVerdict): InterviewVerdictWire {
  return { interview_id: v.interviewId, verdict: v.verdict, prasyarat_status: v.prasyaratStatus };
}

// --- request-body mappers (snake_case wire → camelCase domain input) ---------

export function interviewCreateFromWire(v: unknown): interview.CreateInterviewInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    clientId: String(b.client_id ?? ''),
    contractId: strOrNull(b.contract_id),
    serviceId: strOrNull(b.service_id),
    actingForAmId: strOrNull(b.acting_for_am_id),
    salesClosingId: strOrNull(b.sales_closing_id),
    interviewProfile: b.interview_profile === undefined || b.interview_profile === null ? undefined : String(b.interview_profile),
    retroaktif: b.retroaktif === true,
  };
}

export function interviewJadwalFromWire(v: unknown): interview.JadwalInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    tanggalWaktu: strOrNull(b.tanggal_waktu),
    durasiMenit: numOrNull(b.durasi_menit),
    format: strOrNull(b.format),
    lokasiLink: strOrNull(b.lokasi_link),
    catatanPersiapan: strOrNull(b.catatan_persiapan),
  };
}

export function interviewAnswersFromWire(v: unknown): interview.AnswerInput[] {
  return asRecords((v as Record<string, unknown>)?.answers ?? v).map((a) => ({
    section: String(a.section ?? ''),
    fieldKey: String(a.field_key ?? ''),
    nilaiTeks: strOrNull(a.nilai_teks),
    nilaiAngka: numOrNull(a.nilai_angka),
    nilaiUang: a.nilai_uang === undefined || a.nilai_uang === null ? null : BigInt(String(a.nilai_uang)),
    nilaiBool: typeof a.nilai_bool === 'boolean' ? a.nilai_bool : null,
    nilaiEnum: strOrNull(a.nilai_enum),
    nilaiJsonb: a.nilai_jsonb ?? null,
    sumberAngka: strOrNull(a.sumber_angka),
    dasarEstimasi: strOrNull(a.dasar_estimasi),
    wajibKosong: a.wajib_kosong === true,
  }));
}

/** Builds the core KualifikasiInput from a wire body. Money fields are minor-unit
 *  integer strings → bigint; enums are the canonical codes; percentages plain. */
export function interviewScoreFromWire(v: unknown): ivcore.KualifikasiInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const bigOrNull = (x: unknown): bigint | null => (x === undefined || x === null || x === '' ? null : BigInt(String(x)));
  const big = (x: unknown): bigint => bigOrNull(x) ?? 0n;
  const reset = b.reset_ekspektasi_tertulis as Record<string, unknown> | null | undefined;
  return {
    marginBersih: numOrNull(b.margin_bersih),
    marginBersihSumber: (strOrNull(b.margin_bersih_sumber) as ivcore.SumberAngka | null) ?? null,
    marginBersihDasarEstimasi: strOrNull(b.margin_bersih_dasar_estimasi),
    marginKotor: numOrNull(b.margin_kotor),
    komisiPlatformPersen: numOrNull(b.komisi_platform_persen),
    ongkirPersen: numOrNull(b.ongkir_persen),
    ongkirPerPesanan: bigOrNull(b.ongkir_per_pesanan),
    aov: big(b.aov),
    aovSumber: (strOrNull(b.aov_sumber) as ivcore.SumberAngka | null) ?? undefined,
    ruangHarga: String(b.ruang_harga ?? '') as ivcore.RuangHarga,
    modelBisnis: String(b.model_bisnis ?? '') as ivcore.ModelBisnis,
    kesanggupanLonjakan: String(b.kesanggupan_lonjakan ?? '') as ivcore.KesanggupanLonjakan,
    siklusBeliUlang: String(b.siklus_beli_ulang ?? '') as ivcore.SiklusBeliUlang,
    pembedaProduk: String(b.pembeda_produk ?? '') as ivcore.PembedaProduk,
    skuSiap: Number(b.sku_siap ?? 0),
    skuSiapSumber: (strOrNull(b.sku_siap_sumber) as ivcore.SumberAngka | null) ?? undefined,
    penangananChat: String(b.penanganan_chat ?? '') as ivcore.PenangananChat,
    kecepatanApproval: String(b.kecepatan_approval ?? '') as ivcore.KecepatanApproval,
    kesiapanAkses: String(b.kesiapan_akses ?? '') as ivcore.KesiapanAkses,
    omzet: big(b.omzet),
    omzetSumber: (strOrNull(b.omzet_sumber) as ivcore.SumberAngka | null) ?? undefined,
    targetOmzet: big(b.target_omzet),
    targetOmzetSumber: (strOrNull(b.target_omzet_sumber) as ivcore.SumberAngka | null) ?? undefined,
    dayaTahanBudget: String(b.daya_tahan_budget ?? '') as ivcore.DayaTahanBudget,
    resetEkspektasiTertulis:
      reset && reset.target_baru != null
        ? { targetBaru: big(reset.target_baru), disetujuiOleh: String(reset.disetujui_oleh ?? ''), disetujuiPada: String(reset.disetujui_pada ?? '') }
        : null,
    defaultKomisiPlatformPersen: numOrNull(b.default_komisi_platform_persen),
    defaultOngkirPersen: numOrNull(b.default_ongkir_persen),
  };
}

// --- M6D Rekap Hasil Mingguan (Weekly Result Recap, WRR-) — D-09b -----------
//
// Machine #18 (`weekly_result_recap`). The domain read-models are camelCase
// (@cdps/domain recap.ts); these mappers emit the snake_case shapes
// `web-internal/src/lib/recap.ts` consumes. Nullable fields are emitted as an
// explicit `null`, NEVER omitted — a MISSING key blanks the page harder than a
// null one (O43). Serves the D-10 UI.

/** recap.Recap → RecapWire (the recap header). */
export interface RecapWire {
  id: string;
  client_id: string;
  plan_id: string | null;
  iso_year: number;
  iso_week: number;
  minggu_mulai: string;
  minggu_akhir: string;
  status: string;
  pernah_ditutup_otomatis: boolean;
  catatan_pembuka: string | null;
  ditutup_pada: string | null;
  ditutup_oleh: string | null;
  created_at: string;
  created_by: string;
}

/** recap.RecapDivisi → RecapDivisiWire (RM-B per-division production headline). */
export interface RecapDivisiWire {
  recap_id: string;
  divisi: string;
  jumlah_produksi: number;
  rincian: Record<string, unknown>;
  sengketa: string | null;
}

/** recap.RecapMetrik → RecapMetrikWire (RM-C metric row: auto / manual / `—`). */
export interface RecapMetrikWire {
  recap_id: string;
  metrik: string;
  nilai: number | null;
  sumber: string;
  file_bukti: string | null;
  tanggal_ambil: string | null;
  nilai_minggu_lalu: number | null;
  sengketa: string | null;
}

/** recap.RecapCatatan → RecapCatatanWire (RM-D narrative + RM-C9 text-only note). */
export interface RecapCatatanWire {
  recap_id: string;
  yang_bergerak: string | null;
  yang_tertahan: string | null;
  fokus_minggu_depan: string | null;
  bahan_untuk_klien: string | null;
  catatan_metrik_tambahan: string | null;
}

/** recap.RecapCatatanDivisi → RecapCatatanDivisiWire (RM-D6 append-only note). */
export interface RecapCatatanDivisiWire {
  id: number;
  recap_id: string;
  divisi: string;
  catatan: string;
  created_at: string;
  created_by: string;
}

/** recap.RecapDetail → RecapDetailWire (the whole recap bundle for the detail page). */
export interface RecapDetailWire {
  recap: RecapWire;
  divisi: RecapDivisiWire[];
  metrik: RecapMetrikWire[];
  catatan: RecapCatatanWire | null;
  catatan_divisi: RecapCatatanDivisiWire[];
}

/** Maps a domain Recap (camelCase) to the RecapWire shape. */
export function recapToWire(r: recap.Recap): RecapWire {
  return {
    id: r.id,
    client_id: r.clientId,
    plan_id: r.planId,
    iso_year: r.isoYear,
    iso_week: r.isoWeek,
    minggu_mulai: r.mingguMulai,
    minggu_akhir: r.mingguAkhir,
    status: r.status,
    pernah_ditutup_otomatis: r.pernahDitutupOtomatis,
    catatan_pembuka: r.catatanPembuka,
    ditutup_pada: r.ditutupPada,
    ditutup_oleh: r.ditutupOleh,
    created_at: r.createdAt,
    created_by: r.createdBy,
  };
}

/** Maps a domain RecapDivisi to the RecapDivisiWire shape. */
export function recapDivisiToWire(d: recap.RecapDivisi): RecapDivisiWire {
  return {
    recap_id: d.recapId,
    divisi: d.divisi,
    jumlah_produksi: d.jumlahProduksi,
    rincian: d.rincian,
    sengketa: d.sengketa,
  };
}

/** Maps a domain RecapMetrik to the RecapMetrikWire shape. */
export function recapMetrikToWire(m: recap.RecapMetrik): RecapMetrikWire {
  return {
    recap_id: m.recapId,
    metrik: m.metrik,
    nilai: m.nilai,
    sumber: m.sumber,
    file_bukti: m.fileBukti,
    tanggal_ambil: m.tanggalAmbil,
    nilai_minggu_lalu: m.nilaiMingguLalu,
    sengketa: m.sengketa,
  };
}

/** Maps a domain RecapCatatan to the RecapCatatanWire shape. */
export function recapCatatanToWire(c: recap.RecapCatatan): RecapCatatanWire {
  return {
    recap_id: c.recapId,
    yang_bergerak: c.yangBergerak,
    yang_tertahan: c.yangTertahan,
    fokus_minggu_depan: c.fokusMingguDepan,
    bahan_untuk_klien: c.bahanUntukKlien,
    catatan_metrik_tambahan: c.catatanMetrikTambahan,
  };
}

/** Maps a domain RecapCatatanDivisi to the RecapCatatanDivisiWire shape. */
export function recapCatatanDivisiToWire(c: recap.RecapCatatanDivisi): RecapCatatanDivisiWire {
  return {
    id: c.id,
    recap_id: c.recapId,
    divisi: c.divisi,
    catatan: c.catatan,
    created_at: c.createdAt,
    created_by: c.createdBy,
  };
}

/** Maps a domain RecapDetail bundle to the RecapDetailWire shape. */
export function recapDetailToWire(d: recap.RecapDetail): RecapDetailWire {
  return {
    recap: recapToWire(d.recap),
    divisi: d.divisi.map(recapDivisiToWire),
    metrik: d.metrik.map(recapMetrikToWire),
    catatan: d.catatan === null ? null : recapCatatanToWire(d.catatan),
    catatan_divisi: d.catatanDivisi.map(recapCatatanDivisiToWire),
  };
}

/** Builds the RM-D narrative input from a wire body (full-replace: omitted → null). */
export function recapNarasiFromWire(v: unknown): recap.RecapNarasiInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    yangBergerak: strOrNull(b.yang_bergerak),
    yangTertahan: strOrNull(b.yang_tertahan),
    fokusMingguDepan: strOrNull(b.fokus_minggu_depan),
    bahanUntukKlien: strOrNull(b.bahan_untuk_klien),
    catatanMetrikTambahan: strOrNull(b.catatan_metrik_tambahan),
  };
}

/** Builds the RM-C manual-metric input from a wire body (`nilai: null` → `—`). */
export function recapMetrikManualFromWire(v: unknown): recap.RecapMetrikManualInput {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    nilai: numOrNull(b.nilai),
    fileBukti: b.file_bukti === undefined || b.file_bukti === null ? undefined : String(b.file_bukti),
    tanggalAmbil: b.tanggal_ambil === undefined || b.tanggal_ambil === null ? undefined : String(b.tanggal_ambil),
  };
}
