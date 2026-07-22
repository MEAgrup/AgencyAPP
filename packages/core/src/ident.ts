// House ID scheme PREFIX-YYYYMM-NNNN (CLAUDE.md convention 1 + S0-03).
//
// Ported from backend/internal/core/ident/ident.go (SUPABASE_MIGRATION_TECH_APPENDIX
// §B.1). The ATOMIC allocation — gap-free, no-double-alloc, rollback-safe under
// concurrency — is the Postgres function `ident_next(prefix text, at timestamptz)`
// (migration 20260102000001_ident_next.sql), which takes a row lock via
// INSERT ... ON CONFLICT ... RETURNING inside the caller's transaction, exactly as
// the Go code relied on the MySQL upsert row lock. It is NOT reimplemented in
// TypeScript, because doing so outside a single DB statement would lose the
// concurrency guarantee.
//
// What lives here (pure, TS): the format/parse helpers and the WIB period bucket,
// so route handlers and tests share ONE definition of the id shape. The rule "an
// ID is issued ONLY after mandatory-field validation passes" stays the route
// handler's responsibility (call ident_next only after Validate() succeeds, and
// only inside the same transaction as the entity insert) — the SQL function does
// no business validation, keeping the BI messages a single TypeScript source.

import { period as wibPeriod } from "./tz.js";

/** Matches a well-formed house ID: PREFIX-YYYYMM-NNNN. */
export const ID_PATTERN = /^[A-Za-z0-9]+-\d{6}-\d{4}$/;

/** period returns the WIB YYYYMM bucket for an instant (matches SQL ident_next). */
export function period(at: Date): string {
  return wibPeriod(at);
}

/** pad4 renders the sequence number as a 4-digit zero-padded string. */
function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

/**
 * formatId composes a house ID from its parts. `n` is the sequence value the SQL
 * `ident_next` returns for (prefix, WIB-period-of-at). This mirrors the Go
 * `fmt.Sprintf("%s-%s-%04d", prefix, period, n)`.
 */
export function formatId(prefix: string, at: Date, n: number): string {
  return `${prefix}-${period(at)}-${pad4(n)}`;
}

export interface ParsedId {
  prefix: string;
  period: string;
  sequence: number;
}

/** parseId splits a house ID into its parts, or returns null if malformed. */
export function parseId(id: string): ParsedId | null {
  if (!ID_PATTERN.test(id)) {
    return null;
  }
  const lastDash = id.lastIndexOf("-");
  const midDash = id.lastIndexOf("-", lastDash - 1);
  return {
    prefix: id.slice(0, midDash),
    period: id.slice(midDash + 1, lastDash),
    sequence: Number(id.slice(lastDash + 1)),
  };
}
