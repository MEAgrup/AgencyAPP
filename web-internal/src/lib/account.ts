// Typed wrapper over lib/api.ts for Module 6 (Account & Service) endpoints.
// Shapes mirror backend/internal/httpapi/account_handlers.go +
// backend/internal/module6_account/{account,strategy,brief,brief_review,complaint}.go
// exactly (json tags read from the handler/view structs) — never invented.
//
// Notes read from the FE brief recon (fe_briefs/m6.md):
//  - List endpoints return {"data": [...]}; single-item GETs return the object
//    directly (no wrapper). See per-function return generics below.
//  - Transition endpoints (submit/review/approve/start/resolve/close) return
//    {"ok": true, "from": "...", "to": "..."} (apps/api http.ts
//    transitionResponse). The Go build's capitalized {"From","To"} is retired —
//    see lib/transition.ts, which reads both.
//  - Many fields use omitempty => the JSON key may be ABSENT (not null) when
//    empty; every such field is typed optional here.
//  - No PATCH is needed by this module (strategy edit uses PUT), so we do not
//    duplicate a local patch() helper — lib/api.ts covers get/post/put/delete.

import { api } from '@/lib/api';
import type { PlanTier, Role } from '@/lib/types';

// ---------------------------------------------------------------------------
// Cluster 1 — Intake & AM assignment (account.go)
// ---------------------------------------------------------------------------

export interface IntakeClient {
  client_id: string;
  nama_pic: string;
  toko: string;
  kota: string;
  kategori: string;
  service_count: number;
  released_to_account_at: string | null; // RFC3339 or null (explicit *time.Time)
}

export interface AMWorkload {
  am_employee_id: string;
  active_client_count: number;
}

export interface Assignment {
  client_id: string;
  previous_am?: string;
  assigned_am: string;
  assigned_by: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Cluster 2 — Strategy & Plan (strategy.go)
// ---------------------------------------------------------------------------

/** One planned per-division task-satuan quota (QA revisi 2026-08-12). */
export interface DivisionTask {
  divisi: string;
  jenis: string;
  jumlah: string;
}

export interface Strategy {
  id: string;
  service_id: string;
  objective: string;
  target_kpi: string;
  /** Structured Target KPI (QA revisi). GMV is Rp; the rest ratios/percents; null when unset. */
  target_gmv: string | null;
  target_roas: string | null;
  target_ctr: string | null;
  target_cvr: string | null;
  /** The client's target GMV the ±20% band is measured against. */
  client_target_gmv: string | null;
  gmv_adjustment_status: string;
  gmv_adjustment_reason: string | null;
  gmv_adjustment_approved_by: string | null;
  division_tasks: DivisionTask[];
  divisions_involved: string[];
  planned_brief_outline: string;
  timeline_start: string; // YYYY-MM-DD
  timeline_end: string; // YYYY-MM-DD
  status: string;
  approved_by?: string;
  revision_notes?: string;
  revision_count: number; // only accurate on GetStrategy (detail), 0 in list
  created_by: string;
  created_at: string;
}

export interface StrategyInput {
  objective: string;
  target_kpi?: string;
  target_gmv?: string | null;
  target_roas?: string | null;
  target_ctr?: string | null;
  target_cvr?: string | null;
  gmv_adjustment_reason?: string | null;
  division_tasks?: DivisionTask[];
  divisions_involved: string[];
  planned_brief_outline: string;
  timeline_start: string; // YYYY-MM-DD
  timeline_end: string; // YYYY-MM-DD
}

/** GMV adjustment gate states (mirror of the domain constants). */
export const GMV_ADJ_IN_TOLERANCE = 'dalam_toleransi';
export const GMV_ADJ_PENDING = 'menunggu_persetujuan';
export const GMV_ADJ_APPROVED = 'disetujui';

/** The ±20% tolerance band the AM may adjust the client's target GMV within. */
export const GMV_TOLERANCE = 0.2;

/**
 * Fixed per-division task-satuan catalog (QA revisi). Mirrors the domain
 * TASK_CATALOG — the form renders one input per (division, jenis) for each
 * involved division. `money` marks a Rupiah amount (Ads spend).
 */
export const TASK_CATALOG: Record<string, { jenis: string; label: string; money?: boolean }[]> = {
  Creative: [
    { jenis: 'video_seller', label: 'Jumlah video seller' },
    { jenis: 'sku_optimize', label: 'Jumlah SKU optimize' },
  ],
  KOL: [
    { jenis: 'video_creator', label: 'Jumlah video creator' },
    { jenis: 'live_stream_creator', label: 'Jumlah live stream creator' },
  ],
  Ads: [{ jenis: 'ads_spent', label: 'Ads spent (Rp)', money: true }],
  'Live Stream': [{ jenis: 'live_stream', label: 'Jumlah live stream' }],
};

export interface StrategyRequirement {
  service_id: string;
  requires_strategy_plan: boolean; // effective value after override
  pinned_requires_strategy_plan: boolean; // original MSL pin (immutable)
  overridden: boolean;
  set_by: string;
  reason: string;
}

/**
 * One Service in the AM's personal queue (M6 §3 Rule 4) — GET /services and
 * GET /services/{id}. No key is omitempty on this endpoint: `strategy_id` /
 * `strategy_status` / `assigned_am_id` arrive as explicit null, because "no Plan
 * yet" is precisely the state the onboarding UI must react to.
 */
export interface ServiceQueueRow {
  service_id: string;
  client_id: string;
  toko: string;
  nama_pic: string;
  name: string;
  status: string;
  requires_strategy_plan: boolean; // EFFECTIVE gate (override ∨ decision ∨ tier)
  pinned_requires_strategy_plan: boolean;
  overridden: boolean;
  /** M6C S4 — which of the three catalog tiers this Service was pinned to. */
  plan_tier: PlanTier;
  /** the recorded G-B decision; null while the middle tier is unanswered. */
  gate_decision: GateDecision | null;
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

// ---------------------------------------------------------------------------
// Cluster 3 — Brief breakdown & dispatch (brief.go)
// ---------------------------------------------------------------------------

export interface Brief {
  id: string;
  service_id: string;
  strategy_id?: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  quantity_target: number;
  due_date: string; // YYYY-MM-DD
  priority: string;
  recurring: boolean;
  recurring_frequency?: string;
  recurring_count?: number;
  recurring_end_date?: string;
  instructions?: string;
  reference_attachments?: string;
  title: string;
  status: string;
  revision_count: number; // only accurate on GetBrief (detail)
  revision_flagged: boolean; // only accurate on GetBrief (detail)
  created_by: string;
  created_at: string;
  // M16 — null untuk divisi tanpa pipeline tahapan (mis. Store Operation).
  stage_pipeline_code: string | null;
  production_stage: string | null;
}

export interface BriefInput {
  title: string;
  strategy_id: string; // "" for Direct-path service; STR-id for plan-gated
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  quantity_target: number;
  due_date: string; // YYYY-MM-DD
  priority: string;
  recurring: boolean;
  recurring_frequency?: string;
  recurring_count?: number;
  recurring_end_date?: string;
  instructions?: string;
  reference_attachments?: string;
  is_addendum?: boolean;
}

// ---------------------------------------------------------------------------
// Cluster 4b — Complaint door #2 (complaint.go)
// ---------------------------------------------------------------------------

export interface Complaint {
  id: string;
  client_id: string;
  related_ref?: string; // SVC- or BRF- id belonging to the same client
  source: string; // Door #2 is always "WhatsApp (AM-logged)"
  description: string;
  severity: string;
  status: string;
  assigned_to?: string;
  resolution_notes?: string;
  created_by: string;
  created_at: string;
}

export interface ComplaintInput {
  description: string;
  severity: string;
  related_ref: string; // optional; "" when none
}

// Result of a statemachine transition — `{ok, from, to}` on the wire (apps/api
// http.ts transitionResponse). Read via lib/transition.ts.
import type { TransitionResult } from '@/lib/transition';
export type { TransitionResult };

// ---------------------------------------------------------------------------
// Const option lists — verbatim BI strings from the PRD / brief. Do not rename.
// ---------------------------------------------------------------------------

// Divisions a Strategy can involve / a Brief can target (§4/§5). Live Stream is a
// valid target but its Brief is dispatched straight to the vendor tracker (M10)
// and never appears on the standard kanban.
export const BRIEF_DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream'] as const;

// Divisions whose queue renders on the standard kanban board (§7). Live Stream
// is intentionally excluded (Brief born [Dispatched to Vendor], routed to M10).
export const KANBAN_DIVISIONS = ['Creative', 'Ads', 'KOL'] as const;

// Standard kanban columns for non-Live-Stream Briefs (STATE_MACHINES §7). The
// Account workspace only drives 3 AM-review edges; other transitions belong to
// the execution modules and render read-only here.
export const KANBAN_COLUMNS = [
  '[To Do]',
  '[In Progress]',
  '[Submitted]',
  '[In Review]',
  '[Approved]',
  '[Revision Requested]',
  '[Blocked]',
] as const;

export const PRIORITIES = ['Low', 'Medium', 'High'] as const;

// Severity + its Health-Score penalty (PRD §10 M6-OA-4) — penalty is display-only.
export const SEVERITIES = [
  { value: 'Low', penalty: -5 },
  { value: 'Medium', penalty: -15 },
  { value: 'High', penalty: -30 },
] as const;

// Strategy lifecycle labels (STATE_MACHINES §6a) — used for UI gating only.
export const STRATEGY_DRAFTING = '[Strategy Drafting]';
export const STRATEGY_SUBMITTED = '[Strategy Submitted for Approval]';
export const STRATEGY_APPROVED = '[Strategy Approved]';

// Brief lifecycle labels relevant to the 3 AM-review edges (STATE_MACHINES §7).
export const BRIEF_SUBMITTED = '[Submitted]';
export const BRIEF_IN_REVIEW = '[In Review]';

// Complaint lifecycle labels (STATE_MACHINES §11).
export const COMPLAINT_OPEN = '[Open]';
export const COMPLAINT_IN_PROGRESS = '[In Progress]';
export const COMPLAINT_RESOLVED = '[Resolved]';

// ---------------------------------------------------------------------------
// Role helpers — UI gating ONLY (CLAUDE.md #6). The server is always the final
// authority; these merely hide/disable controls a role clearly cannot use.
// Duplicated locally per house convention (do not add to shared lib/types.ts).
// ---------------------------------------------------------------------------

/**
 * The CDPS division string, verbatim from `role_mappings` (domain
 * `account.ACCOUNT_DIVISION`). Exported because the AM picker asks the server for
 * this division BY NAME — a typo there yields an empty dropdown, not an error.
 */
export const ACCOUNT_DIVISION = 'Account';

export function isAccountLead(role: Role | null): boolean {
  return !!role && role.division.toLowerCase() === 'account' && role.level === 'lead';
}

export function isAccountStaff(role: Role | null): boolean {
  return !!role && role.division.toLowerCase() === 'account' && role.level === 'staff';
}

/** SPV/Head Account (lead) or Director may assign/reassign. OD is read-only. */
export function canManageAssignment(role: Role | null): boolean {
  return isAccountLead(role) || !!role?.director;
}

/** Intake queue + workload: Account lead, OD, or Director. Staff AM is denied. */
export function canReadIntake(role: Role | null): boolean {
  return isAccountLead(role) || !!role?.od || !!role?.director;
}

/** Approve / request-revision on Strategy: Account lead or Director. */
export function canApproveStrategy(role: Role | null): boolean {
  return isAccountLead(role) || !!role?.director;
}

/** OD is read-only across all M6 write endpoints — hide write controls for OD. */
export function isReadOnlyOD(role: Role | null): boolean {
  return !!role?.od && !role?.director && !isAccountLead(role) && !isAccountStaff(role);
}

/** Client Record profile corrections, incl. Platform List (M4-OA-4/M4-OA-2):
 *  Account Lead, OD, or Director — mirrors domain `client.canEditProfile`. */
export function canEditClientProfile(role: Role | null): boolean {
  return !!role?.director || !!role?.od || isAccountLead(role);
}

// ---------------------------------------------------------------------------
// Cluster 1 — API functions
// ---------------------------------------------------------------------------

export function listIntake(): Promise<{ data: IntakeClient[] }> {
  return api.get<{ data: IntakeClient[] }>('/account/intake');
}

export function listWorkload(): Promise<{ data: AMWorkload[] }> {
  return api.get<{ data: AMWorkload[] }>('/account/workload');
}

export function assignAM(clientId: string, amId: string): Promise<Assignment> {
  return api.post<Assignment>(`/clients/${clientId}/assign-am`, { am_id: amId });
}

export function reassignAM(clientId: string, amId: string, reason: string): Promise<Assignment> {
  return api.post<Assignment>(`/clients/${clientId}/reassign-am`, { am_id: amId, reason });
}

// ---------------------------------------------------------------------------
// Service queue (§3 Rule 4) — API + the derived next step
// ---------------------------------------------------------------------------

/** GET /services — every Service the actor may see, with its client + plan gate. */
export function listServiceQueue(): Promise<{ data: ServiceQueueRow[] }> {
  return api.get<{ data: ServiceQueueRow[] }>('/services');
}

/** GET /services/{id} — one Service (status + EFFECTIVE plan gate + its Plan). */
export function getService(serviceId: string): Promise<ServiceQueueRow> {
  return api.get<ServiceQueueRow>(`/services/${serviceId}`);
}

/** Service lifecycle labels (STATE_MACHINES §6) — UI gating only. */
export const SERVICE_AWAITING_ONBOARDING = '[Awaiting Onboarding]';
export const SERVICE_STRATEGY_APPROVED = '[Strategy Approved]';
export const SERVICE_BRIEFED = '[Briefed]';
export const SERVICE_IN_EXECUTION = '[In Execution]';
export const SERVICE_VOIDED = '[Cancelled — Service Voided]';

/**
 * What the AM has to do next on one Service. Derived, never stored — and derived
 * HERE rather than server-side so there is exactly one copy of the §4/§5 gate
 * order in the domain (the write paths) and one copy in the UI that only decides
 * which button to show. `kind` drives the control; `label` is the button text.
 *
 * The order matters and mirrors §2 / §4 Rule 5 / §5 Rule 5 exactly:
 *   `ditentukan_am`, unanswered: answer G-B first (M6C Rule 1);
 *   plan-gated: draft Plan → submit → SPV approves → create Brief;
 *   Direct:     create Brief straight away (no Plan record ever exists, §4 Rule 6).
 */
export type OnboardingStepKind =
  | 'determine_plan'
  | 'draft_strategy'
  | 'submit_strategy'
  | 'await_approval'
  | 'create_brief'
  | 'monitor'
  | 'none';

export interface OnboardingStep {
  kind: OnboardingStepKind;
  label: string;
}

export function nextOnboardingStep(s: ServiceQueueRow): OnboardingStep {
  if (s.status === SERVICE_VOIDED) {
    return { kind: 'none', label: 'Service di-void' };
  }
  if (s.status === SERVICE_AWAITING_ONBOARDING) {
    // M6C Rule 1 comes FIRST: a `ditentukan_am` Service nobody has answered is
    // not Direct, it is UNANSWERED, and Brief creation is blocked until the G-B
    // form is filled. Checking `requires_strategy_plan` first would read this
    // state as Direct and offer a Brief the server always rejects — the same
    // class of bug as inferring the path from "does a Strategy row exist".
    if (s.plan_determination_pending) {
      return { kind: 'determine_plan', label: 'Tentukan kebutuhan Plan' };
    }
    // Plan-gated (§4): the Plan must exist, be submitted, and be approved before
    // any Brief may be created (§4 Rule 5).
    if (s.requires_strategy_plan) {
      if (s.strategy_id === null) {
        return { kind: 'draft_strategy', label: 'Buat Strategy & Plan' };
      }
      if (s.strategy_status === STRATEGY_DRAFTING) {
        return { kind: 'submit_strategy', label: 'Ajukan Plan untuk persetujuan' };
      }
      if (s.strategy_status === STRATEGY_SUBMITTED) {
        return { kind: 'await_approval', label: 'Menunggu persetujuan SPV' };
      }
      // An approved Plan whose Service has not caught up should not happen (the
      // approval drives both in one transaction, §6a) — treat as briefable.
      return { kind: 'create_brief', label: 'Buat Brief' };
    }
    // Direct path (§5 Rule 3): straight to Brief creation.
    return { kind: 'create_brief', label: 'Buat Brief (Direct)' };
  }
  if (s.status === SERVICE_STRATEGY_APPROVED) {
    return { kind: 'create_brief', label: 'Buat Brief' };
  }
  // [Briefed] / [In Execution] / terminal roll-up — work is dispatched; the AM
  // monitors and reviews it, there is nothing left to onboard.
  return { kind: 'monitor', label: 'Pantau Brief' };
}

/** True while a Service still needs onboarding work — the queue proper. */
export function needsOnboarding(s: ServiceQueueRow): boolean {
  const step = nextOnboardingStep(s).kind;
  return step !== 'monitor' && step !== 'none';
}

// ---------------------------------------------------------------------------
// Cluster 2 — API functions
// ---------------------------------------------------------------------------

export function listStrategies(): Promise<{ data: Strategy[] }> {
  return api.get<{ data: Strategy[] }>('/strategies');
}

export function getStrategy(id: string): Promise<Strategy> {
  return api.get<Strategy>(`/strategies/${id}`);
}

export function createStrategy(serviceId: string, input: StrategyInput): Promise<Strategy> {
  return api.post<Strategy>(`/services/${serviceId}/strategy`, input);
}

export function updateStrategy(id: string, input: StrategyInput): Promise<{ id: string }> {
  return api.put<{ id: string }>(`/strategies/${id}`, input);
}

export function submitStrategy(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/strategies/${id}/submit`);
}

export function approveStrategy(id: string): Promise<{ id: string; status: string }> {
  return api.post<{ id: string; status: string }>(`/strategies/${id}/approve`);
}

/** Clear a pending (out-of-tolerance) GMV adjustment — SPV/Head Account/Director (QA revisi). */
export function approveGmvAdjustment(id: string): Promise<{ id: string; gmv_adjustment_status: string }> {
  return api.post<{ id: string; gmv_adjustment_status: string }>(`/strategies/${id}/approve-gmv`);
}

export function requestStrategyRevision(id: string, notes: string): Promise<{ id: string; status: string }> {
  return api.post<{ id: string; status: string }>(`/strategies/${id}/request-revision`, { notes });
}

// ---------------------------------------------------------------------------
// Module 6C — Penentuan Kebutuhan Plan (plan-gate determination)
// ---------------------------------------------------------------------------

/**
 * Catalog tier (M6C S4). The two locked tiers have no form; the middle one does.
 * Defined in `types.ts` (which this file already imports) and re-exported here so
 * the many existing `from '@/lib/account'` importers keep working.
 */
export type { PlanTier };
export type GateDecision = 'butuh_plan' | 'tanpa_plan';
/** GB-4 — the two override directions are distinct on purpose (Rule 5). */
export type GateFit = 'sesuai' | 'tolak_plan' | 'tambah_plan';
export type TargetKind = 'gmv' | 'roas' | 'growth';

export const TIER_LABELS: Record<PlanTier, string> = {
  plan_wajib: 'Plan Wajib (dikunci katalog)',
  ditentukan_am: 'Plan Ditentukan AM',
  tanpa_plan: 'Tanpa Plan (dikunci katalog)',
};

export const FIT_LABELS: Record<GateFit, string> = {
  sesuai: 'Sesuai Rekomendasi',
  tolak_plan: 'Tolak Plan (menolak rekomendasi)',
  tambah_plan: 'Tambah Plan (di luar rekomendasi)',
};

/** One trigger that fired, with the number that fired it (GB-1). */
export interface GateTrigger {
  kode: string;
  label: string;
  dasar: string;
}

/** GB-8 — the four fields the no-Plan path must still leave behind. */
export interface AssignmentSummary {
  deliverable: string;
  deadline: string;
  divisi_pic: string;
  hasil_diharapkan: string;
}

export interface PlanGate {
  service_id: string;
  tier_katalog: PlanTier;
  divisi_terlibat: string[];
  deliverable: string;
  kuota_per_periode: number | null;
  durasi_bulan: number | null;
  berulang: boolean;
  nilai_per_bulan: string | null;
  target_angka_jenis: TargetKind | null;
  target_angka_nilai: string | null;
  sequence_dependency: boolean;
  laporan_periodik: boolean;
  floor_price: unknown | null;
  pemicu_keras: GateTrigger[];
  pemicu_lunak: GateTrigger[];
  config_version_no: number;
  rekomendasi: GateDecision;
  keputusan_am: GateDecision;
  kesesuaian: GateFit;
  alasan: string | null;
  pemantauan_alternatif: string | null;
  tanggal_tinjau_ulang: string;
  ringkasan_penugasan: AssignmentSummary | null;
  plan_id: string | null;
  decided_by: string;
  decided_at: string;
}

export interface PlanGateConfig {
  version_no: number;
  kuota_threshold: number;
  nilai_threshold: string;
  durasi_threshold_bulan: number;
  notif_join_threshold: string;
}

/** Section G-A context + the determination on record (null when unanswered). */
export interface PlanGateContext {
  service_id: string;
  service_name: string;
  client_id: string;
  toko: string | null;
  tier_katalog: PlanTier;
  standard_price: string;
  frequency: string | null;
  unit: string | null;
  min_qty: number | null;
  category: string | null;
  plan_satuan_status: string;
  ada_kontrak_full_management: boolean;
  config: PlanGateConfig;
  gate: PlanGate | null;
  requires_plan: boolean;
  perlu_penentuan: boolean;
}

export interface GateRecommendation {
  pemicu_keras: GateTrigger[];
  pemicu_lunak: GateTrigger[];
  rekomendasi: GateDecision;
  ringkasan: string;
}

/** The attributes the recommendation reads — wire names, snake_case. */
export interface GateAttributesInput {
  durasi_bulan: number | null;
  berulang: boolean;
  divisi_terlibat: string[];
  target_angka_jenis: TargetKind | null;
  kuota_per_periode: number | null;
  nilai_per_bulan: string | null;
  sequence_dependency: boolean;
  laporan_periodik: boolean;
}

export interface GateDecisionBody extends GateAttributesInput {
  target_angka_nilai: string | null;
  deliverable: string;
  keputusan_am: GateDecision;
  alasan: string | null;
  pemantauan_alternatif: string | null;
  tanggal_tinjau_ulang: string;
  ringkasan_penugasan: AssignmentSummary | null;
}

/** GET the G-A context + recorded determination. */
export function getPlanGate(serviceId: string): Promise<PlanGateContext> {
  return api.get<PlanGateContext>(`/services/${serviceId}/plan-gate`);
}

/**
 * Recompute the recommendation server-side as the AM edits the attributes.
 * Deliberately NOT reimplemented in the browser: two copies of the Rule 3
 * trigger table would drift, and the one the AM sees must be the one that gets
 * stored.
 */
export function previewPlanGate(
  serviceId: string,
  attrs: GateAttributesInput,
): Promise<GateRecommendation> {
  return api.post<GateRecommendation>(`/services/${serviceId}/plan-gate/preview`, attrs);
}

export function decidePlanGate(serviceId: string, body: GateDecisionBody): Promise<PlanGate> {
  return api.post<PlanGate>(`/services/${serviceId}/plan-gate`, body);
}

/** Escalation (AM) or de-escalation (SPV only, Rules 11 & 12). */
export function redecidePlanGate(
  serviceId: string,
  keputusan: GateDecision,
  alasan: string,
  ringkasan?: AssignmentSummary | null,
): Promise<PlanGate> {
  return api.post<PlanGate>(`/services/${serviceId}/plan-gate/redecide`, {
    keputusan_am: keputusan,
    alasan,
    ringkasan_penugasan: ringkasan ?? null,
  });
}

export function setStrategyRequirement(
  serviceId: string,
  requiresStrategyPlan: boolean,
  reason: string,
): Promise<StrategyRequirement> {
  return api.post<StrategyRequirement>(`/services/${serviceId}/strategy-requirement`, {
    requires_strategy_plan: requiresStrategyPlan,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Cluster 3 — API functions
// ---------------------------------------------------------------------------

export function createBrief(serviceId: string, input: BriefInput): Promise<Brief> {
  return api.post<Brief>(`/services/${serviceId}/briefs`, input);
}

export function listServiceBriefs(serviceId: string): Promise<{ data: Brief[] }> {
  return api.get<{ data: Brief[] }>(`/services/${serviceId}/briefs`);
}

export function getBrief(id: string): Promise<Brief> {
  return api.get<Brief>(`/briefs/${id}`);
}

export function listDivisionQueue(division: string): Promise<{ data: Brief[] }> {
  return api.get<{ data: Brief[] }>(`/divisions/${encodeURIComponent(division)}/brief-queue`);
}

// ---------------------------------------------------------------------------
// Cluster 4a — Brief AM-review transitions
// ---------------------------------------------------------------------------

export function reviewBrief(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/briefs/${id}/review`);
}

export function approveBrief(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/briefs/${id}/approve`);
}

export function requestBriefRevision(id: string, feedback: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/briefs/${id}/request-revision`, { feedback });
}

// ---------------------------------------------------------------------------
// Cluster 4b — Complaint API functions
// ---------------------------------------------------------------------------

export function createComplaint(clientId: string, input: ComplaintInput): Promise<Complaint> {
  return api.post<Complaint>(`/clients/${clientId}/complaints`, input);
}

export function listComplaints(clientId: string): Promise<{ data: Complaint[] }> {
  return api.get<{ data: Complaint[] }>(`/clients/${clientId}/complaints`);
}

export function getComplaint(id: string): Promise<Complaint> {
  return api.get<Complaint>(`/complaints/${id}`);
}

export function startComplaint(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/complaints/${id}/start`);
}

export function resolveComplaint(id: string, notes: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/complaints/${id}/resolve`, { notes });
}

export function closeComplaint(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/complaints/${id}/close`);
}

// ---------------------------------------------------------------------------
// "Perlu Persetujuan Saya" (2026-08-31) — account.PendingStrategyReview.
// ---------------------------------------------------------------------------

// account.PendingStrategyReview — one Strategy & Plan waiting on Account
// lead/Director: a fresh submission, or a pending GMV adjustment.
export interface PendingStrategyReview {
  strategy_id: string;
  service_id: string;
  client_id: string;
  toko: string;
  nama_pic: string;
  status: string;
  gmv_adjustment_status: string;
  created_by: string;
  created_by_nama: string;
  created_at: string;
}

/** GET /account/strategy-reviews — every Strategy & Plan Account lead/Director may still decide on, oldest first. */
export function listPendingStrategyReviews(): Promise<{ data: PendingStrategyReview[] }> {
  return api.get<{ data: PendingStrategyReview[] }>('/account/strategy-reviews');
}
