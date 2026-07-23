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
 *
 * An @cdps/api route handler is a thin shell: resolve the actor from the JWT
 * app_metadata claim, validate inputs, then call one of these functions.
 */

export * as employees from './employees.js';
export * as demo from './demo.js';
export * as leads from './leads.js';
export * as sales from './sales.js';
export * as msl from './msl.js';
