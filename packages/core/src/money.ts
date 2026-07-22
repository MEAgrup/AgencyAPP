// Shared IDR money type + house formatting (CLAUDE.md #7).
//
// Ported 1:1 from backend/internal/core/money/money.go (SUPABASE_MIGRATION_TECH_APPENDIX
// §B.5). Money is stored as an integer number of *minor units* (hundredths of a
// rupiah) so all arithmetic is exact — no float rounding ever touches a
// commission, allocation, or installment total. Postgres numeric(15,2) columns
// (read as strings by the driver) round-trip through parse/decimal without loss.
//
// The Go original is `int64` minor units; here we use `bigint` to keep the
// "never a float" property explicit (Go comment) while still enforcing the same
// int64 range — a result that would overflow int64 throws BadAmountError, exactly
// as the Go PercentOf/Mul return ErrBadAmount rather than silently wrapping.
//
// House display convention: "Rp. X.XXX.XXX,00" (thousands dot-separated, a literal
// ",00" suffix — MEA does not track real cents in the UI). This mirrors
// web-internal/src/lib/money.ts exactly so the two sides never disagree.

/** Money is an amount in minor units (1/100 rupiah). 900000000n == Rp. 9.000.000,00. */
export type Money = bigint;

/** BadAmountError mirrors money.ErrBadAmount (invalid parse or out-of-range result). */
export class BadAmountError extends Error {
  constructor(message: string) {
    super(`money: ${message}`);
    this.name = "BadAmountError";
  }
}

// int64 bounds — Money is conceptually int64 minor units (Go `type Money int64`).
const I64_MAX = 2n ** 63n - 1n;
const I64_MIN = -(2n ** 63n);

function fitsInt64(v: bigint): boolean {
  return v >= I64_MIN && v <= I64_MAX;
}

/**
 * parse reads a DECIMAL string such as "9000000.00" (or "9000000") into Money.
 * Up to two fractional digits are honoured; more are rejected rather than
 * silently truncated. Throws BadAmountError on any invalid input.
 */
export function parse(input: string): Money {
  const s0 = input.trim();
  if (s0 === "") {
    throw new BadAmountError("invalid amount");
  }
  let s = s0;
  let neg = false;
  if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  } else if (s[0] === "+") {
    s = s.slice(1);
  }

  let intPart = s;
  let fracPart = "";
  const dot = s.indexOf(".");
  if (dot >= 0) {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
  }
  // Require at least one digit somewhere: reject "", "-", "+", ".", "-.".
  if (intPart === "" && fracPart === "") {
    throw new BadAmountError(`invalid amount: ${JSON.stringify(s0)}`);
  }
  if (intPart === "") {
    intPart = "0";
  }
  if (fracPart.length > 2) {
    throw new BadAmountError(`too many decimal places in ${JSON.stringify(s0)}`);
  }
  const digits = intPart + fracPart;
  if (!/^[0-9]+$/.test(digits)) {
    throw new BadAmountError(`invalid amount: ${JSON.stringify(s0)}`);
  }
  // Pad fraction to exactly two digits (minor units).
  const frac = (fracPart + "00").slice(0, 2);
  let minor = BigInt(intPart) * 100n + BigInt(frac);
  if (neg) {
    minor = -minor;
  }
  if (!fitsInt64(minor)) {
    throw new BadAmountError(`overflow ${JSON.stringify(s0)}`);
  }
  return minor;
}

/** decimal renders Money as a DECIMAL(15,2) string ("9000000.00") for storage. */
export function decimal(m: Money): string {
  let neg = "";
  let v = m;
  if (v < 0n) {
    neg = "-";
    v = -v;
  }
  const rupiah = v / 100n;
  const cents = v % 100n;
  return `${neg}${rupiah}.${cents.toString().padStart(2, "0")}`;
}

/**
 * format renders Money in the house IDR convention "Rp. X.XXX.XXX,00".
 * Matches web-internal/src/lib/money.ts (whole rupiah grouped by '.', literal
 * ",00"). Cents are dropped from display by design.
 */
export function format(m: Money): string {
  let neg = "";
  let v = m;
  if (v < 0n) {
    neg = "-";
    v = -v;
  }
  const rupiah = (v / 100n).toString();
  return `${neg}Rp. ${groupThousands(rupiah)},00`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * percentOf returns pct percent of base, rounded half-up to a whole rupiah
 * (the result is always an exact multiple of 100 minor units). pctNumerator and
 * pctScale express the percentage exactly: value = pctNumerator / 10^pctScale.
 * e.g. 4.5% -> (45, 1); 10% -> (10, 0). A result that cannot be represented in a
 * Money (int64 minor units) throws BadAmountError rather than silently wrapping.
 */
export function percentOf(base: Money, pctNumerator: bigint | number, pctScale: number): Money {
  // commission_rupiah = base_minor * pct / (100 * 100)  where pct = num/10^scale
  //                   = base_minor * num / (10000 * 10^scale)
  const num = base * BigInt(pctNumerator);
  const den = 10000n * pow10(pctScale);
  const rupiah = roundHalfUp(num, den);
  const minor = rupiah * 100n;
  if (!fitsInt64(minor)) {
    throw new BadAmountError("commission result out of range");
  }
  return minor;
}

/**
 * mul returns m multiplied by the whole factor n, guarding against int64
 * overflow: a product that cannot be represented in Money (minor units) throws
 * BadAmountError rather than silently wrapping. Used by the pricing calculator
 * for quantity × unit price.
 */
export function mul(m: Money, n: bigint | number): Money {
  const prod = m * BigInt(n);
  if (!fitsInt64(prod)) {
    throw new BadAmountError("product out of range");
  }
  return prod;
}

function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) {
    r *= 10n;
  }
  return r;
}

/**
 * roundHalfUp returns round(num/den) with .5 rounding away from zero. den > 0
 * and even (a multiple of 10000).
 */
function roundHalfUp(num: bigint, den: bigint): bigint {
  const neg = num < 0n;
  let n = neg ? -num : num;
  const half = den / 2n; // den is even (multiple of 10000); exact
  n = n + half;
  let q = n / den;
  if (neg) {
    q = -q;
  }
  return q;
}
