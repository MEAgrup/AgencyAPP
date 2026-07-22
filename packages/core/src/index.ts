/**
 * @cdps/core — Shared core engines for CDPS (ported from Go internal/core/)
 *
 * This package exports the following engines (ported incrementally per phase):
 * - money: Commission, allocation (Σ=100%), installment rollup, ROAS math ✅
 * - tz: WIB (UTC+7, no DST) calendar-date bucketing ✅
 * - permission: Role matrix predicates (staff/lead/SPV/OD/Director/layered) ✅
 * - bi: Bahasa Indonesia validation/block message catalog (pending)
 * - statemachine: Entity lifecycle transitions (SQL sm_transition + TS wrapper, pending)
 * - ident: ID generation PREFIX-YYYYMM-NNNN (SQL ident_next + TS wrapper, pending)
 * - audit: Append-only immutable audit log (pending)
 * - notification: In-app event notifications derived from audit log (pending)
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

export * as money from './money.js';
export * as tz from './tz.js';
export * as permission from './permission.js';
