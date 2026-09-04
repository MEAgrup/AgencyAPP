/**
 * `adsscanner-ui.ts` — the rendering rules that could be wrong in a way a
 * reader would not notice.
 *
 * The centrepiece is the units test. Ads Scanner payload percentages are
 * FRACTIONS and the SKU Screener's are percent-NUMBERS, so the two pages carry
 * separate `fmtPct` implementations. Both directions are pinned here against
 * the real `skuscreener-ui` function, because the failure mode is not a crash
 * — it is a CTR of 5% quietly reading as `0,05%` or `500%`, either of which
 * looks like a plausible number on a dashboard.
 */
import { describe, expect, it } from 'vitest';
import { fmtPct as fmtPctScreener } from './skuscreener-ui';
import {
  BUCKET_ORDER,
  bucketTone,
  byBucketOrder,
  EMPTY,
  fmtDec,
  fmtInt,
  fmtPct,
  fmtRoi,
  fmtRupiah,
  gateTone,
  missingSlots,
  slotLabel,
  slotRequired,
  vonisTone,
} from './adsscanner-ui';

describe('units — fractions here, percent-numbers in the SKU Screener', () => {
  it('fmtPct multiplies a FRACTION by 100', () => {
    expect(fmtPct(0.05)).toBe('5,0%');
    expect(fmtPct(0.0537, 2)).toBe('5,37%');
    expect(fmtPct(1)).toBe('100,0%');
  });

  it('is the INVERSE of the SKU Screener formatter — the same input reads 100x apart', () => {
    // One value, two payload conventions. If these two ever agree, one of the
    // two pages has started lying about its own numbers.
    expect(fmtPct(5)).toBe('500,0%');          // 5 as a fraction really is 500%
    expect(fmtPctScreener(5)).toBe('5,00%');   // 5 as a percent-number is 5%
  });

  it('renders a no-basis percentage as — rather than 0%', () => {
    expect(fmtPct(null)).toBe(EMPTY);
    expect(fmtPct(undefined)).toBe(EMPTY);
    expect(fmtPct(Number.NaN)).toBe(EMPTY);
    expect(fmtPct(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });
});

describe('money and numbers', () => {
  it('fmtRupiah matches the engine renderer: whole rupiah, literal ,00', () => {
    expect(fmtRupiah(1234567)).toBe('Rp. 1.234.567,00');
    // Rounded, not truncated — so a figure here equals the same figure in the
    // scan's rendered HTML (`baseline/angka.ts:rp`).
    expect(fmtRupiah(1234.56)).toBe('Rp. 1.235,00');
    expect(fmtRupiah(0)).toBe('Rp. 0,00');
  });

  it('fmtRupiah renders a missing value as — , never Rp. 0,00', () => {
    expect(fmtRupiah(null)).toBe(EMPTY);
    expect(fmtRupiah(Number.NaN)).toBe(EMPTY);
  });

  it('fmtRoi marks a ratio as a multiplier and — when there is no ad spend', () => {
    expect(fmtRoi(3.82)).toBe('3,82×');
    expect(fmtRoi(5)).toBe('5×');
    expect(fmtRoi(null)).toBe(EMPTY);
  });

  it('fmtInt / fmtDec', () => {
    expect(fmtInt(1234567)).toBe('1.234.567');
    expect(fmtInt(1234.6)).toBe('1.235');
    expect(fmtInt(null)).toBe(EMPTY);
    expect(fmtDec(3.57)).toBe('3,57');
    expect(fmtDec(4)).toBe('4');
    expect(fmtDec(null)).toBe(EMPTY);
  });
});

describe('tones', () => {
  it('gives every one of the 6 buckets a defined badge class', () => {
    for (const b of BUCKET_ORDER) {
      expect(bucketTone(b)).not.toBe('gray');
    }
    expect(BUCKET_ORDER).toHaveLength(6);
  });

  it('tones the two spend-here buckets apart from the two do-not-spend ones', () => {
    expect(bucketTone('SCALE UP')).toBe('green');
    expect(bucketTone('STOK VIDEO CUKUP')).toBe('blue');
    expect(bucketTone('BOROS')).toBe('red');
    expect(bucketTone('BANGUN KONTEN')).toBe('red');
    expect(bucketTone('PERLU OPTIMASI')).toBe('amber');
    expect(bucketTone('DIBLOKIR')).toBe('darkgray');
  });

  it('falls back to gray for an unknown bucket rather than throwing', () => {
    expect(bucketTone('BUCKET BARU')).toBe('gray');
  });

  it('tones gates from strong to dry', () => {
    expect(gateTone('KUAT')).toBe('green');
    expect(gateTone('CUKUP')).toBe('blue');
    expect(gateTone('TIPIS')).toBe('amber');
    expect(gateTone('KERING')).toBe('red');
    expect(gateTone('?')).toBe('gray');
  });

  it('tones the account verdict — all four engine labels are covered', () => {
    expect(vonisTone('SEHAT')).toBe('green');
    expect(vonisTone('PERBAIKI')).toBe('amber');
    expect(vonisTone('RISIKO')).toBe('red');
    expect(vonisTone('KRITIS')).toBe('red');
    expect(vonisTone('')).toBe('gray');
  });
});

describe('bucket ordering — money leaks before opportunities', () => {
  it('sorts wasted spend ahead of scale-up', () => {
    const sorted = ['SCALE UP', 'DIBLOKIR', 'BOROS', 'PERLU OPTIMASI'].sort(byBucketOrder);
    expect(sorted).toEqual(['BOROS', 'PERLU OPTIMASI', 'SCALE UP', 'DIBLOKIR']);
  });

  it('sorts an unrecognised bucket last instead of dropping it', () => {
    const sorted = ['BUCKET BARU', 'SCALE UP'].sort(byBucketOrder);
    expect(sorted).toEqual(['SCALE UP', 'BUCKET BARU']);
  });
});

describe('file slots', () => {
  it('labels each of the 4 slots by the export it names in Seller Center', () => {
    expect(slotLabel('analitik')).toBe('Analitik Produk');
    expect(slotLabel('ads')).toBe('Ads Produk');
    expect(slotLabel('video')).toBe('Video (Kreator/Toko)');
    expect(slotLabel('adslive')).toBe('Ads Live');
  });

  it('states an undetected file rather than rendering blank', () => {
    expect(slotLabel(null)).toBe('tidak dikenali');
    expect(slotLabel(undefined)).toBe('tidak dikenali');
  });

  it('shows an unmapped slot code verbatim so it is visible, not hidden', () => {
    expect(slotLabel('slot_baru')).toBe('slot_baru');
  });

  it('marks only analitik required — mirroring the server gate', () => {
    expect(slotRequired('analitik')).toBe(true);
    expect(slotRequired('ads')).toBe(false);
    expect(slotRequired('video')).toBe(false);
    expect(slotRequired('adslive')).toBe(false);
  });

  it('never nudges for adslive — the engine accepts but never reads it', () => {
    expect(missingSlots({ analitik: true, ads: true, video: true, adslive: false })).toEqual([]);
    expect(missingSlots({ analitik: true })).toEqual(['ads', 'video']);
    expect(missingSlots({})).toEqual(['analitik', 'ads', 'video']);
    expect(missingSlots(null)).toEqual(['analitik', 'ads', 'video']);
  });
});
