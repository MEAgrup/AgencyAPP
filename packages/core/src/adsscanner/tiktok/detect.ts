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

/**
 * Turn the AoA into header-keyed row objects, starting one row after `headerRow`.
 *
 * **Kolom dengan NAMA SAMA: yang PERTAMA menang**, kemunculan berikutnya
 * disimpan di bawah kunci bersuffix `nama#<indeks kolom>` — persis aturan
 * `../../baseline/sheet.ts:readSheet`, supaya satu repo tidak punya dua aturan
 * untuk masalah yang sama, dan tidak ada kolom yang hilang diam-diam.
 *
 * ⚠️ Ini SATU-SATUNYA titik yang MENYIMPANG dari tool asalnya
 * (`docs/design/TIKTOK_ADS_SCANNER.html:414-431`, `o[hdr[c]] = v` polos ⇒ yang
 * TERAKHIR menang) — dan penyimpangannya disengaja, lihat `docs/DECISIONS.md`
 * 2026-09-04 "O70". Alasannya terbukti dari export ASLI (UAT Avitaskin Juli
 * 2026, `docs/handoff/UAT_TIKTOK_AVITASKIN_20260904.md`): "Analitik Produk"
 * yang sebenarnya bukan tabel datar — ia **176 kolom dalam 5 seksi**
 * (baris di ATAS header memberi label seksi: `Semua`, `LIVE penjual`,
 * `Video penjual`, `Afiliasi`, `Kartu produk penjual`) dan **30 nama kolom
 * berulang di tiap seksi** (`GMV`, `Pesanan SKU`, `Impresi produk`, `CTR`,
 * `CTOR (pesanan SKU)`, …).
 *
 * Dengan aturan tool (terakhir menang), SETIAP metrik headline SKU terbaca dari
 * seksi TERAKHIR — "Kartu produk penjual" — bukan dari total toko:
 * ΣGMV terbaca Rp3.743.633 padahal totalnya Rp26.560.049 (86% GMV hilang),
 * Σimpresi 55.345 vs 832.842. Angka yang benar ada di kemunculan PERTAMA
 * (seksi `Semua`), dan itu terkonfirmasi silang: Σ kolom pertama persis sama
 * dengan GMV di export Analitik Toko (`shop_tt`) untuk periode yang sama.
 *
 * Fixture 14-kolom di test lama tidak punya nama berulang sama sekali, jadi
 * bug ini tidak mungkin muncul sebelum ada export sungguhan.
 */
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
      // First occurrence wins; a later same-named column keeps its own key.
      o[Object.prototype.hasOwnProperty.call(o, hdr[c]) ? `${hdr[c]}#${c}` : hdr[c]] = v;
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
