// Kinerja Sales (M0 §7.1) — typed wrapper over apps/api's `/sales/performance*`
// + `/sales/targets`. Shapes mirror packages/domain/src/salesperf.ts +
// apps/api/src/lib/wire.ts EXACTLY (salesPerfRowToWire etc.) — snake_case,
// never invented. See docs/handoff/RENCANA_KINERJA_SALES.md.
//
// Money contract (house rule #4/#7): every *_idr field is pre-formatted
// ("Rp. X.XXX.XXX,00") — render verbatim, never recompute. Ratio/day fields
// (closing_rate_pct, avg_deal_cycle_days, sisa_per_hari, …) are `null` when
// their divisor is zero (or an OKR field with no applicable single-month
// filter) — render "—" (lib/money.ts formatIDR/formatRatio already do this
// for the money/ratio cases; null percents/days render "—" directly).

import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Entity shapes.
// ---------------------------------------------------------------------------

// salesperf.SalesPerfRow (View 1 — REPORT ACTIVITY AND CLOSING).
export interface SalesPerfRow {
  salesperson_id: string;
  nama: string;
  level_sales: string; // §3a — 'Head' | 'Senior' | 'Junior' | 'Admin' | 'CRO' | '—' (unmapped jabatan)
  leads_registered: number;
  leads_scouting: number;
  contacted: number;
  qualified: number;
  non_qualified: number;
  nq_breakdown: Record<string, number>;
  negotiating: number;
  closed_success: number;
  closed_lost: number;
  closing_rate_pct: number | null; // "—" when null
  qualified_rate_pct: number | null;
  avg_deal_cycle_days: number | null;
  effort_follow_up: number;
  effort_visit: number;
  effort_online_meeting: number;
  klien_baru: string; // decimal, weighted by allocation basis points
  klien_perpanjangan: string;
  klien_cross_sell: string;
  klien_count: string;
  omzet: string;
  omzet_idr: string;
  komisi_kontrak: string;
  komisi_kontrak_idr: string;
  komisi_diakui: string;
  komisi_diakui_idr: string;
  target_omzet: string | null; // only set for a single-month `from===to` filter
  target_omzet_idr: string | null;
  pencapaian_pct: number | null;
  sisa_target: string | null;
  sisa_target_idr: string | null;
  sisa_per_minggu: string | null;
  sisa_per_minggu_idr: string | null;
  sisa_per_hari: string | null;
  sisa_per_hari_idr: string | null;
  mom_pct: number | null; // % vs previous month
}

// salesperf.SalesPerfMonthRow (View 2 — FILTER BY NAME / View 5 — rekap tahunan).
export interface SalesPerfMonthRow extends SalesPerfRow {
  period: string; // "YYYYMM"
}

// salesperf.LeadSourceRow (View 3 — DASHBOARD LEAD).
export interface LeadSourceRow {
  period: string;
  source: string;
  campaign_id: string | null;
  campaign_name: string | null;
  salesperson_id: string | null;
  leads: number;
  qualified: number;
  non_qualified: number;
  closing: number;
  conversion_rate_pct: number | null; // "—" when null
  omzet: string;
  omzet_idr: string;
  nq_breakdown: Record<string, number>;
}

// Sales OKR metric catalog (mirrors salesperf.METRIC_KEYS — a closed list,
// never a free-text metric). See salesperf.ts's MetricKey doc for the owner's
// concrete OKR examples behind each one (KS-4).
export const METRIC_KEYS = [
  'omzet', 'closing_ratio_qualified_pct', 'klien_count_min_kontrak', 'scouting_closing_count',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  omzet: 'Omzet (Rp)',
  closing_ratio_qualified_pct: 'Closing Ratio dari Qualified (%)',
  klien_count_min_kontrak: 'Jumlah Klien dgn Minimal Kontrak',
  scouting_closing_count: 'Closing dari Scouting',
};

/** True only for the one metric with a threshold parameter — mirrors salesperf.metricNeedsParam. */
export function metricNeedsParam(k: MetricKey): boolean {
  return k === 'klien_count_min_kontrak';
}

// salesperf.TargetRow (View 4 — Sales OKR).
export interface SalesTarget {
  salesperson_id: string;
  period_start: string; // "YYYY-MM-DD"
  period_kind: string; // 'bulan' | 'kuartal' | 'tahun'
  metric_key: string;
  metric_param: string | null; // Rupiah threshold, only for klien_count_min_kontrak
  metric_param_idr: string | null;
  target_value: string; // unit depends on metric_key
  target_value_idr: string | null; // only for 'omzet'
  actual_value: string | null; // recomputed live; "—" when null (division-by-zero)
  actual_value_idr: string | null;
  achieved_pct: number | null;
  updated_at: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Filter (shared query-string shape across the three GET endpoints).
// ---------------------------------------------------------------------------

export interface SalesPerfFilter {
  from?: string; // "YYYY-MM"
  to?: string; // "YYYY-MM"
  salesperson?: string;
  source?: string;
  campaign?: string;
}

function toQuery(f: SalesPerfFilter): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.salesperson) p.set('salesperson', f.salesperson);
  if (f.source) p.set('source', f.source);
  if (f.campaign) p.set('campaign', f.campaign);
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

// ---------------------------------------------------------------------------
// API functions.
// ---------------------------------------------------------------------------

// GET /sales/performance → {data: SalesPerfRow[]} — View 1.
export function salesPerfBySalesperson(f: SalesPerfFilter = {}): Promise<{ data: SalesPerfRow[] }> {
  return api.get<{ data: SalesPerfRow[] }>(`/sales/performance${toQuery(f)}`);
}

// GET /sales/performance/monthly → {data: SalesPerfMonthRow[]} — View 2 / View 5.
export function salesPerfByMonth(f: SalesPerfFilter = {}): Promise<{ data: SalesPerfMonthRow[] }> {
  return api.get<{ data: SalesPerfMonthRow[] }>(`/sales/performance/monthly${toQuery(f)}`);
}

// GET /sales/performance/sources → {data: LeadSourceRow[]} — View 3.
export function salesPerfBySource(f: SalesPerfFilter = {}): Promise<{ data: LeadSourceRow[] }> {
  return api.get<{ data: LeadSourceRow[] }>(`/sales/performance/sources${toQuery(f)}`);
}

// GET /sales/targets?period_start=YYYY-MM-DD → {data: SalesTarget[]} — View 4.
export function listSalesTargets(periodStart: string): Promise<{ data: SalesTarget[] }> {
  return api.get<{ data: SalesTarget[] }>(`/sales/targets?period_start=${encodeURIComponent(periodStart)}`);
}

export interface SetSalesTargetInput {
  salesperson_id: string;
  period_start: string; // "YYYY-MM-01" (bulan/kuartal) or "YYYY-01-01" (tahun)
  period_kind: 'bulan' | 'kuartal' | 'tahun';
  metric_key: MetricKey;
  metric_param?: string; // required for klien_count_min_kontrak, omitted otherwise
  target_value: string;
}

// PUT /sales/targets — OD/Director only (server-gated; M0 §7.1).
export function setSalesTarget(input: SetSalesTargetInput): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>(`/sales/targets`, input);
}
