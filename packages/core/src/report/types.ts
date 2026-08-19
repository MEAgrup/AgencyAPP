/**
 * Report engine — shared types (`cdps.report.tiktok.v1`).
 *
 * The MONTHLY/WEEKLY client performance report. Sibling of `../baseline`: same
 * inputs (already-parsed `Sheet`s from the 12 Seller-Center exports, plus the 4
 * optional TikTok Ads Manager exports), same purity contract (no DOM, no xlsx
 * dependency, no clock of its own), different output — baseline answers "how
 * healthy was this store BEFORE we took it on", this answers "what did we
 * deliver THIS period".
 *
 * Ported from the owner's `MEA TikTok Report Engine` HTML tool. Two deliberate
 * departures, both house rules:
 *  - the tool detected file types from the DOWNLOAD FILENAME (`[bisnis]-Analitik
 *    toko && …`). A renamed file silently vanished from the report. Here
 *    detection is by COLUMN SIGNATURE, reusing `baseline/detect.ts` — the same
 *    12 signatures the baseline engine already trusts — extended with 4 Ads
 *    Manager signatures.
 *  - the tool's benchmarks were editable in the browser (`applyConfig`), so two
 *    AMs produced different scores for the same month and an old report could
 *    not be recomputed (violates house rule #4). Here the benchmark is a
 *    parameter, sourced from the versioned `report_benchmark` table, and every
 *    stored report records the `benchmark_versi` it used.
 */
import type { FileType, Sheet } from '../baseline/types';

/** Weekly or monthly. Chosen by the AM; the engine validates it against the export range. */
export type PeriodeTipe = 'mingguan' | 'bulanan';

/** The 4 optional TikTok Ads Manager export types (upper-funnel, no GMV). */
export type TtamType = 'ttam_consideration' | 'ttam_follows' | 'ttam_showcase' | 'ttam_videoviews';

export const ALL_TTAM_TYPES: readonly TtamType[] = [
  'ttam_consideration', 'ttam_follows', 'ttam_showcase', 'ttam_videoviews',
];

/** Every slot the report engine understands: the 12 baseline types + the 4 TTAM ones. */
export type ReportFileType = FileType | TtamType;

/** Detected file-type slots, each an already-parsed Sheet. */
export type ReportSlots = Partial<Record<ReportFileType, Sheet>>;

/**
 * The period the report covers. `hari` is the REAL number of days the export
 * spans (derived from the sheet's date-range header), not a nominal 7/30 — it is
 * what volume benchmarks are pro-rated by, so a 5-day partial week is not judged
 * against a full week's target.
 */
export interface Rentang {
  /** ISO date `YYYY-MM-DD`. */
  mulai: string;
  /** ISO date `YYYY-MM-DD`, inclusive. */
  akhir: string;
  hari: number;
}

/**
 * The 11 report benchmarks (tool `DEFAULT_BENCH`). `good`/`warn` are the
 * green/yellow thresholds; the two `quad_*` keys use `high`/`low` as the
 * four-quadrant axes instead. Sourced from `report_benchmark`.
 */
export type ReportBenchKey =
  | 'roi_gmvmax'
  | 'cpa_ratio'
  | 'ctr_ads'
  | 'gmv_per_jam_live'
  | 'sesi_live'
  | 'gpm_video'
  | 'pct_video_sales'
  | 'cvr_toko'
  | 'pct_kreator_produktif'
  | 'quad_klik'
  | 'quad_cvr';

export interface BenchBand {
  /** Green threshold (for `quad_*`: the HIGH axis). */
  good: number;
  /** Yellow threshold (for `quad_*`: the LOW axis). */
  warn: number;
}

export type ReportBench = Record<ReportBenchKey, BenchBand>;

/**
 * Benchmarks measured in COUNTS PER MONTH. These — and only these — are
 * pro-rated by the period length, because a weekly report cannot be judged
 * against "20 LIVE sessions". Every other threshold is already a rate (ROI,
 * CTR, CVR, GMV per hour, a percentage) and is period-independent: pro-rating
 * one would silently move the goalposts (DECISIONS 2026-08-19, keputusan 2).
 */
export const VOLUME_BENCH_KEYS: readonly ReportBenchKey[] = ['sesi_live', 'quad_klik'];

/** Traffic-light flag. `⚪` = no basis to judge (null input), never "bad". */
export type Flag = 'hijau' | 'kuning' | 'merah' | 'kosong';

/** A scored dimension of the overall 0–10 performance score. */
export interface SkorDimensi {
  key: string;
  label: string;
  bobot: number;
  skor: number;
  catatan: string;
}

/** One recommendation card (prioritas tinggi / sedang). */
export interface Rekomendasi {
  judul: string;
  target: string;
  dampak: string;
  timeline: string;
}
