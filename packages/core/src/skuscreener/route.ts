/**
 * R05 — the five-way SKU routing decision.
 *
 * Sequential if/else, in this EXACT order (PRD §2.2 R05 / shipped tool's
 * `run` handler) — order matters because SCALE/KANDIDAT IKLAN share the same
 * CTR-and-CR-above-median condition, split only by Views, and evaluating them
 * out of order would silently reclassify SCALE SKUs as KANDIDAT IKLAN:
 *
 *   1. SCALE:                    CTR≥median AND CR≥median AND Views≥median.
 *   2. KANDIDAT IKLAN:            CTR≥median AND CR≥median (Views < median).
 *   3. OPTIMASI GAMBAR/JUDUL:    Views≥median AND CTR<median.
 *   4. OPTIMASI DESKRIPSI/HARGA: CTR≥median AND CR<median.
 *   5. PARKIR:                   everything else.
 *
 * Precondition (R05 preamble): only called for SKUs with `views > 0` —
 * enforced upstream by `parse.ts#readPerformaProduk`.
 *
 * The R06 anti-rule and "TAHAN" market-CPC override, which can OVERRIDE
 * whatever `routeSku` returns here, live in `./cpc.ts` (they "mengalahkan
 * rute apapun" — the routing decision at this layer is the BASE route before
 * those two absolute overrides apply).
 */

/** The five R05 routes, using the exact PRD/UI labels (also the values stored/displayed). */
export type Rute = 'SCALE' | 'KANDIDAT IKLAN' | 'OPTIMASI GAMBAR/JUDUL' | 'OPTIMASI DESKRIPSI/HARGA' | 'PARKIR';

export interface RouteInput {
  /** Percent (e.g. `5.24` = 5.24%). NaN allowed — treated as "below median". */
  ctr: number;
  /** Percent. NaN allowed — treated as "below median". */
  cr: number;
  views: number;
}

export interface RouteMedians {
  ctr: number;
  cr: number;
  views: number;
}

export function routeSku(input: RouteInput, medians: RouteMedians): Rute {
  const ctrOk = isFinite(input.ctr) && input.ctr >= medians.ctr;
  const crOk = isFinite(input.cr) && input.cr >= medians.cr;
  const viewsHigh = input.views >= medians.views;

  if (ctrOk && crOk && viewsHigh) return 'SCALE';
  if (ctrOk && crOk) return 'KANDIDAT IKLAN';
  if (!ctrOk && viewsHigh) return 'OPTIMASI GAMBAR/JUDUL';
  if (ctrOk && !crOk) return 'OPTIMASI DESKRIPSI/HARGA';
  return 'PARKIR';
}
