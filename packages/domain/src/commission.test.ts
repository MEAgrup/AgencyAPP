/**
 * Unit tests for the commission-rule grammar (DECISIONS O14).
 *
 * `parseCommissionRule` / `computeCommission` are also covered through their
 * `sales` re-export in sales.test.ts; what is tested HERE is the predicate the
 * MSL write door depends on — `isValidCommissionRule` must accept exactly the
 * strings the calculator can price, and reject everything else. Any drift
 * between the two would put the catalog gate and the calculator back out of
 * step, which is the defect this module exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import {
  BadCommissionRuleError,
  computeCommission,
  isValidCommissionRule,
  parseCommissionRule,
} from './commission';
import { money } from '@cdps/core';

const VALID = [
  '0% of standard price', // the O24 house value on all 32 seeded services
  '10% of standard price',
  '4.5% of standard price',
  '100% of standard price',
  'flat Rp 0',
  'flat Rp 500000',
  'flat Rp 500.000',
  'flat Rp 1.250.000',
  '  10% of standard price  ', // parser trims
];

// Every one of these is something a human could plausibly type into the
// free-text "Aturan Komisi" field. Before the write gate they all persisted and
// then threw on the next quote — "10%" is the shape that broke PRSP-202608-0002.
const INVALID = [
  '',
  '10%',
  '10 %  of standard price',
  '10 persen',
  '10% dari harga standar',
  'flat 500000',
  'flat Rp 500.00', // malformed thousands grouping
  'Flat Rp 500.000', // case matters
  'konten',
  '10% of standard price per bulan',
];

describe('isValidCommissionRule', () => {
  it.each(VALID)('accepts %j', (rule) => {
    expect(isValidCommissionRule(rule)).toBe(true);
    expect(() => parseCommissionRule(rule)).not.toThrow();
  });

  it.each(INVALID)('rejects %j', (rule) => {
    expect(isValidCommissionRule(rule)).toBe(false);
    expect(() => parseCommissionRule(rule)).toThrow(BadCommissionRuleError);
  });

  it('agrees with parseCommissionRule on every input (no drift)', () => {
    for (const rule of [...VALID, ...INVALID]) {
      let parses = true;
      try {
        parseCommissionRule(rule);
      } catch {
        parses = false;
      }
      expect(isValidCommissionRule(rule)).toBe(parses);
    }
  });
});

describe('BadCommissionRuleError', () => {
  it('carries the offending rule for the server-side log line', () => {
    try {
      parseCommissionRule('10%');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadCommissionRuleError);
      expect((err as BadCommissionRuleError).rule).toBe('10%');
    }
  });
});

describe('computeCommission', () => {
  it('computes a percentage of the deal value, half-up to whole rupiah', () => {
    const r = parseCommissionRule('4.5% of standard price');
    expect(computeCommission(r, money.parse('1000000'))).toBe(money.parse('45000'));
  });

  it('returns the flat amount regardless of the deal value', () => {
    const r = parseCommissionRule('flat Rp 500.000');
    expect(computeCommission(r, money.parse('9000000'))).toBe(money.parse('500000'));
  });

  it('yields Rp 0 for the O24 house rule', () => {
    const r = parseCommissionRule('0% of standard price');
    expect(computeCommission(r, money.parse('9000000'))).toBe(0n);
  });
});
