/**
 * Baseline engine — benchmark thresholds (RAB-02, fix #4).
 *
 * In the tool the 16 `BENCH` numbers were editable in the browser, so two AMs
 * could score the same store differently and an old score could not be
 * recomputed (violates house rule #4). Here the benchmark is a PARAMETER passed
 * to `score()`/`findings()`, sourced from the versioned `riset_awal_benchmark`
 * table (Director-only). `BENCH_V1` mirrors row `versi=1` of that table — the
 * two must stay identical.
 */
import type { Benchmark } from './types';

/** Mirror of `riset_awal_benchmark` versi=1 (tool `BASELINE_TOOL_TIKTOK_v1.html:339-356`). */
export const BENCH_V1: Benchmark = {
  cr: 1.0, // Persentase konversi toko (%)
  refund: 5.0, // Refund rate maksimal (%)
  vidPostToko: 30, // Video toko / bulan
  vidSalesToko: 8.0, // Video toko ada penjualan (%)
  vidSalesAff: 8.0, // Video afiliasi ada penjualan (%)
  gpmToko: 100000, // GPM median video toko (Rp)
  liveSesi: 20, // Sesi LIVE toko / bulan
  liveJam: 60, // Jam LIVE toko / bulan
  liveGmvJam: 300000, // GMV per jam LIVE (Rp)
  liveCtor: 1.5, // CTOR LIVE (%)
  krSales: 40, // Kreator posting yg ada penjualan (%)
  krKonsen: 60, // Konsentrasi GMV top-5 kreator (% maks)
  skuSales: 30, // SKU ada penjualan (%)
  roas: 6, // ROAS iklan minimal (x)
  adsDep: 60, // Ketergantungan iklan maksimal (% maks)
  spikeFlag: 1.8, // Ambang bulan campaign-driven (x median)
};
