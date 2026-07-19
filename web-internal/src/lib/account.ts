// Typed wrapper over lib/api.ts for Module 6 (Account & Service) endpoints.
// Shapes mirror backend/internal/httpapi/account_handlers.go +
// backend/internal/module6_account/{account,strategy,brief,brief_review,complaint}.go
// exactly (json tags read from the handler/view structs) — never invented.
//
// Notes read from the FE brief recon (fe_briefs/m6.md):
//  - List endpoints return {"data": [...]}; single-item GETs return the object
//    directly (no wrapper). See per-function return generics below.
//  - Transition endpoints (submit/review/approve/start/resolve/close) return
//    statemachine.Result which marshals with EXPORTED Go field names (no json
//    tags) => {"From": "...", "To": "..."} — see TransitionResult.
//  - Many fields use omitempty => the JSON key may be ABSENT (not null) when
//    empty; every such field is typed optional here.
//  - No PATCH is needed by this module (strategy edit uses PUT), so we do not
//    duplicate a local patch() helper — lib/api.ts covers get/post/put/delete.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

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

export interface Strategy {
  id: string;
  service_id: string;
  objective: string;
  target_kpi: string;
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
  target_kpi: string;
  divisions_involved: string[];
  planned_brief_outline: string;
  timeline_start: string; // YYYY-MM-DD
  timeline_end: string; // YYYY-MM-DD
}

export interface StrategyRequirement {
  service_id: string;
  requires_strategy_plan: boolean; // effective value after override
  pinned_requires_strategy_plan: boolean; // original MSL pin (immutable)
  overridden: boolean;
  set_by: string;
  reason: string;
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

// Result of a statemachine transition (From/To, no json tags => capitalized keys).
export interface TransitionResult {
  From: string;
  To: string;
}

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

export function requestStrategyRevision(id: string, notes: string): Promise<{ id: string; status: string }> {
  return api.post<{ id: string; status: string }>(`/strategies/${id}/request-revision`, { notes });
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
