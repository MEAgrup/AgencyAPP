/**
 * TikTok Ads Scanner engine — cell number parsing.
 *
 * The tool's own `toNum()` conflated TWO problems: general Rupiah-vs-decimal
 * ambiguity (already solved house-wide by `../../baseline/angka.ts:n(v,raw)`,
 * RAB-02) and TikTok-ID scientific-notation repair (a different problem —
 * see `./id.ts`). Per the porting brief, this reuses the HOUSE number
 * parser for the former instead of re-deriving separator rules a second
 * time; only the auto-detection of "is this cell Rupiah-formatted" is new,
 * because unlike `baseline/*` (which knows per-COLUMN whether a sheet is
 * Seller-Center vs Ads-Manager and passes `raw` explicitly), a single
 * Analitik Produk / Ads Produk row here mixes Rp-prefixed money columns
 * with plain-decimal ratio columns (ROI) and percent columns (CTR) — so
 * detection is per-CELL, exactly like the tool did, but delegated to `n()`.
 *
 *   "Rp13.473.176" → isRupiah → n(s, false)  → dot = thousands (10945407)
 *   "3.45" / "5,37%" → !isRupiah → n(s, true) → dot = decimal, comma = thousands
 *
 * "-" / "nan" / "--" / empty → 0 (tool `toNum`). This is the CELL-VALUE
 * parser: a present-but-empty cell is 0. Column-level absence (the whole
 * metric was never uploaded) is a different thing, handled in `metrik.ts`
 * by keeping the field `null` instead of calling this at all.
 */
import { n } from '../../baseline/angka';

export function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s || s === '-' || /^nan$/i.test(s) || s === '--') return 0;
  const isRupiah = /rp/i.test(s);
  return n(s, !isRupiah);
}
