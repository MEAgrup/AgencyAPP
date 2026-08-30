// R-03 (Kinerja Sales, M0 §7.1) — Renewal/Cross-Sell request opened from a
// Client Record. Deviasi PRD M0 §6 arah (a), disetujui pemilik: closing di
// sini TIDAK melahirkan `CLI-` baru, hanya CTR-/SVC-/TRX- baru pada klien
// yang SAMA. Mesin status sendiri (`contract_renewal`), label negosiasi
// identik ke `sales.ts` (lihat konstanta yang diimpor ulang dari sana).
import { api } from './api';
import type {
  ClosingInstallmentInput,
  ClosingParties,
  ClosingResult,
  NegotiationDecision,
  ProposalLineInput,
} from './sales';

export type { ClosingInstallmentInput, ClosingParties, ClosingResult, NegotiationDecision, ProposalLineInput };

export type RenewalJenis = 'perpanjangan' | 'cross_sell';

// contract_renewal machine (migration 20260901090000) — status labels
// IDENTICAL to prospect_attempt's negotiation sub-flow (renewal.ts, domain
// layer header comment), plus Draft/Closed/Cancelled which replace
// New Lead/Contacted/Qualified/Not Qualified/Closed-Success/Closed-Lost
// (a renewal never has a Lead to lose).
export const RENEWAL_STATUSES = [
  'Draft',
  'Negotiation - Pending Approval',
  'Negotiation - Auto Approved',
  'Negotiation - Approved',
  'Negotiation - Revision Required',
  'Negotiation - Rejected',
  'Closed',
  'Cancelled',
] as const;

export interface Renewal {
  id: string;
  client_id: string;
  jenis: string;
  contract_sebelumnya_id: string | null;
  status: string;
  created_at: string;
  created_by: string;
}

// Body for POST /clients/{id}/renewals.
export interface RenewalCreateInput {
  jenis: RenewalJenis;
  // Wajib untuk 'perpanjangan' (rantai ke Contract yang diperpanjang, harus
  // milik klien yang sama); selalu tidak dikirim untuk 'cross_sell'.
  contract_sebelumnya_id?: string;
}

// Body for POST /renewals/{id}/close — mirrors sales.ClosingInput PLUS the
// new Contract's own window (a renewal always births a fresh `contracts` row).
export interface RenewalClosingInput {
  parties: ClosingParties;
  payment_scheme: string;
  managed_since?: string; // "YYYY-MM-DD"
  installments?: ClosingInstallmentInput[];
  contract_durasi_bulan: number;
  contract_tanggal_mulai: string; // "YYYY-MM-DD"
  contract_tanggal_akhir: string; // "YYYY-MM-DD"
}

export function listRenewals(clientId: string): Promise<Renewal[]> {
  return api.get<Renewal[]>(`/clients/${clientId}/renewals`);
}

export function createRenewal(clientId: string, body: RenewalCreateInput): Promise<Renewal> {
  return api.post<Renewal>(`/clients/${clientId}/renewals`, body);
}

export function getRenewal(id: string): Promise<Renewal> {
  return api.get<Renewal>(`/renewals/${id}`);
}

export function submitRenewalNegotiation(
  id: string,
  lines: ProposalLineInput[],
  noNego: boolean,
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/renewals/${id}/negotiation`, { lines, no_nego: noNego });
}

export function resubmitRenewalNegotiation(id: string, lines: ProposalLineInput[]): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/renewals/${id}/negotiation/resubmit`, { lines });
}

export function decideRenewalNegotiation(
  id: string,
  decision: NegotiationDecision,
  note: string,
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/renewals/${id}/negotiation/decision`, { decision, note });
}

export function acceptRenewalCounter(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/renewals/${id}/negotiation/accept`);
}

export function cancelRenewal(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/renewals/${id}/cancel`);
}

export function closeRenewal(id: string, input: RenewalClosingInput): Promise<ClosingResult> {
  return api.post<ClosingResult>(`/renewals/${id}/close`, input);
}
