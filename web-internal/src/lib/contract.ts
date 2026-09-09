// O57 — the `CTR-` Contract: the agreement one client signed, covering n
// Services. The Strategi hangs off this, not off a Service (M6A Rule 2 /
// D-1 / §7), so the contract window lives here and is read-only everywhere
// else.
//
// Dibaca oleh `components/clients/ContractSection.tsx` (FS-5, feedback tim
// Sales 2026-09-08 #5) — sebelumnya nol halaman memakainya, dan itulah kenapa
// jendela kontrak tidak pernah terlihat di Client Record sama sekali.
import { api } from './api';

export interface Contract {
  id: string;
  client_id: string;
  durasi_bulan: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  catatan: string | null;
  /** R-01: `baru` | `perpanjangan` | `cross_sell`. */
  jenis: string;
  contract_sebelumnya_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractBody {
  durasi_bulan: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  catatan?: string | null;
}

export function listContracts(clientId: string): Promise<Contract[]> {
  return api.get<Contract[]>(`/clients/${clientId}/contracts`);
}

export function createContract(clientId: string, body: ContractBody): Promise<Contract> {
  return api.post<Contract>(`/clients/${clientId}/contracts`, body);
}

export function getContract(id: string): Promise<Contract> {
  return api.get<Contract>(`/contracts/${id}`);
}

export function updateContract(id: string, body: ContractBody): Promise<Contract> {
  return api.put<Contract>(`/contracts/${id}`, body);
}

/** The Service ids this agreement covers (O57). */
export function contractServices(id: string): Promise<{ service_ids: string[] }> {
  return api.get<{ service_ids: string[] }>(`/contracts/${id}/services`);
}

export function attachService(contractId: string, serviceId: string): Promise<Contract> {
  return api.post<Contract>(`/contracts/${contractId}/services`, { service_id: serviceId });
}

export function detachService(serviceId: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/services/${serviceId}/contract`);
}

// ---------------------------------------------------------------------------
// Sisa masa kontrak — FS-5
// ---------------------------------------------------------------------------

/**
 * Keadaan jendela kontrak terhadap suatu hari.
 *
 * Turunan-saat-baca (aturan rumah #4): TIDAK PERNAH disimpan, selalu dihitung
 * ulang dari `tanggal_akhir`. Sebuah kolom "sisa hari" di DB adalah angka yang
 * benar sekali lalu salah setiap hari sesudahnya.
 */
export type ContractState = 'berjalan' | 'segera' | 'berakhir' | 'belum_mulai';

export interface ContractWindow {
  state: ContractState;
  /** Hari kalender menuju `tanggal_akhir`. Negatif bila sudah lewat. */
  hariTersisa: number;
}

/** Ambang "segera berakhir" — dipakai badge dan teksnya sekaligus. */
export const AMBANG_SEGERA_HARI = 30;

const MS_PER_HARI = 86_400_000;

/**
 * Selisih HARI KALENDER antara dua tanggal `YYYY-MM-DD`.
 *
 * Sengaja memakai `Date.UTC` atas ketiga komponen tanggalnya, bukan
 * `new Date(str)` lalu dikurangi: yang terakhir menafsirkan string sebagai
 * tengah malam UTC tapi membandingkannya dengan waktu LOKAL peramban, jadi
 * seorang pengguna di WIB (UTC+7) akan melihat kontrak yang berakhir "hari ini"
 * terhitung sudah lewat sejak pukul 07:00. Yang dibandingkan di sini murni
 * tanggal, jadi zona waktunya tidak pernah ikut masuk hitungan.
 */
export function selisihHari(dari: string, sampai: string): number {
  const [y1, m1, d1] = dari.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = sampai.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_PER_HARI);
}

/** Tanggal hari ini di WIB sebagai `YYYY-MM-DD`. */
export function hariIniWIB(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function contractWindow(
  tanggalMulai: string,
  tanggalAkhir: string,
  hariIni: string = hariIniWIB(),
): ContractWindow {
  const hariTersisa = selisihHari(hariIni, tanggalAkhir);
  if (selisihHari(hariIni, tanggalMulai) > 0) {
    return { state: 'belum_mulai', hariTersisa };
  }
  // Hari terakhir kontrak masih TERMASUK — `ck_contracts_jendela` menuntut
  // `tanggal_akhir > tanggal_mulai`, jadi jendelanya inklusif di kedua ujung.
  if (hariTersisa < 0) return { state: 'berakhir', hariTersisa };
  if (hariTersisa <= AMBANG_SEGERA_HARI) return { state: 'segera', hariTersisa };
  return { state: 'berjalan', hariTersisa };
}

/** Label jenis kontrak (R-01) untuk dibaca manusia. */
export const JENIS_KONTRAK_LABEL: Record<string, string> = {
  baru: 'Baru',
  perpanjangan: 'Perpanjangan',
  cross_sell: 'Cross Sell',
};

export function labelJenisKontrak(jenis: string): string {
  return JENIS_KONTRAK_LABEL[jenis] ?? jenis;
}
