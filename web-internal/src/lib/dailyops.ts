// M19 — Creative Daily Ops: slot produksi harian (`SLOT-`), sisi klien.
//
// ⚠️ MODUL INI MEMPERINGATKAN, IA TIDAK MENGGERBANG. `createSlot`/`updateSlot`
// menjawab 201/200 dengan `peringatan: string[]` yang MUNGKIN berisi pesan —
// bukan 4xx (ketokan D3/D4). Halaman karena itu harus menampilkan peringatan
// SESUDAH sukses, bukan menganggapnya galat: sebuah `try/catch` yang
// memperlakukan peringatan sebagai kegagalan akan membuat Leader percaya
// jadwalnya tidak tersimpan padahal tersimpan.
//
// ⚠️ ANGKA DI SINI BUKAN KPI (ketokan D5). Penyelesaian hari-sama tidak masuk
// Modul 14 dan tidak punya bobot. Halaman rekap wajib menyatakannya di layar —
// angka per-orang tanpa label akan dipakai seperti nilai kinerja.
//
// Angka turunan (`sisa_qty`, `penyelesaian_pct`, `slot_fill_pct`) datang dari
// server dan TIDAK dihitung ulang di sini. Kalau halaman menghitungnya sendiri,
// "berapa sisanya" punya dua implementasi yang berbeda begitu salah satunya
// lupa bahwa `actual_qty` null bukan nol.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

export const DIVISION = 'Creative';

/** M19 §5.1 — harus sama persis dengan CHECK constraint `ck_slot_task_type`. */
export const TASK_TYPES = ['Shoot', 'Edit', 'Script', 'Voice Over', 'Other'] as const;

/** M19 §5.1 / D4 — empat alasan. BUKAN taksonomi cuti HR; lihat catatan halaman. */
export const ALASAN_TIDAK_TERSEDIA = ['Cuti', 'Sakit', 'Izin', 'Dinas Luar'] as const;

export interface SlotRow {
  id: string;
  tanggal: string;              // YYYY-MM-DD
  client_id: string;
  client_name: string;
  studio_code: string;
  studio_nama: string;
  waktu_mulai: string;          // HH:MM
  waktu_selesai: string;        // HH:MM
  assigned_pic: string;
  assigned_pic_nama: string;
  jenis_paket: string | null;
  task_type: string;
  target_qty: number;
  /** null = slot belum ditutup, BUKAN nol. Bedanya dipakai `slot_fill_pct`. */
  actual_qty: number | null;
  sisa_qty: number | null;
  penyelesaian_pct: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

/** Hasil tulisan yang BISA memperingatkan tapi TETAP tersimpan (D3/D4). */
export interface SlotSaveResult {
  slot: SlotRow;
  /** Selalu ada; kosong berarti bersih. */
  peringatan: string[];
}

export interface StudioRow {
  code: string;
  nama: string;
  aktif: boolean;
  /** false ⇒ tumpang-tindih di lokasi ini TIDAK diperingatkan (`Luar Kantor`). */
  cek_konflik: boolean;
  urutan: number;
}

export interface UnavailabilityRow {
  id: number;
  employee_id: string;
  employee_nama: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  alasan: string;
  catatan: string | null;
  dicatat_oleh: string;
  created_at: string;
}

export interface StudioColumn {
  code: string;
  nama: string;
  cek_konflik: boolean;
  slots: SlotRow[];
  /**
   * ID slot yang bertumpang dengan saudaranya di studio ini. Datang dari
   * server dan TIDAK dihitung di sini: app ini berdiri sendiri tanpa
   * `@cdps/core`, jadi menghitungnya sendiri berarti definisi kedua
   * "bertumpang" — yang akan lupa bahwa perbandingannya setengah terbuka
   * (09.00–12.00 dan 12.00–14.00 BUKAN konflik).
   */
  bentrok_ids: string[];
}

export interface DaySchedule {
  tanggal: string;
  /** SELURUH studio aktif, termasuk yang nol slot — kolom kosong itu informasi. */
  studios: StudioColumn[];
  tidak_tersedia: UnavailabilityRow[];
  total_target: number;
  total_actual: number;
}

export interface PicSameDay {
  employee_id: string;
  nama: string;
  jumlah_slot: number;
  slot_ditutup: number;
  total_target: number;
  total_actual: number;
  penyelesaian_pct: number | null;
  slot_fill_pct: number | null;
}

export interface SlotInput {
  tanggal: string;
  client_id: string;
  studio_code: string;
  waktu_mulai: string;
  waktu_selesai: string;
  assigned_pic: string;
  jenis_paket: string | null;
  task_type: string;
  target_qty: number;
  notes: string | null;
}

export interface UnavailabilityInput {
  employee_id: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  alasan: string;
  catatan: string | null;
}

// --- Gerbang tampilan (UX saja — server tetap otoritas akhir) ---

export function isDirector(role: Role | null): boolean {
  return Boolean(role?.director);
}
export function isODOnly(role: Role | null): boolean {
  return Boolean(role?.od) && !isDirector(role);
}
export function isCreativeDivision(role: Role | null): boolean {
  return role?.division === DIVISION;
}
export function isCreativeLead(role: Role | null): boolean {
  return isCreativeDivision(role) && role?.level === 'lead';
}

/** Menyusun jadwal: lead Creative (Leader Video) atau Director. */
export function canManageSlot(role: Role | null): boolean {
  if (isODOnly(role)) return false;
  return isDirector(role) || isCreativeLead(role);
}

/** Menutup slot: PIC-nya sendiri, lead, atau Director. */
export function canEnterActual(role: Role | null, employeeId: string, assignedPic: string): boolean {
  if (isODOnly(role)) return false;
  if (isDirector(role) || isCreativeLead(role)) return true;
  return assignedPic !== '' && employeeId === assignedPic;
}

/** Mencatat ketidaktersediaan: Leader saja (D4 — bukan self-service PIC). */
export function canWriteUnavailability(role: Role | null): boolean {
  return canManageSlot(role);
}

/** Boleh melihat PIC orang lain (picker rekap), atau terkunci ke diri sendiri. */
export function canSeeAllPics(role: Role | null): boolean {
  return isDirector(role) || Boolean(role?.od) || isCreativeLead(role);
}

// --- Panggilan API ---

export function getDaySchedule(tanggal: string): Promise<DaySchedule> {
  return api.get<DaySchedule>(`/creative/schedule/${encodeURIComponent(tanggal)}`);
}

export function listStudios(): Promise<{ data: StudioRow[] }> {
  return api.get<{ data: StudioRow[] }>('/creative/studios');
}

export function createSlot(input: SlotInput): Promise<SlotSaveResult> {
  return api.post<SlotSaveResult>('/creative/slots', input);
}

export function getSlot(id: string): Promise<SlotRow> {
  return api.get<SlotRow>(`/creative/slots/${encodeURIComponent(id)}`);
}

export function updateSlot(id: string, input: SlotInput): Promise<SlotSaveResult> {
  return api.put<SlotSaveResult>(`/creative/slots/${encodeURIComponent(id)}`, input);
}

export function enterActual(id: string, actualQty: number): Promise<SlotRow> {
  return api.post<SlotRow>(`/creative/slots/${encodeURIComponent(id)}/actual`, {
    actual_qty: actualQty,
  });
}

export function listUnavailability(dari: string, sampai: string): Promise<{ data: UnavailabilityRow[] }> {
  const qs = new URLSearchParams({ dari, sampai }).toString();
  return api.get<{ data: UnavailabilityRow[] }>(`/creative/unavailability?${qs}`);
}

export function markUnavailable(input: UnavailabilityInput): Promise<UnavailabilityRow> {
  return api.post<UnavailabilityRow>('/creative/unavailability', input);
}

export function removeUnavailability(id: number): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/creative/unavailability/${encodeURIComponent(String(id))}`);
}

export function getSlotSummary(dari: string, sampai: string): Promise<{ data: PicSameDay[] }> {
  const qs = new URLSearchParams({ dari, sampai }).toString();
  return api.get<{ data: PicSameDay[] }>(`/creative/slot-summary?${qs}`);
}

// --- Render ---

/** Persen turunan: `null` ⇒ '—' (aturan rumah #7), tidak pernah 0, tidak pernah galat. */
export function fmtPersen(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}%`;
}

/** Jumlah yang boleh kosong: `null` ⇒ '—'. Nol adalah NOL, bukan '—'. */
export function fmtQty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return String(v);
}

export function fmtJam(mulai: string, selesai: string): string {
  return `${mulai}–${selesai}`;
}

/** Hari ini dalam kalender WIB (UTC+7 tetap, tanpa DST — DECISIONS O20). */
export function hariIniWib(): string {
  const t = new Date(Date.now() + 7 * 3600_000);
  return t.toISOString().slice(0, 10);
}

/** Geser sebuah YYYY-MM-DD n hari, aman terhadap zona waktu (aritmetika UTC). */
export function geserHari(ymd: string, n: number): string {
  const t = new Date(`${ymd}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
