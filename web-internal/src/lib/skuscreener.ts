/**
 * MEA SKU Screener (Gelombang 3, SC-08) — FE data layer types.
 *
 * No page consumes these yet (the UI is a separate, later ticket — same
 * "engine + domain first" sequencing as Gelombang 2's Shopee report route).
 * This file exists so the response SHAPE is watched from day one
 * (`apps/api/src/lib/shape-parity.test.ts`, O43 c): a field added to the
 * wire without being declared here is a field no page was ever designed to
 * read, caught mechanically instead of by a human diffing two files later.
 *
 * Wire shapes are snake_case (the API boundary) and mirror
 * `apps/api/src/lib/wire.ts` `screeningRun*ToWire` / `decisionLogEntryToWire`
 * / `trackerRowToWire` exactly.
 */

export interface ScreeningRunSummary {
  id: string;
  client_id: string;
  jenis: string;
  created_at: string;
  created_by: string;
}

export interface ScreeningRunDetail extends ScreeningRunSummary {
  target_roas: number | null;
  cpc_pasar_kategori: number | null;
  faktor_cr_iklan: number | null;
  min_klik_sesudah: number | null;
  /** Opaque — computed medians (Modul A) or matched pairs (Modul B). Only the render layer reads its shape. */
  payload: unknown;
  sumber_berkas: unknown;
}

export interface DecisionLogEntry {
  id: string;
  client_id: string;
  screening_id: string | null;
  advertiser_id: string;
  platform: string;
  object_type: string;
  object_name: string;
  momen: string;
  sop_stage: string;
  decision: string;
  metric_key: string;
  metric_value: number;
  metric_target: number;
  status_vs_target: string;
  spend_7d: number | null;
  gmv_7d: number | null;
  roas_result: number | null;
  verdict: string | null;
  reviews_decision_id: string | null;
  premature: boolean;
  notes: string | null;
  created_at: string;
  created_by: string;
}

export interface TrackerMetrics {
  views: number;
  clicks: number;
  ctr: number;
  cr: number;
  orders: number;
}

export interface TrackerRow {
  screening_id: string;
  product_code: string;
  product_name: string;
  client_id: string;
  change_date: string;
  initial_route: string;
  change_type: string;
  metric_evaluated: string;
  before: TrackerMetrics;
  after: TrackerMetrics | null;
  delta_ctr_pct: number | null;
  delta_cr_pct: number | null;
  delta_metric_pct: number | null;
  verdict: string;
  budget_decision: string | null;
  notes: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}
