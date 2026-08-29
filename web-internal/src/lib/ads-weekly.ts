// Typed wrapper over lib/api.ts for the M8 Advertiser weekly report per Brief
// (follow-up PR #172, keputusan pemilik 2026-08-19).
//
// The report is the Advertiser's narrative — analisa performa + saran perbaikan
// per brief per ISO week. It stores NO numbers: the six weekly metrics ship
// already recomputed from the brief's metric_entries and pre-formatted by the
// server ("—" for a division by zero / an absent figure), so this file never
// formats money. Realisasi-only by owner decision — per-brief targets live in
// Strategy, not here.
//
// Shapes mirror apps/api/src/lib/wire.ts EXACTLY (snake_case, explicit nulls —
// a missing key is worse than a null, per CLAUDE.md's O43 note).

import { api } from '@/lib/api';

/** One recomputed metric inside a weekly row. `sifat`: 'serapan' | 'pencapaian'. */
export interface AdsWeeklyMetric {
  key: string;
  label: string;
  sifat: string;
  realisasi: number | null;
  realisasi_display: string;
}

export interface AdsWeeklyReport {
  brief_id: string;
  iso_year: number;
  iso_week: number;
  minggu_mulai: string; // "YYYY-MM-DD" (Senin WIB)
  minggu_akhir: string; // "YYYY-MM-DD" (Minggu WIB)
  metrik: AdsWeeklyMetric[];
  berjalan: boolean;
  terisi: boolean;
  terlambat: boolean;
  jenis: string; // M16 LT-43 — Weekly (default) | Mini | Monthly | Content Analysis
  analisa: string;
  saran: string;
  kendala: string;
  diisi_oleh: string;
  diisi_pada: string | null; // RFC3339
}

export interface AdsWeeklyReportView {
  brief_id: string;
  minggu: AdsWeeklyReport[];
  belum_diisi: number;
  dipotong: boolean;
}

/** Request body for filing one week. `minggu_mulai` "" = the current week. */
export interface AdsWeeklyReportPayload {
  minggu_mulai: string;
  analisa: string;
  saran: string;
  kendala: string;
}

export function getAdsWeeklyReports(briefId: string): Promise<AdsWeeklyReportView> {
  return api.get<AdsWeeklyReportView>(`/briefs/${briefId}/weekly-reports`);
}

export function fileAdsWeeklyReport(
  briefId: string,
  payload: AdsWeeklyReportPayload,
): Promise<AdsWeeklyReport> {
  return api.post<AdsWeeklyReport>(`/briefs/${briefId}/weekly-reports`, payload);
}

/**
 * weekLabel renders "Minggu 33 · 10–16 Agu 2026" for a week row. Kept here (not
 * in the page) so the list and the filing form label a week identically.
 */
export function weekLabel(w: { iso_week: number; minggu_mulai: string; minggu_akhir: string }): string {
  return `Minggu ${w.iso_week} · ${shortDate(w.minggu_mulai)}–${shortDate(w.minggu_akhir)}`;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-08-10" → "10 Agu 2026". Returns the input unchanged if it is not a date. */
function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (m === null) return ymd;
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
