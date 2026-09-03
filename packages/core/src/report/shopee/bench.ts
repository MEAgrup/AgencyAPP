/**
 * Shopee report engine — benchmark thresholds.
 *
 * `REPORT_BENCH_SHOPEE_V1` mirrors row `versi=1` of `report_benchmark_shopee`
 * (the two must stay identical — same contract as TikTok's `../bench.ts`).
 *
 * Unlike TikTok's benchmark, nothing here is pro-rated by period length: every
 * Shopee threshold is a rate, a percentile fraction, or an absolute cut-off —
 * CONFIG in the HTML source has no "N sessions per month" style volume key, so
 * there is no `prorateBench` equivalent to port.
 */
import type { ShopeeBench } from './types';

/** Mirror of `report_benchmark_shopee` versi=1 (tool `CONFIG`). */
export const REPORT_BENCH_SHOPEE_V1: ShopeeBench = {
  kuadran: {
    cr_basis: 'pesanan_per_pengunjung',
    percentile: { traffic_high_pct: 0.75, traffic_low_pct: 0.25, cr_high_pct: 0.75, cr_low_pct: 0.25 },
    absolute: { traffic_low_max: 150, traffic_high_min: 500, conversion_low_max: 0.02, conversion_high_min: 0.04 },
    medium_traffic_high_if_cr_high: true,
    medium_cr_high_if_traffic_high: true,
    sleeper_visitor_max: 50,
  },
  health: {
    roas_good: 4, roas_warn: 2,
    acos_good: 0.25, acos_warn: 0.40,
    ctr_good: 0.005, cr_good: 0.015,
    csat_good: 0.85, chat_respon_max_detik: 3600,
  },
  layanan: {
    chat_response_rate_good: 0.95,
    chat_order_conversion_good: 0.20,
    csat_good: 0.85,
    chat_respon_max_detik: 3600,
    cancel_rate_good: 0.05,
    cancel_rate_warn: 0.10,
  },
};
