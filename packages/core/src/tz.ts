// WIB (Waktu Indonesia Barat, Asia/Jakarta) calendar-date bucketing.
//
// Ported 1:1 from backend/internal/core/tz/tz.go (SUPABASE_MIGRATION_TECH_APPENDIX
// §B.7). House rule (DECISIONS O20, 2026-07-17): every derivation that buckets an
// instant into a calendar DAY or MONTH — the house-ID period, the payment reminder
// "today"/day-overdue math, the MSL "effective today" date — is done in WIB, not
// UTC. Absolute timestamps (audit created_at, DB now(), session expiry, sync
// markers) are NOT affected; only civil-date derivations are.
//
// WIB is a fixed UTC+7 offset with no daylight-saving time, so we use a literal
// +07:00 offset rather than the tzdata zone name "Asia/Jakarta". This keeps the
// derivation independent of the platform tzdata database and is correct forever
// because WIB has no DST transitions — the SAME reason Go used time.FixedZone.
// This constant is the single source of the offset; the SQL side (wib_date /
// wib_period, `+ interval '7 hours'`) MUST match it (§B.7).

/** The fixed WIB offset in hours (UTC+7, no DST). Single source shared with SQL. */
export const WIB_OFFSET_HOURS = 7;

const WIB_OFFSET_MS = WIB_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// wibFields returns the WIB civil-date components of an instant. We shift the
// instant by +7h and read the UTC components of the shifted value — because WIB
// has no DST this is exact and needs no tzdata lookup.
function wibFields(t: Date): { year: number; month: number; day: number } {
  const shifted = new Date(t.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1, // 1-12
    day: shifted.getUTCDate(),
  };
}

/**
 * date returns the instant of midnight (00:00:00) of the WIB calendar day that
 * instant t falls on. Use it whenever you need the start of "today" for calendar
 * bucketing. (Go returns a WIB-zoned time.Time; a JS Date is an instant, so this
 * is the UTC instant that equals WIB-midnight of that day.)
 */
export function date(t: Date): Date {
  const { year, month, day } = wibFields(t);
  // WIB midnight (year-month-day 00:00 +07:00) as an absolute instant.
  return new Date(Date.UTC(year, month - 1, day) - WIB_OFFSET_MS);
}

/** dateString formats the WIB calendar date of t as "YYYY-MM-DD". */
export function dateString(t: Date): string {
  const { year, month, day } = wibFields(t);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * period formats the WIB calendar month of t as "YYYYMM" — the house-ID month
 * bucket (PREFIX-YYYYMM-NNNN).
 */
export function period(t: Date): string {
  const { year, month } = wibFields(t);
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
  const diffMs = date(to).getTime() - date(from).getTime();
  return Math.round(diffMs / DAY_MS);
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}
