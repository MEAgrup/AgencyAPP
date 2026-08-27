/**
 * Adapter: MEA Video Factory (`/tools/video-factory`, "AM - baseline riset") →
 * Riset Awal manual baseline entry (RAB-04 `ManualForm`).
 *
 * Reuses `strategi-video-factory.ts`'s parser as-is (same `cdps.section_b.v1`
 * payload the "Copy untuk CDPS Section B" button already emits, same schema
 * check, same `[...]` error strings) — the schema contract lives in ONE place;
 * this module only adds a second target for it (anti-duplication, CLAUDE.md).
 *
 * Riset Awal's manual entry only needs a few of the payload's fields: GMV/bulan
 * and order/bulan (from the B-1 baseline rows — each row is already the window
 * average per month, see `VfBaselineMonth`), and jumlah SKU siap jual (from
 * `sku_listed`, B-3.1 "SKU terdaftar" — the PRD's own B2-3 label). AOV, belanja
 * iklan, and ROAS are never in the payload (the tool has no monthly ad-spend
 * breakdown, only a window total it can't attribute per calendar month) and
 * stay manual, same as every other field absent from the export.
 *
 * SARAN, bukan pengisian paksa: hanya field yang masih KOSONG yang diisi — nilai
 * yang sudah diketik AM tidak pernah ditimpa. Sama persis dengan kontrak
 * Section B (2026-08-21) dan Riset Awal → Section B (RAB-19).
 *
 * Guard yang TIDAK ada di jalur Section B: payload video-factory selalu
 * membawa `channel.channel` ('TikTok Shop' atau 'Tokopedia' — tool tak punya
 * parser platform lain), jadi ditolak bila tidak cocok dengan tab platform yang
 * sedang dibuka. Tanpa guard ini, angka TikTok Shop/Tokopedia bisa diam-diam
 * menempel ke baseline platform lain (mis. Shopee) yang tidak pernah dianalisa
 * tool ini sama sekali.
 */
import { parseVideoFactoryPayload, type VideoFactoryPayload } from './strategi-video-factory';

export { parseVideoFactoryPayload };
export type { ParseResult } from './strategi-video-factory';

/** Mirrors `ManualFields` in `RisetAwalPanel.tsx` (structurally, not imported —
 *  the lib layer does not depend on components). */
export interface ManualBaselineFields {
  gmv_bulan: string;
  order: string;
  aov: string;
  sku_total: string;
  belanja_iklan: string;
  roas: string;
  periode_mulai: string;
  periode_akhir: string;
  tanggal_ambil: string;
}

export interface ManualApplySummary {
  fieldsFilled: number;
  fieldsSkipped: number;
}

export type ManualApplyResult =
  | { ok: true; fields: ManualBaselineFields; summary: ManualApplySummary }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Applies a parsed video-factory payload to the manual baseline form fields for
 * ONE platform tab. Rejects (rather than silently prefilling) when the
 * payload's channel doesn't match `platformLabel` — the tool can only ever
 * describe TikTok Shop or Tokopedia data, never any other platform.
 */
export function applyVideoFactoryToManual(
  current: ManualBaselineFields,
  payload: VideoFactoryPayload,
  platformLabel: string,
): ManualApplyResult {
  const chan = (payload.channel.channel || 'TikTok Shop').trim();
  if (chan.toLowerCase() !== platformLabel.trim().toLowerCase()) {
    return {
      ok: false,
      error: `[payload ini hasil analisa "${chan}", bukan "${platformLabel}" — Video Factory hanya bisa membaca export TikTok Shop atau Tokopedia, jalankan dengan export platform ini atau isi manual]`,
    };
  }

  let filled = 0;
  let skipped = 0;
  const next: ManualBaselineFields = { ...current };

  const fillIfBlank = (key: keyof ManualBaselineFields, value: string | null) => {
    if (value == null || value === '') return;
    if (next[key].trim() !== '') {
      skipped++;
      return;
    }
    next[key] = value;
    filled++;
  };

  const rows = payload.channel.baseline ?? [];
  const latest = rows.length ? rows.reduce((a, b) => (b.month_index > a.month_index ? b : a)) : null;
  fillIfBlank('gmv_bulan', latest?.gmv != null && latest.gmv !== '' ? String(latest.gmv) : null);
  fillIfBlank('order', latest?.jumlah_pesanan != null ? String(latest.jumlah_pesanan) : null);
  fillIfBlank('sku_total', payload.channel.sku_listed != null ? String(payload.channel.sku_listed) : null);

  const tgl = payload.channel.tanggal_ambil_data;
  if (typeof tgl === 'string' && DATE_RE.test(tgl)) {
    fillIfBlank('tanggal_ambil', tgl);
  }

  return { ok: true, fields: next, summary: { fieldsFilled: filled, fieldsSkipped: skipped } };
}
