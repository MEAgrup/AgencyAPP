// Kinerja Sales (M0 §7.1) + Sales OKR — RENCANA_KINERJA_SALES.md.
//
// One row per salesperson (View 1), per (salesperson, month) (View 2/5), per
// (period, source, campaign) (View 3), plus the target/OKR admin surface
// (View 4). Every number here is derived server-side from the immutable logs
// (house rule #4) — this file only shapes the fetch + the filter query string.
import { api } from './api';

export interface SalesPerfFilterParams {
  from?: string; // "YYYY-MM"
  to?: string; // "YYYY-MM"
  salesperson?: string;
  source?: string;
  campaign?: string;
}

function toQuery(f: SalesPerfFilterParams): string {
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.salesperson) params.set('salesperson', f.salesperson);
  if (f.source) params.set('source', f.source);
  if (f.campaign) params.set('campaign', f.campaign);
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

export interface SalesPerfRow {
  salesperson_id: string;
  nama: string;
  level_sales: string;
  leads_registered: number;
  leads_scouting: number;
  contacted: number;
  qualified: number;
  non_qualified: number;
  nq_breakdown: Record<string, number>;
  negotiating: number;
  closed_success: number;
  closed_lost: number;
  closing_rate_pct: number | null;
  qualified_rate_pct: number | null;
  avg_deal_cycle_days: number | null;
  effort_follow_up: number;
  effort_visit: number;
  effort_online_meeting: number;
  klien_baru: string;
  klien_perpanjangan: string;
  klien_cross_sell: string;
  klien_count: string;
  omzet_idr: string;
  komisi_kontrak_idr: string;
  komisi_diakui_idr: string;
  target_omzet_idr: string | null;
  pencapaian_pct: number | null;
  sisa_target_idr: string | null;
  sisa_per_minggu_idr: string | null;
  sisa_per_hari_idr: string | null;
  mom_pct: number | null;
}

export interface SalesPerfMonthRow extends SalesPerfRow {
  period: string; // YYYYMM
}

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
  omzet_idr: string;
  nq_breakdown: Record<string, number>;
}

export interface SalesTarget {
  salesperson_id: string;
  period_start: string;
  period_kind: string;
  target_omzet_idr: string;
  updated_at: string;
  updated_by: string;
}

export interface SetSalesTargetBody {
  salesperson_id: string;
  period_start: string; // "YYYY-MM-01" (bulan) or "YYYY-01-01" (tahun)
  period_kind: string; // 'bulan' | 'tahun'
  target_omzet: string;
}

/** View 1 — REPORT ACTIVITY AND CLOSING. */
export function getSalesPerformance(f: SalesPerfFilterParams = {}): Promise<{ data: SalesPerfRow[] }> {
  return api.get<{ data: SalesPerfRow[] }>(`/sales/performance${toQuery(f)}`);
}

/** View 2 (FILTER BY NAME) / View 5 (rekap tahunan) — one row per Year-Month. */
export function getSalesPerformanceMonthly(f: SalesPerfFilterParams = {}): Promise<{ data: SalesPerfMonthRow[] }> {
  return api.get<{ data: SalesPerfMonthRow[] }>(`/sales/performance/monthly${toQuery(f)}`);
}

/** View 3 — DASHBOARD LEAD, grouped by source/campaign. */
export function getSalesPerformanceSources(f: SalesPerfFilterParams = {}): Promise<{ data: LeadSourceRow[] }> {
  return api.get<{ data: LeadSourceRow[] }>(`/sales/performance/sources${toQuery(f)}`);
}

/** View 4 — target/OKR for one month bucket ("YYYY-MM-01"); omit for the current month. */
export function getSalesTargets(periodStart?: string): Promise<{ data: SalesTarget[] }> {
  const qs = periodStart ? `?period_start=${encodeURIComponent(periodStart)}` : '';
  return api.get<{ data: SalesTarget[] }>(`/sales/targets${qs}`);
}

export function setSalesTarget(body: SetSalesTargetBody): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>('/sales/targets', body);
}
