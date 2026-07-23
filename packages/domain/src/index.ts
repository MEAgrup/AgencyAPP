/**
 * @cdps/domain — CDPS domain services on top of @cdps/core (engines) and
 * @cdps/db (client + executors). Ported from Go's `internal/*` module packages.
 *
 * - employees: HRIS employee importer (sync + credential provisioning + GoTrue
 *   link), behind an EmployeeSource port (CSV fallback). Fase 1 langkah 3 / OQ-4.
 * - demo: the Sprint 0 demo-task service (S0-12) — the reference vertical that
 *   composes ident/sm_transition/notify/audit in one transaction. Fase 1 langkah 4.
 *
 * An @cdps/api route handler is a thin shell: resolve the actor from the JWT
 * app_metadata claim, validate inputs, then call one of these functions.
 */

export * as employees from './employees.js';
export * as demo from './demo.js';
