/**
 * TikTok Ads Scanner engine — shared types (`cdps.adsscanner.tiktok.v1`).
 *
 * Ported from the owner's `MEA SKU Triage — Panel Advertiser` HTML tool
 * (`docs/design/TIKTOK_ADS_SCANNER.html`, see `docs/DECISIONS.md` O67 —
 * PORT PENUH, 2026-09-03). Sibling of `../../baseline` and `../../report`:
 * same purity contract (no DOM, no xlsx dependency, no clock of its own).
 *
 * Scope of THIS pass (see task brief): score/bucket/reallocate ONE client's
 * dataset per run. The tool's multi-client portfolio + `localStorage`
 * persistence layer is NOT ported here — that is an open architecture
 * question (DECISIONS.md O67, "keputusan turunan yang perlu diambil saat
 * AS-01 dikerjakan") for a human to resolve before any DB/domain work starts.
 */

/** A raw sheet row as already parsed into an object keyed by column header. */
export type Row = Record<string, unknown>;

/** The 4 file-type slots the tool recognises (tool `FILE_SIGS`). */
export type AdsScannerFileType = 'analitik' | 'ads' | 'video' | 'adslive';

/**
 * Video files come in two kinds — the shop's own uploads vs. affiliate
 * creators' — which the tool cannot tell apart from the COLUMN signature
 * alone (both `vid_toko`/`vid_aff` share one signature in `../../baseline`
 * too). See `detect.ts:classifyVideoKind`.
 */
export type VideoKind = 'kreator' | 'toko';

/** Content-gate tier from video-count volume (tool `s.gate`). */
export type ContentGate = 'KUAT' | 'CUKUP' | 'TIPIS' | 'KERING';

/** The 6 decision buckets (tool `s.bucket`). */
export type Bucket = 'SCALE UP' | 'PERLU OPTIMASI' | 'STOK VIDEO CUKUP' | 'BANGUN KONTEN' | 'BOROS' | 'DIBLOKIR';

export const ALL_BUCKETS: readonly Bucket[] = [
  'SCALE UP', 'PERLU OPTIMASI', 'STOK VIDEO CUKUP', 'BANGUN KONTEN', 'BOROS', 'DIBLOKIR',
];

/** Audit-mode readiness label (tool `s.bucketAudit`, only set when `mode==='newclient'`). */
export type BucketAudit = 'BELUM SIAP' | 'HAMPIR SIAP' | 'SIAP DIIKLANKAN';

/** Review cadence (tool `cfg.mode`). Field name matches the tool verbatim — not a PRD status, so not house-translated. */
export type ScanMode = 'weekly' | 'newclient';

/** The 9 content-angle categories + the residual "not yet classified" bucket (tool `ANGLE_RULES`). */
export type AngleTag =
  | 'Balas Komen'
  | 'Problem–Solution'
  | 'Before–After'
  | 'Review / Testimoni'
  | 'Edukasi / Tutorial'
  | 'Unboxing / Paket'
  | 'Promo / Hard-sell'
  | 'Storytelling / POV'
  | 'Showcase Produk'
  | 'Belum Terklasifikasi';

/** Threshold + commercial config the AM can tune per client (tool `DEFAULT_CFG`). */
export interface AdsScannerConfig {
  /** >= this many videos ⇒ content gate KUAT. */
  gateScale: number;
  /** >= this many videos ⇒ content gate CUKUP. */
  gateConsider: number;
  /** >= this many videos ⇒ content gate TIPIS (below = KERING). */
  gateYellow: number;
  /** Daily test budget (Rp) suggested for STOK VIDEO CUKUP SKUs. */
  testBudgetDaily: number;
  /** Scale-up step, e.g. 0.5 = +50%. */
  scaleStepPct: number;
  /** AOV floor (Rp); 0 = disabled. */
  minAov: number;
  /** Excluded product IDs (margin/commercial rule), normalized 15-digit prefixes. */
  blacklist: string[];
  /** TikTok Shop Level-3 category — selects the benchmark row. */
  category: string;
  /** USD→IDR rate used to convert the category's GPM benchmark (which is in USD). */
  usdRate: number;
  /** Fallback "winner" percentile when the category has no GPM benchmark. */
  winnerPctl: number;
  mode: ScanMode;
}

export const DEFAULT_ADS_SCANNER_CFG: Omit<AdsScannerConfig, 'category'> = {
  gateScale: 1000,
  gateConsider: 100,
  gateYellow: 50,
  testBudgetDaily: 200000,
  scaleStepPct: 0.5,
  minAov: 0,
  blacklist: [],
  usdRate: 16300,
  winnerPctl: 0.75,
  mode: 'weekly',
};

/** One row of the category benchmark table (tool `BENCHMARKS[cat]`). Any field may be unmeasured for a category. */
export interface CategoryBench {
  /** Target ROI (x), e.g. 3.82. */
  roi: number | null;
  /** Target take-rate / commission (fraction), e.g. 0.13 = 13%. */
  tr: number | null;
  /** GMV per 1,000 views benchmark, in USD. */
  gpm: number | null;
}

/** The full category → benchmark table, keyed by TikTok Shop Level-3 category name. */
export type AdsScannerBench = Record<string, CategoryBench>;

/** A raw video record after file parsing (tool per-row shape inside `analyze()` step 2), before angle tagging. */
export interface VideoRecord {
  pid: string | null;
  kind: VideoKind;
  kreator: string;
  caption: string;
  videoId: string;
  waktu: string;
  vv: number;
  gmv: number;
  /** GMV per 1,000 views; derived from GMV/VV when the column is blank. Null when VV is 0 (no basis). */
  gpm: number | null;
  ctr: number;
  finish: number;
  produkNama: string;
  url: string;
}

/** A tagged video (VideoRecord + its classified content angle). Produced by `insight.ts:tagVideos`. */
export interface TaggedVideo extends VideoRecord {
  angle: AngleTag;
}

/** A raw ads row (tool per-row shape inside `analyze()` step 3). */
export interface AdRow {
  pid: string | null;
  cost: number;
  rev: number;
  ord: number;
  kampanye: string;
  videoId: string;
  akun: string;
  judul: string;
  jenis: string;
  otorisasi: string;
  ctr: number;
  cvr: number;
  roi: number;
}

/** Ad spend landing on a product ID absent from Analitik Produk — "SKU mati" (tool `orphanSpend`). */
export interface OrphanSpend {
  pid: string;
  cost: number;
  rev: number;
  creatives: number;
  kampanye: string[];
}

/** One SKU's full computed record (tool `sku` Map values after step 5). */
export interface SkuResult {
  pid: string;
  pidFull: string;
  nama: string;
  status: string;
  gmv: number;
  gmvKreator: number;
  gmvVideoToko: number;
  gmvLiveToko: number;
  pesanan: number;
  /** AOV; null when `pesanan<=0` (no basis — house rule #7), not silently 0. */
  aov: number | null;
  /** CTR; null when `impresi<=0` (no traffic data), not silently a worst-case 0%. */
  ctr: number | null;
  /** CTOR; null when `klik<=0`. */
  ctor: number | null;
  atc: number;
  impresi: number;
  klik: number;
  crVid: number;
  crUniq: number;
  crVv: number;
  crGmv: number;
  shopVid: number;
  shopVv: number;
  shopGmv: number;
  adCost: number;
  adRev: number;
  adOrders: number;
  adCreatives: number;
  konten: number;
  /** null when `adCost<=0` (no ad spend — no basis for ROI, not 0). */
  roi: number | null;
  /** null when `adOrders<=0`. */
  cpa: number | null;
  /** Median GPM (Rp) of this SKU's own-creator videos. */
  crGpm: number;
  /** GMV-from-creator share of this SKU's GMV; null when `gmv<=0`. */
  gmvKreatorPct: number | null;
  gate: ContentGate;
  blockers: string[];
  skor: number;
  skorRinci: { konten: number; gmv: number; efisiensi: number; ctr: number; ctor: number };
  diagnosa: string;
  bucket: Bucket;
  aksi: string;
  budgetHarian: number;
  scaleStep?: number;
  subMasalah?: 'Konversi bocor' | 'Kreatif lemah' | 'SKU lemah' | 'Efisiensi bidding';
  bucketAudit?: BucketAudit;
}

/** One row of the angle summary table (tool `angleTable()` output). */
export interface AngleRow {
  angle: AngleTag;
  jumlah: number;
  menang: number;
  winRate: number;
  gpmMedian: number;
  gmv: number;
  vv: number;
  lolosBenchmark: boolean;
  contoh: TaggedVideo[];
}

/** One row of the budget-reallocation table (tool `realokasi`). */
export interface RealokasiRow {
  pid: string;
  nama: string;
  bucket: Bucket;
  skor: number;
  tambahan: number;
}

/** Account-level rollup (tool `ringkasan`). Percentages/ratios are null, never 0, when their denominator is 0. */
export interface Ringkasan {
  kategori: string;
  benchmark: CategoryBench;
  skuTotal: number;
  skuAktifGmv: number;
  skuSiap: number;
  skuKering: number;
  totalGmv: number;
  totalSpend: number;
  totalRev: number;
  /** null when `totalSpend<=0` — no ad spend, no ROI to blend, not "0". */
  blendedRoi: number | null;
  /** null when `totalSpend<=0` — house rule #7 (div-by-zero → "—", not 0%). */
  pctSpendKering: number | null;
  /** null when `totalSpend<=0`. */
  pctSpendKuat: number | null;
  orphanSpend: number;
  orphanSku: number;
  kontenKreator: number;
  kontenToko: number;
  kreatorUnik: number;
  /** null when there is no video at all — not "0% have GMV". */
  videoBerGmvPct: number | null;
  poolRealokasi: number;
  medCtr: number;
  medCtor: number;
}
