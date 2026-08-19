// Typed wrapper over lib/api.ts for Module 2 (Marketing Performance) + Module 3
// (Campaign) endpoints. Shapes mirror backend/internal/module3_campaign/read.go,
// backend/internal/module2_marketing/metrics.go + backend/internal/httpapi/
// {campaign_handlers.go,marketing_handlers.go,routes_*.go} EXACTLY (json tags read
// from source) — never invented. The backend source files above are the single
// endpoint contract; re-verify there on any drift.
//
// Money contract (house rule #4/#7):
//  - REQUEST money fields (budget) are STRING decimals ("5000000") — backend parses.
//  - RESPONSE carries pre-formatted *_idr ("Rp. X.XXX.XXX,00"); render verbatim.
//  - All Metrics are auto-calculated + strictly read-only. Div-by-zero already
//    renders "—" (U+2014) server-side — render verbatim, never recompute.
//
// Transition gotcha: POST /transition returns a raw statemachine.Result whose JSON
// keys are CAPITALIZED ("From","To") — the Go struct has no json tags (same gotcha
// as M12). Do NOT parse the return; callers refetch getCampaign after success.

import { api, ApiError } from '@/lib/api';
import type { BadgeTone } from '@/lib/status';

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

// module3_campaign.Campaign (read.go). end_date is null until the campaign is
// Closed (server stamps it on the Closed transition).
export interface Campaign {
  id: string;
  name: string;
  channel: string;
  online: boolean;
  offline: boolean;
  start_date: string; // "YYYY-MM-DD"
  end_date: string | null; // null until Closed
  owner_employee_id: string;
  status: string; // Draft | Active | Paused | Closed | Archived (NO brackets)
  created_by: string;
  created_at: string; // RFC3339
}

// One row of the lead-intake campaign picker (GET /marketing/campaigns/selectable).
// Narrower than Campaign by design — the picker is readable by Sales, so it carries
// no owner and NO money (budget/CPL/ROAS stay on the M2 surface). Every status
// appears, verbatim, so the form can mark a Paused/Closed/Archived/Draft pick
// instead of presenting it as live.
//
// The three counts are M2's own derived numbers (§4 r1/r2 + the M1 §8 mirror),
// read-only: nothing types into them. They are here because this dropdown is the
// only campaign surface Sales has — the salesperson picking a campaign is the one
// whose choice fills these numbers.
export interface SelectableCampaign {
  id: string;
  name: string;
  channel: string;
  status: string; // Draft | Active | Paused | Closed | Archived (NO brackets)
  start_date: string; // "YYYY-MM-DD"
  lead_by_dashboard: number; // leads whose Origin Campaign is this one
  lead_real_by_sales: number; // of those, the ones that reached Qualified
  lead_not_qualified: number; // of those, the ones driven to Not Qualified
}

// module3_campaign rollup funnel — read-only, derived from the lead/sales log.
export interface Rollup {
  campaign_id: string;
  leads_generated: number;
  real_leads: number; // leads that reached >= Qualified
  clients_won: number;
  total_value_won: string; // raw decimal
  total_value_won_idr: string; // "Rp. X.XXX.XXX,00"
}

// One Service of a won client, as the Campaign client-list drill-down surfaces it
// (M3 §4 Rule 4). name + status are read verbatim from Account's services row.
export interface CampaignClientService {
  service_id: string;
  name: string;
  status: string; // Account service status, verbatim (e.g. "[In Execution]")
}

// One won client of a Campaign (§4 Rule 4 / Flow 2) — Origin-Campaign lineage, the
// same basis as Rollup.clients_won. services is empty when Account has no Service row
// for the client yet. Click a client → open its Client record / service progress.
export interface CampaignClient {
  client_id: string;
  toko: string; // store name
  nama_pic: string;
  services: CampaignClientService[];
}

// module2_marketing performance Record. budget is the only writable field.
export interface Record {
  campaign_id: string;
  budget: string;
  budget_idr: string; // "Rp. X.XXX.XXX,00"
  online: boolean;
  offline: boolean;
  created_by: string;
}

// module2_marketing junk-lead breakdown row. reason label is verbatim.
export interface JunkReason {
  reason: string;
  count: number;
}

// module2_marketing.Metrics (metrics.go) — EVERY field auto-calculated + read-only.
// String metrics render "—" (U+2014) when their divisor is zero; render verbatim.
export interface Metrics {
  campaign_id: string;
  owner_employee_id: string; // Campaign owner — the Lead dashboard compares across staff (§5 Rule 2)
  online: boolean;
  offline: boolean;
  budget: string; // "" when no record yet
  budget_idr: string; // "—" when no record yet
  lead_by_dashboard: number;
  lead_real_by_sales: number;
  lead_quality_rate: string; // "26%" | "—"
  attributed_sales: string; // IDR
  attributed_sales_decimal: string;
  cost_per_lead: string; // IDR | "—"
  cost_per_real_lead: string; // IDR | "—"
  roas: string; // "4.38" | "—"
  collected_sales: string; // IDR
  collected_sales_decimal: string;
  collected_roas: string; // "X.XX" | "—"
  junk_breakdown: JunkReason[]; // labels verbatim
}

// ---------------------------------------------------------------------------
// Constants — verbatim from brief §"Pembagian file" / config.go MCampaign.
// ---------------------------------------------------------------------------

// Campaign statuses (STATE_MACHINES MCampaign) — birth Draft, terminal Archived.
export const CAMPAIGN_STATUSES = ['Draft', 'Active', 'Paused', 'Closed', 'Archived'] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Legal lifecycle edges (config.go MCampaign). Only edges valid from the current
// status are shown as buttons; illegal edges are blocked server-side with
// [transisi status tidak diizinkan]. NOTE: an explicit mapped type is used instead
// of the TS `Record<...>` utility because the local `Record` interface (M2
// performance record) shadows that global name in this module.
export const CAMPAIGN_TRANSITIONS: { [S in CampaignStatus]: CampaignStatus[] } = {
  Draft: ['Active'],
  Active: ['Paused', 'Closed'],
  Paused: ['Active', 'Closed'],
  Closed: ['Archived'],
  Archived: [],
};

// Channel is free-text (M3-OA-2); these are only <datalist> suggestions.
export const CHANNEL_SUGGESTIONS = [
  'TikTok Ads',
  'IG',
  'Website',
  'Broadcast',
  'Event',
  'Kulwa',
  'Referral',
  'Scouting',
  'Database',
  'Others',
] as const;

// ---------------------------------------------------------------------------
// Local badge-tone map for campaign lifecycle status.
// lib/status.ts (shared) has no entry for these unbracketed Marketing statuses and
// is out of scope to edit for this build stream, so per the build convention
// ("duplicate helpers locally in the module lib") we map the five verbatim
// statuses here rather than let them fall through to the default gray tone.
// ---------------------------------------------------------------------------
export function campaignBadgeTone(status: string): BadgeTone {
  switch (status) {
    case 'Draft':
      return 'gray';
    case 'Active':
      return 'green';
    case 'Paused':
      return 'amber';
    case 'Closed':
      return 'blue';
    case 'Archived':
      return 'darkgray';
    default:
      return 'gray';
  }
}

// ---------------------------------------------------------------------------
// API functions — one thin call per endpoint (brief §"Endpoint M3"/"Endpoint M2").
// ---------------------------------------------------------------------------

export interface CampaignInput {
  name: string;
  channel: string;
  online: boolean;
  offline: boolean;
  start_date: string; // "YYYY-MM-DD"
}

// POST /marketing/campaigns → Campaign (object directly, not wrapped).
export function createCampaign(input: CampaignInput): Promise<Campaign> {
  return api.post<Campaign>(`/marketing/campaigns`, input);
}

// GET /marketing/campaigns → {data: Campaign[]} (newest first).
export function listCampaigns(): Promise<{ data: Campaign[] }> {
  return api.get<{ data: Campaign[] }>(`/marketing/campaigns`);
}

// GET /marketing/campaigns/selectable → {data: SelectableCampaign[]}: EVERY
// campaign, ordered by "can it produce leads now" (Active, Paused → Closed,
// Archived → Draft) then by name. Every intake door may call it
// (Sales/Marketing/OD/Director); any other division gets 403 with the verbatim BI
// message.
export function listSelectableCampaigns(): Promise<{ data: SelectableCampaign[] }> {
  return api.get<{ data: SelectableCampaign[] }>(`/marketing/campaigns/selectable`);
}

// GET /marketing/campaigns/{id} → Campaign (object directly).
export function getCampaign(id: string): Promise<Campaign> {
  return api.get<Campaign>(`/marketing/campaigns/${id}`);
}

// PATCH /marketing/campaigns/{id} → Campaign — edit the §6.3 mandatory fields (§6.1
// "edit own"). Owner/Status/End Date are NOT editable here (reassign / transition /
// Closed-effect respectively). Uses the local patch() helper (see updateBudget note).
export function updateCampaign(id: string, input: CampaignInput): Promise<Campaign> {
  return patch<Campaign>(`/marketing/campaigns/${id}`, input);
}

// GET /marketing/campaigns/{id}/rollup → Rollup (object directly).
export function getCampaignRollup(id: string): Promise<Rollup> {
  return api.get<Rollup>(`/marketing/campaigns/${id}/rollup`);
}

// GET /marketing/campaigns/{id}/clients → {data: CampaignClient[]}: the won-client
// list with each client's Account service status (M3 §4 Rule 4 drill-down). Same §5
// read gate as the rollup; oldest client first.
export function getCampaignClients(id: string): Promise<{ data: CampaignClient[] }> {
  return api.get<{ data: CampaignClient[] }>(`/marketing/campaigns/${id}/clients`);
}

// POST /marketing/campaigns/{id}/transition {to} → statemachine.Result.
// GOTCHA: the response JSON keys are CAPITALIZED ("From","To") — the Go struct has
// no json tags (same as M12). Do NOT parse the return; refetch getCampaign after
// success. Return type is deliberately `unknown` to discourage parsing.
export function transitionCampaign(id: string, to: string): Promise<unknown> {
  return api.post<unknown>(`/marketing/campaigns/${id}/transition`, { to });
}

// POST /marketing/campaigns/{id}/reassign {owner_employee_id} → Campaign.
export function reassignCampaign(id: string, ownerEmployeeId: string): Promise<Campaign> {
  return api.post<Campaign>(`/marketing/campaigns/${id}/reassign`, { owner_employee_id: ownerEmployeeId });
}

// POST /marketing/campaigns/{id}/performance {budget} → Record.
export function createPerformanceRecord(id: string, budget: string): Promise<Record> {
  return api.post<Record>(`/marketing/campaigns/${id}/performance`, { budget });
}

// PATCH /marketing/campaigns/{id}/performance/budget {budget} → Record.
// PATCH is not exposed by lib/api.ts's `api` helper (only get/post/put/delete),
// and api.ts is out of scope for this build stream to edit; the local patch()
// below mirrors its request/error-normalization behaviour exactly so ApiError
// messages stay verbatim (same approach as lib/clients.ts).
export function updateBudget(id: string, budget: string): Promise<Record> {
  return patch<Record>(`/marketing/campaigns/${id}/performance/budget`, { budget });
}

// GET /marketing/campaigns/{id}/performance → {record, metrics}.
// 404 [data tidak ditemukan] when no record exists yet — surfaced via ApiError.
export function getPerformance(id: string): Promise<{ record: Record; metrics: Metrics }> {
  return api.get<{ record: Record; metrics: Metrics }>(`/marketing/campaigns/${id}/performance`);
}

// GET /marketing/performance-dashboard → {data: Metrics[]} — campaigns without a
// record still appear (budget "" + budget_idr "—" + budgeted metrics "—").
export function performanceDashboard(): Promise<{ data: Metrics[] }> {
  return api.get<{ data: Metrics[] }>(`/marketing/performance-dashboard`);
}

// ---------------------------------------------------------------------------
// Local PATCH helper (see updateBudget note) — mirrors lib/api.ts request().
// ---------------------------------------------------------------------------
const API_BASE = '/api/v1';
const FALLBACK_MESSAGE = '[Terjadi kesalahan, silahkan coba lagi.]';

async function patch<T>(path: string, data: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    throw new ApiError(FALLBACK_MESSAGE, 0);
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : FALLBACK_MESSAGE;
    throw new ApiError(message, res.status);
  }

  return body as T;
}
