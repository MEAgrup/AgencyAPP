// Typed wrapper over lib/api.ts for Module 0 (Sales) endpoints.
//
// Quote-preview shapes mirror backend/internal/module0_sales/commission.go
// (LineQuote / Quote) and qualified.go (ServiceSelection) exactly — read from
// the Go code, never invented. All money fields there are pre-formatted IDR
// strings from the server (money.Money.Format()); the frontend never
// recomputes them (CLAUDE.md #4).
//
// The attempt-lifecycle section below mirrors the EXISTING handlers in
// backend/internal/httpapi/sales_handlers.go (module0_sales.QualifiedForm,
// ProposalLine, ClosingParties/ClosingInput/ClosingResult, Allocation) plus
// the NEW read endpoints (GET /attempts, GET /attempts/{id}) and the
// POST /attempts/{id}/lost edge, whose shapes are FINAL per
// fe_m0m1_contract.md §"Endpoint BARU" (backend ticket not yet landed at
// authoring time — this file codes against that contract). Unformatted money
// fields (qualified_form / proposal lines) are raw decimal strings straight
// from the DB; format them with lib/money.ts in the page, never here.

import { api } from '@/lib/api';

export interface ServiceSelection {
  master_service_id: string;
  quantity?: number;
  amount?: string;
}

export interface LineQuote {
  service_id: string;
  name: string;
  quantity: number;
  unit: string;
  standard_price_idr: string;
  komisi_idr: string;
  subtotal_idr: string;
}

export interface Quote {
  lines: LineQuote[];
  estimasi_nilai_idr: string;
  total_komisi_idr: string;
}

export function previewQuote(services: ServiceSelection[]): Promise<Quote> {
  return api.post<Quote>('/sales/quote-preview', { services });
}

// ---------------------------------------------------------------------------
// Attempt lifecycle — list/detail (GET /attempts, GET /attempts/{id}) + the
// write edges hanging off /attempts/{id}/... (contract §"Endpoint yang SUDAH
// ada" + §"Endpoint BARU").
// ---------------------------------------------------------------------------

// GET /attempts[?status=] row shape.
export interface AttemptRow {
  id: string;
  lead_id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
  created_at: string;
}

// module0_sales.QualifiedForm's persisted service line (qualified_form_services
// joined with the pricing snapshot) — nested under AttemptDetail.qualified_form.
export interface QualifiedFormServiceRow {
  master_service_id: string;
  master_version_no: number;
  name: string;
  quantity: string; // DECIMAL dikirim string oleh backend (reads.go QFServiceView)
  unit: string | null;
  pricing_mode: string;
  standard_price: string;
  input_amount: string | null;
  subtotal: string;
  commission_rule: string;
}

// The persisted Qualified Lead Form snapshot (qualified_forms + qualified_form_services).
export interface QualifiedFormSnapshot {
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  platform: string;
  store_link: string | null;
  gmv_baseline: string;
  target_gmv: string;
  marketing_budget: string | null;
  services: QualifiedFormServiceRow[];
}

// negotiation_proposal_lines row, joined with qualified_form_services for name.
export interface ProposalLineRow {
  master_service_id: string;
  name: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms: string | null;
}

// One versioned negotiation_proposals row + its lines (version_no ASC).
export interface NegotiationProposalRow {
  id: string;
  version_no: number;
  proposed_by: string;
  proposed_by_nama: string;
  decision_note: string | null;
  created_at: string;
  lines: ProposalLineRow[];
}

// GET /attempts/{id} response — attempt + lead + qualified form snapshot +
// negotiation history + not-qualified reasons + the engine's legal next moves.
export interface AttemptDetail {
  attempt: {
    id: string;
    lead_id: string;
    owner_employee_id: string;
    owner_nama: string;
    status: string;
    claimed_at: string;
    created_at: string;
  };
  lead: {
    id: string;
    lead_name: string;
    phone_number: string;
    email: string | null;
    source: string;
    record_status: string;
    origin_campaign_id: string | null;
    last_touch_campaign_id: string | null;
    winning_attempt_id: string | null;
  };
  qualified_form: QualifiedFormSnapshot | null;
  proposals: NegotiationProposalRow[];
  nq_reasons: string[];
  allowed_transitions: string[];
}

// Body for POST /attempts/{id}/qualify — mirrors module0_sales.QualifiedForm
// json tags exactly. store_link/marketing_budget are optional on the wire
// (Go has no omitempty here but accepts ""), so we mark them optional in TS.
export interface QualifiedFormInput {
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  platform: string;
  store_link?: string;
  gmv_baseline: string;
  target_gmv: string;
  marketing_budget?: string;
  services: ServiceSelection[];
}

// Body line for POST /attempts/{id}/negotiation|resubmit — mirrors
// module0_sales.ProposalLine json tags.
export interface ProposalLineInput {
  master_service_id: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms?: string;
}

export type NegotiationDecision = 'approve' | 'revise' | 'reject';

// module0_sales.Allocation — basis_points: 100% == 10000 (FullAllocationBP).
export interface ClosingAllocation {
  salesperson_id: string;
  basis_points: number;
}

// module0_sales.ClosingParties.
export interface ClosingParties {
  primary_salesperson_id: string;
  allocations: ClosingAllocation[];
  commission_payment_pic_id?: string;
}

// One Payment Schedule row for the [Termin] / [Bayar di Belakang] schemes.
export interface ClosingInstallmentInput {
  amount: string;
  due_date: string; // "YYYY-MM-DD"
}

// Body for POST /attempts/{id}/close — mirrors module0_sales.ClosingInput.
export interface ClosingInput {
  parties: ClosingParties;
  payment_scheme: string;
  managed_since?: string; // "YYYY-MM-DD"
  installments?: ClosingInstallmentInput[];
}

// module0_sales.ClosingResult.
export interface ClosingResult {
  client_id: string;
  transaction_id: string;
}

// ---- Constants (verbatim BI / status strings — do not rename) ----

// module0_sales — Not-Qualified reason taxonomy (7, "[Lainnya ...]" requires
// lainnya_text).
export const NQ_REASONS = [
  '[Bukan seller]',
  '[Kontak salah/tidak valid]',
  '[Spam/duplikat]',
  '[Sudah jadi klien]',
  '[Tidak ada budget]',
  '[Tidak ada respon]',
  '[Lainnya ...]',
] as const;

// module0_sales — payment schemes (closing.go PaymentScheme*).
export const PAYMENT_SCHEMES = [
  '[Bayar Penuh (Lunas)]',
  '[Bayar Sebagian]',
  '[Termin]',
  '[Bayar di Belakang]',
] as const;

// module0_sales — prospect_attempt machine statuses (sales.go Status*).
export const ATTEMPT_STATUSES = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Not Qualified',
  'Negotiation - Pending Approval',
  'Negotiation - Auto Approved',
  'Negotiation - Approved',
  'Negotiation - Revision Required',
  'Negotiation - Rejected',
  'Closed-Success',
  'Closed-Lost',
  '[Closed - Kalah Kompetisi]',
] as const;

// ---- Read functions ----

export function listAttempts(status?: string): Promise<{ data: AttemptRow[] }> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return api.get<{ data: AttemptRow[] }>(`/attempts${q}`);
}

export function getAttempt(id: string): Promise<AttemptDetail> {
  return api.get<AttemptDetail>(`/attempts/${id}`);
}

// ---- Write edges ----

export function markContacted(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/contacted`);
}

export function qualify(id: string, form: QualifiedFormInput): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/qualify`, form);
}

export function setNotQualified(
  id: string,
  reasons: string[],
  lainnyaText?: string,
): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/not-qualified`, {
    reasons,
    lainnya_text: lainnyaText ?? '',
  });
}

export function submitNegotiation(
  id: string,
  lines: ProposalLineInput[],
  noNego: boolean,
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/attempts/${id}/negotiation`, { lines, no_nego: noNego });
}

export function decideNegotiation(
  id: string,
  decision: NegotiationDecision,
  note: string,
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/attempts/${id}/negotiation/decision`, { decision, note });
}

export function acceptCounter(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/negotiation/accept`);
}

export function resubmitNegotiation(id: string, lines: ProposalLineInput[]): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/attempts/${id}/negotiation/resubmit`, { lines });
}

export function closeAttempt(id: string, input: ClosingInput): Promise<ClosingResult> {
  return api.post<ClosingResult>(`/attempts/${id}/close`, input);
}

// POST /attempts/{id}/lost — contract §"Endpoint BARU" #6.
export function markLost(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/lost`);
}
