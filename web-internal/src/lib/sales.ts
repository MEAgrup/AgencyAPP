// Typed wrapper over lib/api.ts for Module 0 (Sales) endpoints.
//
// Quote-preview shapes mirror archive/backend-go/internal/module0_sales/commission.go
// (LineQuote / Quote) and qualified.go (ServiceSelection) exactly — read from
// the Go code, never invented. All money fields there are pre-formatted IDR
// strings from the server (money.Money.Format()); the frontend never
// recomputes them (CLAUDE.md #4).
//
// The attempt-lifecycle section below mirrors the EXISTING handlers in
// archive/backend-go/internal/httpapi/sales_handlers.go (module0_sales.QualifiedForm,
// ProposalLine, ClosingParties/ClosingInput/ClosingResult, Allocation) plus
// the NEW read endpoints (GET /attempts, GET /attempts/{id}) and the
// POST /attempts/{id}/lost edge, whose shapes are FINAL per
// fe_m0m1_contract.md §"Endpoint BARU" (backend ticket not yet landed at
// authoring time — this file codes against that contract). Unformatted money
// fields (qualified_form / proposal lines) are raw decimal strings straight
// from the DB; format them with lib/money.ts in the page, never here.

import { api } from '@/lib/api';
import type { ActivityRow, EffortSummary } from '@/lib/leads';

export interface ServiceSelection {
  master_service_id: string;
  quantity?: number;
  amount?: string;
  /**
   * FS-6b — tenor yang dipilih, dalam bulan, untuk layanan yang katalognya
   * menawarkan lebih dari satu (`MasterService.durasi_options`). Dihilangkan
   * untuk layanan tenor tunggal; mengirim tenor yang tidak ada di daftar
   * ditolak server dengan pesan `[...]` rumah, bukan diam-diam diabaikan.
   */
  durasi_bulan?: number;
  /**
   * PR-5 (2026-09-10 ketokan) — platform baris ini, salah satu dari checklist
   * Platform List form ini. Dihilangkan ⇒ platform pertama di checklist itu.
   * Inilah yang mengizinkan `master_service_id` yang SAMA muncul dua kali —
   * sekali per platform, masing-masing boleh punya `store_link`-nya sendiri.
   */
  platform?: string;
  /** PR-5 — link toko baris ini (kalau berbeda dari `store_link` form). */
  store_link?: string;
}

export interface LineQuote {
  service_id: string;
  name: string;
  quantity: number;
  unit: string;
  standard_price_idr: string;
  komisi_idr: string;
  /**
   * SELALU non-PPN (D-4). Tidak ada angka PPN per baris, dan itu disengaja:
   * PPN satu keputusan di invoice, jadi ia dijumlah sekali di bawah.
   */
  subtotal_idr: string;
}

export interface Quote {
  lines: LineQuote[];
  /**
   * Σ harga, SELALU non-PPN (ketokan D-4 2026-09-08). Ini yang diakui mesin
   * accrual sebagai pendapatan dan yang jadi basis komisi — PPN titipan negara,
   * bukan pendapatan MEA.
   */
  estimasi_nilai_idr: string;
  /** PPN seluruh invoice; `Rp. 0,00` kalau tombol Include PPN tidak ditekan. */
  total_ppn_idr: string;
  /** Yang ditagih ke klien: dasar + PPN. */
  nilai_ditagih_idr: string;
  total_komisi_idr: string;
}

export function previewQuote(services: ServiceSelection[], includePPN = false): Promise<Quote> {
  return api.post<Quote>('/sales/quote-preview', { services, include_ppn: includePPN });
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
  /**
   * FS-6b — tenor yang dipilih untuk baris ini, dalam bulan, atau `null` bila
   * layanannya tenor tunggal (dan `standard_price` di atas sudah menjawabnya).
   */
  durasi_bulan: number | null;
  /** PR-5 — platform baris ini terjual di dalamnya. */
  platform: string;
  /** PR-5 — link toko baris ini, atau `null` bila mengikuti `store_link` form. */
  store_link: string | null;
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
  /** FS-6b — tenor yang disepakati baris ini, atau `null`. */
  durasi_bulan: number | null;
  /** PR-5 — platform baris ini (selalu terisi). */
  platform: string;
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

// Blok `attempt` dari GET /attempts/{id}.
export interface AttemptDetailAttempt {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  owner_nama: string;
  /** FS-3: rekan prospek bersama (dua arah), atau null. */
  bersama_owner_employee_id: string | null;
  bersama_owner_nama: string | null;
  status: string;
  claimed_at: string;
  created_at: string;
}

// Blok `lead` dari GET /attempts/{id}. Sengaja LEBIH SEMPIT dari `LeadRow`:
// halaman closing tidak membaca origin_division / open_attempt_count.
export interface AttemptDetailLead {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  record_status: string;
  origin_campaign_id: string | null;
  last_touch_campaign_id: string | null;
  winning_attempt_id: string | null;
}

// GET /attempts/{id} response — attempt + lead + qualified form snapshot +
// negotiation history + not-qualified reasons + the engine's legal next moves.
//
// Blok bersarang dinamai (bukan objek inline) supaya gate paritas bentuk
// `apps/api/src/lib/shape-parity.test.ts` bisa membandingkan kunci DALAMNYA —
// objek inline tidak terbaca ekstraktornya, jadi dulu tidak pernah dibandingkan.
export interface AttemptDetail {
  attempt: AttemptDetailAttempt;
  lead: AttemptDetailLead;
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

// Body line for POST /attempts/{id}/negotiation|negotiation/resubmit|services.
//
// DUA BENTUK, dan bedanya menentukan alurnya (lihat sales.isCustomLine di domain):
//   - STANDAR — `proposed_price` dan `commission_rule` dikirim KOSONG. Server yang
//     menghitung harganya dari versi MSL yang berlaku (subtotal kalkulator +
//     commission_rule versi itu). Ini bentuk jasa yang BARU ditambahkan: klien
//     hanya mengirim id + quantity, tidak pernah rupiah (CLAUDE.md #4).
//   - CUSTOM — `proposed_price` diisi. Itu harga hasil negosiasi, jadi wajib lewat
//     persetujuan Superior.
// `quantity` / `amount` hanya dibaca untuk baris standar (masukan kalkulator).
export interface ProposalLineInput {
  master_service_id: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms?: string;
  quantity?: number;
  amount?: string;
  /**
   * FS-6b — tenor baris ini, dalam bulan. Dikirim untuk KEDUA bentuk baris:
   * pada baris standar ia ikut memilih harganya (harga paket tenor itu), pada
   * baris custom ia hanya dicatat — harga negonya yang menang. Menegosiasikan
   * harga paket setahun tidak mengubahnya jadi paket tiga bulan.
   */
  durasi_bulan?: number;
  /** PR-5 — platform baris ini; kosong ⇒ platform pertama di checklist form. */
  platform?: string;
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
  /**
   * A-4 (K-2) — the cooperation duration in months. LEAVE UNSET to take the
   * catalog's answer (MAX durasi_bulan over the closed services); send a number
   * only to override it, and then `alasan_override` is mandatory. Sending an
   * explicit null is the same as leaving it out.
   */
  durasi_bulan_override?: number | null;
  alasan_override?: string | null;
  /**
   * Tombol "Include PPN" (ketokan D-4 2026-09-08). Seluruh harga di sistem ini
   * non-PPN; ini SATU-SATUNYA tempat yang memutuskan apakah 11% ditambahkan ke
   * invoice. Kalau menyala, cicilan harus berjumlah dasar + PPN.
   */
  include_ppn?: boolean;
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

// Batas jasa per penawaran — cermin sales.MAX_SERVICES di domain (dinaikkan
// 5 → 10 oleh keputusan pemilik 2026-08-07, docs/DECISIONS.md). Server tetap
// otoritasnya (`[maksimal pilih 10 jasa saja!]`); konstanta ini hanya yang
// menghentikan tombol "Tambah Jasa" dan menulis label "(maks N)".
export const MAX_SERVICES = 10;

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
  '[Unrespon]', // L1 (Revisi Sales/Creative/Performa) — auto-aged, 3 hari diam
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

// GET /attempts[?status=&limit=&cursor=] — P2 §6: dipaginasi server-side.
export function listAttempts(
  status?: string,
  params?: { limit?: number; cursor?: string },
): Promise<{ data: AttemptRow[]; next_cursor: string | null }> {
  const search = new URLSearchParams();
  if (status) search.set('status', status);
  if (params?.limit) search.set('limit', String(params.limit));
  if (params?.cursor) search.set('cursor', params.cursor);
  const qs = search.toString();
  return api.get<{ data: AttemptRow[]; next_cursor: string | null }>(`/attempts${qs ? `?${qs}` : ''}`);
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

// POST /attempts/{id}/services — Edit Service sebelum closing (M0 §5.1, keputusan
// pemilik 2026-08-07). Menulis versi proposal BARU dengan set jasa final. Baris
// standar saja ⇒ status tetap Approved/Auto Approved; ada harga custom ⇒ kembali
// ke Negotiation - Pending Approval (server yang memutuskan).
export function reviseServices(id: string, lines: ProposalLineInput[]): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/attempts/${id}/services`, { lines });
}

export function closeAttempt(id: string, input: ClosingInput): Promise<ClosingResult> {
  return api.post<ClosingResult>(`/attempts/${id}/close`, input);
}

// POST /attempts/{id}/lost — contract §"Endpoint BARU" #6.
export function markLost(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/attempts/${id}/lost`);
}

// ---------------------------------------------------------------------------
// Log aktivitas prospek (ACT-) — keputusan pemilik 2026-08-06.
//
// Bentuk baris & taksonominya hidup di `lib/leads.ts` (ActivityRow /
// EffortSummary / ACTIVITY_TYPES) karena halaman /leads juga membacanya; di sini
// hanya pintu per-attempt yang dipakai workspace Sales.
// ---------------------------------------------------------------------------

// GET /attempts/{id}/activities — log + rollup effort (total & per jenis).
export function listActivities(
  attemptId: string,
): Promise<{ data: ActivityRow[]; effort: EffortSummary }> {
  return api.get<{ data: ActivityRow[]; effort: EffortSummary }>(
    `/attempts/${attemptId}/activities`,
  );
}

// Body POST /attempts/{id}/activities. Dideklarasikan sebagai interface bernama
// (bukan tipe inline) supaya `body-parity.test.ts` bisa membaca kunci-kuncinya —
// pemindainya menyelesaikan tipe variabel lewat nama interface, dan body yang
// tak terselesaikan tidak menjaga apa pun.
export interface LogActivityInput {
  activity_type: string;
  occurred_at?: string;
  summary: string;
}

// POST /attempts/{id}/activities — `summary` WAJIB (itu inti log-nya).
// `occurred_at` kosong berarti "sekarang". Server menolak jenis di luar
// ACTIVITY_TYPES dan status prospek yang belum Qualified.
export function logActivity(
  attemptId: string,
  input: LogActivityInput,
): Promise<{ data: ActivityRow }> {
  return api.post<{ data: ActivityRow }>(`/attempts/${attemptId}/activities`, input);
}
