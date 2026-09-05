// Typed wrapper over lib/api.ts for Module 10 (Live Stream) endpoints.
// Shapes mirror archive/backend-go/internal/httpapi/{routes_livestream.go,livestream_handlers.go}
// + archive/backend-go/internal/module10_livestream/{livestream.go,lifecycle.go,session.go,read.go,
// reopen.go,rollup.go} EXACTLY (json tags read from source) — never invented.
// Reconciled against fe_briefs/m10.md (the single endpoint source for this module).
//
// M10 is a request-vs-result VENDOR TRACKER, not a Kanban: Live Stream Session
// (`LSS-`) is born `[Requested]` directly on create (no draft), and the parent
// Brief is off-machine (birth `[Dispatched to Vendor]`, auto-rolls to `[Approved]`
// only when every Session under it is `[Reconciled]`). See m10 brief §2.
//
// Money/number contract (m10 brief §3 / gotcha #3-4):
//  - REQUEST target_duration_hours / actual_duration_hours are STRING decimals
//    ("2" | "1.5"); RESPONSE carries them back as NUMBER (float64) — asymmetric,
//    do not reuse one type for both directions.
//  - REQUEST gmv is a STRING (money.Parse); RESPONSE gmv is a raw number (rupiah,
//    already /100) for calc/sort ONLY — always render `gmv_display` ("Rp. X.XXX.XXX,00",
//    pre-formatted by backend money.Money.Format()) for display, never reformat
//    `gmv` in FE (house rule 7 / gotcha #4).
//  - `data_confidence_tier` is always the constant "Vendor-Reported" in M10 — no
//    filter/toggle for other tiers belongs in this module's scope (gotcha, §3).
//
// Result-shape gotcha (#6/#7): confirm/results/reconcile/flag-discrepancy all
// return a generic `statemachine.Result` (NOT a full Session) and reopen returns
// only `{id, status}` (NOT a full Brief) — callers must always re-fetch
// getSession/getBrief afterwards instead of trusting the mutation response body.
//
// M10 has NO list-Brief / list-cross-Brief-Session / edit-Session / delete-Session
// endpoints (m10 brief "TIDAK TERSEDIA"). The only Session list is PER BRIEF
// (GET /briefs/{id}/sessions, unpaginated). For the /livestream landing (no
// cross-brief list exists), Live Stream Briefs are borrowed from the M6/M12
// division brief-queue the same way the sibling M8 (ads) workspace does it
// (lib/ads.ts precedent) — duplicated locally here per the build convention
// ("butuh helper bersama? duplikasi lokal di lib/livestream.ts"), NOT imported
// from lib/tasks.ts. This /briefs/{id} + /divisions/{division}/brief-queue pair
// is not itself documented inside the m10 brief (those routes belong to M6/M12
// files that were out of scope for the m10 recon) — flagged as an inferred/
// unverified reuse in the build report, mirrored 1:1 off the already-shipped
// ads.ts usage of the identical generic routes.

import { api } from '@/lib/api';
import type { BadgeTone } from '@/lib/status';
import type { Role } from '@/lib/types';

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

// module10_livestream.Session (session.go:33-56). Result-only fields are
// `omitempty` and simply ABSENT from JSON until `[Completed]` (gotcha #5) —
// treat missing the same as empty, never coerce to 0/false for display.
export interface Session {
  id: string;
  brief_id: string;
  /** LT-61: the vendor entitled to self-serve this Session, or null when unresolved. */
  vendor_id: string | null;
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
  gmv?: number; // raw, calc-only — use gmv_display for rendering
  gmv_display?: string;
  vendor_report_link?: string;
  reconciliation_notes?: string;
  data_confidence_tier: string;
  created_by: string;
  created_at: string;
}

// Brief-lite: subset of module6_account.Brief actually consumed by the M10
// workspace (parent-brief context for the voided-freeze check + Dispatched/
// Approved gating). Mirrors the same borrowed-read shape lib/ads.ts uses.
export interface LiveStreamBrief {
  id: string;
  service_id: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  due_date: string;
  priority: string;
  title: string;
  status: string;
  created_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants (verbatim from m10 brief §1 / §2 / §4 — never invented)
// ---------------------------------------------------------------------------

// Session.platform — only these two accepted server-side, case-sensitive (§1.1).
export const PLATFORM_OPTIONS = ['TikTok Shop Live', 'Shopee Live'] as const;

// Live Stream Session lifecycle (STATE_MACHINES §10 / m10 brief §2).
export const SESSION_STATUSES = [
  '[Requested]',
  '[Confirmed by Vendor]',
  '[Completed]',
  '[Reconciled]',
  '[Discrepancy Flagged]',
] as const;

// Brief (off-machine) statuses relevant to M10 gating (m10 brief §2).
export const BRIEF_DISPATCHED_STATUS = '[Dispatched to Vendor]';
export const BRIEF_APPROVED_STATUS = '[Approved]';
export const BRIEF_VOIDED_STATUS = '[Cancelled — Service Voided]';

export const DATA_CONFIDENCE_VENDOR_REPORTED = 'Vendor-Reported';

// ---------------------------------------------------------------------------
// Local badge-tone overrides.
// lib/status.ts (shared, out of scope to edit here) exact-matches/keyword-matches
// none of the M10 Session statuses meaningfully (all fall to default gray) —
// duplicated locally per the build convention, same pattern as
// lib/ads.ts::campaignBadgeTone for [Active]/[Paused]/[Ended].
// ---------------------------------------------------------------------------
export function sessionBadgeTone(status: string): BadgeTone {
  switch (status) {
    case '[Requested]':
      return 'gray';
    case '[Confirmed by Vendor]':
      return 'blue';
    case '[Completed]':
      return 'amber';
    case '[Reconciled]':
      return 'green';
    case '[Discrepancy Flagged]':
      return 'red';
    default:
      return 'gray';
  }
}

// data_confidence_tier badge tone — M10 only ever emits "Vendor-Reported", but
// PRD mentions "Platform-Verified" exists for other modules (m10 brief §3); kept
// as a switch (not a boolean) so it never silently mis-colors an unexpected value.
export function confidenceBadgeTone(tier: string): BadgeTone {
  switch (tier) {
    case 'Vendor-Reported':
      return 'blue';
    case 'Platform-Verified':
      return 'purple';
    default:
      return 'gray';
  }
}

// ---------------------------------------------------------------------------
// API functions — one thin call per endpoint (m10 brief §1).
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  platform: string;
  requested_datetime: string; // "YYYY-MM-DDTHH:mm" (datetime-local value works directly, gotcha #2)
  target_duration_hours: string; // positive decimal AS STRING
  products_talent?: string;
  special_instructions?: string;
}

// POST /briefs/{id}/sessions → Session (object directly, not wrapped).
export function createSession(briefId: string, input: CreateSessionInput): Promise<Session> {
  return api.post<Session>(`/briefs/${briefId}/sessions`, input);
}

// GET /briefs/{id}/sessions → {data: Session[]} — unpaginated, [] when empty
// (gotcha #1: no limit/offset/page param exists, do not send one).
export function listBriefSessions(briefId: string): Promise<{ data: Session[] }> {
  return api.get<{ data: Session[] }>(`/briefs/${briefId}/sessions`);
}

// GET /sessions/{id} → Session (object directly, not wrapped).
export function getSession(id: string): Promise<Session> {
  return api.get<Session>(`/sessions/${id}`);
}

// Lifecycle edges — all return a generic statemachine.Result (gotcha #6), so
// callers should re-fetch getSession afterwards rather than parse the return.

// POST /sessions/{id}/confirm — [Requested] -> [Confirmed by Vendor]. No body.
export function confirmSession(id: string): Promise<unknown> {
  return api.post<unknown>(`/sessions/${id}/confirm`);
}

export interface LogResultsInput {
  actual_datetime: string; // same 5-layout contract as requested_datetime (gotcha #2)
  actual_duration_hours: string; // positive decimal AS STRING
  viewers_peak?: number | null;
  viewers_avg?: number | null;
  orders_generated: number | null; // required (nil treated as incomplete server-side)
  gmv: string; // decimal string, money.Parse — send raw digits, do not pre-format
  vendor_report_link: string; // required, checked FIRST server-side (gotcha #11)
}

// POST /sessions/{id}/results — [Confirmed by Vendor] -> [Completed].
export function logResults(id: string, input: LogResultsInput): Promise<unknown> {
  return api.post<unknown>(`/sessions/${id}/results`, input);
}

// POST /sessions/{id}/reconcile — [Completed] OR [Discrepancy Flagged] -> [Reconciled]
// (terminal). No body. May side-effect the parent Brief to [Approved] (rollup) —
// re-fetch getBrief afterwards too, not just getSession.
export function reconcileSession(id: string): Promise<unknown> {
  return api.post<unknown>(`/sessions/${id}/reconcile`);
}

// POST /sessions/{id}/flag-discrepancy — [Completed] -> [Discrepancy Flagged].
export function flagDiscrepancy(id: string, notes: string): Promise<unknown> {
  return api.post<unknown>(`/sessions/${id}/flag-discrepancy`, { notes });
}

export interface ReopenBriefResult {
  id: string;
  status: string;
}

// POST /briefs/{id}/reopen — Brief [Approved] -> [Dispatched to Vendor]. No body.
// Response is ad-hoc {id, status} ONLY (gotcha #7) — re-fetch getBrief for the
// rest of the Brief's fields, never assume they are present on this result.
export function reopenBrief(id: string): Promise<ReopenBriefResult> {
  return api.post<ReopenBriefResult>(`/briefs/${id}/reopen`);
}

// GET /briefs/{id} — borrowed M6 read (see file header note). Used only for
// parent-Brief context: voided-freeze check (gotcha #9) and Dispatched/Approved
// gating; M10 never mutates the Brief directly except via reopenBrief above.
export function getBrief(id: string): Promise<LiveStreamBrief> {
  return api.get<LiveStreamBrief>(`/briefs/${id}`);
}

// LT-61 FE — one open Live Stream Brief the calling vendor may create a new
// Session under (POST /briefs/{id}/sessions). Solves the discovery gap: a
// vendor has no Brief id in hand otherwise (see listVendorSessions below).
export interface VendorBrief {
  id: string;
  client_toko: string;
}

// GET /vendor/sessions → {data: Session[]} — every Session assigned to the
// calling vendor Actor, across all Briefs/clients (LT-61). The vendor-realm
// counterpart to listBriefSessions, which needs a Brief id a vendor has no
// way to already know.
export function listVendorSessions(): Promise<{ data: Session[] }> {
  return api.get<{ data: Session[] }>('/vendor/sessions');
}

// GET /vendor/briefs → {data: VendorBrief[]} — open Briefs the calling vendor
// may create a new Session under (LT-61 FE).
export function listVendorBriefs(): Promise<{ data: VendorBrief[] }> {
  return api.get<{ data: VendorBrief[] }>('/vendor/briefs');
}

// GET /divisions/livestream/brief-queue — borrowed M6/M12 division queue (see
// file header note). Sole source of Live Stream Briefs for the /livestream
// landing, since M10 exposes no list-Brief endpoint of its own.
export function listLiveStreamBriefQueue(): Promise<{ data: LiveStreamBrief[] }> {
  // Division path param is exact-match against the M6 §4 vocabulary
  // ("Creative" | "Ads" | "KOL" | "Live Stream" — module6_account/brief.go
  // isAllowedDivision), NOT a slug: must be the capitalized "Live Stream"
  // with the space URL-encoded (same pattern as lib/account.ts listDivisionQueue).
  return api.get<{ data: LiveStreamBrief[] }>(
    `/divisions/${encodeURIComponent('Live Stream')}/brief-queue`,
  );
}

// canManageSession FE approximation (m10 brief §1.1 / gotcha #8): backend
// canManageSession (module10_livestream/livestream.go) allows the client's
// owning AM (clients.assigned_am_id) OR Director — it does NOT check
// division/level. FE can only approximate "owning AM" as "any Account-division
// employee" (any level — an AM with level 'lead' still qualifies server-side);
// the backend re-checks the exact assigned_am_id match on every write, so this
// is UX-only gating. Role.Division from /me is the raw role-mapping string
// ("Account", capitalized — auth_handlers.go returns it unnormalized), hence
// the case-insensitive compare.
export function canManageLiveStream(role: Role | null): boolean {
  return Boolean(role && (role.director || role.division.toLowerCase() === 'account'));
}

// ---------------------------------------------------------------------------
// Role helpers — UX gating ONLY (CLAUDE.md #6). Server is always the final
// authority; these merely hide/disable controls a role clearly cannot use.
// Duplicated locally per house convention (mirrors lib/creative.ts's helpers).
// ---------------------------------------------------------------------------

export function isDirector(role: Role | null): boolean {
  return !!role?.director;
}

/** OD is read-only across every M16 stage write endpoint — hide all action buttons. */
export function isODOnly(role: Role | null): boolean {
  return !!role?.od && !role?.director;
}

/**
 * The CDPS division string, verbatim from `role_mappings` (domain
 * `division.registry` code `LIVE`, `nama = 'Live Stream'`). Distinct from
 * `canManageLiveStream` above: that gate is M10 Session/GMV governance (owning
 * AM or Director, per `module10_livestream` — no division check at all), while
 * this one is M16 tahapan-produksi governance (`stage.canExecuteStage`,
 * division staff/lead or Director) — the internal team that reports the
 * vendor's progress on CDPS's behalf (LT-60), which is a DIFFERENT population
 * than the client's AM.
 */
export const LIVE_STREAM_DIVISION = 'Live Stream';

export function isLiveStreamDivision(role: Role | null): boolean {
  return !!role && role.division === LIVE_STREAM_DIVISION;
}

/** canAdvanceStage (LT-60): Director, or Live Stream division staff/lead — mirrors `stage.canExecuteStage`. */
export function canAdvanceLiveStage(role: Role | null): boolean {
  return !isODOnly(role) && (isDirector(role) || isLiveStreamDivision(role));
}
