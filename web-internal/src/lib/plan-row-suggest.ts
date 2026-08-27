/**
 * QA (2026-08-26): on `/account/plan/{id}`, picking a Strategi pillar (PC-3)
 * for a new Plan row only recorded the link — the pillar's own `aksi`/`target`
 * (e.g. "30 video, jembatan Video bertayangan / bulan" from AM Co-Pilot, or
 * free text the AM typed straight into Section E) never reached the row, so
 * the AM re-typed exactly what Section E already had. This is a pure
 * suggestion adapter (RAB-19 usulan→konfirmasi pattern, same shape as
 * `strategi-video-factory.ts`/`strategi-baseline-inherit.ts`): the caller
 * only applies a suggested field when the AM's own field is still empty, and
 * divisi PIC is set from a closed, unambiguous subset of pillar jenis — `sku`
 * / `harga` / `retensi` have no single owning division and are left for the
 * AM to pick.
 */
import type { StrategiPillar } from './strategi';

export const PILAR_TO_DIVISI: Record<string, string> = {
  konten: 'Creative',
  iklan: 'Ads',
  affiliate: 'KOL',
  live: 'Live Stream',
  operasional: 'Ops',
};

/** Leading "<angka> <satuan>" in a pillar's target text, e.g. "30 video, jembatan …". */
const RE_TARGET_QTY = /^(\d+(?:[.,]\d+)?)\s*([^\s,]+)?/;

export interface PlanRowSuggestion {
  aksi: string;
  kuota: string;
  satuan: string;
  divisiPic: string | null;
  /** PC-5 — the pillar's own SKU (E-3/E-4), when it names exactly one. */
  skuSasaran: string[];
}

export function suggestRowFromPillar(p: StrategiPillar): PlanRowSuggestion {
  const m = RE_TARGET_QTY.exec((p.target ?? '').trim());
  const sku = (p.sku ?? '').trim();
  return {
    aksi: (p.aksi ?? '').trim(),
    kuota: m ? m[1].replace(',', '.') : '',
    satuan: m?.[2] ?? '',
    divisiPic: PILAR_TO_DIVISI[p.jenis] ?? null,
    skuSasaran: sku ? [sku] : [],
  };
}
