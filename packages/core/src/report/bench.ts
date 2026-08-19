/**
 * Report engine — benchmark thresholds + period pro-rating.
 *
 * `REPORT_BENCH_V1` mirrors row `versi=1` of `report_benchmark`; the two must
 * stay identical (same contract as `baseline/benchmark.ts`).
 */
import type { PeriodeTipe, ReportBench, ReportBenchKey } from './types';
import { VOLUME_BENCH_KEYS } from './types';

/** Mirror of `report_benchmark` versi=1 (tool `DEFAULT_BENCH`). */
export const REPORT_BENCH_V1: ReportBench = {
  roi_gmvmax: { good: 8, warn: 4 }, // ROI GMV Max (x)
  cpa_ratio: { good: 0.1, warn: 0.2 }, // CPA / AOV — lebih kecil lebih baik
  ctr_ads: { good: 0.03, warn: 0.015 }, // CTR iklan produk
  gmv_per_jam_live: { good: 300000, warn: 150000 }, // GMV per jam LIVE (Rp)
  sesi_live: { good: 20, warn: 12 }, // Sesi LIVE / bulan  ← VOLUME
  gpm_video: { good: 30000, warn: 10000 }, // GMV per 1.000 views (Rp)
  pct_video_sales: { good: 0.05, warn: 0.02 }, // % video ada penjualan
  cvr_toko: { good: 0.015, warn: 0.008 }, // CVR toko
  pct_kreator_produktif: { good: 0.2, warn: 0.1 }, // % kreator produktif
  quad_klik: { good: 150, warn: 25 }, // Kuadran: klik produk (high/low) ← VOLUME
  quad_cvr: { good: 0.015, warn: 0.005 }, // Kuadran: CVR produk (high/low)
};

/** The nominal month the monthly volume thresholds are written against. */
export const HARI_PER_BULAN = 30;

/**
 * Scale the VOLUME thresholds to the period actually covered; leave every rate
 * threshold alone (keputusan 2). A 7-day report is judged against 20×7/30 ≈ 4.7
 * LIVE sessions, not 20 — and its ROI target is still 8×, because ROI does not
 * get easier in a shorter week.
 *
 * `hari` is the real span of the export. Guarded to ≥1 so a malformed range can
 * never divide by zero or invert a threshold.
 */
export function prorateBench(bench: ReportBench, hari: number): ReportBench {
  const d = Math.max(1, Math.round(hari));
  if (d === HARI_PER_BULAN) return { ...bench };
  const f = d / HARI_PER_BULAN;
  const out = { ...bench } as ReportBench;
  for (const k of VOLUME_BENCH_KEYS) {
    out[k] = { good: bench[k].good * f, warn: bench[k].warn * f };
  }
  return out;
}

/** Nominal day count for a period type — the fallback when the export carries no readable range. */
export function hariNominal(tipe: PeriodeTipe): number {
  return tipe === 'mingguan' ? 7 : HARI_PER_BULAN;
}

/** Runtime list of the benchmark keys, for validating a `report_benchmark` row. */
export const ALL_BENCH_KEYS = Object.keys(REPORT_BENCH_V1) as ReportBenchKey[];
