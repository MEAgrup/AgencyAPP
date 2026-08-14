// Typed wrapper over lib/api.ts for Module 7 (Creative Workspace) endpoints.
//
// Per fe_briefs/m7.md, M7 is SPLIT across two backend packages/routers that the
// Creative FE workspace must both call for one full Asset lifecycle:
//   - module7_creative (creative_handlers.go / asset.go / review.go / hours.go /
//     daily_output.go / reminder.go): the Asset ENTITY — create/list/get, AM-side
//     review/approve/request-revision, Hours Logged, Daily Output, reminder scan.
//   - module12_task (task_handlers.go / task.go / block.go / metrics.go): the
//     Asset EXECUTION edges (start/submit/rework/resume/assign-pic/sla/
//     revision-sla/block-request/block-decide/metrics) that PIC & SPV/Lead use to
//     actually run the revision loop. Without these the loop cannot be driven
//     from FE (AM can only approve/request-revision; PIC does the work).
//
// Shapes mirror the backend structs EXACTLY as documented in m7.md (json tags
// read from source, not invented). Per house convention (CONVENTIONS.md §8),
// this module's lib file owns its own copy of shared-shape entities (Brief,
// TransitionResult, etc.) rather than importing another module's lib file —
// same pattern already used between lib/account.ts and lib/tasks.ts.
//
// Money-ish raw numbers (attributed_gmv) are NOT pre-formatted by the backend
// (asset.go says it's a bare *float64) — format with lib/money.ts in the page.
// Everything else here is either a plain string/number/bool or a pre-formatted
// display string explicitly called out below (e.g. Metrics.*_display).

import { api } from '@/lib/api';
import type { AuditEntry, Role } from '@/lib/types';

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

// module6_account.Brief (borrowed read — GET /briefs/{id} is called out narratively
// in m7.md §4 point 2: FE needs quantity_target for the "N dari M dibuat" progress
// bar, since that field lives on Brief, not Asset). Shape mirrors lib/account.ts's
// Brief / lib/tasks.ts's Brief (same backend struct), duplicated locally per
// house convention rather than cross-importing another module's lib file.
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
  revision_count: number;
  revision_flagged: boolean;
  created_by: string;
  created_at: string;
}

// module7_creative.Asset (asset.go:141-156). Pointer/omitempty fields are
// optional — they can be ABSENT from JSON (not null) when unset.
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
  created_at: string;
}

// module7_creative.daily_output.go:78-85
export interface DailyOutputEntry {
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

export interface DailyOutputDay {
  pic: string;
  date_wib: string;
  locked: boolean;
  total: number;
  approved_count: number;
  entries: DailyOutputEntry[];
}

// module12_task/metrics.go:45-69. ALL fields present (no omitempty on the
// pointers) — a null metric arrives as JSON `null`, unlike the Asset entity's
// omitempty convention. *_display strings are PRE-FORMATTED ("85.42%" | "N/A" |
// "—") — render verbatim, never reformat or recompute.
export interface Metrics {
  brief_id: string; // NB: this is actually the Asset id per m7.md note
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

// module12_task/block.go:26-35
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

// Transition bodies are `{ok, from, to}` (apps/api http.ts transitionResponse).
// Used by review/approve/request-revision/start/submit/rework/resume; read them
// through lib/transition.ts, which also tolerates the retired Go casing.
import type { TransitionResult } from '@/lib/transition';
export type { TransitionResult };

export interface HoursResult {
  id: string;
  hours_logged: number;
}

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

export interface ReminderScanResult {
  reminders_sent: number;
}

// ---------------------------------------------------------------------------
// Const enums (verbatim BI strings, STATE_MACHINES §7 / m7.md §2) — do not rename.
// ---------------------------------------------------------------------------

export const ASSET_STATUSES = [
  '[To Do]',
  '[In Progress]',
  '[Submitted]',
  '[In Review]',
  '[Approved]',
  '[Revision Requested]',
  '[Blocked]',
] as const;

export const ASSET_SUBMITTED = '[Submitted]';
export const ASSET_IN_REVIEW = '[In Review]';

// ---------------------------------------------------------------------------
// Role helpers — UX gating ONLY (CLAUDE.md #6). Server is always the final
// authority; these merely hide/disable controls a role clearly cannot use.
// Duplicated locally per house convention (mirrors lib/account.ts's helpers).
// ---------------------------------------------------------------------------

export function isDirector(role: Role | null): boolean {
  return !!role?.director;
}

/** OD is read-only across every M7/M12 write endpoint — hide all action buttons. */
export function isODOnly(role: Role | null): boolean {
  return !!role?.od && !role?.director;
}

/**
 * The CDPS division string, verbatim from `role_mappings` (domain
 * `creative.CREATIVE_DIVISION`). Exported because the PIC picker asks the server
 * for this division by name — a typo there yields an empty dropdown, not an error.
 */
export const CREATIVE_DIVISION = 'Creative';

export function isCreativeDivision(role: Role | null): boolean {
  // Backend sends Role.Division verbatim from role_mappings — canonical value is
  // capitalized "Creative" (module7_creative/asset.go:42), case-sensitive.
  return !!role && role.division === CREATIVE_DIVISION;
}

export function isCreativeLead(role: Role | null): boolean {
  return isCreativeDivision(role) && role?.level === 'lead';
}

export function isCreativeStaff(role: Role | null): boolean {
  return isCreativeDivision(role) && role?.level === 'staff';
}

export function isAccountRole(role: Role | null): boolean {
  // Canonical backend value is "Account" (module6_account/account.go:39), case-sensitive.
  return !!role && role.division === 'Account';
}

// ---------------------------------------------------------------------------
// module7_creative — Asset entity + AM review + Hours + Daily Output + reminders
// ---------------------------------------------------------------------------

export interface CreateAssetInput {
  sequence_no: number;
  assigned_pic?: string;
}

export function createAsset(briefId: string, input: CreateAssetInput): Promise<Asset> {
  return api.post<Asset>(`/briefs/${briefId}/assets`, input);
}

export function listBriefAssets(briefId: string): Promise<{ data: Asset[] }> {
  return api.get<{ data: Asset[] }>(`/briefs/${briefId}/assets`);
}

export function getAsset(id: string): Promise<Asset> {
  return api.get<Asset>(`/assets/${id}`);
}

// GET /briefs/{id} — borrowed M6 read, explicitly sanctioned by m7.md §4 point 2
// (FE needs quantity_target for the Brief -> Asset breakdown progress bar).
export function getBrief(id: string): Promise<Brief> {
  return api.get<Brief>(`/briefs/${id}`);
}

export function reviewAsset(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/review`);
}

export function approveAsset(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/approve`);
}

export function requestAssetRevision(id: string, feedback: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/request-revision`, { feedback });
}

export function logHours(id: string, hours: number): Promise<HoursResult> {
  return api.post<HoursResult>(`/assets/${id}/hours`, { hours });
}

export function getDailyOutput(picId: string, date?: string): Promise<DailyOutputDay> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  return api.get<DailyOutputDay>(`/daily-output/${encodeURIComponent(picId)}${q}`);
}

export function scanAssetReminders(): Promise<ReminderScanResult> {
  return api.post<ReminderScanResult>('/assets/reminders/scan');
}

// GET /api/v1/audit?entity_type=asset&entity_id={id} — generic audit endpoint
// (m7.md §2 + §6.7): NOT gated per-entity like GetAsset/ListBriefAssets, only
// requires login. Used to surface Revision Feedback (not a Asset column — only
// in the audit log, action == "revision_feedback", after.feedback) and, as a
// fallback heuristic, to detect an unresolved block-request for this Asset
// (m7.md §5: no GET list endpoint exists for pending block requests).
// Response envelope assumed `{data: AuditEntry[]}` to match every other list
// endpoint's convention in this codebase; not explicitly pinned down in m7.md.
export function getAssetAudit(assetId: string): Promise<{ data: AuditEntry[] }> {
  return api.get<{ data: AuditEntry[] }>(`/audit?entity_type=asset&entity_id=${encodeURIComponent(assetId)}`);
}

/** Latest revision feedback text (if any) recorded in the audit trail for this Asset. */
export function latestRevisionFeedback(audit: AuditEntry[]): { feedback: string; actor: string; at: string } | null {
  let latest: { feedback: string; actor: string; at: string } | null = null;
  for (const entry of audit) {
    if (entry.action !== 'revision_feedback') continue;
    const after = entry.after_json;
    const feedback =
      after && typeof after === 'object' && typeof (after as Record<string, unknown>).feedback === 'string'
        ? ((after as Record<string, unknown>).feedback as string)
        : null;
    if (!feedback) continue;
    latest = { feedback, actor: entry.actor_employee_id, at: entry.created_at };
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Pending block-request heuristic (duplicated locally per house convention —
// see lib/block-requests.ts for the original pattern this mirrors). Scans the
// audit trail for a block-request action not yet followed by an approve/reject
// action referencing the same request id.
// ---------------------------------------------------------------------------

const BLOCK_ID_KEYS = ['request_id', 'block_request_id', 'req_id', 'id'];

function extractBlockId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  for (const key of BLOCK_ID_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return null;
}

function isBlockRequestAction(action: string): boolean {
  const a = action.toLowerCase();
  return a.includes('block') && a.includes('request') && !a.includes('approve') && !a.includes('reject');
}

function isBlockDecisionAction(action: string): boolean {
  const a = action.toLowerCase();
  return a.includes('block') && (a.includes('approve') || a.includes('reject'));
}

export interface PendingAssetBlockRequest {
  id: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
}

export function findPendingBlockRequest(audit: AuditEntry[]): PendingAssetBlockRequest | null {
  const resolvedIds = new Set<string>();
  for (const entry of audit) {
    if (!isBlockDecisionAction(entry.action)) continue;
    const id = extractBlockId(entry.after_json) ?? extractBlockId(entry.before_json);
    if (id) resolvedIds.add(id);
  }

  let pending: PendingAssetBlockRequest | null = null;
  for (const entry of audit) {
    if (!isBlockRequestAction(entry.action)) continue;
    const id = extractBlockId(entry.after_json) ?? extractBlockId(entry.before_json);
    if (!id || resolvedIds.has(id)) continue;
    const after = entry.after_json;
    const reason =
      after && typeof after === 'object' && typeof (after as Record<string, unknown>).reason === 'string'
        ? ((after as Record<string, unknown>).reason as string)
        : '';
    pending = { id, requestedBy: entry.actor_employee_id, requestedAt: entry.created_at, reason };
  }
  return pending;
}

// ---------------------------------------------------------------------------
// module12_task — Asset execution edges (start/submit/rework/resume/assign-pic/
// sla/revision-sla/block-request/block-decide/metrics). Scoped to Asset only
// (no Brief-as-task branch here — that belongs to lib/tasks.ts's M12 workspace).
// ---------------------------------------------------------------------------

export function startAsset(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/start`);
}

// Submit REQUIRES output_link (m7.md §1.2 task.go:101).
export function submitAsset(id: string, outputLink: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/submit`, { output_link: outputLink });
}

export function reworkAsset(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/rework`);
}

export function resumeAsset(id: string): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/assets/${id}/resume`);
}

export function assignAssetPic(id: string, picId: string): Promise<AssignPICResult> {
  return api.post<AssignPICResult>(`/assets/${id}/assign-pic`, { pic_id: picId });
}

export function setAssetSLA(id: string, hours: number): Promise<SLAResult> {
  return api.post<SLAResult>(`/assets/${id}/sla`, { hours });
}

export function setAssetRevisionSLA(id: string, hours: number): Promise<RevisionSLAResult> {
  return api.post<RevisionSLAResult>(`/assets/${id}/revision-sla`, { hours });
}

export function requestAssetBlock(id: string, reason: string): Promise<BlockRequest> {
  return api.post<BlockRequest>(`/assets/${id}/block-request`, { reason });
}

export function approveAssetBlock(id: string, reqId: string): Promise<BlockDecisionResult> {
  return api.post<BlockDecisionResult>(`/assets/${id}/block-requests/${reqId}/approve`);
}

export function rejectAssetBlock(id: string, reqId: string): Promise<BlockDecisionResult> {
  return api.post<BlockDecisionResult>(`/assets/${id}/block-requests/${reqId}/reject`);
}

export function getAssetMetrics(id: string): Promise<Metrics> {
  return api.get<Metrics>(`/assets/${id}/metrics`);
}

// ---------------------------------------------------------------------------
// Cross-module borrowed read used ONLY as the Creative workspace landing queue.
// GET /divisions/{division}/brief-queue is an M6-owned endpoint (not in m7.md's
// own endpoint table) — it is already reused across module lib files the same
// way (lib/account.ts and lib/tasks.ts both call it independently). m7.md §5
// itself names this exact workaround ("dari modul lain / M6") for the fact that
// M7 has NO dedicated queue/aggregate endpoint of its own. Flagged as a
// cross-module dependency in the build notes — not a fabricated endpoint.
// ---------------------------------------------------------------------------

export function listCreativeBriefQueue(): Promise<{ data: Brief[] }> {
  // Division segment must match backend allowedDivisions verbatim (case-sensitive
  // "Creative" — module6_account/strategy.go:51 / module7_creative/asset.go:42).
  return api.get<{ data: Brief[] }>('/divisions/Creative/brief-queue');
}

// PATCH is not exposed by lib/api.ts (only get/post/put/delete). M7 has no PATCH
// endpoint in scope today, so no local patch() helper is needed — kept out
// intentionally (see lib/clients.ts for the pattern if a future ticket adds one).
