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
 * - msl: Master Service List admin (S0-09) — Sales-owned catalog with immutable
 *   versions, plus the canonical MSL read (effectiveAt) consumed by `sales`.
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
 *

 * An @cdps/api route handler is a thin shell: resolve the actor from the JWT
 * app_metadata claim, validate inputs, then call one of these functions.
 */

export * as auth from './auth';
export * as employees from './employees';
export * as demo from './demo';
export * as leads from './leads';
export * as sales from './sales';
export * as msl from './msl';
export * as finance from './finance';
export * as client from './client';
export * as account from './account';
export * as task from './task';
export * as creative from './creative';
export * as ads from './ads';
export * as kol from './kol';
export * as board from './board';
export * as livestream from './livestream';
export * as campaign from './campaign';
export * as marketing from './marketing';
