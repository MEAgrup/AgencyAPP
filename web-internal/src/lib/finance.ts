// Typed wrapper over lib/api.ts for Module 5 (Admin & Finance) endpoints.
// Shapes mirror backend/internal/httpapi/finance_handlers.go +
// intent_reminder_handlers.go (trxView / instViews / reminderViews /
// outstandingViews / BermasalahStatus) exactly. Money fields arrive
// pre-formatted ("Rp. X.XXX.XXX,00") by the backend and are rendered as-is.

import { api } from '@/lib/api';

export interface Installment {
  id: string;
  installment_no: number;
  amount: string;
  /** Σ verified against this installment — a short payment leaves it open. */
  amount_verified: string;
  due_date: string | null;
  status: string;
  jatuh_tempo: boolean;
  verified_date: string | null;
  verified_by: string;
  proof_of_payment: string;
}

export interface Transaction {
  id: string;
  client_id: string;
  payment_intent_scheme: string;
  total_agreed_value: string;
  amount_verified: string;
  amount_outstanding: string;
  payment_status: string;
  bermasalah: boolean;
  contract_attachment: string;
  released_to_account_at: string | null;
  installments: Installment[];
}

export interface BermasalahVote {
  division: string;
  decision: string;
  note?: string;
  actor: string;
  created_at: string;
}

export interface BermasalahStatus {
  transaction_id: string;
  flagged: boolean;
  finance_vote?: string;
  account_vote?: string;
  director_vote?: string;
  escalated: boolean;
  votes: BermasalahVote[];
}

export interface ReminderRow {
  client_id: string;
  toko: string;
  transaction_id: string;
  installment_id: string;
  installment_no: number;
  amount: string;
  due_date: string;
  status: string;
  days_overdue: number;
  label?: string;
}

export interface OutstandingRow {
  client_id: string;
  toko: string;
  transaction_id: string;
  amount_outstanding: string;
}

export interface RemindersResponse {
  reminders: ReminderRow[];
  outstanding_no_due_date: OutstandingRow[];
}

export interface ScanResult {
  overdue_flagged: number;
  h3_reminders_sent: number;
  contract_flags_raised: number;
}

// Payment schemes (M5 §4 Rule 5 / M5-OA-6 change-scheme options) — same 4
// verbatim strings as the Payment Intent handoff (module5_finance.Scheme*).
export const SCHEME_OPTIONS = [
  '[Bayar Penuh (Lunas)]',
  '[Bayar Sebagian]',
  '[Termin]',
  '[Bayar di Belakang]',
] as const;

export function getQueue(): Promise<{ data: Transaction[] }> {
  return api.get<{ data: Transaction[] }>('/finance/queue');
}

export function getTransaction(id: string): Promise<{ transaction: Transaction }> {
  return api.get<{ transaction: Transaction }>(`/transactions/${id}`);
}

export interface ScheduleItemInput {
  amount: string;
  due_date: string;
}

export function createSchedule(id: string, items: ScheduleItemInput[]): Promise<{ installments: Installment[] }> {
  return api.post<{ installments: Installment[] }>(`/transactions/${id}/schedule`, { items });
}

/**
 * Schedules the collection of what the transaction still owes (M5 §6): the items
 * must sum to Amount Outstanding, not to the agreed total — that is what
 * `createSchedule` above is for.
 */
export function scheduleOutstanding(
  id: string,
  items: ScheduleItemInput[],
): Promise<{ installments: Installment[] }> {
  return api.post<{ installments: Installment[] }>(`/transactions/${id}/outstanding-schedule`, { items });
}

export interface VerifyInput {
  installment_id: string;
  amount: string;
  received_date: string;
  proof_of_payment: string;
  /** Contract link saved together with the verification (M5 §7 Rule 1). */
  contract_attachment: string;
}

/**
 * Strips the house IDR formatting ("Rp. 9.000.000,00") back to a plain number
 * string for prefilling a numeric input. Display always uses the server's string
 * as-is; this only seeds a form field the server re-validates to the cent.
 */
export function idrToInput(formatted: string): string {
  const digits = formatted.replace(/[^\d,]/g, '').split(',')[0];
  return digits.replace(/\D/g, '');
}

export function verify(id: string, body: VerifyInput): Promise<{ transaction: Transaction }> {
  return api.post<{ transaction: Transaction }>(`/transactions/${id}/verify`, body);
}

export function attachContract(id: string, contractAttachment: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/transactions/${id}/contract`, {
    contract_attachment: contractAttachment,
  });
}

export function changeScheme(id: string, scheme: string, reason: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/transactions/${id}/scheme`, {
    payment_intent_scheme: scheme,
    reason,
  });
}

export function getBermasalah(id: string): Promise<BermasalahStatus> {
  return api.get<BermasalahStatus>(`/transactions/${id}/bermasalah`);
}

export function flagBermasalah(id: string, reason: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/transactions/${id}/bermasalah`, { reason });
}

export function voteBermasalah(id: string, decision: string, note: string): Promise<BermasalahStatus> {
  return api.post<BermasalahStatus>(`/transactions/${id}/bermasalah/resolve`, { decision, note });
}

export function getReminders(): Promise<RemindersResponse> {
  return api.get<RemindersResponse>('/finance/reminders');
}

export function scanReminders(): Promise<ScanResult> {
  return api.post<ScanResult>('/finance/reminders/scan');
}
