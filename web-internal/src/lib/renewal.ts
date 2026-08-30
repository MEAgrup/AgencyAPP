// R-03/R-04 (Kinerja Sales) — renewal/cross-sell (RNW-) on an existing client.
// Mirrors apps/api RenewalWire/RenewalDetailWire exactly (snake_case, keys
// identical); registered in shape-parity. Body shapes reuse `sales.ts`'s
// ProposalLineInput/ClosingParties/ClosingInstallmentInput — R-03 execution is
// the same table shapes `sales.close()` births, just on an existing client.
import { api } from '@/lib/api';
import type { Role } from '@/lib/types';
import type { ClosingInstallmentInput, ClosingParties, ProposalLineInput } from '@/lib/sales';

export const SALES_DIVISION = 'Sales';

export function isSalesLead(role: Role | null): boolean {
  return !!role && role.division === SALES_DIVISION && role.level === 'lead';
}

export function isSalesStaff(role: Role | null): boolean {
  return !!role && role.division === SALES_DIVISION && role.level === 'staff';
}

/** Mirrors `renewal.canWriteRenewal` loosely (server is the real gate): Director; Sales lead; the client's own Sales PIC. */
export function canWriteRenewalUi(role: Role | null, employeeId: string | null, salesPicId: string | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (!isSalesLead(role) && !isSalesStaff(role)) return false;
  if (isSalesLead(role)) return true;
  return employeeId !== null && salesPicId !== null && salesPicId === employeeId;
}

/** Approve/Reject on a Pending Approval request — Sales lead or Director only. */
export function canDecideRenewalUi(role: Role | null): boolean {
  return !!role && (isSalesLead(role) || !!role.director);
}

export const JENIS_PERPANJANGAN = 'perpanjangan';
export const JENIS_CROSS_SELL = 'cross_sell';

export const STATUS_PENDING = 'Pending Approval';
export const STATUS_AUTO_APPROVED = 'Auto Approved';
export const STATUS_APPROVED = 'Approved';
export const STATUS_REJECTED = 'Rejected';
export const STATUS_EXECUTED = 'Executed';

export interface Renewal {
  id: string;
  client_id: string;
  jenis: string;
  proposed_by: string;
  status: string;
  decision_note: string | null;
  contract_id: string | null;
  transaction_id: string | null;
  created_at: string;
  created_by: string;
}

export interface RenewalLine {
  master_service_id: string;
  proposed_price: string;
  commission_rule: string;
}

export interface RenewalDetail extends Renewal {
  lines: RenewalLine[];
}

export interface ExecuteRenewalInput {
  durasi_bulan: number;
  tanggal_mulai: string; // YYYY-MM-DD
  tanggal_akhir: string; // YYYY-MM-DD
  parties: ClosingParties;
  payment_scheme: string;
  installments?: ClosingInstallmentInput[];
}

export interface ExecuteRenewalResult {
  contract_id: string;
  transaction_id: string;
}

/** GET /clients/{id}/renewals — every renewal/cross-sell offer for this client, newest first. */
export function listRenewals(clientId: string): Promise<Renewal[]> {
  return api.get<Renewal[]>(`/clients/${clientId}/renewals`);
}

/** GET /clients/{id}/renewals/{rid} — one request + its newest priced line set. */
export function getRenewalDetail(clientId: string, id: string): Promise<RenewalDetail> {
  return api.get<RenewalDetail>(`/clients/${clientId}/renewals/${id}`);
}

/** POST /clients/{id}/renewals — the "Perpanjangan / Cross Sell" button. */
export function proposeRenewal(
  clientId: string,
  jenis: string,
  lines: ProposalLineInput[],
  noNego: boolean,
): Promise<Renewal> {
  return api.post<Renewal>(`/clients/${clientId}/renewals`, { jenis, lines, no_nego: noNego });
}

/** POST /clients/{id}/renewals/{rid}/resubmit — after a Reject, a fresh proposal version. */
export function resubmitRenewal(clientId: string, id: string, lines: ProposalLineInput[]): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/clients/${clientId}/renewals/${id}/resubmit`, { lines });
}

/** POST /clients/{id}/renewals/{rid}/decision — Sales lead/Director approve or reject. Reject requires a note. */
export function decideRenewal(
  clientId: string,
  id: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/clients/${clientId}/renewals/${id}/decision`, { decision, note });
}

/** POST /clients/{id}/renewals/{rid}/execute — births CTR-/SVC-/TRX-(+INST-); REPLACES client_sales_allocations (KS-2). */
export function executeRenewal(clientId: string, id: string, input: ExecuteRenewalInput): Promise<ExecuteRenewalResult> {
  return api.post<ExecuteRenewalResult>(`/clients/${clientId}/renewals/${id}/execute`, input);
}
