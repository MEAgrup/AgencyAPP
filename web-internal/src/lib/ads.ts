// Typed wrapper over lib/api.ts for Module 8 (Ads) endpoints.
// Shapes mirror backend/internal/module8_ads/{read.go,metrics.go,optimization.go}
// + backend/internal/httpapi/ads_handlers.go EXACTLY (json tags read from source) —
// never invented. Reconciled against fe_briefs/m8.md (the single endpoint source).
//
// Money contract (m8 brief §"CATATAN"/gotcha #4):
//  - REQUEST money fields (budget/spend/gmv/before_value/after_value) are STRING
//    decimals ("8000000" | "8000000.00") — backend uses money.Parse.
//  - RESPONSE Campaign carries pre-formatted *_display ("Rp. X.XXX.XXX,00") +
//    roas_display ("3.875x" | "—"); render those verbatim, never reformat.
//  - MetricEntry.spend/gmv are RAW float64 (whole rupiah, NOT pre-formatted) —
//    format in the page via lib/money.ts formatIDR.
//  - roas is *float64 → JSON `null` when total_spend == 0; always display via
//    roas_display (already handles div-by-zero → "—", house rule #7).
//
// M8 has NO list-campaigns / edit-campaign / delete endpoints (m8 brief
// "TIDAK TERSEDIA"): campaigns are created under a Brief and read by id only.
// The /ads landing therefore sources Ads Briefs from the verified M6/M12
// division brief-queue (used already by lib/tasks.ts) to let advertisers create
// campaigns and open them by id. CTR/CVR are accepted on POST metric but never
// returned by any M8 read (gotcha #9), so no CTR/CVR read-back exists here.

import { api } from '@/lib/api';
import type { BadgeTone } from '@/lib/status';

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

// module8_ads.Campaign (read.go:22-55). Derived running metrics are computed
// server-side (recompute-from-log) and are strictly read-only here.
export interface Campaign {
  id: string;
  brief_id: string;
  client_id: string;
  platform: string;
  objective: string;
  budget: number;
  budget_display: string;
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
  target_kpi: string;
  status: string; // [Paused] | [Active] | [Ended]
  total_spend: number;
  total_spend_display: string;
  total_gmv: number;
  total_gmv_display: string;
  roas: number | null; // null when total_spend == 0
  roas_display: string; // "3.875x" | "—"
  linked_asset_ids: string[]; // currently linked (unlinked_at IS NULL)
  metric_entry_count: number;
  optimization_count: number;
  underperforming_streak: number; // only meaningful when target_kpi is ROAS-typed
  escalation_flagged: boolean; // streak >= 2
  created_by: string;
  created_at: string; // RFC3339
}

// module8_ads.MetricEntry (metrics.go:42-52). NOTE: response carries NO ctr/cvr.
export interface MetricEntry {
  id: string;
  campaign_id: string;
  period_start: string; // "YYYY-MM-DD"
  period_end: string; // "YYYY-MM-DD"
  spend: number; // raw whole-rupiah float
  gmv: number; // raw whole-rupiah float
  entry_method: string;
  entered_by: string;
  created_at: string; // RFC3339
}

// module8_ads.Optimization (optimization.go:41-50). Append-only, immutable.
export interface Optimization {
  id: string;
  campaign_id: string;
  change_type: string;
  before_value: string;
  after_value: string;
  reason: string;
  actor: string;
  created_at: string; // RFC3339
}

// map literal returned by link/unlink (ads_handlers.go:118) — not an entity.
export interface AssetLinkResult {
  id: string;
  asset_id: string;
  linked: boolean;
}

// Brief-lite: the M6/M12 brief queue rows + parent-brief read, used only for the
// /ads landing (create-campaign source) and the launch guardrail context. Mirror
// of module6_account.Brief json tags (subset actually consumed here).
export interface AdsBrief {
  id: string;
  service_id: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  due_date: string;
  priority: string;
  title: string;
  status: string;
  created_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants (verbatim from m8 brief §1 / PRD §9.3–§9.5) — never invented.
// ---------------------------------------------------------------------------

// Ad Campaign platform (single choice) — only these three accepted server-side.
export const PLATFORM_OPTIONS = ['Shopee Ads', 'TikTok Shop Ads', 'Social Ads'] as const;

// Metric Entry input method — only these two accepted server-side.
export const ENTRY_METHOD_OPTIONS = ['Manual', 'File Export'] as const;

// Optimization change type — only these five accepted server-side.
export const CHANGE_TYPE_OPTIONS = ['Budget', 'Targeting', 'Creative Swap', 'Schedule', 'Other'] as const;

// Ad Campaign statuses (STATE_MACHINES §14) — birth [Paused], terminal [Ended].
export const CAMPAIGN_STATUSES = ['[Paused]', '[Active]', '[Ended]'] as const;

// ---------------------------------------------------------------------------
// Local badge-tone map for campaign lifecycle status.
// lib/status.ts (shared) has no entry for [Active]/[Paused]/[Ended] and is out of
// scope to edit for this build stream, so per the build convention ("duplicate
// helpers locally in lib/ads.ts") we map the three verbatim statuses here rather
// than let them all fall through to the default gray tone.
// ---------------------------------------------------------------------------
export function campaignBadgeTone(status: string): BadgeTone {
  switch (status) {
    case '[Active]':
      return 'green';
    case '[Paused]':
      return 'amber';
    case '[Ended]':
      return 'darkgray';
    default:
      return 'gray';
  }
}

/** True when Target KPI is a ROAS-typed target (mirrors ParseROASTarget: substring "roas").
 *  Streak / escalation fields are only meaningful for ROAS-typed targets (gotcha #11). */
export function isRoasTarget(targetKpi: string): boolean {
  return targetKpi.toLowerCase().includes('roas');
}

// ---------------------------------------------------------------------------
// API functions — one thin call per endpoint (m8 brief §1).
// ---------------------------------------------------------------------------

export interface CampaignInput {
  platform: string;
  objective: string;
  budget: string; // decimal string
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
  target_kpi: string;
}

// POST /briefs/{id}/campaigns → Campaign (object directly, not wrapped).
export function createCampaign(briefId: string, input: CampaignInput): Promise<Campaign> {
  return api.post<Campaign>(`/briefs/${briefId}/campaigns`, input);
}

// GET /campaigns/{id} → Campaign (object directly).
export function getCampaign(id: string): Promise<Campaign> {
  return api.get<Campaign>(`/campaigns/${id}`);
}

// Lifecycle edges — no body; response is a generic statemachine.Result whose shape
// is not stable across M8, so callers should refresh via getCampaign afterwards
// rather than parse the return (m8 brief §1.3 recommendation).
export function launchCampaign(id: string): Promise<unknown> {
  return api.post<unknown>(`/campaigns/${id}/launch`);
}

export function resumeCampaign(id: string): Promise<unknown> {
  return api.post<unknown>(`/campaigns/${id}/resume`);
}

export function pauseCampaign(id: string): Promise<unknown> {
  return api.post<unknown>(`/campaigns/${id}/pause`);
}

export function endCampaign(id: string): Promise<unknown> {
  return api.post<unknown>(`/campaigns/${id}/end`);
}

// POST /campaigns/{id}/assets {asset_id} → {id, asset_id, linked:true}.
export function linkAsset(id: string, assetId: string): Promise<AssetLinkResult> {
  return api.post<AssetLinkResult>(`/campaigns/${id}/assets`, { asset_id: assetId });
}

// DELETE /campaigns/{id}/assets/{assetId} → {id, asset_id, linked:false}.
export function unlinkAsset(id: string, assetId: string): Promise<AssetLinkResult> {
  return api.delete<AssetLinkResult>(`/campaigns/${id}/assets/${assetId}`);
}

export interface MetricInput {
  period_start: string; // "YYYY-MM-DD"
  period_end: string; // "YYYY-MM-DD"
  spend: string; // decimal string
  gmv: string; // decimal string
  ctr: number | null; // optional; sent null when omitted (never read back)
  cvr: number | null; // optional; sent null when omitted (never read back)
  entry_method: string;
}

// POST /campaigns/{id}/metrics → MetricEntry (object directly).
export function createMetric(id: string, input: MetricInput): Promise<MetricEntry> {
  return api.post<MetricEntry>(`/campaigns/${id}/metrics`, input);
}

// GET /campaigns/{id}/metrics → {data: MetricEntry[]} (always wrapped, [] when empty).
export function listMetrics(id: string): Promise<{ data: MetricEntry[] }> {
  return api.get<{ data: MetricEntry[] }>(`/campaigns/${id}/metrics`);
}

export interface OptimizationInput {
  change_type: string;
  before_value: string; // required except Creative Swap (auto-filled from old_asset_id)
  after_value: string; // required except Creative Swap (auto-filled from new_asset_id)
  reason: string;
  old_asset_id: string; // required only for Creative Swap
  new_asset_id: string; // required only for Creative Swap
}

// POST /campaigns/{id}/optimizations → Optimization (object directly).
// Creative Swap performs the unlink(old)+link(new) atomically — do NOT also call
// linkAsset/unlinkAsset for a swap (m8 brief §1.11).
export function createOptimization(id: string, input: OptimizationInput): Promise<Optimization> {
  return api.post<Optimization>(`/campaigns/${id}/optimizations`, input);
}

// GET /campaigns/{id}/optimizations → {data: Optimization[]} (always wrapped, [] when empty).
export function listOptimizations(id: string): Promise<{ data: Optimization[] }> {
  return api.get<{ data: Optimization[] }>(`/campaigns/${id}/optimizations`);
}

// GET /briefs/{id} → Brief (object directly) — verified M6 read (lib/tasks.ts).
// Best-effort parent-brief context for the launch guardrail (brief must be
// [Approved]); the /ads scope never mutates the brief.
export function getBrief(id: string): Promise<AdsBrief> {
  return api.get<AdsBrief>(`/briefs/${id}`);
}

// GET /divisions/Ads/brief-queue → {data: Brief[]} — verified M6/M12 read
// (lib/tasks.ts listDivisionQueue). Source of Ads Briefs for the /ads landing,
// since M8 exposes no list-campaigns endpoint. NOTE: the division path segment is
// validated CASE-SENSITIVELY server-side against {"Creative","Ads","KOL","Live Stream"}
// (module6_account isAllowedDivision) — it must be "Ads", not "ads".
export function listAdsBriefQueue(): Promise<{ data: AdsBrief[] }> {
  return api.get<{ data: AdsBrief[] }>(`/divisions/${encodeURIComponent('Ads')}/brief-queue`);
}
