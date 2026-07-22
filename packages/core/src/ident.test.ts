import { describe, it, expect } from "vitest";
import { ID_PATTERN, period, formatId, parseId } from "./ident.js";

// Mirrors the format/WIB-bucket assertions of
// backend/internal/core/ident/ident_test.go. The gap-free/no-duplicate/rollback-
// safe allocation is the SQL ident_next function, exercised by pgTAP (§G); here we
// pin the id SHAPE and the WIB month bucket that both sides must agree on.

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi));

describe("format + sequence", () => {
  it("renders PREFIX-YYYYMM-NNNN, zero-padded", () => {
    const at = utc(2026, 7, 1);
    const ids = [1, 2, 3, 4, 5].map((n) => formatId("TST", at, n));
    expect(ids).toEqual([
      "TST-202607-0001",
      "TST-202607-0002",
      "TST-202607-0003",
      "TST-202607-0004",
      "TST-202607-0005",
    ]);
    for (const id of ids) expect(ID_PATTERN.test(id)).toBe(true);
  });
});

describe("month bucket is WIB (DECISIONS O20)", () => {
  it("2026-06-30T17:30Z buckets to 202607 (00:30 WIB, next month)", () => {
    // An instant late in a UTC day is already the next calendar month in WIB (+7).
    expect(period(utc(2026, 6, 30, 17, 30))).toBe("202607");
    expect(formatId("TST", utc(2026, 6, 30, 17, 30), 1)).toBe("TST-202607-0001");
  });
  it("two instants in the same WIB day share the period", () => {
    // 2026-07-11T18:30Z == 2026-07-12 01:30 WIB; 2026-07-12T10:00Z == 17:00 WIB.
    expect(formatId("TST", utc(2026, 7, 11, 18, 30), 1)).toBe("TST-202607-0001");
    expect(formatId("TST", utc(2026, 7, 12, 10, 0), 2)).toBe("TST-202607-0002");
  });
});

describe("parseId", () => {
  it("round-trips a well-formed id", () => {
    expect(parseId("CLI-202607-0042")).toEqual({ prefix: "CLI", period: "202607", sequence: 42 });
  });
  it("returns null for malformed ids", () => {
    for (const bad of ["", "CLI-2026-0001", "CLI-202607-1", "202607-0001", "cli 202607 0001"]) {
      expect(parseId(bad)).toBeNull();
    }
  });
});
