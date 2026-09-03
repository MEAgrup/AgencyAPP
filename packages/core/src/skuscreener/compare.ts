/**
 * R09-R12 — before/after SKU matching and verdicts.
 *
 * Two DIFFERENT verdict vocabularies exist in the PRD for two DIFFERENT
 * modules, and this file keeps them apart rather than merging them:
 *
 *  - Module B (plain two-period comparison, §3.2/§5.4, `compareBeforeAfter`):
 *    no `change_type` is collected here — the shipped tool's Module B compares
 *    CTR AND CR generically and calls it MEMBAIK the moment EITHER clears
 *    +20% (`(dCTR>=20)||(dCR>=20)`). Verdict enum: MEMBAIK / TIDAK BERUBAH /
 *    MEMBURUK / BELUM CUKUP DATA (R11).
 *
 *  - Module D (Optimization Tracker, §5.3, `evaluateOptimization`): EACH
 *    record declares exactly ONE `change_type`, which R12 maps to exactly ONE
 *    metric (CTR or CR) — the verdict is judged SOLELY on that one metric,
 *    never "either". Verdict enum: BERHASIL / TIDAK BERUBAH / MEMBURUK /
 *    BELUM CUKUP DATA (§5.3's own — note "BERHASIL", not "MEMBAIK").
 *
 * Conflating the two would silently violate R12 ("Metrik yang dinilai
 * ditentukan oleh jenis perubahan yang dilakukan") for the Tracker, or invent
 * a change_type Module B never asked for.
 */

const relDeltaPct = (before: number, after: number): number => {
  if (!isFinite(before) || !(before > 0) || !isFinite(after)) return NaN;
  return (after / before - 1) * 100;
};

// ── R09: SKU key matching ───────────────────────────────────────────────

/** R09/§5.4 normalize: lowercase, strip non-alphanumeric, trim. */
export function normalizeProductName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** R09: Kode Produk as primary key; empty/absent Kode Produk falls back to the normalized name. */
export function skuKey(kode: string, produk: string): string {
  const k = (kode ?? '').trim();
  return k !== '' ? k : normalizeProductName(produk);
}

export interface MatchedPair<T> {
  key: string;
  before: T;
  after: T;
}

/**
 * §5.4 `matchSKUs`: primary key Kode Produk, fallback normalized name.
 * Unmatched SKUs are silently skipped (not an error) — a period-over-period
 * export naturally drops/adds SKUs.
 */
export function matchSkus<T extends { kode: string; produk: string }>(
  before: readonly T[],
  after: readonly T[],
): MatchedPair<T>[] {
  const byKey = new Map(before.map((r) => [skuKey(r.kode, r.produk), r]));
  const out: MatchedPair<T>[] = [];
  for (const a of after) {
    const key = skuKey(a.kode, a.produk);
    const b = byKey.get(key);
    if (!b) continue;
    out.push({ key, before: b, after: a });
  }
  return out;
}

// ── R10/R11: Module B — generic two-period comparison ───────────────────

export type CompareVerdict = 'MEMBAIK' | 'TIDAK BERUBAH' | 'MEMBURUK' | 'BELUM CUKUP DATA';

export interface ComparePeriodMetrics {
  views: number;
  clicks: number;
  ctr: number;
  cr: number;
  orders: number;
  gmv: number;
}

export interface CompareResult {
  deltaCtrPct: number;
  deltaCrPct: number;
  deltaViewsPct: number;
  deltaGmvPct: number;
  verdict: CompareVerdict;
}

/**
 * R10 (min 20 clicks after) + R11 (±20%/-10% thresholds) for Module B's plain
 * before/after comparison. `minClicksAfter` defaults to 20 (PRD default /
 * shipped tool's `minKlik` input default).
 */
export function compareBeforeAfter(
  before: ComparePeriodMetrics,
  after: ComparePeriodMetrics,
  minClicksAfter = 20,
): CompareResult {
  const deltaCtrPct = relDeltaPct(before.ctr, after.ctr);
  const deltaCrPct = relDeltaPct(before.cr, after.cr);
  const deltaViewsPct = relDeltaPct(before.views, after.views);
  const deltaGmvPct = relDeltaPct(before.gmv, after.gmv);

  let verdict: CompareVerdict;
  if (after.clicks < minClicksAfter) {
    verdict = 'BELUM CUKUP DATA'; // R10
  } else if ((isFinite(deltaCtrPct) && deltaCtrPct >= 20) || (isFinite(deltaCrPct) && deltaCrPct >= 20)) {
    verdict = 'MEMBAIK'; // R11
  } else if ((isFinite(deltaCtrPct) && deltaCtrPct <= -10) || (isFinite(deltaCrPct) && deltaCrPct <= -10)) {
    verdict = 'MEMBURUK';
  } else {
    verdict = 'TIDAK BERUBAH';
  }
  return { deltaCtrPct, deltaCrPct, deltaViewsPct, deltaGmvPct, verdict };
}

// ── R12: Module D — Optimization Tracker (change-type-aware) ────────────

/** §5.3 REF — the 10 recognised change types. */
export const CHANGE_TYPES = [
  'Gambar utama',
  'Judul produk',
  'Video produk',
  'Thumbnail & badge',
  'Deskripsi',
  'Foto detail & ukuran',
  'Harga',
  'Voucher/promo',
  'Bundling/minimum belanja',
  'Dorong ulasan',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** R12: perubahan yang memengaruhi KLIK dinilai lewat CTR. */
const CTR_CHANGE_TYPES: ReadonlySet<ChangeType> = new Set(['Gambar utama', 'Judul produk', 'Video produk', 'Thumbnail & badge']);

/** R12: perubahan yang memengaruhi CLOSING dinilai lewat CR (the remaining 6 types). */
export function metricEvaluatedFor(changeType: ChangeType): 'CTR' | 'CR' {
  return CTR_CHANGE_TYPES.has(changeType) ? 'CTR' : 'CR';
}

/** R12: "Sistem MENOLAK record yang mencatat dua jenis sekaligus." No BI bracket text is given by the PRD for this specific case (a Tracker validation, not a Screening/A3 one) — the message is written in-house convention but is NOT a verbatim PRD string; flagged for confirmation. */
export const MSG_DUA_JENIS_PERUBAHAN = '[satu record optimasi hanya boleh mencatat satu jenis perubahan]';

export class DuaJenisPerubahanError extends Error {
  constructor() {
    super(MSG_DUA_JENIS_PERUBAHAN);
    this.name = 'DuaJenisPerubahanError';
  }
}

/** §5.3's own verdict vocabulary — note BERHASIL, distinct from Module B's MEMBAIK. */
export type OptimizationVerdict = 'BERHASIL' | 'TIDAK BERUBAH' | 'MEMBURUK' | 'BELUM CUKUP DATA';

export interface OptimizationMetrics {
  views: number;
  clicks: number;
  ctr: number;
  cr: number;
  orders: number;
}

export interface OptimizationEvaluation {
  metricEvaluated: 'CTR' | 'CR';
  /** Delta of ONLY `metricEvaluated` — never "whichever moved more". NaN before ≥14 days / <20 clicks after. */
  deltaMetricPct: number;
  verdict: OptimizationVerdict;
}

/**
 * R12/R10/R11 for the Optimization Tracker (Module D, §5.3/§3.4 D4). Exactly
 * ONE change type per record — passing more than one throws
 * `DuaJenisPerubahanError` (R12's explicit rejection), it is never silently
 * merged or averaged.
 *
 * `after` is `null` before the ≥14-day/≥20-click "sesudah" data is filled in
 * (Flow D3) — resolves to BELUM CUKUP DATA, same as `after.clicks < minClicksAfter`.
 */
export function evaluateOptimization(
  changeTypes: ChangeType | readonly ChangeType[],
  before: OptimizationMetrics,
  after: OptimizationMetrics | null,
  minClicksAfter = 20,
): OptimizationEvaluation {
  const types = Array.isArray(changeTypes) ? changeTypes : [changeTypes];
  if (types.length !== 1) throw new DuaJenisPerubahanError();
  const metricEvaluated = metricEvaluatedFor(types[0]);

  if (!after || after.clicks < minClicksAfter) {
    return { metricEvaluated, deltaMetricPct: NaN, verdict: 'BELUM CUKUP DATA' };
  }

  const beforeVal = metricEvaluated === 'CTR' ? before.ctr : before.cr;
  const afterVal = metricEvaluated === 'CTR' ? after.ctr : after.cr;
  const deltaMetricPct = relDeltaPct(beforeVal, afterVal);

  let verdict: OptimizationVerdict;
  if (isFinite(deltaMetricPct) && deltaMetricPct >= 20) verdict = 'BERHASIL';
  else if (isFinite(deltaMetricPct) && deltaMetricPct <= -10) verdict = 'MEMBURUK';
  else verdict = 'TIDAK BERUBAH';

  return { metricEvaluated, deltaMetricPct, verdict };
}
