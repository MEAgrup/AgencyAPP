import { describe, expect, it } from 'vitest';
import { compose, parse } from './CommissionRuleInput';

// Mirrors packages/domain/src/sales.ts's parseCommissionRule regexes exactly —
// this test's whole point is proving the two never drift apart.
const RE_PCT = /^(\d+)(?:\.(\d+))?% of standard price$/;
const RE_FLAT = /^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$/;

describe('CommissionRuleInput compose', () => {
  it('composes a percent rule the server regex accepts', () => {
    expect(compose('percent', '10')).toBe('10% of standard price');
    expect(RE_PCT.test(compose('percent', '10'))).toBe(true);
  });

  it('composes a decimal percent rule the server regex accepts', () => {
    expect(compose('percent', '2.5')).toBe('2.5% of standard price');
    expect(RE_PCT.test(compose('percent', '2.5'))).toBe(true);
  });

  it('composes a flat rule the server regex accepts', () => {
    expect(compose('flat', '500000')).toBe('flat Rp 500000');
    expect(RE_FLAT.test(compose('flat', '500000'))).toBe(true);
  });

  it('empty number composes to empty string (leave-blank = standard MSL rule)', () => {
    expect(compose('percent', '')).toBe('');
    expect(compose('flat', '')).toBe('');
  });
});

describe('CommissionRuleInput parse', () => {
  it('parses a percent rule back to its number', () => {
    expect(parse('10% of standard price')).toEqual({ mode: 'percent', number: '10' });
  });

  it('parses a decimal percent rule back to its number', () => {
    expect(parse('2.5% of standard price')).toEqual({ mode: 'percent', number: '2.5' });
  });

  it('parses a plain-digit flat rule back to its number', () => {
    expect(parse('flat Rp 500000')).toEqual({ mode: 'flat', number: '500000' });
  });

  it('parses a dotted-thousands flat rule back to its number', () => {
    expect(parse('flat Rp 500.000')).toEqual({ mode: 'flat', number: '500000' });
  });

  it('falls back to an empty percent field for an empty or unrecognized string', () => {
    expect(parse('')).toEqual({ mode: 'percent', number: '' });
    expect(parse('0')).toEqual({ mode: 'percent', number: '' });
  });

  it('round-trips compose -> parse for both modes', () => {
    expect(parse(compose('percent', '15'))).toEqual({ mode: 'percent', number: '15' });
    expect(parse(compose('flat', '250000'))).toEqual({ mode: 'flat', number: '250000' });
  });
});
