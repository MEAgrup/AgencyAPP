import { describe, it, expect } from "vitest";
import { WIB_OFFSET_HOURS, date, dateString, period, daysBetween } from "./tz.js";

// Mirrors backend/internal/core/tz/tz_test.go.

const utc = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
): Date => new Date(Date.UTC(y, mo - 1, d, h, mi, s));

describe("WIB fixed offset, no DST", () => {
  it("is +7h all year round", () => {
    expect(WIB_OFFSET_HOURS).toBe(7);
    // WIB midnight in July and January map to the same UTC offset (no DST swing):
    // date() of any instant that day is UTC = WIB-midnight - 7h.
    const jul = date(utc(2026, 7, 17, 3, 0, 0));
    expect(jul.getTime()).toBe(Date.UTC(2026, 6, 17) - 7 * 3600 * 1000);
    const jan = date(utc(2026, 1, 15, 3, 0, 0));
    expect(jan.getTime()).toBe(Date.UTC(2026, 0, 15) - 7 * 3600 * 1000);
  });
});

describe("date / dateString bucketing", () => {
  it("crosses UTC midnight into the WIB day", () => {
    // 2026-07-16T18:30:00Z == 2026-07-17 01:30 WIB -> bucket day is 17 Jul.
    expect(dateString(utc(2026, 7, 16, 18, 30, 0))).toBe("2026-07-17");
    expect(date(utc(2026, 7, 16, 18, 30, 0)).getTime()).toBe(
      Date.UTC(2026, 6, 17) - 7 * 3600 * 1000,
    );
  });
  it("stays same day before the UTC boundary", () => {
    // 2026-07-17T05:00:00Z == 2026-07-17 12:00 WIB -> still 17 Jul.
    expect(dateString(utc(2026, 7, 17, 5, 0, 0))).toBe("2026-07-17");
  });
});

describe("period month rollover in WIB", () => {
  it("rolls to next month at WIB midnight", () => {
    // 2026-06-30T17:30:00Z == 2026-07-01 00:30 WIB -> month bucket 202607.
    expect(period(utc(2026, 6, 30, 17, 30, 0))).toBe("202607");
    // 2026-06-30T16:00:00Z == 2026-06-30 23:00 WIB -> still 202606.
    expect(period(utc(2026, 6, 30, 16, 0, 0))).toBe("202606");
  });
});

describe("daysBetween calendar days", () => {
  it("counts WIB calendar days", () => {
    const due = utc(2026, 6, 17); // DATE stored as UTC midnight by the driver
    // 2026-06-20T18:00Z == 2026-06-21 01:00 WIB -> 4 calendar days overdue.
    expect(daysBetween(due, utc(2026, 6, 20, 18, 0, 0))).toBe(4);
    // Before the WIB midnight roll (2026-06-20T10:00Z == 17:00 WIB) it's 3.
    expect(daysBetween(due, utc(2026, 6, 20, 10, 0, 0))).toBe(3);
  });
});
