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
 * - account: M6 Account & Service — Cluster 1 (client intake & AM assignment):
 *   the Unassigned Intake Queue, manual AM assign/reassign, and the AM-workload
 *   read model.
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
