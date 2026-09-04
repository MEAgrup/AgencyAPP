/**
 * TikTok Ads Scanner — presentation helpers for `/ads/scanner` (AS-05).
 *
 * Framework-free and pure on purpose, so every rendering rule that could be
 * wrong in a way a reader would not notice is unit-tested — the same split
 * `skuscreener-ui.ts` and `nav.ts` follow. Nothing here decides anything:
 * scores, buckets, gates, the verdict and the reallocation pool all arrive
 * already computed in the frozen scan payload. This file only chooses how they
 * read.
 *
 * ## Units, stated once — and NOT the same as the SKU Screener's
 *
 * This is the one thing to get right on this page. Ads Scanner payload
 * percentages are **FRACTIONS**: `0.05` means 5%. The engine's cell parser
 * (`baseline/angka.ts:n`) divides by 100 whenever it sees a `%` in the cell, so
 * a `"5%"` CTR column lands in the payload as `0.05`, and the engine's own HTML
 * renderer multiplies by 100 on the way out (`pct` in that same file).
 *
 * The SKU Screener payload is the **opposite**: its `ctr`/`cr` are percent
 * NUMBERS (`2.0` means 2%), because R04's floors are literally `2.0`/`0.5`.
 * That is why `skuscreener-ui.ts:fmtPct` does NOT multiply and `fmtPct` here
 * DOES. Using either page's formatter on the other's payload is off by 100× —
 * a CTR of 5% reading as `0,05%` or `500%`, both plausible enough to go
 * unnoticed. Hence two modules, and hence the test that pins both directions.
 *
 * House rule #7 holds throughout: a value with no basis renders `—`, never
 * `0`, `NaN` or an error. In this payload a `null` is always a deliberate "no
 * basis" written by `metrik.ts`/`skor.ts` (no impressions, no clicks, no ad
 * spend), so it must never be coerced to zero on the way to the screen.
 */

/** Every value that is missing, non-finite, or has no basis renders as this. */
export const EMPTY = '—';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** id-ID integer with thousand dots: `1.234.567`. `—` when there is no number. */
export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? Math.round(v).toLocaleString('id-ID') : EMPTY;
}

/** A plain number with up to `digits` decimals: `4` → `4`, `3.57` → `3,57`. */
export function fmtDec(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY;
  return v.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/**
 * A FRACTION as a percentage: `0.05` → `5,0%`.
 *
 * Multiplies by 100 — the payload value is a fraction, not a percentage. This
 * is the inverse of `skuscreener-ui.ts:fmtPct`; see the module header. Tested
 * in both directions.
 */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return EMPTY;
  return `${(v * 100).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/**
 * IDR in house format: `Rp. 1.234.567,00`.
 *
 * Matches the engine renderer's own `rp` (`baseline/angka.ts`) exactly —
 * rounded to whole rupiah with a literal `,00` — so a figure read on this page
 * and the same figure read in the scan's rendered HTML never differ by a cent.
 * That is deliberately different from `skuscreener-ui.ts:fmtRupiah`, which
 * keeps real cents because a CPC maximum of `Rp. 1.234,56` is meaningful at
 * that precision; nothing in THIS payload is (budgets, GMV, spend, GPM).
 */
export function fmtRupiah(v: number | null | undefined): string {
  return isNum(v) ? `Rp. ${Math.round(v).toLocaleString('id-ID')},00` : EMPTY;
}

/** A ratio as a multiplier: `3.82` → `3,82×`. `—` when there is no basis (e.g. zero ad spend). */
export function fmtRoi(v: number | null | undefined, digits = 2): string {
  return isNum(v) ? `${v.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits })}×` : EMPTY;
}

// ---------------------------------------------------------------------------
// Tones. Badge classes are the ones `globals.css` actually defines
// (`badge-green` … `badge-darkgray`) — NOT the `badgeSuccess` family, which is
// styled nowhere and renders colourless (a pre-existing bug in `ReportPanel`,
// noted in the Gelombang 4 handoff; not repeated here).
// ---------------------------------------------------------------------------
export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'darkgray' | 'purple';

/**
 * Tone for one of the 6 decision buckets.
 *
 * Grouped by what the advertiser should DO, which is why two greens exist and
 * are not merged: `SCALE UP` and `STOK VIDEO CUKUP` are both "spend here", the
 * difference being whether it is already running. `BOROS` and `BANGUN KONTEN`
 * are both red but for opposite reasons (money going to a content-dry SKU vs.
 * no money and no content yet) — the label carries that, the colour only says
 * "do not add budget".
 */
export function bucketTone(bucket: string): Tone {
  switch (bucket) {
    case 'SCALE UP': return 'green';
    case 'STOK VIDEO CUKUP': return 'blue';
    case 'PERLU OPTIMASI': return 'amber';
    case 'BANGUN KONTEN': return 'red';
    case 'BOROS': return 'red';
    case 'DIBLOKIR': return 'darkgray';
    default: return 'gray';
  }
}

/** Tone for the content gate (video-count volume tier). */
export function gateTone(gate: string): Tone {
  switch (gate) {
    case 'KUAT': return 'green';
    case 'CUKUP': return 'blue';
    case 'TIPIS': return 'amber';
    case 'KERING': return 'red';
    default: return 'gray';
  }
}

/** Tone for the account-level verdict (`payload.vonis.label`). */
export function vonisTone(label: string): Tone {
  switch (label) {
    case 'SEHAT': return 'green';
    case 'PERBAIKI': return 'amber';
    case 'RISIKO': return 'red';
    case 'KRITIS': return 'red';
    default: return 'gray';
  }
}

/**
 * The 6 buckets in the order the SOP works them, NOT the order the engine
 * happens to emit.
 *
 * Money first: `BOROS` is spend actively being wasted this week and `PERLU
 * OPTIMASI` is spend underperforming, so both outrank `SCALE UP` — which is an
 * opportunity, not a leak. `DIBLOKIR` is last because it needs no action
 * beyond a note in the client report.
 */
export const BUCKET_ORDER: readonly string[] = [
  'BOROS', 'PERLU OPTIMASI', 'SCALE UP', 'STOK VIDEO CUKUP', 'BANGUN KONTEN', 'DIBLOKIR',
];

/** Sort buckets into `BUCKET_ORDER`; anything unrecognised sorts last rather than vanishing. */
export function byBucketOrder(a: string, b: string): number {
  const ia = BUCKET_ORDER.indexOf(a);
  const ib = BUCKET_ORDER.indexOf(b);
  return (ia === -1 ? BUCKET_ORDER.length : ia) - (ib === -1 ? BUCKET_ORDER.length : ib);
}

// ---------------------------------------------------------------------------
// File slots
// ---------------------------------------------------------------------------
/** The 4 slots the server detects, with the export each one names in Seller Center. */
export const SLOT_LABELS: Readonly<Record<string, string>> = {
  analitik: 'Analitik Produk',
  ads: 'Ads Produk',
  video: 'Video (Kreator/Toko)',
  adslive: 'Ads Live',
};

/** Human label for a detected slot. `null` (nothing recognised the file) reads as a statement, not a blank. */
export function slotLabel(peran: string | null | undefined): string {
  if (!peran) return 'tidak dikenali';
  return SLOT_LABELS[peran] ?? peran;
}

/**
 * Is this slot required for a scan to run at all?
 *
 * Only `analitik` — the SKU universe is built exclusively from Analitik Produk,
 * so without it the server rejects the scan (`MSG_ANALITIK_WAJIB`). Mirrors
 * that server gate so the form can say so BEFORE the upload round-trip, never
 * instead of it.
 */
export function slotRequired(peran: string): boolean {
  return peran === 'analitik';
}

/**
 * Which of the 4 slots is missing from a completed scan, for the "kelengkapan"
 * note.
 *
 * `adslive` is deliberately excluded from the "you are missing something"
 * nudge: the engine ACCEPTS it but never reads it (a faithful port of the
 * tool's own dead-but-harmless slot, flagged in O67 for a human decision on
 * whether Ads Live should feed a score component). Telling an advertiser to go
 * fetch a file that changes no number would be a false errand.
 */
export function missingSlots(kelengkapan: Partial<Record<string, boolean>> | null | undefined): string[] {
  const k = kelengkapan ?? {};
  return ['analitik', 'ads', 'video'].filter((s) => !k[s]);
}
