/**
 * @cdps/core skuscreener — MEA SKU Screener, Gelombang 3 (Modul A/B pure
 * logic: screening/routing + before-after comparison). Modul C (`ADL-`
 * decision log) and Modul D (optimization tracker) are schema-only in this
 * pass (see `supabase/migrations/` + `docs/DECISIONS.md`) — their per-record
 * rules (R12-R16) that ARE pure math/validation live here (`compare.ts`'s
 * `evaluateOptimization`), but there is no domain/route layer yet (SC-08 +
 * the domain wrapper are a later ticket).
 *
 * Pure and DOM-free, exactly like `../baseline` and `../report`. See
 * `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` §6 and
 * `docs/design/PRD_MEA_SKU_SCREENER_v1.0.md` for the full rule set (R01-R16).
 */
export * from './types';
export * from './parse';
export * from './median';
export * from './route';
export * from './cpc';
export * from './roas';
export * from './compare';
