/**
 * WIB (Waktu Indonesia Barat, Asia/Jakarta) calendar-date bucketing.
 *
 * Ported 1:1 from archive/backend-go/internal/core/tz/tz.go.
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
 * dateTimeString formats the WIB wall-clock of t as "YYYY-MM-DD HH:mm:ss" —
 * DISPLAY formatting for a human reader (e.g. a CSV export opened in
 * Jakarta), not the calendar-bucketing this file's header rule governs. An
 * export that rendered `created_at` as raw ISO UTC would read "kemarin
 * 23:30" for a lead created at 06:30 WIB today — a 7-hour reading error, not
 * a rounding nicety.
 */
export function dateTimeString(t: Date): string {
  const shifted = new Date(t.getTime() + OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const h = shifted.getUTCHours();
  const mi = shifted.getUTCMinutes();
  const s = shifted.getUTCSeconds();
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)} ${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
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

/** One ISO week in WIB: its identity keys plus its Monday–Sunday calendar bounds. */
export interface IsoWeek {
  isoYear: number;
  isoWeek: number; // 1..53
  mondayDate: string; // "YYYY-MM-DD" (WIB Monday)
  sundayDate: string; // "YYYY-MM-DD" (WIB Sunday)
}

/**
 * isoWeekOf buckets an instant into the ISO week its WIB calendar date falls in
 * (Monday–Sunday, per M6D R5 / M8-OA-2 weekly cadence).
 *
 * Must agree EXACTLY with the SQL side, which the Monday job computes as
 * `extract(isoyear|week FROM wib_date(...) - (isodow - 1))`
 * (20260813080000_m6d_wrr_job.sql) — Postgres' `week` IS the ISO week. Both
 * therefore key a week the same way, so a week identified in TS and a week
 * identified in SQL are never off by one at a year boundary (ISO week 1 is the
 * week containing the first Thursday, which is why the year is read off the
 * week's Thursday below, not off its Monday).
 */
export function isoWeekOf(t: Date): IsoWeek {
  const { year, month, day } = wibParts(t);
  const civil = Date.UTC(year, month - 1, day);
  // getUTCDay(): 0=Sunday..6=Saturday → 0=Monday..6=Sunday.
  const dow = (new Date(civil).getUTCDay() + 6) % 7;
  const monday = civil - dow * DAY_MS;
  const thursday = new Date(monday + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.floor((thursday.getTime() - jan1) / (7 * DAY_MS)) + 1;
  return {
    isoYear,
    isoWeek,
    mondayDate: ymd(monday),
    sundayDate: ymd(monday + 6 * DAY_MS),
  };
}

/**
 * isoWeekOfDate is isoWeekOf for a "YYYY-MM-DD" WIB calendar date (the form the
 * DB hands back for `date` columns). Invalid input throws — callers validate the
 * shape first and turn it into their own `[...]` message.
 */
export function isoWeekOfDate(ymdStr: string): IsoWeek {
  const ms = Date.parse(`${ymdStr}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new RangeError(`invalid WIB date: ${ymdStr}`);
  }
  // Reconstruct the instant whose WIB civil date is exactly ymdStr.
  return isoWeekOf(new Date(ms - OFFSET_MS));
}

/** addDaysToDate shifts a "YYYY-MM-DD" WIB calendar date by n whole days. */
export function addDaysToDate(ymdStr: string, n: number): string {
  const ms = Date.parse(`${ymdStr}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new RangeError(`invalid WIB date: ${ymdStr}`);
  }
  return ymd(ms + n * DAY_MS);
}

/**
 * daysBetweenDate counts whole calendar days from `fromYmd` to `toYmd`, both
 * "YYYY-MM-DD" WIB dates. Positive when `to` is later; the convention is
 * HALF-OPEN — `daysBetweenDate('2026-01-01', '2026-02-01')` is 31, the number
 * of days in [1 Jan, 1 Feb).
 *
 * Half-open is what makes period arithmetic composable: a period of one month
 * from 1 January covers exactly the days this function counts to its end date,
 * so "how long did it run" and "when does it end" can never disagree by a day.
 * The accrual engine (Gelombang D) divides money by this count, and an
 * off-by-one there is an off-by-one in the books.
 *
 * Both dates are read at WIB midnight, so DST does not exist and the difference
 * is always a whole number of days.
 */
export function daysBetweenDate(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(from)) {
    throw new RangeError(`invalid WIB date: ${fromYmd}`);
  }
  if (Number.isNaN(to)) {
    throw new RangeError(`invalid WIB date: ${toYmd}`);
  }
  return Math.round((to - from) / DAY_MS);
}

/**
 * addMonthsToDate shifts a "YYYY-MM-DD" WIB calendar date by n whole CALENDAR
 * months, clamping to the last day of the target month when the day-of-month
 * does not exist there.
 *
 * This is what "durasi 1 bulan" means to the business and it is NOT 30 days:
 * a service that starts 31 January and runs one month ends 28 February (29 in a
 * leap year), not 2 March. Getting that wrong by a few days per period is not a
 * rounding detail once the accrual engine reads it — every period boundary
 * drifts a little further from the month it is supposed to close in, and D-3
 * locks the books PER MONTH.
 *
 * Clamping (not spilling into the next month) is the same convention the rest of
 * the world writes contracts with: "31 Jan + 1 bulan" is end of February, and
 * two starts that clamp to the same day stay merged rather than crossing over.
 */
export function addMonthsToDate(ymdStr: string, n: number): string {
  const ms = Date.parse(`${ymdStr}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new RangeError(`invalid WIB date: ${ymdStr}`);
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`month shift must be a whole number: ${n}`);
  }
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  // Day 0 of month+1 is the LAST day of that month — how many days the target
  // month actually has, so the clamp needs no table and no leap-year branch.
  const target = new Date(Date.UTC(year, month + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${pad(target.getUTCFullYear(), 4)}-${pad(target.getUTCMonth() + 1, 2)}-${pad(Math.min(day, lastDay), 2)}`;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
