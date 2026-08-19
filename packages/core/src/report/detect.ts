/**
 * Report engine — TikTok Ads Manager file signatures + period range reading.
 *
 * The 12 Seller-Center types are detected by `baseline/detect.ts` (unchanged —
 * one registry, not two). This module adds ONLY what the report engine
 * understands on top: the 4 optional Ads Manager exports, which the baseline
 * engine has no use for.
 *
 * ⛔ JANGAN ubah string nama kolom pada signature — itu satu-satunya cara file
 * dikenali. Ads Manager memakai skema yang sama sekali berbeda dari Seller
 * Center (kolom "Ad group name"/"Ad name" + "Spend", metrik awareness alih-alih
 * GMV), jadi tak ada risiko bentrok dengan 12 signature baseline.
 */
import type { Sheet } from '../baseline/types';
import type { Rentang, TtamType } from './types';

/** Case-insensitive column lookup: lowercase label → the sheet's real column key. */
export function colIndex(d: Sheet): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of d.cols) {
    const k = c.trim().toLowerCase();
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

/** True when the sheet carries a column with this (case-insensitive) label. */
export const hasCol = (idx: Map<string, string>, label: string): boolean => idx.has(label.toLowerCase());

interface TtamSpec {
  l: string;
  sig: (idx: Map<string, string>) => boolean;
}

/**
 * The 4 Ads Manager signatures. Order matters: `showcase` also carries
 * "Video views", so the more specific checkout signature is tested first and
 * `videoviews` is the residual.
 */
export const TTAM_TYPES: Record<TtamType, TtamSpec> = {
  ttam_consideration: { l: 'Ads Manager — Brand Considerations', sig: (i) => hasCol(i, 'New consideration size') },
  ttam_follows: { l: 'Ads Manager — Follows', sig: (i) => hasCol(i, 'Paid follows') },
  ttam_showcase: { l: 'Ads Manager — Showcase (Initiate Checkout)', sig: (i) => hasCol(i, 'Checkouts initiated (Shop)') || hasCol(i, 'Adds to cart (Shop)') },
  ttam_videoviews: { l: 'Ads Manager — Video Views', sig: (i) => hasCol(i, 'Video views') && hasCol(i, 'CPM') },
};

export const TTAM_ORDER: readonly TtamType[] = [
  'ttam_consideration', 'ttam_follows', 'ttam_showcase', 'ttam_videoviews',
];

/**
 * Classify an Ads Manager export. Returns null for anything that is not one —
 * including Seller-Center files, which never carry a "Spend" + ad-name pair.
 */
export function detectTtam(d: Sheet): TtamType | null {
  const idx = colIndex(d);
  const isAdsManager = hasCol(idx, 'Spend') && (hasCol(idx, 'Ad group name') || hasCol(idx, 'Ad name'));
  if (!isAdsManager) return null;
  for (const t of TTAM_ORDER) if (TTAM_TYPES[t].sig(idx)) return t;
  return null;
}

const pad = (x: number): string => String(x).padStart(2, '0');

/** Whole days between two ISO dates, INCLUSIVE of both ends (a 1-day export = 1). */
export function hariAntara(mulai: string, akhir: string): number {
  const a = Date.parse(mulai + 'T00:00:00Z');
  const b = Date.parse(akhir + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Read the export's date RANGE from its header meta row — the half
 * `baseline/sheet.ts:periodeOf` throws away (it keeps only the month).
 *
 * The report needs both ends: the period is what the whole document is about,
 * and `hari` is what volume benchmarks are pro-rated by. Handles the two shapes
 * Seller Center emits: `2026-08-01 ~ 2026-08-31` and `01/08/2026 - 31/08/2026`.
 * Returns null when no range is readable — the caller then falls back to the
 * nominal length of the chosen period type AND records that it did.
 */
export function rentangOf(meta: unknown): Rentang | null {
  const s = String(meta ?? '');
  const iso = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})\s*[~–—-]\s*(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) {
    const mulai = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const akhir = `${iso[4]}-${iso[5]}-${iso[6]}`;
    const hari = hariAntara(mulai, akhir);
    return hari > 0 ? { mulai, akhir, hari } : null;
  }
  const dmy = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s*[~–—-]\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) {
    const mulai = `${dmy[3]}-${pad(+dmy[2])}-${pad(+dmy[1])}`;
    const akhir = `${dmy[6]}-${pad(+dmy[5])}-${pad(+dmy[4])}`;
    const hari = hariAntara(mulai, akhir);
    return hari > 0 ? { mulai, akhir, hari } : null;
  }
  return null;
}
