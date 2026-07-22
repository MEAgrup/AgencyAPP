/**
 * WIB (Waktu Indonesia Barat, Asia/Jakarta) calendar-date bucketing.
 *
 * Ported 1:1 from backend/internal/core/tz/tz.go.
 *
 * House rule (DECISIONS O20, 2026-07-17): every derivation that buckets an
 * instant into a calendar DAY or MONTH — the house-ID period, the payment
 * reminder "today"/day-overdue math, the MSL "effective today" date — is done
 * in WIB, not UTC. Absolute timestamps (audit created_at, DB now(), session
 * expiry, sync markers) are NOT affected; only civil-date derivations are.
 *
 * WIB is a fixed UTC+7 offset with no daylight-saving time, so we compute with
 * a literal +07:00 offset rather than an `Asia/Jakarta` tzdata lookup. This
 * keeps behaviour independent of the runtime's tz database and is correct
 * forever because WIB has no DST transitions. The offset is defined in ONE
 * place (WIB_OFFSET_HOURS) and must match the SQL side (wib_date/wib_period,
 * `+ interval '7 hours'`) — see SUPABASE_MIGRATION_TECH_APPENDIX §B.7.
 */

/** WIB is a fixed UTC+7 offset — the single source of truth for the offset. */
export const WIB_OFFSET_HOURS = 7;
const OFFSET_MS = WIB_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** The WIB civil (wall-clock) calendar parts of an instant. */
interface WibParts {
  year: number;
  month: number; // 1-12
  day: number;
}

// Shift the instant by +7h and read the UTC parts — that yields the WIB
// wall-clock civil date without depending on the host tz database.
function wibParts(t: Date): WibParts {
  const shifted = new Date(t.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * date returns midnight (00:00:00 WIB) of the WIB calendar day that instant t
 * falls on, as a Date (an absolute instant). Use it whenever you need the start
 * of "today" for calendar bucketing.
 */
export function date(t: Date): Date {
  const { year, month, day } = wibParts(t);
  // WIB midnight of (year,month,day) as a UTC instant: the civil-date midnight
  // minus the +7h offset.
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

/** dateString formats the WIB calendar date of t as "YYYY-MM-DD". */
export function dateString(t: Date): string {
  const { year, month, day } = wibParts(t);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * period formats the WIB calendar month of t as "YYYYMM" — the house-ID month
 * bucket (PREFIX-YYYYMM-NNNN).
 */
export function period(t: Date): string {
  const { year, month } = wibParts(t);
  return `${pad(year, 4)}${pad(month, 2)}`;
}

/**
 * daysBetween returns the whole number of calendar days from the WIB date of
 * `from` to the WIB date of `to` (i.e. to - from). Both operands are first
 * reduced to WIB midnight, so the result is a pure calendar-day difference,
 * independent of the clock time within each day. Because WIB has no DST the
 * reduced instants differ by exact multiples of 24h, so the division is exact.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((date(to).getTime() - date(from).getTime()) / DAY_MS);
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
