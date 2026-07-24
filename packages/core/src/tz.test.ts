// Ported 1:1 from backend/internal/core/tz/tz_test.go.
import { describe, expect, it } from 'vitest';
import { WIB_OFFSET_HOURS, dateString, daysBetween, period } from './tz';

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
