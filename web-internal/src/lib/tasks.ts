// Typed wrapper over lib/api.ts for Module 12 (Task Execution) endpoints.
//
// M12 has NO generic GET /tasks or GET /tasks/{id}: a "Task" is a role played by
// a Brief-as-task (Ads / single-unit) or a Creative Asset, so the list/detail
// reads borrow M6/M7/M11/M15 endpoints and this file composes them. The only
// endpoints M12 truly owns are the execution edges (start/submit/rework/resume/
// assign-pic/sla/block-request/approve/reject) + the recompute-from-log metrics.
//
// Shapes below mirror the backend structs EXACTLY (json tags read from source):
//   module6_account.Brief       (brief.go)
//   module7_creative.Asset      (asset.go)
//   module11_board.Card         (views.go)
//   module12_task.Metrics       (metrics.go)
//   module12_task.BlockRequest  (block.go)
//   module12_task.PendingBlockRequest (block.go)
//   module15_portal.TeamPortal  (portal.go)
//   statemachine TransitionResult                  <- NOTE: the TS API answers
//                                                      {ok, from, to} (lowercase);
//                                                      the Go build's capitalized
//                                                      "From"/"To" is retired.
// No invented fields. Money-ish raw floats (attributed_gmv) are formatted in the
// page via lib/money.ts; nothing here is pre-formatted by the backend.

import { api } from '@/lib/api';

/** A Task is sourced either from a Brief-as-task (/tasks/…) or an Asset (/assets/…). */
export type TaskSource = 'brief' | 'asset';

// ---- Entity shapes (borrowed reads) ----

// module6_account.Brief. Many optional fields carry `omitempty` server-side, so
// they can be ABSENT from the JSON (not null) when empty — treat missing == empty.
export interface Brief {
  id: string;
  service_id: string;
  strategy_id?: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  quantity_target: number;
  due_date: string; // "YYYY-MM-DD"
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
  created_at: string; // RFC3339
}

// module7_creative.Asset. `sla_target_hours`/`revision_sla_target_hours`/
// `hours_logged`/`attributed_gmv` are `*float64` with `omitempty` — absent when nil.
export interface Asset {
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
  created_at: string; // RFC3339
}

// module11_board.Card — the cross-source "my tasks" row (brief|asset|booking|session).
// `universal_column` is a COMPUTED bucket (To Do / In Progress / Awaiting Review /
// Blocked-Revision / Done) — render as-is, never re-derive from native_status.
export interface Card {
  id: string;
  type: 'brief' | 'asset' | 'booking' | 'session';
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

// module12_task.Metrics — ALL fields present (no omitempty on the pointers), so a
// nil metric arrives as JSON `null` (distinct from the entity omitempty convention).
// speed_score_display / revision_speed_score_display are PRE-FORMATTED
// ("112.50%" | "N/A" | "—") — render verbatim, never reformat or recompute.
export interface Metrics {
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

// module12_task.BlockRequest — returned by the block-request POST edges.
export interface BlockRequest {
  id: string;
  entity_id: string;
  reason: string;
  status: string;
  requested_by: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

// module12_task.PendingBlockRequest — one open request in the SPV/Lead approval
// queue (surfaced only via /portal/team). `source` tells us which edge family to
// call for approve/reject ("brief" -> /tasks/…, "asset" -> /assets/…).
export interface PendingBlockRequest {
  id: string;
  source: TaskSource;
  entity_id: string;
  division: string;
  client_id: string;
  reason: string;
  requested_by: string;
  created_at: string;
}

// module15_portal.TeamPortal — SPV/Lead landing. Only `block_queue` is in scope
// for M12's block-request queue; the rollup/shortcuts belong to M14/M11 pages.
export interface TeamPortal {
  division: string;
  performance_rollup: unknown;
  client_shortcuts: unknown[];
  block_queue: PendingBlockRequest[];
}

// Transition bodies are `{ok, from, to}` (apps/api http.ts transitionResponse).
// Read them through lib/transition.ts — it also tolerates the retired Go casing.
import type { TransitionResult } from '@/lib/transition';
export type { TransitionResult };

export interface AssignPICResult {
  id: string;
  assigned_pic: string;
}

export interface SLAResult {
  id: string;
  sla_target_hours: number;
}

export interface RevisionSLAResult {
  id: string;
  revision_sla_target_hours: number;
}

export interface BlockDecisionResult {
  id: string;
  request_id: string;
  status: string;
}

// ---- Constants (verbatim from PRD / STATE_MACHINES §7, brief_task machine) ----

// Task lifecycle statuses (module12_task/task.go enum). Used for the client-side
// status filter — there is NO ?status= query param on any list endpoint.
export const TASK_STATUSES = [
  '[To Do]',
  '[In Progress]',
  '[Submitted]',
  '[In Review]',
  '[Approved]',
  '[Revision Requested]',
  '[Blocked]',
  '[Cancelled — Service Voided]',
] as const;

// Divisions available for the division-queue filter — VERBATIM copy of the backend
// allow-list (module6_account/strategy.go:51 allowedDivisions, enforced case-
// sensitively by isAllowedDivision in brief.go for GET /divisions/{d}/brief-queue).
// Duplicated locally (per build convention) so this module stays self-contained.
// Live Stream is excluded from the M12 execution engine (dispatched to vendor), so
// its briefs never render action buttons — kept in the list for read visibility.
export const DIVISIONS = [
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
] as const;

// ---- Read functions (borrowed M6/M7/M11/M15 endpoints) ----

// GET /briefs/{id} returns the Brief object DIRECTLY (not wrapped in {brief}).
export function getBrief(id: string): Promise<Brief> {
  return api.get<Brief>(`/briefs/${id}`);
}

// GET /assets/{id} returns the Asset object DIRECTLY.
export function getAsset(id: string): Promise<Asset> {
  return api.get<Asset>(`/assets/${id}`);
}

// GET /divisions/{division}/brief-queue — Brief-level queue for a division (no
// status filter server-side; filter in the page).
export function listDivisionQueue(division: string): Promise<{ data: Brief[] }> {
  return api.get<{ data: Brief[] }>(`/divisions/${division}/brief-queue`);
}

// GET /briefs/{id}/assets — the Asset breakdown of a Creative Brief (sequence_no ASC).
export function listBriefAssets(briefId: string): Promise<{ data: Asset[] }> {
  return api.get<{ data: Asset[] }>(`/briefs/${briefId}/assets`);
}

// GET /my-tasks[?employee=] — cross-source card list. `employee` param only honoured
// for OD/Director/Account-lead; anyone else passing another id gets 403.
export function myTasks(employee?: string): Promise<{ data: Card[] }> {
  const q = employee ? `?employee=${encodeURIComponent(employee)}` : '';
  return api.get<{ data: Card[] }>(`/my-tasks${q}`);
}

// GET /portal/team[?division=] — SPV/Lead/Director only; source of the block queue.
export function getTeamPortal(division?: string): Promise<TeamPortal> {
  const q = division ? `?division=${encodeURIComponent(division)}` : '';
  return api.get<TeamPortal>(`/portal/team${q}`);
}

// GET metrics: /tasks/{id}/metrics (Brief-as-task) or /assets/{id}/metrics.
export function getMetrics(source: TaskSource, id: string): Promise<Metrics> {
  return api.get<Metrics>(`${actionBase(source, id)}/metrics`);
}

// ---- Execution edges (M12-owned) ----

// The action path prefix differs by source: Brief-as-task edges hang off /tasks/{id},
// Asset edges off /assets/{id}. (Entity/metrics reads for a Brief still use /briefs
// and /tasks respectively — see getBrief vs getMetrics.)
function actionBase(source: TaskSource, id: string): string {
  return source === 'asset' ? `/assets/${id}` : `/tasks/${id}`;
}

export function startTask(source: TaskSource, id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`${actionBase(source, id)}/start`);
}

// Asset submit REQUIRES {output_link}; Brief-as-task submit takes no body.
export function submitTask(source: TaskSource, id: string, outputLink?: string): Promise<TransitionResult> {
  if (source === 'asset') {
    return api.post<TransitionResult>(`${actionBase(source, id)}/submit`, { output_link: outputLink ?? '' });
  }
  return api.post<TransitionResult>(`${actionBase(source, id)}/submit`);
}

export function reworkTask(source: TaskSource, id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`${actionBase(source, id)}/rework`);
}

export function resumeTask(source: TaskSource, id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`${actionBase(source, id)}/resume`);
}

export function assignPIC(source: TaskSource, id: string, picId: string): Promise<AssignPICResult> {
  return api.post<AssignPICResult>(`${actionBase(source, id)}/assign-pic`, { pic_id: picId });
}

export function setSLA(source: TaskSource, id: string, hours: number): Promise<SLAResult> {
  return api.post<SLAResult>(`${actionBase(source, id)}/sla`, { hours });
}

// Revision SLA is Asset-only (Brief-as-task carries no revision SLA column).
export function setRevisionSLA(assetId: string, hours: number): Promise<RevisionSLAResult> {
  return api.post<RevisionSLAResult>(`/assets/${assetId}/revision-sla`, { hours });
}

export function requestBlock(source: TaskSource, id: string, reason: string): Promise<BlockRequest> {
  return api.post<BlockRequest>(`${actionBase(source, id)}/block-request`, { reason });
}

export function approveBlock(source: TaskSource, id: string, reqId: string): Promise<BlockDecisionResult> {
  return api.post<BlockDecisionResult>(`${actionBase(source, id)}/block-requests/${reqId}/approve`);
}

export function rejectBlock(source: TaskSource, id: string, reqId: string): Promise<BlockDecisionResult> {
  return api.post<BlockDecisionResult>(`${actionBase(source, id)}/block-requests/${reqId}/reject`);
}

// ---- Small local helpers (duplicated per build convention; no shared-file edits) ----

/** Infer the Task source from the id prefix (BRF- => brief, AST- => asset). */
export function sourceOf(id: string): TaskSource {
  return id.startsWith('AST-') ? 'asset' : 'brief';
}
