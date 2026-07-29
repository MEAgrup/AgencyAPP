// Typed wrapper over lib/api.ts for Module 1 (Leads Database) endpoints.
//
// Register/bulk-import/claim shapes mirror backend/internal/module1_leads
// exactly (json tags read from the Go structs):
//   Lead / Attempt          (leads.go)         — returned by POST /leads, /claim
//   RegisterInput            (leads.go)         — POST /leads body
//   BulkRow / BulkRowResult / BulkReport (bulk.go) — POST /leads/bulk
// The pool/list/detail reads (GET /leads/pool, GET /leads, GET /leads/{id})
// are NEW endpoints; their shapes are FINAL per fe_m0m1_contract.md
// §"Endpoint BARU" (backend ticket not yet landed at authoring time — this
// file codes against that contract, not against Go source that doesn't exist
// yet). No money fields on this surface — all values here are plain strings.

import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Existing endpoints (module1_leads.Lead / Attempt / RegisterInput / bulk.go)
// ---------------------------------------------------------------------------

// module1_leads.Lead (subset returned by Register/Claim).
export interface LeadStub {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  record_status: string;
}

// module1_leads.Attempt (subset returned by Register/Claim).
export interface AttemptStub {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  status: string;
}

// Body for POST /leads — mirrors module1_leads.RegisterInput.
export interface RegisterLeadInput {
  lead_name: string;
  phone_number: string;
  email?: string;
  source: string;
  campaign_id?: string;
}

// Response of POST /leads — notice is the co-pursuit BI message
// ("[lead juga sedang dikerjakan sales lain]"), present only on join.
export interface RegisterLeadResult {
  lead: LeadStub;
  attempt: AttemptStub;
  notice?: string;
}

// One row for POST /leads/bulk — mirrors module1_leads.BulkRow.
export interface BulkRow {
  lead_name: string;
  phone_number: string;
  email?: string;
  source: string;
}

// Per-row verdict — mirrors module1_leads.BulkRowResult.
export interface BulkRowResult {
  row_number: number;
  lead_name: string;
  phone_number: string;
  imported: boolean;
  reopened?: boolean;
  lead_id?: string;
  reason?: string;
}

// Response of POST /leads/bulk — mirrors the handleBulkImportLeads body.
export interface BulkReport {
  imported: number;
  rejected: number;
  summary: string;
  rows: BulkRowResult[];
  rejections: BulkRowResult[];
}

// ---------------------------------------------------------------------------
// New reads — contract §"Endpoint BARU" #3/#4/#5.
// ---------------------------------------------------------------------------

// GET /leads/pool row (WHERE record_status='[Pool]').
export interface PoolRow {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  origin_campaign_id: string | null;
  created_at: string;
  stale: boolean;
  open_attempt_count: number;
  my_open_attempt: boolean;
}

// GET /leads[?status=&q=] row.
export interface LeadRow {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  origin_division: string;
  origin_campaign_id: string | null;
  last_touch_campaign_id: string | null;
  record_status: string;
  winning_attempt_id: string | null;
  created_at: string;
  open_attempt_count: number;
}

// One row in GET /leads/{id}'s attempts list (the "kontes" for this lead).
export interface LeadAttemptRow {
  id: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
}

// GET /leads/{id} response — LeadRow minus open_attempt_count, plus attempts.
export interface LeadDetail {
  lead: Omit<LeadRow, 'open_attempt_count'>;
  attempts: LeadAttemptRow[];
}

// ---------------------------------------------------------------------------
// Hapus lead dengan ACC Head (keputusan pemilik 2026-07-29, docs/DECISIONS.md).
//
// Tidak ada endpoint DELETE: baris lead tidak pernah dibuang (aturan rumah #3,
// riwayat immutable). Sales MENGAJUKAN, Head meng-ACC, dan ACC itulah yang
// memindahkan lead ke record_status terminal '[Deleted]'.
// ---------------------------------------------------------------------------

export const DELETED_RECORD_STATUS = '[Deleted]';

// leads.DeleteRequest — hasil POST /leads/{id}/delete-requests.
export interface DeleteRequest {
  id: string;
  lead_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string;
  requested_by: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
}

// leads.DeleteRequestQueueRow — baris antrian ACC (request + join lead & nama).
export interface DeleteRequestQueueRow extends DeleteRequest {
  lead_name: string;
  phone_number: string;
  record_status: string;
  origin_division: string;
  requested_by_nama: string;
  resolved_by_nama: string;
}

// ---- Constants (verbatim source taxonomy — do not rename) ----

// module1_leads — registration/bulk-import Source options (M1 §9.3).
export const SOURCES = [
  'Scouting',
  'Leads - Socmed',
  'Leads - Iklan',
  'Website',
  'Referral (Affiliasi)',
  'Broadcast',
  'Event',
  'Kulwa',
  'Database',
  'Others',
] as const;

// ---- Functions ----

export function registerLead(input: RegisterLeadInput): Promise<RegisterLeadResult> {
  return api.post<RegisterLeadResult>('/leads', input);
}

export function bulkImportLeads(campaignId: string | undefined, rows: BulkRow[]): Promise<BulkReport> {
  return api.post<BulkReport>('/leads/bulk', { campaign_id: campaignId ?? '', rows });
}

export function claimLead(leadId: string): Promise<{ attempt: AttemptStub }> {
  return api.post<{ attempt: AttemptStub }>(`/leads/${leadId}/claim`);
}

export function listPool(): Promise<{ data: PoolRow[] }> {
  return api.get<{ data: PoolRow[] }>('/leads/pool');
}

export function listLeads(params?: { status?: string; q?: string }): Promise<{ data: LeadRow[] }> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.q) search.set('q', params.q);
  const qs = search.toString();
  return api.get<{ data: LeadRow[] }>(`/leads${qs ? `?${qs}` : ''}`);
}

export function getLead(id: string): Promise<LeadDetail> {
  return api.get<LeadDetail>(`/leads/${id}`);
}
