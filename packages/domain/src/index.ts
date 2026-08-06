/**
 * @cdps/domain — CDPS domain services on top of @cdps/core (engines) and
 * @cdps/db (client + executors). Ported from Go's `internal/*` module packages.
 *
 * - employees: HRIS employee importer (sync + credential provisioning + GoTrue
 *   link), behind an EmployeeSource port (CSV fallback). Fase 1 langkah 3 / OQ-4.
 * - demo: the Sprint 0 demo-task service (S0-12) — the reference vertical that
 *   composes ident/sm_transition/notify/audit in one transaction. Fase 1 langkah 4.
 * - leads: M1 registration door (+ M0 §3) — the money-path entry point, minting
 *   the central LEAD record and the salesperson's PRSP attempt with dedup v2.
 * - sales: M0 Qualified stage — Contacted progression, the MSL v2 pricing
 *   calculator + commission quote, and the Qualified Lead Form submit.
 * - activity: the prospect activity log (ACT-) — Follow Up / Jadwal Meeting /
 *   Online Meeting / Visit recorded from `Qualified` until closing, with the
 *   derived effort rollups. Append-only; NOT a lifecycle (deviasi PRD, keputusan
 *   pemilik 2026-08-06).
 * - msl: Master Service List admin (S0-09) — Sales-owned catalog with immutable
 *   versions, plus the canonical MSL read (effectiveAt) consumed by `sales`.
 * - directory: the assignable-employee READ behind every "who does this?" picker
 *   (AM assignment, Brief/Task/Asset PIC, Booking Coordinator). Read-only, and
 *   its predicate mirrors the assignment validators so what is offered is what is
 *   accepted.
 * - audit: the cross-module audit-trail READ (GET /audit) the entity-history
 *   panels use. Read-only by construction; writes stay in @cdps/core audit.
 * - engine: transition-engine introspection (`allowedTransitions`) over `sm_edges`
 *   — what the detail views need to decide which action buttons exist. Read-only
 *   by construction; enforcement stays in the SQL `sm_transition`.
 * - finance: M5 Admin & Finance — payment verification + routing gate + the
 *   derived Amount Verified / commission-achievement read-models (M0 §5 / M5).
 * - client: M4 Client Record — the §4 lock matrix (server-side edit gate over the
 *   born Client Record) + the shared Client Record read.
 * - account: M6 Account & Service — client intake & AM assignment (§3), Strategy
 *   & Plan (§4, the plan-gated path), Brief breakdown/dispatch/review (§5–§7),
 *   and Complaint door #2 (§8).
 * - task: M12 Task Execution — the division-side brief_task edges (start/submit/
 *   rework/block/resume), PIC + SLA assignment, the block-request queue, the
 *   recompute-from-log Task metrics (turnaround / speed score), and the Brief→Asset
 *   roll-up. Serves the Brief-as-task and Creative Asset sources (Booking with M9).
 * - creative: M7 Creative — the Asset (AST-) entity: incremental Brief breakdown,
 *   the AM-side per-Asset review edges (§4 Flow 3 / §6), Hours Logged (§5), and the
 *   Asset reads. Execution edges + roll-up live in `task`.
 * - ads: M8 Ads — the Ad Campaign (ADC-): creation, the [Paused]/[Active]/[Ended]
 *   lifecycle with the launch dependency, Creative-Asset linkage, the Optimization
 *   Log (+ budget sign-off / creative swap), periodic Metric Entries with derived
 *   Total Spend / GMV / ROAS + Attributed-GMV feedback to Creative, and the setup
 *   Brief submit guard (§4 Rule 3) that `task` calls.
 * - kol: M9 KOL — the Creator Booking (BKG-): creation, the native 8-state
 *   lifecycle incl. KOL-side QC + escalate/drop, coordinator/SLA/hours, the
 *   Brief↔Booking roll-up, the Creator Payment Request (Finance-executed), the
 *   compiled Creator List, Attributed GMV, and §11-mapped Speed Score via
 *   task.computeMetrics.
 * - livestream: M10 Live Stream — the Live Stream Session (LSS-) vendor tracker:
 *   AM-owned request/result lifecycle over an off-machine [Dispatched to Vendor]
 *   Brief, requested-vs-actual reconciliation, and the off-machine Brief roll-up.
 * - campaign: M3 Campaign — the acquisition Campaign (CMP-): create (born Draft),
 *   the Draft→Active⇄Paused→Closed→Archived machine (Closed stamps end_date),
 *   ownership reassign (Marketing lead/Director), §5-scoped Get/List, and the
 *   read-only linkage rollups (leads/real-leads/clients-won/total-value-won).
 * - marketing: M2 Marketing — the Marketing Performance Record (1:1 Campaign, budget
 *   input) + the read-only Auto-Metrics Engine (Lead-by-Dashboard/Real/Quality,
 *   Attributed Sales last-touch, CPL/CPRL/ROAS, Collected-ROAS, junk breakdown) and
 *   the Lead/Staff dashboard split. Reuses `campaign` for the §5 gate + Online/Offline.
 * - vendor: M6A §7/D19 — the VND- entity. Live Stream is vendor mode (D15/Rule 18),
 *   so E-8 and F-4 need a vendor record before Section E can exist at all. Shared
 *   master data: Account lead/Director write, everyone reads, status via sm_transition.
 * - strategi: M6A — the STRG- entity + its child tables + machine #15. The record
 *   the Section A→J form is built on: versions are rows (Rule 13), the baseline is
 *   rows per (channel, month) not fixed columns (D11), and the submit gate is the
 *   PRD's own rules (3/5/8/9/17). Does NOT yet unlock Brief dispatch — that gate
 *   still reads the old M6 §4 entity until the form swap (A-05…A-09).
 * - notification: the in-app inbox (Phase 0 v2 §9) — the READ + mark-as-read side of
 *   the FROZEN 15-event catalog. Emission stays in @cdps/core `emit()`/`notify_emit`;
 *   there is no delete path here, by house rule §8.
 *

 * An @cdps/api route handler is a thin shell: resolve the actor from the JWT
 * app_metadata claim, validate inputs, then call one of these functions.
 */

export * as auth from './auth';
export * as employees from './employees';
export * as admin from './admin';
export * as directory from './directory';
export * as demo from './demo';
export * as leads from './leads';
export * as sales from './sales';
export * as activity from './activity';
export * as msl from './msl';
export * as finance from './finance';
export * as client from './client';
export * as account from './account';
export * as plangate from './plangate';
export * as vendor from './vendor';
export * as strategi from './strategi';
export * as task from './task';
export * as creative from './creative';
export * as ads from './ads';
export * as kol from './kol';
export * as performance from './performance';
export * as health from './health';
export * as board from './board';
export * as livestream from './livestream';
export * as campaign from './campaign';
export * as marketing from './marketing';
export * as portal from './portal';
export * as notification from './notification';
export * as audit from './audit';
export * as engine from './engine';
