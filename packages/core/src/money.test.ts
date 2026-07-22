import { describe, it, expect } from "vitest";
import { parse, decimal, format, percentOf, mul, BadAmountError, type Money } from "./money.js";

// Mirrors backend/internal/core/money/money_test.go.

describe("parse + decimal", () => {
  const cases: Array<[string, Money, string]> = [
    ["9000000.00", 900000000n, "9000000.00"],
    ["6000000.00", 600000000n, "6000000.00"],
    ["6900000.00", 690000000n, "6900000.00"],
    ["20000000", 2000000000n, "20000000.00"],
    ["0", 0n, "0.00"],
    ["0.5", 50n, "0.50"],
    ["1234567.89", 123456789n, "1234567.89"],
    ["-45000000.00", -4500000000n, "-45000000.00"],
  ];
  it.each(cases)("parse(%s)", (input, minor, dec) => {
    const got = parse(input);
    expect(got).toBe(minor);
    expect(decimal(got)).toBe(dec);
  });
});

describe("parse rejects", () => {
  // Includes bare sign/dot strings that must NOT silently parse as 0.
  const bad = ["", "abc", "1.234", "1..2", "1,000", "Rp5", "-", "+", ".", "-.", "+."];
  it.each(bad)("rejects %j", (input) => {
    expect(() => parse(input)).toThrow(BadAmountError);
  });
});

describe("format", () => {
  const cases: Array<[Money, string]> = [
    [900000000n, "Rp. 9.000.000,00"],
    [690000000n, "Rp. 6.900.000,00"],
    [2190000000n, "Rp. 21.900.000,00"], // Alpha Digital deal total
    [4500000000n, "Rp. 45.000.000,00"],
    [50000000n, "Rp. 500.000,00"],
    [0n, "Rp. 0,00"],
    [100000n, "Rp. 1.000,00"],
    [99900000n, "Rp. 999.000,00"],
    [-4500000000n, "-Rp. 45.000.000,00"],
  ];
  it.each(cases)("format(%s)", (minor, want) => {
    expect(format(minor)).toBe(want);
  });
});

describe("percentOf", () => {
  const rp = (s: string) => parse(s);
  const cases: Array<[string, Money, bigint, number, Money]> = [
    ["5% of 9.000.000", rp("9000000.00"), 5n, 0, rp("450000.00")],
    ["4% of 7.500.000", rp("7500000.00"), 4n, 0, rp("300000.00")],
    ["2.5% of 1.000.000", rp("1000000.00"), 25n, 1, rp("25000.00")],
    ["10% of 21.900.000", rp("21900000.00"), 10n, 0, rp("2190000.00")],
    // Half-up rounding to whole rupiah: 1% of 12.345.678 = 123456.78 -> 123457.
    ["1% of 12.345.678 rounds half-up", rp("12345678.00"), 1n, 0, rp("123457.00")],
    // Exactly .5 rounds away from zero: 0.5% of 12.345.700 = 61728.5 -> 61729.
    ["0.5 rounds up", rp("12345700.00"), 5n, 1, rp("61729.00")],
  ];
  it.each(cases)("%s", (_name, base, num, scale, want) => {
    expect(percentOf(base, num, scale)).toBe(want);
  });
});

describe("mul", () => {
  const rp = (s: string) => parse(s);
  const cases: Array<[Money, bigint, Money]> = [
    [rp("150000.00"), 5n, rp("750000.00")],
    [rp("50000.00"), 10n, rp("500000.00")],
    [rp("10000.00"), 300n, rp("3000000.00")],
    [rp("1000000.00"), 0n, 0n],
  ];
  it.each(cases)("mul(%s, %s)", (base, n, want) => {
    expect(mul(base, n)).toBe(want);
  });
});

describe("overflow guards", () => {
  it("mul overflow throws", () => {
    const base = parse("9999999999999.99");
    expect(() => mul(base, 1000000000n)).toThrow(BadAmountError);
  });
  it("percentOf overflow throws", () => {
    const base = parse("9999999999999.99");
    expect(() => percentOf(base, 9000000000000000000n, 0)).toThrow(BadAmountError);
  });
});
