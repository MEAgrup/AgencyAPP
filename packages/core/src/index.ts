/**
 * @cdps/core — Shared core engines for CDPS (ported from Go internal/core/)
 *
 * This package exports the following engines (ported incrementally per phase):
 * - money: Commission, allocation (Σ=100%), installment rollup, ROAS math ✅
 * - tz: WIB (UTC+7, no DST) calendar-date bucketing ✅
 * - permission: Role matrix predicates (staff/lead/SPV/OD/Director/layered) ✅
 * - bi: house-wide Bahasa Indonesia core messages + [...] invariant helpers ✅
 * - ident: prefix registry + ID format/parse + nextId wrapper (SQL ident_next) ✅
 * - statemachine: lifecycle transitions wrapper (SQL sm_transition) ✅
 * - audit: append-only immutable audit writer + no-secret guard ✅
 * - notification: 15 FROZEN events catalog + emit wrapper (SQL notify_emit) ✅
 *
 * All implementations must maintain house-rule compliance (CLAUDE.md §Non-negotiable):
 * - State machines server-side enforced + exact Bahasa Indonesia [...] messages
 * - ID generation only after mandatory validation passes
 * - Derived fields computed (never user-typed) and always recomputable from audit log
 * - Permission checks per role with tests for all levels including layered OD/Director
 * - Money math: round-half-up, div-by-zero → "—", IDR format Rp. X.XXX.XXX,00
 *
 * Reference: SUPABASE_MIGRATION_PLAN.md §3 + TECH_APPENDIX §B (pemetaan engine).
 */

export * as money from './money';
export * as tz from './tz';
export * as permission from './permission';
export * as bi from './bi';
export * as ident from './ident';
export * as statemachine from './statemachine';
export * as audit from './audit';
export * as notification from './notification';
