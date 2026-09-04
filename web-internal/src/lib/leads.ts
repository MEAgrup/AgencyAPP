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

import { api, ApiError } from '@/lib/api';

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
//
// campaign_id / outside_campaign are the Origin Campaign link (M1 §9.3). They are
// mutually exclusive in practice: the form is ONE picker whose "di luar campaign"
// option sends outside_campaign=true with no id. Sending an id wins — the server
// treats an explicit pick as authoritative and ignores the flag.
export interface RegisterLeadInput {
  lead_name: string;
  phone_number: string;
  email?: string;
  source: string;
  campaign_id?: string;
  outside_campaign?: boolean;
}

// Response of POST /leads — notice is the co-pursuit BI message
// ("[lead juga sedang dikerjakan sales lain]"), present only on join.
export interface RegisterLeadResult {
  lead: LeadStub;
  attempt: AttemptStub;
  notice?: string;
}

// ---------------------------------------------------------------------------
// Pendaftaran lead BATCH (QA revisi 2026-08-07) — POST /leads/batch.
//
// Satu Source (dan satu keputusan Origin Campaign) untuk maksimal 5 prospek;
// tiap baris tetap melewati pintu dedup M1 §5 sendiri, jadi laporannya per baris:
// baris yang bentrok ditolak dengan pesan BI verbatim sementara baris lain tetap
// terdaftar. Berbeda dari /leads/bulk (pintu import Marketing) karena di sini
// setiap lead melahirkan PRSP milik si sales.
// ---------------------------------------------------------------------------

// Satu baris prospek — Source/Campaign ada di level batch, bukan per baris.
export interface BatchProspectInput {
  lead_name: string;
  phone_number: string;
  email?: string;
}

// Body POST /leads/batch.
export interface BatchRegisterInput {
  source: string;
  campaign_id?: string;
  outside_campaign?: boolean;
  prospects: BatchProspectInput[];
}

// Verdict per baris — `notice` = pesan co-pursuit, `reason` = alasan penolakan.
export interface BatchRegisterRowResult {
  row_number: number;
  lead_name: string;
  phone_number: string;
  registered: boolean;
  lead_id: string;
  attempt_id: string;
  notice: string;
  reason: string;
}

// Response POST /leads/batch.
export interface BatchRegisterReport {
  registered: number;
  rejected: number;
  summary: string;
  rows: BatchRegisterRowResult[];
  rejections: BatchRegisterRowResult[];
}

// Batas prospek per pendaftaran — cermin leads.MAX_REGISTER_BATCH di domain.
// Server tetap otoritasnya (`[maksimal 5 lead per pendaftaran!]`); ini hanya
// yang membuat tombol "Tambah Prospek" berhenti di baris kelima.
export const MAX_REGISTER_BATCH = 5;

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
  // Peran AKTOR atas lead ini — dipakai kolom "Peran" di tab Lead Saya.
  // Keduanya false bila permintaan tidak memakai filter `mine`.
  registered_by_me: boolean;
  claimed_by_me: boolean;
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
  // Kolom peran ikut di-omit bersama rollup: ia menjawab "apa hubungan PEMBACA
  // dengan baris ini" untuk kolom Peran di tab Lead Saya, sedangkan halaman
  // detail sudah menampilkan seluruh kontes attempt lengkap dengan namanya.
  lead: Omit<LeadRow, 'open_attempt_count' | 'registered_by_me' | 'claimed_by_me'>;
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

// The Origin Campaign rules that drive the intake form — CAMPAIGN_REQUIRED_SOURCES,
// campaignRequiredForSource, OUTSIDE_CAMPAIGN — live in `lib/campaign-picker.ts`,
// which imports nothing at runtime and is therefore unit-testable (this module
// pulls in lib/api, so vitest cannot load it without the Next path alias).

// ---- Functions ----

export function registerLead(input: RegisterLeadInput): Promise<RegisterLeadResult> {
  return api.post<RegisterLeadResult>('/leads', input);
}

export function registerLeadsBatch(input: BatchRegisterInput): Promise<BatchRegisterReport> {
  return api.post<BatchRegisterReport>('/leads/batch', input);
}

export function bulkImportLeads(campaignId: string | undefined, rows: BulkRow[]): Promise<BulkReport> {
  return api.post<BulkReport>('/leads/bulk', { campaign_id: campaignId ?? '', rows });
}

export function claimLead(leadId: string): Promise<{ attempt: AttemptStub }> {
  return api.post<{ attempt: AttemptStub }>(`/leads/${leadId}/claim`);
}

// GET /leads/pool[?q=&source=] — q mencari nama ATAU nomor telepon (substring,
// case-insensitive); source menyaring persis satu nilai dari SOURCES.
export function listPool(params?: { q?: string; source?: string }): Promise<{ data: PoolRow[] }> {
  const search = new URLSearchParams();
  if (params?.q) search.set('q', params.q);
  if (params?.source) search.set('source', params.source);
  const qs = search.toString();
  return api.get<{ data: PoolRow[] }>(`/leads/pool${qs ? `?${qs}` : ''}`);
}

// Mode kepemilikan untuk tab "Lead Saya" (keputusan pemilik 2026-08-06):
//   registered — lead yang AKTOR daftarkan sendiri (M1 §4 / import Marketing);
//   claimed    — lead orang lain yang ia pegang attempt-nya (klaim Pool, §6);
//   any        — salah satu dari keduanya.
export const MINE_MODES = ['registered', 'claimed', 'any'] as const;
export type MineMode = (typeof MINE_MODES)[number];

export const MINE_MODE_LABELS: Record<MineMode, string> = {
  registered: 'Yang saya daftarkan',
  claimed: 'Yang saya klaim',
  any: 'Semua lead saya',
};

// GET /leads[?status=&q=&source=&mine=<mode>&limit=&cursor=] — `mine`
// mempersempit ke lead milik aktor. Ia KENYAMANAN, bukan batas keamanan: baris
// yang boleh dibaca tetap ditentukan RLS `leads_select`.
//
// P2 §6: endpoint ini SELALU dipaginasi server-side. `next_cursor` berisi
// penanda halaman berikutnya, `null` kalau sudah halaman terakhir. Kirim balik
// nilai itu sebagai `cursor` untuk mengambil lanjutannya. Cursor bersifat
// buram — jangan diurai atau dibangun sendiri di FE.
export function listLeads(
  params?: { status?: string; q?: string; source?: string; mine?: MineMode; limit?: number; cursor?: string },
): Promise<{ data: LeadRow[]; next_cursor: string | null }> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.q) search.set('q', params.q);
  if (params?.source) search.set('source', params.source);
  if (params?.mine) search.set('mine', params.mine);
  if (params?.limit) search.set('limit', String(params.limit));
  if (params?.cursor) search.set('cursor', params.cursor);
  const qs = search.toString();
  return api.get<{ data: LeadRow[]; next_cursor: string | null }>(`/leads${qs ? `?${qs}` : ''}`);
}

export function getLead(id: string): Promise<LeadDetail> {
  return api.get<LeadDetail>(`/leads/${id}`);
}

/** Query string for GET /leads/export — pure, so it's unit-testable without a DOM. */
export function exportLeadsCsvUrl(params?: { status?: string; q?: string; source?: string }): string {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.q) search.set('q', params.q);
  if (params?.source) search.set('source', params.source);
  const qs = search.toString();
  return `/api/v1/leads/export${qs ? `?${qs}` : ''}`;
}

/** Extracts `filename="..."` from a `Content-Disposition` header, or a fallback. */
export function filenameFromContentDisposition(header: string | null): string {
  const match = /filename="([^"]+)"/.exec(header ?? '');
  return match?.[1] ?? 'leads-database.csv';
}

// GET /leads/export[?status=&q=&source=] (E1/E2, Director-only) — CSV, not
// JSON, so `api.get` (which always `JSON.parse`s the body) cannot be used
// here: a CSV response would silently become `null`. Raw `fetch()` instead,
// mirroring the blob-download mechanics already proven at
// `(shell)/leads/page.tsx` `downloadRejectionsCsv` — the difference is the
// bytes come FROM the server here, not built client-side.
export async function exportLeadsCsv(
  params?: { status?: string; q?: string; source?: string },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(exportLeadsCsvUrl(params), { credentials: 'include' });
  } catch {
    throw new ApiError('[Terjadi kesalahan, silahkan coba lagi.]', 0);
  }
  if (!res.ok) {
    let message = '[Terjadi kesalahan, silahkan coba lagi.]';
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // body wasn't JSON — keep the fallback.
    }
    throw new ApiError(message, res.status);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get('content-disposition'));

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Hapus lead (AJUKAN → ACC Head) ----

// POST /leads/{id}/delete-requests — `reason` wajib. Server yang berwenang
// menolak (alasan kosong ⇒ [data tidak lengkap...]), tapi form tetap
// `required` supaya pengguna tidak menunggu round-trip untuk tahu.
export function requestLeadDelete(leadId: string, reason: string): Promise<DeleteRequest> {
  return api.post<DeleteRequest>(`/leads/${leadId}/delete-requests`, { reason });
}

// GET /leads/{id}/delete-requests — SEMUA status (pending + yang sudah
// diputuskan), untuk panel di halaman detail.
export function listLeadDeleteRequests(leadId: string): Promise<{ data: DeleteRequestQueueRow[] }> {
  return api.get<{ data: DeleteRequestQueueRow[] }>(`/leads/${leadId}/delete-requests`);
}

// GET /leads/delete-requests[?status=] — antrian ACC Head. Tanpa argumen =
// hanya `pending` (default server, himpunan yang bisa ditindak); `status: ''`
// mengirim `?status=` kosong yang di server berarti "semua".
export function listDeleteRequests(params?: { status?: string }): Promise<{ data: DeleteRequestQueueRow[] }> {
  const qs = params?.status === undefined ? '' : `?status=${encodeURIComponent(params.status)}`;
  return api.get<{ data: DeleteRequestQueueRow[] }>(`/leads/delete-requests${qs}`);
}

// POST /leads/delete-requests/{reqId}/approve — ACC Head. `transition` adalah
// verdict sm_transition; kalau `ok: false` lead TIDAK bergerak dan request
// tetap pending (server membalas 409/403 dengan pesan engine).
export function approveLeadDelete(
  reqId: string,
  note?: string,
): Promise<{ request: DeleteRequest; transition?: { ok: boolean; message: string } }> {
  return api.post<{ request: DeleteRequest; transition?: { ok: boolean; message: string } }>(
    `/leads/delete-requests/${reqId}/approve`,
    { note: note ?? '' },
  );
}

// POST /leads/delete-requests/{reqId}/reject — Head menolak; lead dibiarkan utuh.
export function rejectLeadDelete(reqId: string, note?: string): Promise<{ request: DeleteRequest }> {
  return api.post<{ request: DeleteRequest }>(`/leads/delete-requests/${reqId}/reject`, {
    note: note ?? '',
  });
}

// ---------------------------------------------------------------------------
// Log aktivitas prospek (ACT-) — keputusan pemilik 2026-08-06, docs/DECISIONS.md.
//
// Bukan lifecycle: mencatat aktivitas TIDAK memindahkan status prospek. Baris
// bersifat append-only (tidak ada endpoint edit/hapus, dan DB menolaknya lewat
// trigger), jadi koreksi dilakukan dengan mencatat aktivitas baru.
// ---------------------------------------------------------------------------

export interface ActivityRow {
  id: string;
  attempt_id: string;
  lead_id: string;
  activity_type: string;
  occurred_at: string;
  summary: string;
  created_by: string;
  created_by_nama: string;
  created_at: string;
}

// Rollup effort yang DITURUNKAN dari log (tidak pernah disimpan).
export interface EffortSummary {
  attempt_id: string;
  total: number;
  by_type: Record<string, number>;
  last_activity_at: string | null;
}

// Taksonomi TERTUTUP — cermin ACTIVITY_TYPES di packages/domain/src/activity.ts
// dan CHECK `ck_act_type` di migrasi 20260806050000. Menambah nilai di sini saja
// hanya menghasilkan 400 dari server.
export const ACTIVITY_TYPES = [
  'Follow Up',
  'Jadwal Meeting',
  'Online Meeting',
  'Visit',
  'Lainnya',
] as const;

// GET /leads/{id}/activities — seluruh aktivitas SEMUA attempt pada satu lead.
export function listLeadActivities(leadId: string): Promise<{ data: ActivityRow[] }> {
  return api.get<{ data: ActivityRow[] }>(`/leads/${leadId}/activities`);
}
