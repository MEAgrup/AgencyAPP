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
 * ## Deliberately NARROW
 *
 * Only the two riset-awal scored numbers are deduped. The client's sales record
 * (gmv_baseline / target_gmv) is shown as read-only CONTEXT elsewhere but is NOT
 * folded into a scored field: `median_6m`→`B1-5` is a ~3× unit mismatch (handoff
 * §5.2), and `B3-3`/`B7-3` stay interview questions (human judgement). Widening
 * this set would silently corrupt the score — exactly what RAB-08 must not do.
 */

import { formatIDR } from './money';
import { INTERVIEW_FIELDS } from './interview-fields';
import type { RisetAwalBaseline, RisetAwalIsian } from './riset-awal';

/** The interview fields an upstream source can safely pre-answer. */
export const DEDUP_FIELD_KEYS = ['B2-9', 'B2-3'] as const;
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

/** Is this auto-filled row a money value? (B2-9 AOV.) Others are counts. */
function isMoney(f: RisetAwalIsian): boolean {
  return f.nilai_uang != null || f.field_key === 'B2-9';
}

function display(f: RisetAwalIsian): string {
  if (isMoney(f)) return f.nilai_uang == null ? '—' : formatIDR(Number(f.nilai_uang) / 100);
  return f.nilai_angka == null ? '—' : String(f.nilai_angka);
}

function sourceLabel(sumber: string): string {
  if (sumber === 'analisa') return 'Riset Awal (analisa)';
  if (sumber === 'manual') return 'Riset Awal (manual)';
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
