// M19 separuh kedua — baris pekerjaan `SMO & Content Strategist` (`SCS-`),
// sisi klien.
//
// ⚠️ `client_id`/`client_name` BOLEH null, dan itu bukan data yang hilang.
// Baris "all client" berlaku lintas klien; ia adalah seluruh alasan modul ini
// berdiri sendiri alih-alih jadi Task M12 keempat. Halaman WAJIB merendernya
// sebagai label ("Semua klien"), bukan sebagai kolom kosong yang terbaca
// seperti data yang gagal dimuat.
//
// ⚠️ SPEED SCORE KATEGORI STANDING ADALAH 'N/A', BUKAN '0%'. Server sudah
// mengirim `speed_score_display` yang benar; halaman tidak boleh menghitungnya
// sendiri dari `speed_score_pct` (yang null) karena `null ?? 0` akan merender
// "0%" — sebuah pernyataan tentang kecepatan seseorang atas pekerjaan yang
// tidak pernah di-SLA-kan.
//
// ⚠️ ANGKA REKAP BUKAN KPI. Ia tidak masuk Modul 14 dan tidak punya bobot —
// sama seperti penyelesaian hari-sama (D5). Halaman rekap wajib menyatakannya.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

export const DIVISION = 'Creative';

/**
 * Kosakata state mesin #34 — SAMA PERSIS dengan `brief_task`, dan itu bukan
 * kebetulan: kesamaan itulah yang membuat server memakai ulang rumus Speed
 * Score M12 alih-alih menulis yang kedua. Jangan "rapikan" salah satunya.
 */
export const STATUSES = [
  '[To Do]',
  '[In Progress]',
  '[Submitted]',
  '[In Review]',
  '[Approved]',
  '[Revision Requested]',
  '[Blocked]',
] as const;

/**
 * Delapan label Sub Type dari worksheet Leader, VERBATIM dari sumber
 * (`docs/prd/CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` Gap B).
 *
 * ⚠️ Ini SARAN pengetikan (`<datalist>`), BUKAN daftar tertutup. Server
 * menerima teks bebas dengan sengaja: delapan label ini masih bergerak, dan
 * mengunci mereka di CHECK constraint berarti satu migrasi per koreksi label.
 * Yang dibeli saran ini adalah ejaan yang konsisten — `Brief Feed` yang diketik
 * tiga cara berbeda membuat pengelompokan laporannya tak berguna, dan
 * pengelompokan itulah seluruh alasan field ini pindah ke baris.
 */
export const SUB_TYPES = [
  'Brief Feed',
  'Brief Story',
  'Script Video',
  'Content Plan',
  'Caption',
  'Angle Content',
  'Copy SKU',
  'Copy Banner',
] as const;

export interface KategoriRow {
  kode: string;
  nama: string;
  /** Pekerjaan berulang harian: dihitung sebagai volume, Speed Score N/A. */
  is_standing: boolean;
  /** null ⇒ tidak di-SLA-kan. Kategori standing SELALU null. */
  sla_jam: number | null;
  aktif: boolean;
  urutan: number;
}

export interface ScsTaskRow {
  id: string;
  tanggal: string;
  kategori_kode: string;
  kategori_nama: string;
  kategori_is_standing: boolean;
  /** Label Sub Type baris ini. null = tidak relevan — render '—', bukan kosong. */
  sub_type: string | null;
  judul: string;
  /** null = baris "all client". Render label, bukan kolom kosong. */
  client_id: string | null;
  client_name: string | null;
  mendukung_divisi: string | null;
  assigned_pic: string;
  assigned_pic_nama: string;
  target_qty: number;
  status: string;
  link_hasil: string;
  catatan: string;
  created_by: string;
  created_at: string;
}

export interface ScsMetrics {
  id: string;
  status: string;
  turnaround_hours: number | null;
  speed_score_pct: number | null;
  /** 'N/A' untuk Kategori standing. Tampilkan APA ADANYA. */
  speed_score_display: string;
  revision_count: number;
}

export interface ScsPicSummary {
  employee_id: string;
  nama: string;
  deliverable_selesai: number;
  deliverable_qty: number;
  standing_selesai: number;
  belum_selesai: number;
  total_baris: number;
}

export interface ScsTaskInput {
  tanggal: string;
  kategori_kode: string;
  sub_type: string | null;
  judul: string;
  client_id: string | null;
  mendukung_divisi: string | null;
  assigned_pic: string;
  target_qty: number;
  catatan: string | null;
}

export interface KategoriInput {
  kode: string;
  nama: string;
  is_standing: boolean;
  sla_jam: number | null;
  aktif: boolean;
  urutan: number;
}

// --- Gerbang tampilan (UX saja — server tetap otoritas akhir) ---

export function isDirector(role: Role | null): boolean {
  return Boolean(role?.director);
}
export function isODOnly(role: Role | null): boolean {
  return Boolean(role?.od) && !isDirector(role);
}
export function isCreativeLead(role: Role | null): boolean {
  return role?.division === DIVISION && role?.level === 'lead';
}

/** Menyusun antrean + mengelola Kategori: lead Creative atau Director. */
export function canManageTask(role: Role | null): boolean {
  if (isODOnly(role)) return false;
  return isDirector(role) || isCreativeLead(role);
}

/**
 * Mengerjakan sebuah baris: PIC-nya sendiri SAJA — lead pun tidak.
 * Lebih sempit daripada `canEnterActual` M19 dengan sengaja: lead yang menandai
 * baris orang lain [In Progress] memalsukan jangkar turnaround-nya.
 */
export function canWorkTask(role: Role | null, employeeId: string, assignedPic: string): boolean {
  if (isODOnly(role)) return false;
  return assignedPic !== '' && employeeId === assignedPic;
}

/** Me-review: lead Creative atau Director. NOL AM. */
export function canReviewTask(role: Role | null): boolean {
  return canManageTask(role);
}

/** Boleh melihat PIC orang lain (picker), atau terkunci ke diri sendiri. */
export function canSeeAllPics(role: Role | null): boolean {
  return isDirector(role) || Boolean(role?.od) || isCreativeLead(role);
}

/** Label klien yang tidak pernah kosong — baris "all client" punya namanya. */
export function labelKlien(r: Pick<ScsTaskRow, 'client_id' | 'client_name'>): string {
  return r.client_id === null ? 'Semua klien' : (r.client_name ?? r.client_id);
}

// --- Panggilan API ---

export interface QueueQuery {
  dari: string;
  sampai: string;
  pic?: string;
  kategori?: string;
  status?: string;
}

function qs(q: QueueQuery): string {
  const p = new URLSearchParams({ dari: q.dari, sampai: q.sampai });
  if (q.pic) p.set('pic', q.pic);
  if (q.kategori) p.set('kategori', q.kategori);
  if (q.status) p.set('status', q.status);
  return p.toString();
}

export function listTasks(q: QueueQuery): Promise<{ tasks: ScsTaskRow[] }> {
  return api.get<{ tasks: ScsTaskRow[] }>(`/creative/scs/tasks?${qs(q)}`);
}

export function getTask(id: string): Promise<{ task: ScsTaskRow; metrics: ScsMetrics }> {
  return api.get<{ task: ScsTaskRow; metrics: ScsMetrics }>(
    `/creative/scs/tasks/${encodeURIComponent(id)}`,
  );
}

export function createTask(input: ScsTaskInput): Promise<ScsTaskRow> {
  return api.post<ScsTaskRow>('/creative/scs/tasks', input);
}

export function updateTask(id: string, input: ScsTaskInput): Promise<ScsTaskRow> {
  return api.put<ScsTaskRow>(`/creative/scs/tasks/${encodeURIComponent(id)}`, input);
}

export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/creative/scs/tasks/${encodeURIComponent(id)}`);
}

export type Aksi =
  | 'mulai' | 'submit' | 'buka_review' | 'setujui'
  | 'minta_revisi' | 'lanjut' | 'blokir' | 'buka_blokir';

export function transition(id: string, aksi: Aksi, linkHasil?: string): Promise<ScsTaskRow> {
  return api.post<ScsTaskRow>(`/creative/scs/tasks/${encodeURIComponent(id)}/transition`, {
    aksi, link_hasil: linkHasil ?? '',
  });
}

export function listKategori(semua = false): Promise<{ kategori: KategoriRow[] }> {
  return api.get<{ kategori: KategoriRow[] }>(`/creative/scs/kategori${semua ? '?semua=1' : ''}`);
}

export function createKategori(input: KategoriInput): Promise<KategoriRow> {
  return api.post<KategoriRow>('/creative/scs/kategori', input);
}

export function updateKategori(kode: string, input: KategoriInput): Promise<KategoriRow> {
  return api.put<KategoriRow>(`/creative/scs/kategori/${encodeURIComponent(kode)}`, input);
}

export function getSummary(dari: string, sampai: string): Promise<{ rekap: ScsPicSummary[] }> {
  return api.get<{ rekap: ScsPicSummary[] }>(
    `/creative/scs/summary?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai)}`,
  );
}
