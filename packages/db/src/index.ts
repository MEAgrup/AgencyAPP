/**
 * @cdps/db — Postgres client & core executor implementations for CDPS.
 *
 * - client: postgres.js connection factory (Supabase pooler, prepare:false) +
 *   withTransaction helper.
 * - executors: concrete @cdps/core executor implementations backed by the SQL
 *   functions ident_next / sm_transition / notify_emit and the audit_log insert.
 *
 * Generated Drizzle types will be added here later (see README). For now the
 * executors call the SQL functions directly via tagged-template queries.
 *
 * Reference: SUPABASE_MIGRATION_TECH_APPENDIX §E.2 (pooler) + §B (engines).
 */

export * from './client';
export * from './executors';
export * as interview from './interview';
