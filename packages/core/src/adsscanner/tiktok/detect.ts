/**
 * TikTok Ads Scanner engine — file-type detection (tool `FILE_SIGS` + `detectSheet`).
 * Ported from `docs/design/TIKTOK_ADS_SCANNER.html:391-431`.
 *
 * Unlike `../../baseline/sheet.ts:readSheet` (which auto-detects the header
 * row via a generic "most unique labels" heuristic because the 12 Seller
 * Center exports vary), these 4 exports each have a FIXED, known header row
 * — so detection here checks the exact expected row for the signature's
 * required columns, exactly like the tool. This module therefore consumes
 * the raw array-of-arrays (`Aoa`), not an already-`readSheet`'d `Sheet`.
 *
 * ⛔ JANGAN ubah string nama kolom pada signature — itu satu-satunya cara
 * file dikenali (same rule as every other detect.ts in this codebase).
 */
import type { Aoa } from '../../baseline/types';
import type { AdsScannerFileType, Row, VideoKind } from './types';

interface FileSig {
  key: AdsScannerFileType;
  headerRow: number;
  must: string[];
  label: string;
}

/** The 4 file signatures (tool `FILE_SIGS`). Order is the tool's own detection order. */
export const FILE_SIGS: readonly FileSig[] = [
  { key: 'analitik', headerRow: 3, must: ['Nama', 'ID Produk', 'GMV'], label: 'Analitik Produk' },
  { key: 'ads', headerRow: 0, must: ['Nama kampanye', 'ID produk', 'Biaya'], label: 'Ads Produk' },
  { key: 'video', headerRow: 2, must: ['Nama Kreator', 'ID Video', 'Produk', 'VV'], label: 'Video (Kreator/Toko)' },
  { key: 'adslive', headerRow: 0, must: ['Nama LIVE', 'Nama kampanye', 'Biaya'], label: 'Ads Live' },
];

export type DetectResult =
  | { type: AdsScannerFileType; label: string; headerRow: number }
  | { type: 'wrong_summary'; label: string }
  | null;

const cellText = (x: unknown): string => (x == null ? '' : String(x)).trim();

/** Classify a raw sheet (array-of-arrays) by its exact header row. Mirrors tool `detectSheet`. */
export function detectAoa(rowsRaw: Aoa): DetectResult {
  for (const sig of FILE_SIGS) {
    const hdr = (rowsRaw[sig.headerRow] ?? []).map(cellText);
    if (sig.must.every((m) => hdr.includes(m))) return { type: sig.key, label: sig.label, headerRow: sig.headerRow };
  }
  // Wrong export detected: a "Ringkasan data" (summary) export instead of per-SKU.
  const flat = rowsRaw.slice(0, 4).flat().map(cellText);
  if (flat.includes('Ringkasan data')) return { type: 'wrong_summary', label: 'Ringkasan Data (bukan per-SKU)' };
  return null;
}

/** Turn the AoA into header-keyed row objects, starting one row after `headerRow`. Mirrors tool `rowsToObjects`. */
export function rowsToObjects(rowsRaw: Aoa, headerRow: number): Row[] {
  const hdr = (rowsRaw[headerRow] ?? []).map(cellText);
  const out: Row[] = [];
  for (let i = headerRow + 1; i < rowsRaw.length; i++) {
    const r = rowsRaw[i];
    if (!r || !r.length) continue;
    const o: Row = {};
    let any = false;
    for (let c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      const v = r[c];
      o[hdr[c]] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
    }
    if (any) out.push(o);
  }
  return out;
}

export interface VideoKindResult {
  kind: VideoKind;
  /** True when the kind could not be confidently decided (filename gave no signal, fell back to a creator-count heuristic) — the caller/UI should let the AM confirm/swap, exactly like the tool's "Tukar ke …" affordance. */
  ambiguous: boolean;
}

/**
 * Classify a detected `video` sheet as the shop's own uploads ("toko") or
 * affiliate creators' ("kreator"). The tool decides this from the download
 * FILENAME first, falling back to a unique-creator-count heuristic — ported
 * faithfully (not "fixed"): unlike `../../baseline/detect.ts`'s equivalent
 * problem, there is no CDPS-side linked-account list to consult from this
 * pure, DB-free engine in this pass, so the caller (future UI) is expected
 * to let the AM override via `ambiguous`, matching the tool's own manual
 * swap control.
 */
export function classifyVideoKind(rows: Row[], filename?: string): VideoKindResult {
  const fn = filename ?? '';
  if (/bisnis|business|toko|seller/i.test(fn)) return { kind: 'toko', ambiguous: false };
  if (/aff|kreator|creator/i.test(fn)) return { kind: 'kreator', ambiguous: false };
  const uniq = new Set(rows.map((r) => cellText(r['Nama Kreator'])));
  return { kind: uniq.size <= 3 ? 'toko' : 'kreator', ambiguous: true };
}
