import { describe, expect, it } from 'vitest';
import { distributeLinks } from './creative';

describe('distributeLinks (C3, Revisi Sales/Creative/Performa)', () => {
  it('splits by line, trims, drops blank lines', () => {
    const r = distributeLinks('  https://a  \n\nhttps://b\n', 5);
    expect(r.links).toEqual(['https://a', 'https://b']);
    expect(r.totalPasted).toBe(2);
    expect(r.leftover).toBe(0);
  });

  it('fills exactly rowCount rows when counts match', () => {
    const pasted = Array.from({ length: 18 }, (_, i) => `https://x/${i}`).join('\n');
    const r = distributeLinks(pasted, 18);
    expect(r.links).toHaveLength(18);
    expect(r.totalPasted).toBe(18);
    expect(r.leftover).toBe(0);
  });

  it('caps at rowCount and reports the excess as leftover, in order', () => {
    const pasted = Array.from({ length: 21 }, (_, i) => `https://x/${i}`).join('\n');
    const r = distributeLinks(pasted, 18);
    expect(r.links).toHaveLength(18);
    expect(r.links[0]).toBe('https://x/0');
    expect(r.links[17]).toBe('https://x/17');
    expect(r.totalPasted).toBe(21);
    expect(r.leftover).toBe(3);
  });

  it('handles fewer pasted links than rows without padding or erroring', () => {
    const r = distributeLinks('https://only-one', 5);
    expect(r.links).toEqual(['https://only-one']);
    expect(r.leftover).toBe(0);
  });

  it('handles empty input and zero rows', () => {
    expect(distributeLinks('', 5)).toEqual({ links: [], totalPasted: 0, leftover: 0 });
    expect(distributeLinks('https://a\nhttps://b', 0)).toEqual({ links: [], totalPasted: 2, leftover: 2 });
  });
});
