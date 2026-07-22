/**
 * @cdps/core — Shared core engines for CDPS (ported from Go internal/core/)
 *
 * This package exports the following engines (to be ported):
 * - statemachine: Entity lifecycle transitions with server-side validation
 * - ident: ID generation (PREFIX-YYYYMM-NNNN format, immutable, no reuse)
 * - money: Commission, allocation (Σ=100%), installment rollup, ROAS calculations
 * - audit: Append-only immutable audit log (actor, action, before→after, timestamp)
 * - notification: In-app event notifications derived from audit log
 * - permission: Role matrix enforcement (staff/lead/SPV/OD/Director/layered)
 * - tz: Timezone utilities for client-local vs server timestamps
 * - importer: Bulk import with dry-run SAVEPOINT + atomic apply
 *
 * All implementations must maintain house-rule compliance (CLAUDE.md §Non-negotiable):
 * - State machines server-side enforced + exact Bahasa Indonesia [...]messages
 * - ID generation only after mandatory validation passes
 * - Derived fields computed (never user-typed) and always recomputable from audit log
 * - Permission checks per role with tests for all levels including layered OD/Director
 * - Money math: round-half-up, div-by-zero → "—", IDR format Rp. X.XXX.XXX,00
 *
 * Reference: SUPABASE_MIGRATION_PLAN.md §3 (pemetaan house rules)
 */

// Placeholder exports — implementations follow per phase
export {};
