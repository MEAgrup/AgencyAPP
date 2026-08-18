// Typed wrapper over lib/api.ts for Module 9 (KOL) endpoints.
//
// Source of truth: fe_briefs/m9.md (the ONE endpoint contract for this build
// stream) + backend/internal/module9_kol/*.go + httpapi/routes_kol.go /
// kol_handlers.go referenced there. Shapes mirror the backend structs EXACTLY
// (json tags as documented in m9.md §3) — never invented.
//
// Money contract (m9 brief §5 gotcha #5/#6):
//  - REQUEST money fields (agreed_rate, amount, attributed_gmv) are STRING
//    decimals ("1500000" | "1500000.00") — backend uses money.Parse. Never send
//    a raw JSON number for these.
//  - RESPONSE *_display fields (agreed_rate_display, amount_display,
//    attributed_gmv_display) are already "Rp. X.XXX.XXX,00" — render verbatim.
//  - RESPONSE raw numeric fields (agreed_rate, amount, attributed_gmv) are
//    float64 in WHOLE rupiah — format with lib/money.ts formatIDR in the page
//    when a *_display counterpart isn't given (e.g. Booking.attributed_gmv).
//  - attributed_gmv: 0 is a valid recorded value ("link tidak menghasilkan
//    sales") and renders as "Rp. 0,00"; missing/null means "belum dicatat" and
//    renders "—" (m9 brief gotcha #13, CLAUDE.md #7).
//
// `a.protect` only checks session login — every permission below is enforced
// service-side, not by route middleware. All gating helpers in this file are
// UX-only (hide/disable a control a role clearly cannot use); the backend is
// always the final authority and returns its own [...] error if bypassed.
//
// No pagination/filter query params exist on any list endpoint here (m9 brief
// gotcha #1/#2) — client-side sort/filter only, never invent `?status=`/`?page=`.

import { api } from '@/lib/api';
import { badgeTone, type BadgeTone } from '@/lib/status';
import type { Role } from '@/lib/types';

// ---------------------------------------------------------------------------
// Entity shapes (m9 brief §3 — json tags verbatim)
// ---------------------------------------------------------------------------

// module6_account.Brief (borrowed read, same struct used by lib/tasks.ts /
// lib/creative.ts / lib/ads.ts). Duplicated locally per house convention
// rather than cross-importing another module's lib file.
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

// module9_kol Booking (booking.go:37-62 & read.go). Fields marked `omitempty`
// server-side (m9 brief gotcha #4) can be ENTIRELY ABSENT from JSON when unset
// — treat missing the same as empty/null, never assume the key exists.
export interface Booking {
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
  attributed_gmv?: number; // present (incl. 0) once recorded; absent = never recorded
  qty_video: number; // per-creator video deliverables (>= 0); always present (DB default 0)
  qty_live: number; // per-creator live-session deliverables (>= 0); always present (DB default 0)
  revision_count: number; // COMPUTED — derived from audit log, never editable
  payment_status: string; // COMPUTED — reflection of latest CPR, "" if none
  created_by: string;
  created_at: string; // RFC3339
}

// module9_kol BookingMetrics (metrics.go:31-47) — GET /bookings/{id}/metrics,
// ALL fields computed/read-only.
export interface BookingMetrics {
  booking_id: string;
  status: string;
  sla_target_hours: number | null;
  sourcing_turnaround_hours: number | null;
  delivery_turnaround_hours: number | null;
  overall_turnaround_hours: number | null;
  speed_score_pct: number | null;
  speed_score_display: string; // "112.50%" | "N/A" | "—"
  revision_count: number;
  excluded_from_speed_score: boolean; // true when [Dropped] — excluded, not 0%
  approved_period_wib: string; // "YYYY-MM" or "" if not yet [QC Passed]
}

// module9_kol PaymentRequest (payment.go:25-37).
export interface PaymentRequest {
  id: string;
  booking_id: string;
  amount: number;
  amount_display: string;
  payment_details: string;
  status: string;
  rejection_reason?: string; // only present if [Rejected]
  requested_by: string;
  paid_by?: string; // only present if [Paid]
  created_by: string;
  created_at: string; // RFC3339
}

// module9_kol CreatorList (creator_list.go:23-32). `eligible_bookings` is
// COMPUTED LIVE (all bookings currently [QC Passed]) and can differ from the
// snapshot in `included_bookings` taken at the last compile — render both.
export interface CreatorList {
  brief_id: string;
  creator_list_link?: string;
  included_bookings: string[];
  last_compiled?: string; // RFC3339
  eligible_bookings: string[];
}

// ---------------------------------------------------------------------------
// Const enums (verbatim BI strings, m9 brief §2 / STATE_MACHINES §8-9) — do
// not rename or add entries without a matching PRD/backend reference.
// ---------------------------------------------------------------------------

// Source Pool (booking.go:79-88) — exactly these 3 strings, priority order
// per PRD §4 Rule 2 (MCN MEA Roster -> KOL External Pool -> Ad-hoc New).
export const SOURCE_POOL_OPTIONS = ['MCN MEA Roster', 'KOL External Pool', 'Ad-hoc New'] as const;

// Creator Booking native lifecycle (STATE_MACHINES §8). [Sourcing] is the
// birth status (set on INSERT, not a transition target).
export const BOOKING_STATUSES = [
  '[Sourcing]',
  '[Booked]',
  '[Content In Progress]',
  '[Content Submitted]',
  '[QC Review]',
  '[QC Passed]',
  '[QC Failed - Revision Requested]',
  '[Escalated - Creator Unresponsive]',
  '[Dropped]',
] as const;

// Revision cap (M9-OA-2, kol.go:92) — after 1 fail-qc round, fail-qc is
// blocked server-side and FE must steer the user to Escalate instead.
export const REVISION_CAP = 1;

// Creator Payment Request lifecycle (STATE_MACHINES §9).
export const PAYMENT_REQUEST_STATUSES = [
  '[Requested]',
  '[Received by Finance]',
  '[Paid]',
  '[Rejected]',
] as const;

// ---------------------------------------------------------------------------
// Local badge-tone overrides. lib/status.ts's shared keyword fallback (out of
// scope to edit for this build stream) maps some M9 labels to a less useful
// tone (e.g. both "[QC Failed - Revision Requested]" and
// "[Escalated - Creator Unresponsive]" would fall into the same "fail/escalat"
// red bucket, losing the escalation signal). Per house convention
// (CONVENTIONS.md §8/§5 — "duplicate helpers locally"), map the fixed status
// sets explicitly here, same pattern as lib/ads.ts's campaignBadgeTone.
// ---------------------------------------------------------------------------

export function bookingBadgeTone(status: string): BadgeTone {
  switch (status) {
    case '[Sourcing]':
      return 'gray';
    case '[Booked]':
      return 'blue';
    case '[Content In Progress]':
      return 'blue';
    case '[Content Submitted]':
      return 'amber';
    case '[QC Review]':
      return 'amber';
    case '[QC Passed]':
      return 'green';
    case '[QC Failed - Revision Requested]':
      return 'purple';
    case '[Escalated - Creator Unresponsive]':
      return 'red';
    case '[Dropped]':
      return 'darkgray';
    default:
      return badgeTone(status);
  }
}

export function paymentRequestBadgeTone(status: string): BadgeTone {
  switch (status) {
    case '[Requested]':
      return 'amber';
    case '[Received by Finance]':
      return 'blue';
    case '[Paid]':
      return 'green';
    case '[Rejected]':
      return 'red';
    default:
      return badgeTone(status);
  }
}

// ---------------------------------------------------------------------------
// Role helpers — UX gating ONLY (CLAUDE.md #6). Server is always the final
// authority; these merely hide/disable a control a role clearly cannot use.
// Duplicated locally per house convention (mirrors lib/creative.ts's helpers).
// ---------------------------------------------------------------------------

export function isDirector(role: Role | null): boolean {
  return !!role?.director;
}

/** OD is read-only across every M9 write endpoint — hide all action buttons. */
export function isODOnly(role: Role | null): boolean {
  return !!role?.od && !role?.director;
}

/**
 * The CDPS division string, verbatim from `role_mappings` (domain
 * `kol.KOL_DIVISION`). Exported because the Coordinator picker asks the server
 * for this division by name — a typo there yields an empty dropdown, not an error.
 */
export const KOL_DIVISION = 'KOL';

export function isKolDivision(role: Role | null): boolean {
  // GET /me returns Role.Division verbatim from the role mapping ("KOL") —
  // compare against the exact backend label, not a lowercased slug.
  return !!role && role.division === KOL_DIVISION;
}

/** KOL Team Leader — the only staff-side role allowed to escalate/drop/manage. */
export function isKolLead(role: Role | null): boolean {
  return isKolDivision(role) && role?.level === 'lead';
}

export function isKolStaff(role: Role | null): boolean {
  return isKolDivision(role) && role?.level === 'staff';
}

export function isAccountRole(role: Role | null): boolean {
  return !!role && role.division === 'Account';
}

/** SPV/Head Account — Account lead, one of the Drop tie-breaker roles. */
export function isAccountLead(role: Role | null): boolean {
  return isAccountRole(role) && role?.level === 'lead';
}

export function isFinanceRole(role: Role | null): boolean {
  return !!role && role.division === 'Finance';
}

/** canCreateBooking (booking.go:156): Director, or KOL division staff/lead. */
export function canCreateBooking(role: Role | null): boolean {
  // OD layered di atas karyawan divisi KOL tetap read-only (Phase 0 §4).
  return !isODOnly(role) && (isDirector(role) || isKolDivision(role));
}

/**
 * canExecute (lifecycle.go:78): Director; or KOL staff/lead — but once a
 * Coordinator is assigned, only that Coordinator or a KOL lead may act.
 * Covers book/start-content/submit-content/send-qc/pass-qc/fail-qc/resubmit,
 * and is also the base gate reused by canContinueEscalation/payment-request.
 */
export function canExecuteBooking(role: Role | null, employeeId: string | undefined, booking: Booking): boolean {
  if (isDirector(role)) return true;
  if (!isKolDivision(role)) return false;
  if (!booking.assigned_coordinator) return true;
  if (role?.level === 'lead') return true;
  return !!employeeId && employeeId === booking.assigned_coordinator;
}

/** canEscalate (§10.1): the assigned Coordinator, KOL Team Leader, or Director.
 * B2 (DECISIONS 2026-08-18) resolved the old PRD/code gap in favour of §10.1 —
 * the Coordinator may "escalate when needed" — so this now mirrors
 * canExecuteBooking (the claim/QC gate) instead of the old lead-only rule. */
export function canEscalateBooking(role: Role | null, employeeId: string | undefined, booking: Booking): boolean {
  return canExecuteBooking(role, employeeId, booking);
}

/** canDrop: KOL Team Leader, Account lead (tie-breaker), or Director.
 * Valid from [Sourcing]/[Booked]/[Content In Progress]/[Escalated - Creator
 * Unresponsive]. The [Content In Progress] state was added B1 (DECISIONS
 * 2026-08-18) so an unresponsive creator who never submits content can still
 * be dropped instead of leaving the Booking stuck. */
export function canDropBooking(role: Role | null): boolean {
  return isDirector(role) || isKolLead(role) || isAccountLead(role);
}

/** canManageBooking (assign.go:18): assign-coordinator & set-SLA — KOL Team Leader or Director ONLY. */
export function canManageBooking(role: Role | null): boolean {
  return isDirector(role) || isKolLead(role);
}

/** canLogHours (assign.go:168): Director, KOL lead, or the assigned Coordinator self-reporting.
 * Also gates the attributed-GMV write-back (same sentinel per m9 brief §"Attributed GMV"). */
export function canLogHoursBooking(role: Role | null, employeeId: string | undefined, booking: Booking): boolean {
  if (isDirector(role)) return true;
  if (isKolLead(role)) return true;
  return !!employeeId && employeeId === booking.assigned_coordinator;
}

/**
 * canContinueEscalation (lifecycle.go:105): owning AM, or Coordinator/lead KOL
 * (canExecute), or Director. There is no explicit "owning AM id" field
 * surfaced anywhere in the M9 read contract (Booking/Brief), so — mirroring
 * lib/ads.ts's documented approach for the same shape of gap
 * (canLogOptimization) — Account division is shown the control generically
 * and the backend enforces actual ownership; a non-owning AM will get a 403
 * with the verbatim [...] message.
 */
export function canContinueEscalation(role: Role | null, employeeId: string | undefined, booking: Booking): boolean {
  if (canExecuteBooking(role, employeeId, booking)) return true;
  return isAccountRole(role);
}

/** canFinance (payment.go:196): Finance division (any level) or Director. Gates receive/pay/reject. */
export function canFinanceAction(role: Role | null): boolean {
  // OD layered di atas karyawan Finance tetap read-only (Phase 0 §4).
  return !isODOnly(role) && (isDirector(role) || isFinanceRole(role));
}

/** canManageCreatorList (creator_list.go:156): Director, owning AM, or staff/lead KOL of the Brief.
 * Same "no ownership id on the wire" gap as canContinueEscalation — Account is shown the
 * control generically, backend is final authority. */
export function canManageCreatorList(role: Role | null): boolean {
  return !isODOnly(role) && (isDirector(role) || isKolDivision(role) || isAccountRole(role));
}

// ---------------------------------------------------------------------------
// module9_kol — Booking entity + native lifecycle
// ---------------------------------------------------------------------------

export interface CreateBookingInput {
  creator_name: string;
  creator_handle?: string;
  platform: string;
  niche?: string;
  source_pool: string;
  pool_reference?: string;
  agreed_rate: string; // decimal string, e.g. "1500000" or "1500000.00"
  assigned_coordinator?: string; // omit for staff self-claim
  qty_video?: number; // per-creator video deliverables (>= 0 integer); omit => 0
  qty_live?: number; // per-creator live-session deliverables (>= 0 integer); omit => 0
}

// POST /briefs/{id}/bookings -> Booking (object directly).
export function createBooking(briefId: string, input: CreateBookingInput): Promise<Booking> {
  return api.post<Booking>(`/briefs/${briefId}/bookings`, input);
}

// GET /briefs/{id}/bookings -> {data: Booking[]} (no pagination/filter param).
export function listBriefBookings(briefId: string): Promise<{ data: Booking[] }> {
  return api.get<{ data: Booking[] }>(`/briefs/${briefId}/bookings`);
}

// GET /bookings/{id} -> Booking (object directly).
export function getBooking(id: string): Promise<Booking> {
  return api.get<Booking>(`/bookings/${id}`);
}

// GET /bookings/{id}/metrics -> BookingMetrics (object directly).
export function getBookingMetrics(id: string): Promise<BookingMetrics> {
  return api.get<BookingMetrics>(`/bookings/${id}/metrics`);
}

// Statemachine.Result has no stable json-tagged shape in the m9 brief (treated
// as opaque) — every lifecycle call below returns `unknown`; callers MUST
// re-fetch getBooking(id) afterwards for the refreshed status/revision_count/
// payment_status rather than parse the return value (m9 brief §3 recommendation).

export function bookBooking(id: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/book`);
}

export function startContent(id: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/start-content`);
}

export function submitContent(id: string, contentLink: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/submit-content`, { content_link: contentLink });
}

export function sendQC(id: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/send-qc`);
}

export function passQC(id: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/pass-qc`);
}

export function failQC(id: string, qcNotes: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/fail-qc`, { qc_notes: qcNotes });
}

export function escalateBooking(id: string, qcNotes: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/escalate`, { qc_notes: qcNotes });
}

export function resubmitContent(id: string, contentLink: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/resubmit`, { content_link: contentLink });
}

// content_link optional bodily, but required by the backend unless a link was
// already recorded before (m9 brief gotcha #9) — always send whatever the
// user typed (which may be pre-filled from booking.content_link).
export function continueEscalation(id: string, contentLink: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/continue`, { content_link: contentLink });
}

export function dropBooking(id: string, reason: string): Promise<unknown> {
  return api.post<unknown>(`/bookings/${id}/drop`, { reason });
}

// ---------------------------------------------------------------------------
// Coordinator assignment / SLA / Hours (M9 §3 Rule 3, §7)
// ---------------------------------------------------------------------------

export interface AssignCoordinatorResult {
  id: string;
  assigned_coordinator: string;
}

// `reason` only required server-side on REASSIGNMENT (booking already has a
// different coordinator) — pass '' for a first-time assignment.
export function assignCoordinator(id: string, coordinatorId: string, reason: string): Promise<AssignCoordinatorResult> {
  return api.post<AssignCoordinatorResult>(`/bookings/${id}/assign-coordinator`, {
    coordinator_id: coordinatorId,
    reason,
  });
}

export interface SLAResult {
  id: string;
  sla_target_hours: number;
}

export function setBookingSLA(id: string, hours: number): Promise<SLAResult> {
  return api.post<SLAResult>(`/bookings/${id}/sla`, { hours });
}

export interface HoursResult {
  id: string;
  hours_logged: number;
}

export function logBookingHours(id: string, hours: number): Promise<HoursResult> {
  return api.post<HoursResult>(`/bookings/${id}/hours`, { hours });
}

// ---------------------------------------------------------------------------
// Attributed GMV write-back (M9 §10.3 / M9-OA-4) — only while [QC Passed].
// ---------------------------------------------------------------------------

export interface AttributedGMVResult {
  id: string;
  attributed_gmv: number;
  attributed_gmv_display: string;
}

// attributed_gmv is a decimal STRING on the way in ("0" is valid/allowed).
export function recordAttributedGMV(id: string, attributedGmv: string): Promise<AttributedGMVResult> {
  return api.post<AttributedGMVResult>(`/bookings/${id}/attributed-gmv`, { attributed_gmv: attributedGmv });
}

// ---------------------------------------------------------------------------
// Creator Payment Request (M9 §8)
// ---------------------------------------------------------------------------

export interface CreatePaymentRequestInput {
  amount: string; // decimal string, MUST equal the booking's agreed_rate exactly
  payment_details: string;
}

// POST /bookings/{id}/payment-request -> PaymentRequest (object directly).
export function createPaymentRequest(bookingId: string, input: CreatePaymentRequestInput): Promise<PaymentRequest> {
  return api.post<PaymentRequest>(`/bookings/${bookingId}/payment-request`, input);
}

// GET /payment-requests/{id} -> PaymentRequest (object directly). No list/queue
// endpoint exists (m9 brief "TIDAK TERSEDIA" #2) — Finance can only open by id.
export function getPaymentRequest(id: string): Promise<PaymentRequest> {
  return api.get<PaymentRequest>(`/payment-requests/${id}`);
}

export function receivePaymentRequest(id: string): Promise<unknown> {
  return api.post<unknown>(`/payment-requests/${id}/receive`);
}

export function payPaymentRequest(id: string): Promise<unknown> {
  return api.post<unknown>(`/payment-requests/${id}/pay`);
}

export function rejectPaymentRequest(id: string, reason: string): Promise<unknown> {
  return api.post<unknown>(`/payment-requests/${id}/reject`, { reason });
}

// ---------------------------------------------------------------------------
// Compiled Creator List (M9 §6/§10.5)
// ---------------------------------------------------------------------------

// POST /briefs/{id}/creator-list {link} -> CreatorList (object directly).
export function compileCreatorList(briefId: string, link: string): Promise<CreatorList> {
  return api.post<CreatorList>(`/briefs/${briefId}/creator-list`, { link });
}

// GET /briefs/{id}/creator-list -> CreatorList (object directly).
export function getCreatorList(briefId: string): Promise<CreatorList> {
  return api.get<CreatorList>(`/briefs/${briefId}/creator-list`);
}

// ---------------------------------------------------------------------------
// Cross-module borrowed reads (same pattern as lib/creative.ts / lib/ads.ts):
// GET /briefs/{id} and GET /divisions/kol/brief-queue are M6-owned endpoints,
// not part of M9's own routes, reused here only as read context / the KOL
// workspace landing queue (M9 has no list-bookings-across-briefs endpoint —
// m9 brief "TIDAK TERSEDIA" #1/#3).
// ---------------------------------------------------------------------------

export function getBrief(id: string): Promise<Brief> {
  return api.get<Brief>(`/briefs/${id}`);
}

export function listKolBriefQueue(): Promise<{ data: Brief[] }> {
  // Division path param is validated case-sensitively by the backend against
  // allowedDivisions (strategy.go:51) — must be the canonical label "KOL".
  return api.get<{ data: Brief[] }>('/divisions/KOL/brief-queue');
}

// PATCH is not exposed by lib/api.ts (only get/post/put/delete). M9 has no
// PATCH endpoint in scope (m9 brief "TIDAK TERSEDIA" #5 — Booking base fields
// are immutable after create), so no local patch() helper is needed here.
