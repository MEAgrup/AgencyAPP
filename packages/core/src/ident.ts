/**
 * House ID scheme PREFIX-YYYYMM-NNNN (CLAUDE.md #1).
 *
 * Ported from backend/internal/core/ident. The **atomic, gap-free, rollback-safe
 * allocation** lives in the Postgres function `ident_next(prefix, at)`
 * (migration 20260722060601_ident_next.sql) — NOT reimplemented in TypeScript,
 * because reproducing the row-lock/no-double-alloc guarantee outside a single DB
 * transaction is impossible to do safely (SUPABASE_MIGRATION_TECH_APPENDIX §B.1).
 *
 * This module provides the PURE, DB-free parts:
 *   - the prefix registry (single source for the TS side),
 *   - format / parse / isValid helpers for IDs,
 * plus a thin `nextId` wrapper that calls the SQL function inside the caller's
 * transaction (the SAME tx as the entity insert), guarding against unregistered
 * prefixes. House rule "ID only after mandatory-field validation passes" stays
 * the caller's (route handler's) responsibility — this wrapper is invoked only
 * after validation, exactly like Go's `ident.Next`.
 */

import { period as wibPeriod } from './tz';

/** A registered ID prefix and what it identifies. Source: docs/DATA_MODEL.md §1. */
export interface PrefixInfo {
  entity: string;
  module: string;
}

/**
 * Prefix registry — the exact set used by `ident.Next` across the Go backend,
 * cross-checked against docs/DATA_MODEL.md §1. Immutable & never reused
 * (CLAUDE.md #1). Adding a prefix requires a DATA_MODEL.md entry.
 *
 * This object is the TS half of the M6A §7 two-mechanism guarantee; the DB half
 * is the `entity_prefix` table (PK ⇒ duplicates impossible). The two must not
 * diverge — `ident.registry.test.ts` asserts it both ways, and the same test
 * scans every ID-minting call site so a prefix cannot reach `ident_next` without
 * being registered here. That check was added because three had already slipped
 * through (`ACT`, `LDR`, `DEMO`): they called the untyped executor directly.
 */
export const PREFIXES = {
  LEAD: { entity: 'Lead record', module: 'M1' },
  PRSP: { entity: 'Prospect attempt', module: 'M0/M1' },
  ACT: { entity: 'Prospect activity', module: 'M0/M1' },
  LDR: { entity: 'Lead delete request', module: 'M1' },
  NEG: { entity: 'Negotiation proposal', module: 'M0' },
  CMP: { entity: 'Campaign (acquisition)', module: 'M3' },
  CLI: { entity: 'Client', module: 'M0→M4' },
  TRX: { entity: 'Transaction', module: 'M0→M5' },
  INST: { entity: 'Installment', module: 'M5' },
  SVC: { entity: 'Service', module: 'M0→M6' },
  STR: { entity: 'Strategy & Plan', module: 'M6' },
  BRF: { entity: 'Brief', module: 'M6' },
  AST: { entity: 'Asset (Creative)', module: 'M7' },
  ADC: { entity: 'Ad Campaign (client-facing)', module: 'M8' },
  MTR: { entity: 'Metric Entry', module: 'M8' },
  OPT: { entity: 'Optimization Log', module: 'M8' },
  BKG: { entity: 'Creator Booking', module: 'M9' },
  CPR: { entity: 'Creator Payment Request', module: 'M9→M5' },
  LSS: { entity: 'Live Stream Session', module: 'M10' },
  DEP: { entity: 'Dependency', module: 'M11' },
  CPL: { entity: 'Complaint', module: 'M6' },
  CHR: { entity: 'Client Health Report Snapshot', module: 'M13' },
  PERF: { entity: 'Performance Score', module: 'M14' },
  MSV: { entity: 'Master Service List version', module: 'Admin' },
  DBR: { entity: 'Demo Block Request', module: 'demo' },
  DEMO: { entity: 'Demo task', module: 'demo' },
  // M6A/6B/6C. `STRG` is deliberately four letters (M6A §7): three-letter space
  // is where collisions live, and `STR` is already the old M6 §4 entity. The
  // registry confirmed STRG/PLAN/VND are all free, so the PRD's `STGY`/`PPRD`
  // fallback is not used.
  STRG: { entity: 'Strategi (Full Store Management)', module: 'M6A' },
  PLAN: { entity: 'Plan period', module: 'M6B' },
  VND: { entity: 'Vendor', module: 'M6A' },
  // O57 — the agreement a client signed, covering n Services. Strategi hangs off
  // this, not off a Service, so Rule 2 / D-1 / §7 read as written.
  CTR: { entity: 'Contract (kesepakatan klien)', module: 'M6A/M6B' },
  // M5-OA-7 — a Finance-filed request to change a transaction's payment scheme,
  // applied only on Director ACC. Minted after validation passes (house rule #1).
  TCR: { entity: 'Transaction Change Request', module: 'M5' },
  // Interview (tab 1 "Kelola Klien"). `ITV` was free in the registry; the PRD's
  // `ITV-YYYY-NNNNN` form is NOT used — same decision as STRG/PLAN/VND
  // (DECISIONS.md 2026-08-06): `ident_next` only produces the house
  // PREFIX-YYYYMM-NNNN, and forking the ID engine for one entity is the larger
  // evil. Logged in DECISIONS.md 2026-08-11.
  ITV: { entity: 'Interview (Kualifikasi Klien)', module: 'M6-Interview' },
  // M6D — Rekap Hasil Mingguan. One recap per active client per ISO week, auto-
  // generated Monday 00:00 WIB (machine #18). Aggregation-and-narrative layer;
  // owns no execution data. `WRR` was free in the registry; house form
  // PREFIX-YYYYMM-NNNN via ident_next (same decision as STRG/PLAN/VND/ITV, not
  // the PRD's own form). Registered in entity_prefix by the D-01 migration.
  WRR: { entity: 'Rekap Hasil Mingguan', module: 'M6D' },
  // T-4c — Upcoming Milestones terstruktur (RM-11). One per client tonggak, machine
  // `client_milestone` ([Upcoming]→[Done]|[Cancelled]). Registered in entity_prefix
  // by 20260814070000_t4c_milestones.sql. House form PREFIX-YYYYMM-NNNN.
  MLS: { entity: 'Client Milestone (Upcoming Milestones)', module: 'M6D' },
  // Penugasan Internal — tugas yang atasan berikan ke anggota timnya, di luar
  // rantai Klien→Service→Brief. DELIBERATELY NOT an M12 Task: M12 §2 Rule 1
  // freezes Task = Asset | Creator Booking | Brief-as-task, all three anchored
  // to a paying client. `TSK` was free in the registry. Machine `internal_task`;
  // registered in entity_prefix by 20260814110000_penugasan_internal.sql.
  TSK: { entity: 'Penugasan Internal (internal task)', module: 'Penugasan' },
} as const satisfies Record<string, PrefixInfo>;

/** A registered prefix string (e.g. 'CLI', 'TRX'). */
export type Prefix = keyof typeof PREFIXES;

/** isRegisteredPrefix reports whether p is a known house prefix. */
export function isRegisteredPrefix(p: string): p is Prefix {
  return Object.prototype.hasOwnProperty.call(PREFIXES, p);
}

// A house ID is PREFIX (2-5 uppercase letters) - YYYYMM (6 digits) - NNNN
// (4+ digits; NNNN is zero-padded to at least 4 but a period may exceed 9999).
const ID_RE = /^([A-Z]{2,5})-(\d{6})-(\d{4,})$/;

/** Parsed components of a house ID. */
export interface ParsedId {
  prefix: string;
  period: string; // YYYYMM (WIB month bucket)
  n: number;
}

/**
 * format builds an ID string from its parts. n is zero-padded to at least 4
 * digits, matching `lpad(n::text, 4, '0')` in `ident_next` (a period exceeding
 * 9999 widens rather than truncates — same as Go's `%04d`).
 */
export function format(prefix: string, period: string, n: number): string {
  return `${prefix}-${period}-${String(n).padStart(4, '0')}`;
}

/**
 * parse splits a house ID into its parts, or returns null if it does not match
 * the PREFIX-YYYYMM-NNNN shape. It does NOT check prefix registration (use
 * isRegisteredPrefix for that) nor calendar validity of the month.
 */
export function parse(id: string): ParsedId | null {
  const m = ID_RE.exec(id);
  if (m === null) {
    return null;
  }
  return { prefix: m[1], period: m[2], n: Number(m[3]) };
}

/**
 * isValid reports whether id has the house shape AND a registered prefix.
 * Use for validating IDs arriving from URLs / user input before a DB lookup.
 */
export function isValid(id: string): boolean {
  const p = parse(id);
  return p !== null && isRegisteredPrefix(p.prefix);
}

/**
 * Minimal executor over the atomic SQL allocator. The real implementation wraps
 * postgres.js/drizzle and MUST run inside the same transaction as the entity
 * insert (so a rolled-back insert consumes no sequence number):
 *
 *   { identNext: (prefix, at) => sql`select ident_next(${prefix}, ${at})`.then(r => r[0].ident_next) }
 */
export interface IdentExecutor {
  /** Calls the Postgres function `ident_next(prefix, at)` and returns the new ID. */
  identNext(prefix: string, at: Date): Promise<string>;
}

/**
 * nextId allocates the next ID for prefix in the WIB YYYYMM bucket of `at`, via
 * the atomic SQL function. Rejects an unregistered prefix (guards typos before
 * touching the DB). Mirrors Go's `ident.Next(ctx, tx, prefix, now)`.
 *
 * Invariant: only call AFTER mandatory-field validation has passed (CLAUDE.md #1).
 */
export async function nextId(exec: IdentExecutor, prefix: Prefix, at: Date): Promise<string> {
  if (!isRegisteredPrefix(prefix)) {
    throw new Error(`ident: unregistered prefix ${JSON.stringify(prefix)}`);
  }
  return exec.identNext(prefix, at);
}

/**
 * periodOf returns the WIB YYYYMM bucket an ID minted at instant `at` would
 * carry — the same derivation `ident_next` performs in SQL (`+ interval '7
 * hours'`). Single source of the offset via tz (SUPABASE_MIGRATION_TECH_APPENDIX §B.7).
 */
export function periodOf(at: Date): string {
  return wibPeriod(at);
}
