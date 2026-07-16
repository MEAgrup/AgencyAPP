// Typed wrapper over lib/api.ts for Module 1 (Leads) + Module 0 (Sales attempt
// worklist) read endpoints. Shapes mirror the PINNED SALES_WS_SPEC.md API
// contract exactly (GET /leads, /leads/{id}, /my/attempts) — field names are
// not invented. The POST /leads (register) and POST /leads/{id}/claim bodies
// mirror backend/internal/httpapi/leads_handlers.go + module1_leads.RegisterInput/
// Lead/Attempt (PascalCase request fields — that struct has no json tags, so
// Go's default case-insensitive-exact-name matching applies; response fields
// are the tagged snake_case json names).

import { api } from '@/lib/api';

export type LeadView = 'pool' | 'mine' | 'all';

export interface ActiveOwner {
  employee_id: string;
  name: string;
}

export interface LeadListItem {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  record_status: string;
  origin_division: string;
  manual_review_flag: boolean;
  stale: boolean;
  active_owners: ActiveOwner[];
  winning_attempt_id: string | null;
  created_at: string;
}

export interface LeadsResponse {
  leads: LeadListItem[];
}

export interface LeadAttempt {
  id: string;
  owner_employee_id: string;
  owner_name: string;
  status: string;
  created_at: string;
  is_winner: boolean;
}

export interface LeadDetailResponse {
  lead: LeadListItem;
  attempts: LeadAttempt[];
}

export interface MyAttemptItem {
  id: string;
  lead_id: string;
  lead_name: string;
  phone_number: string;
  status: string;
  created_at: string;
}

export interface MyAttemptsResponse {
  attempts: MyAttemptItem[];
}

export function listLeads(view: LeadView, q?: string): Promise<LeadsResponse> {
  const params = new URLSearchParams();
  params.set('view', view);
  if (q) params.set('q', q);
  return api.get<LeadsResponse>(`/leads?${params.toString()}`);
}

export function getLead(id: string): Promise<LeadDetailResponse> {
  return api.get<LeadDetailResponse>(`/leads/${id}`);
}

export function getMyAttempts(): Promise<MyAttemptsResponse> {
  return api.get<MyAttemptsResponse>('/my/attempts');
}

// Minimal register/claim response shapes — the POST handlers return the
// module1_leads.Lead / Attempt structs (a narrower field set than the list/
// detail read models above), read verbatim from
// backend/internal/httpapi/leads_handlers.go's handleRegisterLead /
// handleClaimLead.
export interface RegisteredLead {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  record_status: string;
}

export interface RegisteredAttempt {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  status: string;
}

export interface RegisterLeadInput {
  LeadName: string;
  PhoneNumber: string;
  Email?: string;
  Source: string;
}

export interface RegisterLeadResult {
  lead: RegisteredLead;
  attempt: RegisteredAttempt;
  /** Verbatim BI info string on a collaborative join (M1-OA-5/D5/D7); absent on a solo registration. */
  info?: string;
}

export function registerLead(input: RegisterLeadInput): Promise<RegisterLeadResult> {
  return api.post<RegisterLeadResult>('/leads', input);
}

export function claimLead(id: string): Promise<{ attempt: RegisteredAttempt }> {
  return api.post<{ attempt: RegisteredAttempt }>(`/leads/${id}/claim`);
}
