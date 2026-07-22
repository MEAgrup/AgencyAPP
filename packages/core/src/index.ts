/**
 * @cdps/core — Shared core engines for CDPS (ported from Go internal/core/).
 *
 * Ported to TypeScript in Fase 0 sesi 2 (see docs/handoff/HANDOFF_SUPABASE_FASE0.md
 * §5.2 and SUPABASE_MIGRATION_TECH_APPENDIX §B). The mapping principle (§B): pure
 * computation/format/validation lives here as TypeScript; anything that must be
 * atomic with a single row/transaction (ID allocation, status transition write,
 * immutability, updated_at) is a Postgres function/trigger (supabase/migrations/)
 * that this layer's decisions feed into.
 *
 * Engines:
 * - money        — IDR minor-unit math + "Rp. X.XXX.XXX,00" format (pure)
 * - tz           — WIB (+07:00, no DST) calendar-day/month bucketing (pure)
 * - permission   — role matrix predicates (pure; RLS re-checks them in SQL)
 * - biMessages   — single source of Bahasa Indonesia [...] messages
 * - statemachine — declarative machine config + allow/block/role decision (pure);
 *                  the atomic write is the SQL sm_transition function
 * - notification — frozen 15-event catalog + recipient-selection semantics (pure);
 *                  resolvers + INSERT are SQL, atomic with the triggering change
 * - ident        — PREFIX-YYYYMM-NNNN format/parse (pure); allocation is SQL ident_next
 * - audit        — append-only entry builder + no-secret guard (pure); INSERT via db
 *
 * House-rule compliance (CLAUDE.md §Non-negotiable) is preserved by construction:
 * status is only ever set through the transition path, IDs only after validation,
 * derived fields are computed and recomputable, BI messages come from one module.
 */

export * as money from "./money.js";
export * as tz from "./tz.js";
export * as permission from "./permission.js";
export * as biMessages from "./bi-messages.js";
export * as statemachine from "./statemachine/index.js";
export * as ident from "./ident.js";
export * as audit from "./audit.js";
export * as notification from "./notification/catalog.js";
