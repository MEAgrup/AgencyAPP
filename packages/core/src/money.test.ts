// Ported 1:1 from archive/backend-go/internal/core/money/money_test.go.
import { describe, expect, it } from 'vitest';
import { BadAmountError, decimal, format, mul, parse, percentOf, proRata, type Money } from './money';

const rp = (s: string): Money => parse(s);

describe('parse and decimal', () => {
  const cases: Array<{ in: string; minor: Money; dec: string }> = [
    { in: '9000000.00', minor: 900000000n, dec: '9000000.00' },
    { in: '6000000.00', minor: 600000000n, dec: '6000000.00' },
    { in: '6900000.00', minor: 690000000n, dec: '6900000.00' },
    { in: '20000000', minor: 2000000000n, dec: '20000000.00' },
    { in: '0', minor: 0n, dec: '0.00' },
    { in: '0.5', minor: 50n, dec: '0.50' },
    { in: '1234567.89', minor: 123456789n, dec: '1234567.89' },
    { in: '-45000000.00', minor: -4500000000n, dec: '-45000000.00' },
  ];
  it.each(cases)('parse($in)', (c) => {
    const got = parse(c.in);
    expect(got).toBe(c.minor);
    expect(decimal(got)).toBe(c.dec);
  });
});

describe('parse rejects', () => {
  // Includes bare sign/dot strings that must NOT silently parse as 0.
  const bad = ['', 'abc', '1.234', '1..2', '1,000', 'Rp5', '-', '+', '.', '-.', '+.'];
  it.each(bad)('parse(%j) throws', (in_) => {
    expect(() => parse(in_)).toThrow(BadAmountError);
  });
});

describe('format', () => {
  const cases: Array<{ minor: Money; want: string }> = [
    { minor: 900000000n, want: 'Rp. 9.000.000,00' },
    { minor: 690000000n, want: 'Rp. 6.900.000,00' },
    { minor: 2190000000n, want: 'Rp. 21.900.000,00' }, // Alpha Digital deal total
    { minor: 4500000000n, want: 'Rp. 45.000.000,00' },
    { minor: 50000000n, want: 'Rp. 500.000,00' },
    { minor: 0n, want: 'Rp. 0,00' },
    { minor: 100000n, want: 'Rp. 1.000,00' },
    { minor: 99900000n, want: 'Rp. 999.000,00' },
    { minor: -4500000000n, want: '-Rp. 45.000.000,00' },
  ];
  it.each(cases)('format($minor)', (c) => {
    expect(format(c.minor)).toBe(c.want);
  });
});

describe('percentOf', () => {
  const cases: Array<{ name: string; base: Money; num: bigint; scale: number; want: Money }> = [
    { name: '5% of 9.000.000', base: rp('9000000.00'), num: 5n, scale: 0, want: rp('450000.00') },
    { name: '4% of 7.500.000', base: rp('7500000.00'), num: 4n, scale: 0, want: rp('300000.00') },
    { name: '2.5% of 1.000.000', base: rp('1000000.00'), num: 25n, scale: 1, want: rp('25000.00') },
    { name: '10% of 21.900.000', base: rp('21900000.00'), num: 10n, scale: 0, want: rp('2190000.00') },
    // Half-up rounding to whole rupiah: 1% of 12.345.678 = 123456.78 -> 123457.
    { name: '1% of 12.345.678 rounds half-up', base: rp('12345678.00'), num: 1n, scale: 0, want: rp('123457.00') },
    // Exactly .5 rounds away from zero: 0.5% of 12.345.700 = 61728.5 -> 61729.
    { name: '0.5 rounds up', base: rp('12345700.00'), num: 5n, scale: 1, want: rp('61729.00') },
  ];
  it.each(cases)('$name', (c) => {
    expect(percentOf(c.base, c.num, c.scale)).toBe(c.want);
  });
});

describe('mul', () => {
  const cases: Array<{ base: Money; n: bigint; want: Money }> = [
    { base: rp('150000.00'), n: 5n, want: rp('750000.00') },
    { base: rp('50000.00'), n: 10n, want: rp('500000.00') },
    { base: rp('10000.00'), n: 300n, want: rp('3000000.00') },
    { base: rp('1000000.00'), n: 0n, want: 0n },
  ];
  it.each(cases)('mul($base, $n)', (c) => {
    expect(mul(c.base, c.n)).toBe(c.want);
  });
});

describe('proRata', () => {
  const cases: Array<{ name: string; amount: Money; num: bigint; den: bigint; want: Money }> = [
    // Full fraction attributes the whole amount, exactly (num == den).
    { name: 'full fraction is exact', amount: rp('2190000.00'), num: 45000000n, den: 45000000n, want: rp('2190000.00') },
    // 1/3 of 45.000.000 verified -> a third of the commission, half-up whole rupiah.
    { name: 'one third of 2.190.000', amount: rp('2190000.00'), num: 15000000n, den: 45000000n, want: rp('730000.00') },
    // Allocation split: 60% of 730.000 = 438.000.
    { name: '60% allocation share', amount: rp('730000.00'), num: 6000n, den: 10000n, want: rp('438000.00') },
    // Half-up to whole rupiah: 1/3 of 1.000.000 = 333333.33 -> 333333.
    { name: 'rounds half-up to rupiah', amount: rp('1000000.00'), num: 1n, den: 3n, want: rp('333333.00') },
    { name: 'zero numerator -> zero', amount: rp('2190000.00'), num: 0n, den: 45000000n, want: 0n },
  ];
  it.each(cases)('$name', (c) => {
    expect(proRata(c.amount, c.num, c.den)).toBe(c.want);
  });

  it('rejects a non-positive denominator', () => {
    expect(() => proRata(rp('100.00'), 1n, 0n)).toThrow(BadAmountError);
  });
});

describe('overflow guards', () => {
  it('mul with overflowing product throws', () => {
    const base = parse('9999999999999.99');
    expect(() => mul(base, 1000000000n)).toThrow(BadAmountError);
  });

  it('percentOf with overflowing result throws', () => {
    // An absurd percentage whose result cannot fit int64 minor units must
    // throw, not silently wrap to a negative amount.
    const base = parse('9999999999999.99');
    expect(() => percentOf(base, 9000000000000000000n, 0)).toThrow(BadAmountError);
  });
});
