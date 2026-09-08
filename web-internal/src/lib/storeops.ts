// M18 — Store Operation: baris SKU (`SKU-`), sisi klien.
//
// ⚠️ DUA KELOMPOK KOLOM, DUA PENULIS. `SkuRow` di bawah sengaja dikelompokkan
// dan diberi komentar pemiliknya, bukan diratakan jadi satu daftar field.
// Halaman yang merendernya harus tahu mana yang read-only bagi si pembaca, dan
// menebaknya dari nama kolom adalah cara aturan dua-penulis itu bocor pelan-pelan.
// Penegakannya tetap di server (trigger DB); yang di sini hanya supaya UI tidak
// menawarkan tombol yang pasti 403.
//
// Angka turunan (`actual_done`, `leadtime`, `pernah_gagal_upload`, dua
// `achievement_*`, `verdict`) datang dari server dan TIDAK PERNAH dihitung ulang
// di sini — kalau halaman menghitungnya sendiri, "apakah SKU ini on time" punya
// dua implementasi yang berbeda begitu salah satunya lupa kalender WIB.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

export const DIVISION = 'Store Operation';

/** Mesin #32 (STATE_MACHINES §22). */
export const STATE_MENUNGGU = '[Menunggu Eksekusi]';
export const STATE_DIKERJAKAN = '[Dikerjakan]';
export const STATE_TERUPLOAD = '[Terupload]';
export const STATE_GAGAL_UPLOAD = '[Gagal Upload]';
export const STATE_DIEVALUASI = '[Dievaluasi]';

/** M18 §3.3 — dari worksheet divisi; harus sama persis dengan CHECK constraint-nya. */
export const REQUEST_TYPES = [
  'Shopee New', 'Shopee Revision', 'Shopee Additional',
  'Tiktok New', 'Tiktok Revision', 'Tiktok Additional',
  'CPAS New',
] as const;

/** M18 §3.4. */
export const JENIS_GAMBAR = [
  'Cover Only', 'Cover + Pendamping', 'Varian + Pendamping', 'Iklan CPAS',
] as const;

export interface SkuRow {
  id: string;
  brief_id: string;
  // --- Kelompok 1: cakupan + target. Penulis: AM. Read-only bagi Store Ops. ---
  nama_produk: string;
  link_sku: string | null;
  request_type: string;
  jenis_gambar: string;
  total_req_picture: number;
  expected_done: string | null;
  target_ctr: number | null;
  target_cvr: number | null;
  target_rating: number | null;
  catatan_am: string | null;
  // --- Kelompok 2: hasil + dampak. Penulis: Store Operation. Read-only bagi AM. ---
  assigned_pic: string | null;
  link_output: string | null;
  catatan_ops: string | null;
  ctr_sebelum: number | null;
  cvr_sebelum: number | null;
  rating_sebelum: number | null;
  ctr_sesudah: number | null;
  cvr_sesudah: number | null;
  rating_sesudah: number | null;
  status: string;
  created_at: string;
  created_by: string;
  // --- Turunan, read-only mutlak (aturan rumah #4). ---
  actual_done: string | null;
  leadtime: string | null;
  pernah_gagal_upload: boolean;
  achievement_ctr_pct: number | null;
  achievement_cvr_pct: number | null;
  verdict: string | null;
}

export interface SkuSummary {
  brief_id: string;
  total: number;
  selesai: number;
  dievaluasi: number;
  dinilai_ontime: number;
  ontime: number;
  ontime_pct: number | null;
  pernah_gagal_upload: number;
  gagal_upload_pct: number | null;
}

export interface SkuScopeInput {
  nama_produk: string;
  link_sku: string | null;
  request_type: string;
  jenis_gambar: string;
  total_req_picture: number;
  expected_done: string | null;
  target_ctr: number | null;
  target_cvr: number | null;
  target_rating: number | null;
  catatan_am: string | null;
}

export interface DampakInput {
  ctr_sebelum: number;
  cvr_sebelum: number;
  rating_sebelum: number;
  ctr_sesudah: number;
  cvr_sesudah: number;
  rating_sesudah: number;
}

// --- Gerbang tampilan (UX saja — server tetap otoritas akhir) ---

export function isDirector(role: Role | null): boolean {
  return Boolean(role?.director);
}
export function isODOnly(role: Role | null): boolean {
  return Boolean(role?.od) && !isDirector(role);
}
export function isStoreOpsDivision(role: Role | null): boolean {
  return role?.division === DIVISION;
}
export function isStoreOpsLead(role: Role | null): boolean {
  return isStoreOpsDivision(role) && role?.level === 'lead';
}
export function isAccountRole(role: Role | null): boolean {
  return role?.division === 'Account';
}

/** Siapa yang boleh menulis cakupan + target: AM/Account, atau Director. */
export function canWriteScope(role: Role | null): boolean {
  if (isODOnly(role)) return false;
  return isDirector(role) || isAccountRole(role);
}

/** Siapa yang boleh menulis hasil + dampak: Store Operation, atau Director. */
export function canWriteResult(role: Role | null): boolean {
  if (isODOnly(role)) return false;
  return isDirector(role) || isStoreOpsDivision(role);
}

/** Menunjuk PIC: leader divisi saja (K-1). Director ikut, seperti gerbang lain. */
export function canAssignPic(role: Role | null): boolean {
  if (isODOnly(role)) return false;
  return isDirector(role) || isStoreOpsLead(role);
}

// --- Panggilan API ---

export function listBriefSkus(briefId: string): Promise<{ data: SkuRow[] }> {
  return api.get<{ data: SkuRow[] }>(`/briefs/${encodeURIComponent(briefId)}/skus`);
}

export function getBriefSkuSummary(briefId: string): Promise<SkuSummary> {
  return api.get<SkuSummary>(`/briefs/${encodeURIComponent(briefId)}/sku-summary`);
}

export function createSku(briefId: string, input: SkuScopeInput): Promise<SkuRow> {
  return api.post<SkuRow>(`/briefs/${encodeURIComponent(briefId)}/skus`, input);
}

export function updateSkuScope(id: string, input: SkuScopeInput): Promise<SkuRow> {
  return api.put<SkuRow>(`/skus/${encodeURIComponent(id)}`, input);
}

export function assignSkuPic(id: string, picId: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/skus/${encodeURIComponent(id)}/pic`, { pic_id: picId });
}

/**
 * Transisi satu baris. `from` adalah status yang halaman TERAKHIR LIHAT — ia
 * hanya membedakan dua edge yang tujuannya sama (mulai vs ulangi setelah gagal).
 * Nilai basi aman: server mem-pin state asal dan menjawab 409, bukan
 * memindahkan baris yang sudah berubah di bawah tangan pengguna.
 */
export function transitionSku(
  id: string,
  to: string,
  opts: { from?: string; link_output?: string; catatan_ops?: string; dampak?: DampakInput } = {},
): Promise<{ ok: boolean; from?: string; to?: string }> {
  return api.post(`/skus/${encodeURIComponent(id)}/transition`, { to, ...opts });
}

// --- Render ---

/** Persen turunan: `null` ⇒ '—' (aturan rumah #7), tidak pernah 0 dan tidak pernah galat. */
export function fmtPersen(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}%`;
}

/** Angka biasa (CTR/CVR/rating) — sama aturannya, tanpa tanda persen. */
export function fmtAngka(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return String(v);
}

export function fmtTanggal(v: string | null | undefined): string {
  return v && v !== '' ? v : '—';
}
