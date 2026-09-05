/**
 * Shared IDR money type + house formatting (CLAUDE.md #7).
 *
 * Ported 1:1 from archive/backend-go/internal/core/money/money.go. Money is stored as an
 * integer number of *minor units* (hundredths of a rupiah) so all arithmetic is
 * exact — no float rounding ever touches a commission, allocation, or
 * installment total. Postgres `numeric(15,2)` columns round-trip through
 * `parse`/`decimal` without loss (the driver reads `numeric` as a string, never
 * a JS `number`).
 *
 * Representation choice (SUPABASE_MIGRATION_TECH_APPENDIX §B.5): `bigint` for
 * minor units — mirrors Go's `int64` and makes "never float" explicit.
 *
 * House display convention: "Rp. X.XXX.XXX,00" (thousands dot-separated, a
 * literal ",00" suffix — MEA does not track real cents in the UI). This mirrors
 * web-internal/src/lib/money.ts (formatIDR) exactly so the two sides never
 * disagree.
 */

/** Money is an amount in minor units (1/100 rupiah). 900000000n == Rp. 9.000.000,00. */
export type Money = bigint;

/** Thrown when a decimal string cannot be parsed or a result overflows range. */
export class BadAmountError extends Error {
  constructor(message: string) {
    super(`money: ${message}`);
    this.name = 'BadAmountError';
  }
}

// Go's Money is int64; keep the same bound so overflow behaviour matches.
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function fitsInt64(v: bigint): boolean {
  return v >= INT64_MIN && v <= INT64_MAX;
}

/**
 * Parse reads a DECIMAL string such as "9000000.00" (or "9000000") into Money.
 * Up to two fractional digits are honoured; more are rejected rather than
 * silently truncated. Bare sign/dot strings ("", "-", "+", ".", "-.") are
 * rejected — they must NOT silently parse as 0.
 */
export function parse(s: string): Money {
  s = s.trim();
  if (s === '') {
    throw new BadAmountError('invalid amount');
  }
  let neg = false;
  if (s[0] === '-') {
    neg = true;
    s = s.slice(1);
  } else if (s[0] === '+') {
    s = s.slice(1);
  }
  let intPart = s;
  let fracPart = '';
  const dot = s.indexOf('.');
  if (dot >= 0) {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
  }
  // Require at least one digit somewhere: reject "", "-", "+", ".", "-.".
  if (intPart === '' && fracPart === '') {
    throw new BadAmountError(`invalid amount: ${JSON.stringify(s)}`);
  }
  if (intPart === '') {
    intPart = '0';
  }
  if (fracPart.length > 2) {
    throw new BadAmountError(`too many decimal places in ${JSON.stringify(s)}`);
  }
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) {
    throw new BadAmountError(`invalid amount: ${JSON.stringify(s)}`);
  }
  // Pad fraction to exactly two digits (minor units).
  const frac = (fracPart + '00').slice(0, 2);
  const rupiah = BigInt(intPart);
  let minor = rupiah * 100n + BigInt(frac);
  if (neg) {
    minor = -minor;
  }
  if (!fitsInt64(minor)) {
    throw new BadAmountError(`overflow ${JSON.stringify(s)}`);
  }
  return minor;
}

/** decimal renders Money as a DECIMAL(15,2) string ("9000000.00") for storage. */
export function decimal(m: Money): string {
  let neg = '';
  let v = m;
  if (v < 0n) {
    neg = '-';
    v = -v;
  }
  const frac = (v % 100n).toString().padStart(2, '0');
  return `${neg}${v / 100n}.${frac}`;
}

/**
 * format renders Money in the house IDR convention "Rp. X.XXX.XXX,00".
 * Matches web-internal/src/lib/money.ts (whole rupiah grouped by '.', literal
 * ",00"). Cents are dropped from display by design.
 */
export function format(m: Money): string {
  let neg = '';
  let v = m;
  if (v < 0n) {
    neg = '-';
    v = -v;
  }
  const rupiah = (v / 100n).toString();
  return `${neg}Rp. ${groupThousands(rupiah)},00`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * percentOf returns pct percent of base, rounded half-up to a whole rupiah
 * (the result is always an exact multiple of 100 minor units). pctNumerator and
 * pctScale express the percentage exactly: value = pctNumerator / 10^pctScale.
 * e.g. 4.5% -> (45, 1); 10% -> (10, 0). All arithmetic is exact via bigint; a
 * result that cannot be represented in a Money (int64 minor units) throws
 * BadAmountError rather than silently wrapping.
 */
export function percentOf(base: Money, pctNumerator: bigint, pctScale: number): Money {
  // commission_rupiah = base_minor * pct / (100 * 100)  where pct = num/10^scale
  //                   = base_minor * num / (10000 * 10^scale)
  const num = base * pctNumerator;
  const den = 10000n * pow10(pctScale);
  const rupiah = roundHalfUp(num, den);
  const minor = rupiah * 100n;
  if (!fitsInt64(minor)) {
    throw new BadAmountError('commission result out of range');
  }
  return minor;
}

/**
 * mul returns m multiplied by the whole factor n, guarding against int64
 * overflow: a product that cannot be represented in Money (minor units) throws
 * BadAmountError rather than silently wrapping. Used by the pricing calculator
 * for quantity × unit price.
 */
export function mul(m: Money, n: bigint): Money {
  const prod = m * n;
  if (!fitsInt64(prod)) {
    throw new BadAmountError('product out of range');
  }
  return prod;
}

/**
 * proRata returns `amount * numerator / denominator`, rounded half-up to a whole
 * rupiah (the result is always an exact multiple of 100 minor units, like
 * percentOf). All arithmetic is exact via bigint — used to recognize commission
 * achievement on the actually-verified fraction of a deal (M0 §5 / M5 Amount
 * Verified) and to split it by allocation basis points. `numerator`/`amount`
 * must be ≥ 0 and `denominator` > 0; a result out of int64 range throws.
 */
export function proRata(amount: Money, numerator: bigint, denominator: bigint): Money {
  if (denominator <= 0n) {
    throw new BadAmountError('proRata denominator must be positive');
  }
  if (amount < 0n || numerator < 0n) {
    throw new BadAmountError('proRata operands must be non-negative');
  }
  // rupiah = round_half_up( amount_minor * numerator / (denominator * 100) ).
  // half-up for non-negatives: floor((2*num + den) / (2*den)).
  const num = amount * numerator;
  const den = denominator * 100n;
  const rupiah = (2n * num + den) / (2n * den);
  const minor = rupiah * 100n;
  if (!fitsInt64(minor)) {
    throw new BadAmountError('proRata result out of range');
  }
  return minor;
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
  let n = num < 0n ? -num : num;
  const half = den >> 1n; // den is even (multiple of 10000); exact
  n = n + half;
  let q = n / den; // bigint division truncates toward zero; operands are >= 0 here
  if (neg) {
    q = -q;
  }
  return q;
}
