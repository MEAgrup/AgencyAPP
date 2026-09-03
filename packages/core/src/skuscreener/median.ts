/**
 * R04 — store-wide median CTR/CR, with iterative threshold reduction.
 *
 * ⚠️ This is the ONE place in Gelombang 3 where the port goes BEYOND the
 * shipped HTML on purpose (`docs/design/README.md`'s explicit call): the tool
 * uses FIXED floors (`views>=200`/`clicks>=20`) with no reduction —
 * `Math.max(med(BIZ.filter(s=>s.views>=200).map(s=>s.ctr))||0, 2)`. The PRD
 * marks R04's iterative-reduction step as a numbered, mandatory rule (not a
 * UI shortcut), so THIS module implements it in full:
 *
 *   "Median CTR dihitung dari SKU dengan Views ≥ 200. Median CR dihitung dari
 *    SKU dengan Clicks ≥ 20. Jika kurang dari 5 SKU memenuhi ambang di atas,
 *    ambang diturunkan 50% secara iteratif sampai setidaknya 5 SKU tersedia
 *    atau floor absolut (Views ≥ 50, Clicks ≥ 5) tercapai. Floor absolut CTR:
 *    2,0%. Floor absolut CR: 0,5%. Dipakai jika median toko di bawah nilai
 *    ini." (PRD §2.2 R04)
 *
 * Two SEPARATE floors are in play and must not be conflated:
 *   1. The THRESHOLD floor (Views≥50 / Clicks≥5) bounds how far the sample
 *      filter can be relaxed while hunting for ≥5 qualifying SKUs.
 *   2. The VALUE floor (CTR 2.0% / CR 0.5%) clamps the resulting median
 *      itself, applied AFTER the threshold search settles — this is the part
 *      the shipped HTML already does (`Math.max(median, floor)`).
 */
import { median as medianOf } from '../baseline/angka';

export interface MedianReductionResult {
  /** The median used for routing — raw median clamped up to the absolute value floor. */
  effectiveMedian: number;
  /** The computed median BEFORE the value-floor clamp (0 when the sample is empty — `median()`'s own convention). */
  rawMedian: number;
  /** The basis (Views or Clicks) threshold actually used, after any reduction. */
  threshold: number;
  /** How many SKUs made it into the sample at the final threshold. */
  sampleSize: number;
  /** How many times the threshold was halved. */
  iterations: number;
  /** True if the threshold hit the hard floor before the sample reached ≥5 SKUs. */
  reachedAbsoluteFloor: boolean;
}

interface ThresholdRow {
  /** The field the threshold filters on (Views for CTR, Clicks for CR). */
  basis: number;
  /** The field the median is computed over (CTR% or CR%). */
  metric: number;
}

function reduceThreshold(
  rows: readonly ThresholdRow[],
  startThreshold: number,
  floorThreshold: number,
): { threshold: number; sample: number[]; iterations: number; reachedAbsoluteFloor: boolean } {
  let threshold = startThreshold;
  const sampleAt = (t: number) => rows.filter((r) => r.basis >= t).map((r) => r.metric);
  let sample = sampleAt(threshold);
  let iterations = 0;
  // "diturunkan 50% secara iteratif sampai setidaknya 5 SKU tersedia ATAU
  // floor absolut tercapai" — Math.max(...,floor) both halves AND clamps to
  // the floor in one step, so the loop naturally stops exactly at the floor.
  while (sample.length < 5 && threshold > floorThreshold) {
    threshold = Math.max(threshold / 2, floorThreshold);
    sample = sampleAt(threshold);
    iterations++;
  }
  return { threshold, sample, iterations, reachedAbsoluteFloor: threshold <= floorThreshold };
}

/** R04 — median CTR: start threshold Views≥200, absolute floor Views≥50, value floor CTR 2.0%. */
export function medianCtr(rows: ReadonlyArray<{ views: number; ctr: number }>): MedianReductionResult {
  const { threshold, sample, iterations, reachedAbsoluteFloor } = reduceThreshold(
    rows.map((r) => ({ basis: r.views, metric: r.ctr })),
    200,
    50,
  );
  const rawMedian = medianOf(sample);
  return {
    effectiveMedian: Math.max(rawMedian, 2.0),
    rawMedian,
    threshold,
    sampleSize: sample.filter((x) => isFinite(x)).length,
    iterations,
    reachedAbsoluteFloor,
  };
}

/** R04 — median CR: start threshold Clicks≥20, absolute floor Clicks≥5, value floor CR 0.5%. */
export function medianCr(rows: ReadonlyArray<{ clicks: number; cr: number }>): MedianReductionResult {
  const { threshold, sample, iterations, reachedAbsoluteFloor } = reduceThreshold(
    rows.map((r) => ({ basis: r.clicks, metric: r.cr })),
    20,
    5,
  );
  const rawMedian = medianOf(sample);
  return {
    effectiveMedian: Math.max(rawMedian, 0.5),
    rawMedian,
    threshold,
    sampleSize: sample.filter((x) => isFinite(x)).length,
    iterations,
    reachedAbsoluteFloor,
  };
}

/**
 * R05's third comparator — plain store median of Views, NO threshold and NO
 * floor (R04 only specifies reduction/floor for CTR and CR; Views median is
 * used purely as the "traffic already high" cutoff in routing). Matches the
 * shipped tool's `mVw=med(BIZ.map(s=>s.views))` exactly.
 */
export function medianViews(rows: ReadonlyArray<{ views: number }>): number {
  return medianOf(rows.map((r) => r.views));
}
