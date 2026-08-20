/**
 * RAB-08 — the Interview door stops re-asking what upstream already answered.
 *
 * By the time the AM reaches Blok B, two of its scored questions have already
 * been answered: **B2-9 (AOV)** and **B2-3 (jumlah SKU)** come out of Riset Awal
 * (RAB-05 auto-fill) and, once confirmed, are the AUTHORITATIVE inputs the score
 * reads (RAB-06 — the server ignores whatever Blok B carries for these two). So
 * asking the AM to type them again is pure re-entry: the answer would be thrown
 * away by the scorer, and a mismatch between the two boxes reads as a bug.
 *
 * This module computes which Blok B fields are already answered by Riset Awal so
 * the form can render them as "terisi dari Riset Awal" (value shown, no input)
 * with a "berbeda dari data" path back to the ONE place a correction belongs —
 * the Riset Awal confirmation grid, where the number and the score move together.
 *
 * ## What is deduped (QA pemilik 2026-08-20 widened this)
 *
 * Four upstream-answered scored numbers are deduped, each with its unit already
 * resolved so folding it in cannot corrupt the score:
 *  - **B2-9** (AOV) and **B2-3** (SKU) from Riset Awal (`sumber=analisa|manual`).
 *  - **B1-5** (omzet 3 bulan) from Riset Awal as a 3-month TOTAL (`runrate_3m × 3`
 *    / `gmv_bulan × 3`) — NOT the raw monthly `median_6m` the earlier §5.2 note
 *    guarded against; the ×3 is applied server-side in `riset-awal.ts`.
 *  - **B6-3** (target omzet 3 bulan) from the client's Target GMV
 *    (`sumber=sales`, `target_gmv × 3` — Target GMV is captured monthly).
 * `B3-3`/`B7-3` stay interview questions (human judgement); `median_6m` still
 * never becomes B1-5. The one correction path stays the Riset Awal confirmation
 * grid, where the number and the score move together.
 */

import { formatIDR } from './money';
import { INTERVIEW_FIELDS } from './interview-fields';
import type { RisetAwalBaseline, RisetAwalIsian } from './riset-awal';

/** The interview fields an upstream source can safely pre-answer. */
export const DEDUP_FIELD_KEYS = ['B2-9', 'B2-3', 'B1-5', 'B6-3'] as const;
export type DedupFieldKey = (typeof DEDUP_FIELD_KEYS)[number];

export interface DedupInfo {
  fieldKey: string;
  label: string;
  /** Human-readable value carried over from Riset Awal. */
  display: string;
  /** Where it came from, e.g. "Riset Awal (analisa)". */
  source: string;
  /** Has the AM confirmed the number (keputusan 1)? */
  confirmed: boolean;
}

export interface DedupResult {
  /** field_key → the answer Riset Awal already provides. Empty when nothing applies. */
  byField: Map<string, DedupInfo>;
}

function fieldLabel(fieldKey: string): string {
  return INTERVIEW_FIELDS.find((f) => f.fieldKey === fieldKey)?.label ?? fieldKey;
}

/** Is this auto-filled row a money value? (B2-9 AOV, B1-5 omzet, B6-3 target.)
 *  Others (B2-3 SKU) are counts. */
function isMoney(f: RisetAwalIsian): boolean {
  return f.nilai_uang != null || f.field_key === 'B2-9' || f.field_key === 'B1-5' || f.field_key === 'B6-3';
}

function display(f: RisetAwalIsian): string {
  if (isMoney(f)) return f.nilai_uang == null ? '—' : formatIDR(Number(f.nilai_uang) / 100);
  return f.nilai_angka == null ? '—' : String(f.nilai_angka);
}

function sourceLabel(sumber: string): string {
  if (sumber === 'analisa') return 'Riset Awal (analisa)';
  if (sumber === 'manual') return 'Riset Awal (manual)';
  if (sumber === 'sales') return 'Data Klien (Target GMV)';
  return 'Riset Awal';
}

/**
 * Compute the dedup map from the loaded baseline. `null`/empty baseline yields an
 * empty map — the form then behaves exactly as before (every field asked).
 */
export function computeDedup(baseline: RisetAwalBaseline | null): DedupResult {
  const byField = new Map<string, DedupInfo>();
  if (!baseline) return { byField };
  const dedupKeys = new Set<string>(DEDUP_FIELD_KEYS);
  for (const f of baseline.isian) {
    if (!dedupKeys.has(f.field_key)) continue;
    byField.set(f.field_key, {
      fieldKey: f.field_key,
      label: fieldLabel(f.field_key),
      display: display(f),
      source: sourceLabel(f.sumber),
      confirmed: f.dikonfirmasi,
    });
  }
  return { byField };
}
