// Ported 1:1 from backend/internal/core/tz/tz_test.go.
import { describe, expect, it } from 'vitest';
import { WIB_OFFSET_HOURS, addDaysToDate, dateString, daysBetween, isoWeekOf, isoWeekOfDate, period } from './tz';

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

describe('isoWeekOf / isoWeekOfDate — WIB ISO weeks (M6D R5, M8-OA-2)', () => {
  it('buckets an instant into its WIB Monday–Sunday week', () => {
    // 2026-08-14 is a Friday; its ISO week runs Mon 10th – Sun 16th.
    const w = isoWeekOf(utc(2026, 8, 14, 3, 0));
    expect(w.mondayDate).toBe('2026-08-10');
    expect(w.sundayDate).toBe('2026-08-16');
    expect([w.isoYear, w.isoWeek]).toEqual([2026, 33]);
  });

  it('uses the WIB calendar date, not the UTC one, at the midnight roll', () => {
    // 2026-08-09T18:00Z == Mon 2026-08-10 01:00 WIB -> the NEXT week (W33),
    // even though it is still Sunday in UTC.
    expect(isoWeekOf(utc(2026, 8, 9, 18, 0)).mondayDate).toBe('2026-08-10');
    // 2026-08-09T16:00Z == Sun 2026-08-09 23:00 WIB -> still W32.
    expect(isoWeekOf(utc(2026, 8, 9, 16, 0)).mondayDate).toBe('2026-08-03');
  });

  it('reads the ISO year off the week Thursday at a year boundary', () => {
    // Mon 2025-12-29 .. Sun 2026-01-04 is ISO 2026-W01 (its Thursday is 1 Jan).
    const w = isoWeekOfDate('2025-12-29');
    expect([w.isoYear, w.isoWeek]).toEqual([2026, 1]);
    expect(w.sundayDate).toBe('2026-01-04');
    // Thu 2027-12-30 sits in ISO 2027-W52, not 2028-W01.
    const v = isoWeekOfDate('2027-12-30');
    expect([v.isoYear, v.isoWeek]).toEqual([2027, 52]);
  });

  it('isoWeekOfDate/addDaysToDate walk weeks a Monday at a time', () => {
    expect(addDaysToDate('2026-08-03', 7)).toBe('2026-08-10');
    expect(addDaysToDate('2026-02-28', 1)).toBe('2026-03-01'); // 2026 is not a leap year
    // 2026 has 53 ISO weeks: Mon 28 Dec 2026 is W53, and the next Monday opens 2027-W01.
    expect(isoWeekOfDate('2026-12-28').isoWeek).toBe(53);
    const next = isoWeekOfDate(addDaysToDate('2026-12-28', 7));
    expect([next.isoYear, next.isoWeek]).toEqual([2027, 1]);
  });
});
