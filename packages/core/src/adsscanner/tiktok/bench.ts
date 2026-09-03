/**
 * TikTok Ads Scanner engine — category benchmark table, VERSIONED.
 *
 * The tool's `BENCHMARKS` was a hardcoded, unversioned JS object mutated in
 * place whenever MEA's research sheet changed — meaning a score computed
 * last month could not be recomputed from an old payload once the constant
 * moved (house rule #4: derived fields "always recomputable from the
 * event/timestamp log"). Ported here as `ADSSCANNER_BENCH_V1`, mirroring the
 * pattern of `../../report/bench.ts:REPORT_BENCH_V1` and
 * `../../baseline/benchmark.ts` — every payload records the
 * `benchmark_versi` it was scored against, and future benchmark updates add
 * a new versioned constant rather than editing this one in place.
 *
 * Source: tool comment — "Sumber: sheet benchmark MEA. ROI update 31 Des
 * 2025, TR & GPM update 26 Apr 2026." 33 TikTok Shop Level-3 categories.
 * `roi`/`tr`/`gpm` may each be `null` for a category with no measured
 * benchmark (e.g. Gaming & Consoles has no ROI/TR data at all) — that is a
 * real "not measured", not a zero, and score/insight code must treat it as
 * such (never `bm.roi ?? 0`).
 */
import type { AdsScannerBench } from './types';

/** Mirror of the tool's `BENCHMARKS` constant, version 1. */
export const ADSSCANNER_BENCH_V1: AdsScannerBench = {
  'Audio & Camera': { roi: 8.04, tr: 0.05, gpm: 3.26 },
  'Automotive & Motorcycle': { roi: 5.75, tr: 0.03, gpm: 1.65 },
  'Beauty & Personal Care': { roi: 3.82, tr: 0.13, gpm: 1.63 },
  'Books & Magazine': { roi: 3.63, tr: 0.12, gpm: 1.05 },
  'Computers & Office Equipment': { roi: 7.64, tr: 0.04, gpm: 4.35 },
  'Fashion Accessories': { roi: 4.0, tr: 0.06, gpm: 2.41 },
  'Food & Beverages': { roi: 4.71, tr: 0.06, gpm: 1.45 },
  Furniture: { roi: 10.22, tr: 0.03, gpm: 4.82 },
  'Handphone (Devices)': { roi: 50.43, tr: 0.01, gpm: 3.02 },
  Health: { roi: 3.26, tr: 0.12, gpm: 2.33 },
  'Home Appliances': { roi: 15.62, tr: 0.05, gpm: 3.95 },
  'Home Care Essentials': { roi: null, tr: 0.07, gpm: 1.74 },
  'Home Improvement': { roi: 7.87, tr: 0.05, gpm: 2.91 },
  'Home Supplies': { roi: 3.73, tr: 0.07, gpm: 2.06 },
  'Jewellery Accessories & Derivatives': { roi: 78.21, tr: 0.01, gpm: 4.8 },
  "Kids' Fashion": { roi: 6.0, tr: 0.03, gpm: 3.2 },
  Kitchenware: { roi: 7.97, tr: 0.04, gpm: 2.833 },
  'Luggage & Bags': { roi: 8.58, tr: 0.05, gpm: 2.28 },
  'Menswear & Underwear': { roi: 5.77, tr: 0.04, gpm: 1.66 },
  'Mom & Babies': { roi: 5.31, tr: 0.06, gpm: 2.25 },
  'Muslim Fashion': { roi: 9.16, tr: 0.03, gpm: 3.86 },
  'Pet Supplies': { roi: 3.95, tr: 0.07, gpm: 1.32 },
  Shoes: { roi: 7.21, tr: 0.06, gpm: 1.59 },
  'Sports & Outdoor Equipment': { roi: 8.15, tr: 0.04, gpm: 2.38 },
  Sportswear: { roi: null, tr: 0.04, gpm: 1.68 },
  Stationery: { roi: 11.3, tr: 0.03, gpm: 1.6 },
  'Textiles & Soft Furnishings': { roi: 7.71, tr: 0.04, gpm: 3.79 },
  'Tools & Hardware': { roi: 3.36, tr: 0.06, gpm: 2.64 },
  'Toys & Hobbies': { roi: 7.8, tr: 0.04, gpm: 1.93 },
  'Wearable & Accessories': { roi: 7.36, tr: 0.08, gpm: 1.55 },
  'Womenswear & Underwear': { roi: 7.27, tr: 0.04, gpm: 3.21 },
  'Gaming & Consoles': { roi: null, tr: null, gpm: 0.86 },
  Telecommunication: { roi: null, tr: null, gpm: 0.51 },
  'Music & Collectibles': { roi: null, tr: null, gpm: 1.36 },
};

/** Runtime list of the 33 recognised categories, for validating an `adsscanner_benchmark` row / populating a category picker. */
export const ALL_ADSSCANNER_CATEGORIES: readonly string[] = Object.keys(ADSSCANNER_BENCH_V1).sort();

const EMPTY_BENCH = { roi: null, tr: null, gpm: null } as const;

/** Look up a category's benchmark row; unknown category ⇒ all-null (never a made-up default). */
export function benchOf(bench: AdsScannerBench, category: string): { roi: number | null; tr: number | null; gpm: number | null } {
  return bench[category] ?? EMPTY_BENCH;
}
