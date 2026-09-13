import { describe, expect, it } from 'vitest';
import { parsePdtAngka } from './angka';

describe('parsePdtAngka (G1-03)', () => {
  describe('sel kosong ⇒ 0', () => {
    it.each([null, undefined, '', '   '])('returns 0 for %p', (v) => {
      expect(parsePdtAngka(v)).toBe(0);
    });
  });

  describe('nilai tak terbaca ⇒ NaN, bukan 0', () => {
    it.each(['-', '—', 'N/A', 'n/a', 'tidak terbatas', 'abc', '--', 'null', 'undefined'])(
      'returns NaN for %p',
      (v) => {
        expect(Number.isNaN(parsePdtAngka(v))).toBe(true);
      },
    );

    it('returns NaN for a non-finite number input', () => {
      expect(Number.isNaN(parsePdtAngka(NaN))).toBe(true);
      expect(Number.isNaN(parsePdtAngka(Infinity))).toBe(true);
    });
  });

  describe('konvensi Seller Center / angka Indonesia (titik = ribuan, koma = desimal)', () => {
    it('single dot with 3-digit groups is thousands', () => {
      expect(parsePdtAngka('740.900')).toBe(740900);
    });
    it('multi-dot is thousands', () => {
      expect(parsePdtAngka('249.535.512')).toBe(249535512);
    });
    it('single comma is decimal', () => {
      expect(parsePdtAngka('3,21')).toBeCloseTo(3.21, 5);
    });
    it('dot+comma is thousands+decimal', () => {
      expect(parsePdtAngka('1.234,56')).toBeCloseTo(1234.56, 5);
    });
    it('strips Rp prefix (Seller Center money cell)', () => {
      expect(parsePdtAngka('Rp10.945.407')).toBe(10945407);
    });
  });

  describe('konvensi Ads Manager (raw=true, titik = desimal, koma = ribuan)', () => {
    it('plain decimal passes through', () => {
      expect(parsePdtAngka('335164.77', true)).toBeCloseTo(335164.77, 2);
    });
    it('comma-thousands is stripped', () => {
      expect(parsePdtAngka('1,234.56', true)).toBeCloseTo(1234.56, 5);
    });
  });

  describe('persen (akhiran % ⇒ dibagi 100)', () => {
    it('Seller Center percent cell', () => {
      expect(parsePdtAngka('5,37%')).toBeCloseTo(0.0537, 6);
    });
  });

  describe('negatif berkurung (refund/GMV negatif Shopee)', () => {
    it('parenthesised value becomes negative', () => {
      expect(parsePdtAngka('(1.234)')).toBe(-1234);
    });
  });

  it('passes finite numbers through unchanged', () => {
    expect(parsePdtAngka(42)).toBe(42);
    expect(parsePdtAngka(0)).toBe(0);
    expect(parsePdtAngka(1234.56)).toBe(1234.56);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parsePdtAngka('  1.234,56  ')).toBeCloseTo(1234.56, 5);
  });
});
