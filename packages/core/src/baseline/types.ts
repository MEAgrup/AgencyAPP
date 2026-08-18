/**
 * Baseline engine — shared types (RAB-02).
 *
 * The engine is pure and DOM-free: it takes an already-parsed array-of-arrays
 * (`Aoa`, exactly what `XLSX.utils.sheet_to_json(ws,{header:1})` yields) and
 * produces the `cdps.baseline.tiktok.v1` payload. The xlsx binary parse stays at
 * the FE/adapter boundary (RAB-04) so this package needs no xlsx dependency and
 * every fragile rule (header heuristic, `n()`, metrics, scoring) is unit-testable
 * with plain arrays.
 */

/** A raw sheet as array-of-arrays (rows of cells). */
export type Aoa = unknown[][];

/** A parsed sheet: header row detected, data rows keyed by column name. */
export interface Sheet {
  file: string;
  cols: string[];
  rows: Record<string, unknown>[];
  meta: string;
  headerRow: number;
  /** Set by the caller after detect(): the file-type slot this sheet fills. */
  type?: FileType | null;
  /** Reference month derived from the sheet's date-range header, e.g. "Agu 2026". */
  periode?: string;
}

/** The 12 recognised export file types (tool `TYPES` registry). */
export type FileType =
  | 'shop_tt'
  | 'shop_tp'
  | 'prod_tt'
  | 'prod_tp'
  | 'vid_toko'
  | 'vid_aff'
  | 'live_toko'
  | 'live_aff'
  | 'aff_kr'
  | 'aff_pr'
  | 'ads_prod'
  | 'ads_live';

/** Canonical order of the 12 file types (tool `Object.keys(TYPES)`). */
export const ALL_FILE_TYPES: readonly FileType[] = [
  'shop_tt', 'shop_tp', 'prod_tt', 'prod_tp', 'vid_toko', 'vid_aff',
  'live_toko', 'live_aff', 'aff_kr', 'aff_pr', 'ads_prod', 'ads_live',
];

/** The 16 MEA benchmark thresholds (tool `BENCH`). Sourced from `riset_awal_benchmark`. */
export type BenchKey =
  | 'cr'
  | 'refund'
  | 'vidPostToko'
  | 'vidSalesToko'
  | 'vidSalesAff'
  | 'gpmToko'
  | 'liveSesi'
  | 'liveJam'
  | 'liveGmvJam'
  | 'liveCtor'
  | 'krSales'
  | 'krKonsen'
  | 'skuSales'
  | 'roas'
  | 'adsDep'
  | 'spikeFlag';

export type Benchmark = Record<BenchKey, number>;

/** One month of the manually-entered 6-month GMV history (tool `HIST`). */
export interface HistRow {
  /** "YYYY-MM" */
  key: string;
  /** e.g. "Agu 2026" */
  label: string;
  gmv: string | number;
  order: string | number;
  flag: 'normal' | 'campaign' | 'belum' | 'masalah';
}

/**
 * The five Skor Kondisi Toko values (RAB-01/RAB-03). Vocabulary is DELIBERATELY
 * disjoint from the Blok C verdict enum (handoff §2.3). `belum_dapat_diukur` =
 * "no analysis engine for this platform"; it must never be conflated with
 * `mesin_belum_terbangun` ("engine ran, the store is genuinely weak").
 */
export type KondisiToko =
  | 'mesin_jalan'
  | 'mesin_sebagian'
  | 'fondasi_perlu_dibenahi'
  | 'mesin_belum_terbangun'
  | 'belum_dapat_diukur';

/** A finding: severity level + text. Levels order = tantangan → perhatian → catatan → modal. */
export interface Finding {
  lv: 'tantangan' | 'perhatian' | 'catatan' | 'modal';
  t: string;
}
