// Typed wrapper over lib/api.ts for the M8 Ads Brief-as-task target metrics and
// the Advertiser's weekly report (keputusan pemilik 2026-08-14).
//
// Why these live on the BRIEF and not on the Ad Campaign: the targets are the
// work contract a SPV/Lead hands over together with the PIC — they exist before
// any campaign does. `ad_campaigns.target_kpi` (one free-text KPI per campaign)
// is untouched and stays the campaign's own field.
//
// Shapes mirror apps/api/src/lib/wire.ts EXACTLY (snake_case, explicit nulls —
// a missing key is worse than a null, per CLAUDE.md's O43 note). Every numeric
// field ships with its `*_display` twin already formatted by the server ("—" for
// a division by zero / an absent figure), so this file never formats money.

import { api } from '@/lib/api';

/** The six targets of one Ads Brief. `ditetapkan` false = never set. */
export interface AdsBriefTargets {
  brief_id: string;
  ditetapkan: boolean;
  target_spend: number | null;
  target_spend_display: string;
  target_gmv: number | null;
  target_gmv_display: string;
  target_roas: number | null;
  target_roas_display: string;
  target_view: number | null;
  target_view_display: string;
  target_ctr: number | null;
  target_ctr_display: string;
  target_cvr: number | null;
  target_cvr_display: string;
  catatan: string;
  updated_by: string;
  updated_at: string | null;
}

/** What the system already knows (Strategy KPI + brief Quantity Target). */
export interface AdsTargetSuggestion {
  target_spend: number | null;
  target_gmv: number | null;
  target_roas: number | null;
  target_view: number | null;
  target_ctr: number | null;
  target_cvr: number | null;
  sumber: string;
}

export interface AdsBriefTargetsView {
  targets: AdsBriefTargets;
  saran: AdsTargetSuggestion;
}

/** One metric inside a weekly row. `sifat`: 'serapan' (spend) | 'pencapaian'. */
export interface AdsWeeklyMetric {
  key: string;
  label: string;
  sifat: string;
  target: number | null;
  target_display: string;
  realisasi: number | null;
  realisasi_display: string;
  rasio: number | null;
  rasio_display: string;
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
  analisa: string;
  saran: string;
  kendala: string;
  diisi_oleh: string;
  diisi_pada: string | null; // RFC3339
}

export interface AdsWeeklyReportView {
  brief_id: string;
  targets: AdsBriefTargets;
  minggu: AdsWeeklyReport[];
  belum_diisi: number;
  dipotong: boolean;
}

/** Every field a string; "" means "no target for this metric". */
export interface AdsTargetPayload {
  target_spend: string;
  target_gmv: string;
  target_roas: string;
  target_view: string;
  target_ctr: string;
  target_cvr: string;
  catatan: string;
}

export interface AdsWeeklyReportPayload {
  minggu_mulai: string; // Senin WIB; "" = minggu berjalan
  analisa: string;
  saran: string;
  kendala: string;
}

export function getAdsTargets(briefId: string): Promise<AdsBriefTargetsView> {
  return api.get<AdsBriefTargetsView>(`/briefs/${briefId}/ads-targets`);
}

export function setAdsTargets(briefId: string, payload: AdsTargetPayload): Promise<AdsBriefTargets> {
  return api.put<AdsBriefTargets>(`/briefs/${briefId}/ads-targets`, payload);
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
