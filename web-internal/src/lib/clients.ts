// Typed wrapper over lib/api.ts for Module 4 (Client Record) endpoints.
// Shapes mirror backend/internal/httpapi/client_handlers.go + intent_reminder_handlers.go
// (clientView / clientEditBody / VoidResult) exactly — read from the handler code,
// never invented. Money fields arrive pre-formatted ("Rp. X.XXX.XXX,00") by the
// backend (money.Money.Format()) and are rendered as-is.

import { api, ApiError } from '@/lib/api';

export interface Platform {
  client_platform_id: number;
  platform: string;
  store_link?: string;
  managed_since?: string | null;
  active: boolean;
}

export interface Allocation {
  salesperson_id: string;
  basis_points: number;
}

export interface ServiceLine {
  id: string;
  master_service_id: string;
  name: string;
  standard_price: string;
  status: string;
}

export interface Client {
  id: string;
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  gmv_baseline: string;
  target_gmv: string;
  total_sales: string;
  marketing_budget: string | null;
  origin_campaign_id: string;
  sales_pic_id: string;
  commission_payment_pic_id: string;
  transaction_id: string;
  payment_intent: string;
  released_to_account_at: string | null;
  platforms: Platform[];
  sales_allocation: Allocation[];
  services: ServiceLine[];
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface VoidResult {
  service_id: string;
  voided_briefs: string[];
  skipped_approved_briefs: string[];
}

// Client Record field matrix (M4 §4 / lock.go) — the scalar fields the PATCH
// endpoint accepts. Kept as a const list (not invented ad hoc) so the
// correction form only ever offers a field the backend actually knows about;
// per-role allow/deny is still enforced server-side (CLAUDE.md: never trim by
// role in FE).
export const EDITABLE_FIELDS = [
  { field: 'nama_pic', label: 'Nama PIC' },
  { field: 'toko', label: 'Toko' },
  { field: 'kota', label: 'Kota' },
  { field: 'link_toko', label: 'Link Toko' },
  { field: 'kategori', label: 'Kategori' },
  { field: 'gmv_baseline', label: 'GMV Baseline' },
  { field: 'target_gmv', label: 'Target GMV' },
  { field: 'marketing_budget', label: 'Marketing Budget' },
  { field: 'sales_pic_id', label: 'Sales PIC' },
  { field: 'commission_payment_pic_id', label: 'Commission & Payment PIC' },
] as const;

export const PAYMENT_INTENT_OPTIONS = [
  '[Bayar Penuh (Lunas)]',
  '[Bayar Sebagian]',
  '[Termin]',
  '[Bayar di Belakang]',
] as const;

/** Platform List checklist (M0 §4.3 — verbatim from the PRD). Shared by the Sales
 *  Qualified Lead Form and the Client Record Platform List editor so the two
 *  never drift. Each selection becomes its own `client_platforms` row (M4-OA-2:
 *  "each entry carries its own sub-data") — `close()` now splits the Qualified
 *  Lead Form's joined selection back into one row per platform. */
export const PLATFORM_OPTIONS = ['Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Others'] as const;

export function listClients(): Promise<{ data: Client[] }> {
  return api.get<{ data: Client[] }>('/clients');
}

export function getClient(id: string): Promise<{ client: Client }> {
  return api.get<{ client: Client }>(`/clients/${id}`);
}

export function voidService(serviceId: string): Promise<VoidResult> {
  return api.post<VoidResult>(`/services/${serviceId}/void`);
}

// client.PendingHoldRequest — one Service in [Hold Requested], for the
// "Perlu Persetujuan Saya" queue (GET /services/hold-requests).
export interface PendingHoldRequest {
  service_id: string;
  client_id: string;
  toko: string;
  nama_pic: string;
  service_name: string;
  owner_am: string | null;
  owner_am_nama: string;
  updated_at: string;
}

/** GET /services/hold-requests — every Service in [Hold Requested], oldest first (Head of Account / Director). */
export function listPendingHoldRequests(): Promise<{ data: PendingHoldRequest[] }> {
  return api.get<{ data: PendingHoldRequest[] }>('/services/hold-requests');
}

/** T-2b: AM MENGAJUKAN hold ([In Execution] → [Hold Requested]); reason wajib. Head lalu ACC/tolak. */
export function requestHoldService(serviceId: string, reason: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/services/${serviceId}/hold`, { reason });
}

/** T-2b: Head of Account MENYETUJUI hold ([Hold Requested] → [On Hold]). */
export function approveHoldService(serviceId: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/services/${serviceId}/hold/approve`);
}

/** T-2b: Head of Account MENOLAK hold ([Hold Requested] → [In Execution]); reason opsional. */
export function rejectHoldService(serviceId: string, reason?: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/services/${serviceId}/hold/reject`, { reason: reason ?? '' });
}

/** T-2b: Head of Account RESUME service ([On Hold] → [In Execution]). */
export function resumeService(serviceId: string, reason?: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/services/${serviceId}/resume`, { reason: reason ?? '' });
}

export function setPaymentIntent(clientId: string, paymentIntent: string): Promise<{ client: Client }> {
  return api.post<{ client: Client }>(`/clients/${clientId}/payment-intent`, {
    payment_intent: paymentIntent,
  });
}

// PATCH is not exposed by lib/api.ts's `api` helper (only get/post/put/delete),
// and api.ts is out of scope for this build stream to edit. This mirrors its
// request/error-normalization behaviour exactly so ApiError messages stay
// verbatim.
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

export function editClient(id: string, changes: Record<string, string>): Promise<{ changes: FieldChange[] }> {
  return patch<{ changes: FieldChange[] }>(`/clients/${id}`, changes);
}

/** Body of `POST /clients/{id}/platforms` — a named interface (not an inline
 *  type) so `body-parity.test.ts` can statically resolve it against the route. */
export interface AddPlatformInput {
  platform: string;
  store_link?: string;
  managed_since?: string;
}

/** POST /clients/{id}/platforms — M4 §3/§4: add one platform to the Platform
 *  List (Account Lead / OD / Director). Used both for a brand-new platform and
 *  to correct a client closed before `close()` split the checklist per-row: add
 *  each real platform here, then deactivate the old joined-string row. */
export function addPlatform(clientId: string, input: AddPlatformInput): Promise<{ platform_id: number }> {
  return api.post<{ platform_id: number }>(`/clients/${clientId}/platforms`, input);
}

/** PATCH /clients/{id}/platforms/{pid} — correct store link / managed-since, or
 *  deactivate (active:false) a platform — removal from the list, never a delete. */
export function updatePlatform(
  clientId: string,
  platformId: number,
  patchInput: { store_link?: string; managed_since?: string; active?: boolean },
): Promise<{ ok: boolean }> {
  return patch<{ ok: boolean }>(`/clients/${clientId}/platforms/${platformId}`, patchInput);
}
