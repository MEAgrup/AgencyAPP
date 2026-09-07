// Ported 1:1 from archive/backend-go/internal/core/tz/tz_test.go.
import { describe, expect, it } from 'vitest';
import { WIB_OFFSET_HOURS, addDaysToDate, addMonthsToDate, dateString, dateTimeString, daysBetween, isoWeekOf, isoWeekOfDate, period } from './tz';

// Helper: build a UTC instant the way the Go tests do (time.Date(..., time.UTC)).
const utc = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));

describe('WIB fixed offset, no DST', () => {
  it('is UTC+7', () => {
    expect(WIB_OFFSET_HOURS).toBe(7);
  });
});

describe('date / dateString cross-midnight bucket', () => {
  it('2026-07-16T18:30Z is 2026-07-17 in WIB', () => {
    // 2026-07-16T18:30:00Z == 2026-07-17 01:30 WIB -> bucket day is 17 Jul.
    expect(dateString(utc(2026, 7, 16, 18, 30))).toBe('2026-07-17');
  });

  it('2026-07-17T05:00Z is still 2026-07-17 in WIB', () => {
    // 2026-07-17T05:00:00Z == 2026-07-17 12:00 WIB -> still 17 Jul.
    expect(dateString(utc(2026, 7, 17, 5, 0))).toBe('2026-07-17');
  });
});

describe('dateTimeString (E1 export display formatting)', () => {
  it('formats the full WIB wall-clock, not just the date', () => {
    // 2026-09-01T16:30:00Z == 2026-09-01 23:30:00 WIB.
    expect(dateTimeString(utc(2026, 9, 1, 16, 30))).toBe('2026-09-01 23:30:00');
  });

  it('crosses midnight into the next WIB day, same as dateString', () => {
    // 2026-07-16T18:30:00Z == 2026-07-17 01:30:00 WIB.
    expect(dateTimeString(utc(2026, 7, 16, 18, 30))).toBe('2026-07-17 01:30:00');
  });
});

describe('period month rollover in WIB', () => {
  it('2026-06-30T17:30Z rolls into 202607', () => {
    // 2026-06-30T17:30:00Z == 2026-07-01 00:30 WIB -> month bucket 202607.
    expect(period(utc(2026, 6, 30, 17, 30))).toBe('202607');
  });

  it('2026-06-30T16:00Z is still 202606', () => {
    // 2026-06-30T16:00:00Z == 2026-06-30 23:00 WIB -> still 202606.
    expect(period(utc(2026, 6, 30, 16, 0))).toBe('202606');
  });
});

describe('ISO week (WIB, Monday–Sunday)', () => {
  it('buckets an instant into its WIB ISO week with Monday/Sunday bounds', () => {
    // 2026-08-12 05:00 WIB (from 2026-08-11T22:00Z) is ISO 2026-W33 (Mon 10 Aug).
    const w = isoWeekOf(utc(2026, 8, 11, 22, 0));
    expect([w.isoYear, w.isoWeek]).toEqual([2026, 33]);
    expect(w.mondayDate).toBe('2026-08-10');
    expect(w.sundayDate).toBe('2026-08-16');
  });

  it('isoWeekOfDate keys a "YYYY-MM-DD" WIB date; Monday is its own Monday', () => {
    const w = isoWeekOfDate('2026-08-03'); // a Monday → ISO 2026-W32
    expect([w.isoYear, w.isoWeek]).toEqual([2026, 32]);
    expect(w.mondayDate).toBe('2026-08-03');
    // A mid-week date resolves to the SAME week's Monday.
    expect(isoWeekOfDate('2026-08-06').mondayDate).toBe('2026-08-03');
  });

  it('keys ISO week 1 by the week Thursday at a year boundary', () => {
    // 2027-01-01 is a Friday → still ISO 2026-W53 (Mon 28 Dec 2026).
    const w = isoWeekOfDate('2027-01-01');
    expect([w.isoYear, w.isoWeek]).toEqual([2026, 53]);
    expect(w.mondayDate).toBe('2026-12-28');
  });

  it('addDaysToDate shifts a WIB calendar date by whole days', () => {
    expect(addDaysToDate('2026-08-03', 7)).toBe('2026-08-10');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('daysBetween calendar days', () => {
  it('counts WIB calendar days, crossing WIB midnight', () => {
    // Due 2026-06-17 (DATE stored as UTC midnight by the driver), "now"
    // 2026-06-20T18:00Z == 2026-06-21 01:00 WIB -> 4 calendar days overdue.
    const due = utc(2026, 6, 17);
    expect(daysBetween(due, utc(2026, 6, 20, 18, 0))).toBe(4);
    // Before the WIB midnight roll (2026-06-20T10:00Z == 17:00 WIB) it's 3.
    expect(daysBetween(due, utc(2026, 6, 20, 10, 0))).toBe(3);
  });
});

describe('addMonthsToDate', () => {
  it('keeps the same day-of-month when that day exists in the target month', () => {
    expect(addMonthsToDate('2026-07-01', 1)).toBe('2026-08-01');
    expect(addMonthsToDate('2026-01-15', 6)).toBe('2026-07-15');
    expect(addMonthsToDate('2026-03-31', 3)).toBe('2026-06-30'); // June has 30
  });

  it('CLAMPS to the last day when the day does not exist — 31 Jan + 1 bulan is end of Feb, not 2 Mar', () => {
    // This is the whole reason the helper exists: +30 days would say 2026-03-02.
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonthsToDate('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('crosses the year boundary, forwards and backwards', () => {
    expect(addMonthsToDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsToDate('2026-12-31', 12)).toBe('2027-12-31');
    expect(addMonthsToDate('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('is a no-op for 0 and rejects a fractional shift or a bad date', () => {
    expect(addMonthsToDate('2026-07-01', 0)).toBe('2026-07-01');
    expect(() => addMonthsToDate('2026-07-01', 1.5)).toThrow(RangeError);
    expect(() => addMonthsToDate('bukan-tanggal', 1)).toThrow(RangeError);
  });

  it('differs from 30-day arithmetic exactly where the business cares — a 12-month contract', () => {
    // 12 months of 30 days lands 5 days early and in the wrong month-end.
    expect(addMonthsToDate('2026-01-01', 12)).toBe('2027-01-01');
    expect(addDaysToDate('2026-01-01', 360)).toBe('2026-12-27');
  });
});
