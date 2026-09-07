// Showcase Klien Terbaik (Gelombang C) + ledger izin pitch (C-5).
//
// Mencerminkan `apps/api` ShowcaseViewWire/IzinStatusWire persis (snake_case,
// kunci identik); terdaftar di shape-parity. Tipe di berkas INILAH anchor-nya —
// halaman tidak bisa membaca kunci yang tidak dideklarasikan di sini, dan wire
// tidak boleh mengirim kunci yang tak ada di sini.
//
// ⚠️ Halaman ini adalah **pengecualian pertama terhadap Role Matrix Fase 0 §4**:
// divisi Sales boleh membukanya (C-1, keputusan pemilik 2026-09-07). Gerbang
// sebenarnya ada di server (`domain/showcase.ts`) — helper `canX` di sini hanya
// untuk menyembunyikan menu, tidak pernah untuk menjaga data.
import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

export const ACCOUNT_DIVISION = 'Account';
export const SALES_DIVISION = 'Sales';

/** Tren satu metrik antara laporan ber-skor pertama dan terakhir. */
export interface ShowcaseTren {
  awal: number;
  akhir: number;
  /** null = pangkalnya nol; halaman merender `—` (aturan rumah #7). */
  delta: number | null;
}

/** Satu klien yang lolos ambang. */
export interface ShowcaseKlien {
  client_id: string;
  toko: string;
  kategori: string | null;
  berizin: boolean;
  periode_dinilai: number;
  periode_mulai: string;
  periode_akhir: string;
  platform: string[];
  skor_terakhir: number;
  skor_label_terakhir: string | null;
  tren_skor: ShowcaseTren;
  tren_gmv: ShowcaseTren;
}

/** Satu klien yang TIDAK lolos, beserta sebabnya — inilah yang membuat halaman
 *  kosong bisa dibaca sebagai "belum ada yang memenuhi", bukan "fiturnya rusak". */
export interface ShowcaseTersisih {
  client_id: string;
  toko: string;
  alasan: string;
  alasan_kalimat: string;
  periode_berskor: number;
  skor_terakhir: number | null;
}

/** Ambang yang dipakai, dibawa dari server supaya halaman tak menyalin angkanya. */
export interface ShowcaseAmbang {
  skor_min: number;
  min_periode: number;
  kalimat: string;
  sumber: string;
}

export interface ShowcaseView {
  klien: ShowcaseKlien[];
  tersisih: ShowcaseTersisih[];
  ambang: ShowcaseAmbang;
  /** true = pemirsa ini (Sales) hanya melihat klien ber-izin. */
  disaring_izin: boolean;
  disembunyikan_tanpa_izin: number;
  total_laporan: number;
  total_klien_ditimbang: number;
}

/** Status izin pitch satu klien hari ini — turunan dari ledger, bukan flag. */
export interface IzinStatus {
  client_id: string;
  berizin: boolean;
  berlaku_sampai: string | null;
  dokumen_catatan: string | null;
  sejak: string | null;
  oleh_siapa: string | null;
  /** true = izin pernah ada tapi masa berlakunya lewat (perlu diperpanjang). */
  kedaluwarsa: boolean;
}

/** Satu peristiwa di ledger izin. */
export interface IzinPeristiwa {
  id: number;
  client_id: string;
  aksi: string;
  berlaku_sampai: string | null;
  dokumen_catatan: string | null;
  alasan: string | null;
  created_at: string;
  created_by: string;
}

export interface IzinPanel {
  status: IzinStatus;
  riwayat: IzinPeristiwa[];
}

export interface BeriIzinInput {
  berlaku_sampai?: string | null;
  dokumen_catatan?: string | null;
}

// ---------------------------------------------------------------------------
// Gerbang UI — cermin longgar server; server tetap gerbang sebenarnya
// ---------------------------------------------------------------------------
/** Siapa yang melihat menu Showcase. Cermin `domain/showcase.canReadShowcase`. */
export function canReadShowcaseUi(role: Role | null): boolean {
  if (!role) return false;
  if (role.director || role.od) return true;
  return role.division === ACCOUNT_DIVISION || role.division === SALES_DIVISION;
}

/** Apakah pemirsa ini melihat versi Sales (disaring izin, tanpa daftar tersisih). */
export function melihatSebagaiSalesUi(role: Role | null): boolean {
  if (!role) return false;
  if (role.director || role.od) return false;
  return role.division === SALES_DIVISION;
}

/** Siapa yang boleh mencentang/mencabut izin. Sales TIDAK — aksesnya read-only. */
export function canKelolaIzinPitchUi(role: Role | null, employeeId: string | null, assignedAmId: string | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (role.division !== ACCOUNT_DIVISION) return false;
  if (role.level === 'lead') return true;
  return employeeId !== null && assignedAmId !== null && assignedAmId === employeeId;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
/** GET /showcase — daftar klien terbaik untuk pemirsa ini. */
export function getShowcase(): Promise<ShowcaseView> {
  return api.get<ShowcaseView>('/showcase');
}

/** GET /clients/{id}/izin-pitch — status hari ini + seluruh riwayatnya. */
export function getIzinPitch(clientId: string): Promise<IzinPanel> {
  return api.get<IzinPanel>(`/clients/${clientId}/izin-pitch`);
}

/** POST /clients/{id}/izin-pitch — catat bahwa klien mengizinkan angkanya dipakai. */
export function beriIzinPitch(clientId: string, input: BeriIzinInput): Promise<IzinStatus> {
  return api.post<IzinStatus>(`/clients/${clientId}/izin-pitch`, input);
}

/**
 * URL materi pitch — dokumen HTML mandiri berisi klien BER-IZIN saja, siapa pun
 * yang meng-export. Sengaja sebuah URL (dibuka/diunduh peramban), bukan
 * `api.get`: badannya HTML, bukan JSON, dan menariknya lewat fetch hanya untuk
 * membuat Blob berarti menyalin logika unduhan yang peramban sudah punya.
 */
export function urlMateriPitch(download = false): string {
  return `/api/v1/showcase/pitch${download ? '?download=1' : ''}`;
}

/** POST /clients/{id}/izin-pitch/cabut — tarik izin (INSERT baris baru, bukan hapus). */
export function cabutIzinPitch(clientId: string, alasan: string | null): Promise<IzinStatus> {
  return api.post<IzinStatus>(`/clients/${clientId}/izin-pitch/cabut`, { alasan });
}
