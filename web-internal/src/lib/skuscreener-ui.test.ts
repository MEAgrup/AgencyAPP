/**
 * `skuscreener-ui.ts` — the rendering rules of `/ads/screening`.
 *
 * Tested because every failure mode here is SILENT: a CTR shown 100× too small
 * still looks like a plausible CTR, and a missing value shown as `0` looks like
 * a real zero. Nothing in this file computes a business rule (routes, verdicts
 * and deltas all arrive computed from `@cdps/core`), so these are display
 * assertions only — deliberately including the ones that read as obvious.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  fmtDeltaPct,
  fmtInt,
  fmtPct,
  fmtRupiah,
  momenLabel,
  routeTone,
  statusVsTargetTone,
  suggestsTracker,
  verdictTone,
} from '@/lib/skuscreener-ui';
import { MOMEN_OPTIONS } from '@/lib/skuscreener';

describe('fmtPct — payload percentages are already percentages', () => {
  it('does NOT multiply by 100: the R04 CTR floor of 2.0 reads as 2,00%', () => {
    expect(fmtPct(2)).toBe('2,00%');
    expect(fmtPct(0.5)).toBe('0,50%');
  });

  it('renders a real zero as 0,00% and a missing value as —', () => {
    expect(fmtPct(0)).toBe('0,00%');
    expect(fmtPct(null)).toBe(EMPTY);
    expect(fmtPct(undefined)).toBe(EMPTY);
    expect(fmtPct(NaN)).toBe(EMPTY);
    expect(fmtPct(Infinity)).toBe(EMPTY);
  });

  it('honours the digit count for the tighter columns', () => {
    expect(fmtPct(2.345, 1)).toBe('2,3%');
  });
});

describe('fmtDeltaPct — relative change, signed', () => {
  it('signs an improvement and keeps the PRD §4.2 worked example legible', () => {
    // Sneakers Outdoor Trail: CTR +34,4% → MEMBAIK.
    expect(fmtDeltaPct(34.4)).toBe('+34,4%');
  });

  it('leaves a decline with its own minus sign and does not sign zero', () => {
    expect(fmtDeltaPct(-10)).toBe('-10,0%');
    expect(fmtDeltaPct(0)).toBe('0,0%');
  });

  it('is — when there is no basis (R10: fewer than 20 clicks after)', () => {
    expect(fmtDeltaPct(null)).toBe(EMPTY);
    expect(fmtDeltaPct(NaN)).toBe(EMPTY);
  });
});

describe('fmtRupiah — house rule #7', () => {
  it('formats whole rupiah as Rp. X.XXX.XXX,00', () => {
    expect(fmtRupiah(1234567)).toBe('Rp. 1.234.567,00');
    expect(fmtRupiah(0)).toBe('Rp. 0,00');
  });

  it('keeps real cents instead of pretending they are zero', () => {
    expect(fmtRupiah(1234.56)).toBe('Rp. 1.234,56');
    expect(fmtRupiah(1234.5)).toBe('Rp. 1.234,50');
  });

  it('carries a cent rounding into the rupiah rather than printing ,100', () => {
    expect(fmtRupiah(1999.999)).toBe('Rp. 2.000,00');
  });

  it('keeps a negative GMV negative (R03 never applies .abs())', () => {
    expect(fmtRupiah(-500000)).toBe('-Rp. 500.000,00');
  });

  it('is — for a value with no basis (AOV of a SKU with zero orders)', () => {
    expect(fmtRupiah(null)).toBe(EMPTY);
    expect(fmtRupiah(NaN)).toBe(EMPTY);
  });
});

describe('fmtInt', () => {
  it('groups thousands and never shows NaN', () => {
    expect(fmtInt(50000)).toBe('50.000');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(null)).toBe(EMPTY);
  });
});

describe('routeTone', () => {
  it('gives each of the five R05 routes a distinct-enough tone', () => {
    expect(routeTone('SCALE')).toBe('green');
    expect(routeTone('KANDIDAT IKLAN')).toBe('blue');
    expect(routeTone('OPTIMASI GAMBAR/JUDUL')).toBe('amber');
    expect(routeTone('OPTIMASI DESKRIPSI/HARGA')).toBe('amber');
    expect(routeTone('PARKIR')).toBe('gray');
  });

  it('matches the two R06 override labels by PREFIX, so engine wording can change', () => {
    expect(routeTone('ANTI-RULE — jangan diiklankan')).toBe('red');
    expect(routeTone('ANTI-RULE — teks lain sama sekali')).toBe('red');
    expect(routeTone('TAHAN — CPC max terlalu rendah, naikkan CR atau AOV dulu')).toBe('darkgray');
    expect(routeTone('TAHAN — apa pun')).toBe('darkgray');
  });

  it('falls back to a neutral tone rather than throwing on an unknown label', () => {
    expect(routeTone('SESUATU YANG BARU')).toBe('gray');
  });
});

describe('verdictTone — two vocabularies, one meaning', () => {
  it('treats Modul B MEMBAIK and Modul D BERHASIL alike', () => {
    expect(verdictTone('MEMBAIK')).toBe('green');
    expect(verdictTone('BERHASIL')).toBe('green');
  });

  it('separates a decline from "not enough data yet"', () => {
    expect(verdictTone('MEMBURUK')).toBe('red');
    expect(verdictTone('BELUM CUKUP DATA')).toBe('amber');
    expect(verdictTone('TIDAK BERUBAH')).toBe('gray');
  });
});

describe('statusVsTargetTone', () => {
  it('reads above-target as good news, not a warning', () => {
    expect(statusVsTargetTone('DI ATAS TARGET')).toBe('blue');
    expect(statusVsTargetTone('SESUAI')).toBe('green');
    expect(statusVsTargetTone('DI BAWAH TARGET')).toBe('red');
  });
});

describe('momenLabel', () => {
  it('maps a stored code to its label', () => {
    expect(momenLabel('review_7_hari', MOMEN_OPTIONS)).toBe('Review 7 hari (follow-up)');
  });

  it('shows an unmapped code verbatim rather than blank', () => {
    expect(momenLabel('momen_baru', MOMEN_OPTIONS)).toBe('momen_baru');
  });
});

describe('suggestsTracker', () => {
  it('offers a Tracker row for exactly the two OPTIMASI routes', () => {
    expect(suggestsTracker('OPTIMASI GAMBAR/JUDUL')).toBe(true);
    expect(suggestsTracker('OPTIMASI DESKRIPSI/HARGA')).toBe(true);
  });

  it('does not for routes whose next step is not "change then measure"', () => {
    expect(suggestsTracker('SCALE')).toBe(false);
    expect(suggestsTracker('KANDIDAT IKLAN')).toBe(false);
    expect(suggestsTracker('PARKIR')).toBe(false);
    expect(suggestsTracker('ANTI-RULE — jangan diiklankan')).toBe(false);
  });
});
