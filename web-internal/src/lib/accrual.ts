// Typed wrapper atas lib/api.ts untuk laporan pengakuan pendapatan bulanan
// (Gelombang D, D-3). Nilai uang datang SUDAH terformat ("Rp. X.XXX.XXX,00")
// dari server dan dirender apa adanya — pola yang sama dengan lib/finance.ts.
//
// KENAPA `sumber` ADA DI TIPE, DAN BUKAN DIABAIKAN HALAMAN. Bulan yang sudah
// ditutup dibaca dari angka yang DIBEKUKAN; bulan yang masih terbuka dihitung
// ulang setiap kali dibuka, jadi angkanya MASIH BISA berubah. Dua laporan yang
// terlihat identik tapi berbeda sumbernya adalah dua hal yang sangat berbeda
// saat angkanya dipertanyakan, dan halaman menampilkannya sebagai badge.

import { api } from '@/lib/api';

/** Status periode buku — kosakata mesin #32 `periode_buku`. */
export type StatusPeriode = 'Terbuka' | 'Ditutup';

export interface PeriodeBuku {
  id: string;
  bulan: string;
  status: string;
  ditutup_pada: string | null;
  ditutup_oleh: string | null;
}

export interface BarisLaporan {
  service_id: string;
  client_id: string;
  nama: string;
  /** Yang diakui DI BULAN INI (sudah terformat IDR). */
  nilai_diakui: string;
  /** Nilai bruto baris layanan — D-4: sistem tidak menghitung PPN di jalur ini. */
  nilai_bruto: string;
  pengakuan: string;
  master_version_no: number;
}

export interface BarisKoreksi {
  id: string;
  bulan: string;
  bulan_dikoreksi: string;
  client_id: string | null;
  service_id: string | null;
  /** BERTANDA — negatif berarti koreksi turun. Sudah terformat IDR. */
  nilai: string;
  alasan: string;
  dicatat_oleh: string;
  dicatat_pada: string;
}

export interface LaporanBulan {
  bulan: string;
  status: string;
  /** `'beku'` | `'dihitung'` — lihat catatan di kepala berkas. */
  sumber: string;
  ditutup_pada: string | null;
  ditutup_oleh: string | null;
  baris: BarisLaporan[];
  total_diakui: string;
  /** Koreksi yang MENDARAT di bulan ini (memperbaiki bulan-bulan lampau). */
  koreksi: BarisKoreksi[];
  total_koreksi: string;
  total: string;
  /**
   * Koreksi yang MENUNJUK bulan ini, dicatat di bulan-bulan sesudahnya. TIDAK
   * ikut menjumlah `total` — angka bulan tertutup tidak berubah, itu seluruh
   * gunanya — tapi wajib terlihat, karena tanpanya laporan bulan ini terbaca
   * benar padahal sudah diketahui keliru.
   */
  dikoreksi_oleh: BarisKoreksi[];
  alasan_kosong: string | null;
}

/** Label per nilai `pengakuan` (D-KOM) — satu tempat, dipakai tabel apa adanya. */
export const PENGAKUAN_LABELS: Record<string, string> = {
  per_periode: 'Rata sepanjang durasi',
  saat_selesai: 'Penuh saat selesai',
  bulan_berikutnya: 'Bulan berikutnya (komisi)',
};

/** labelPengakuan tidak pernah mengembalikan string kosong. */
export function labelPengakuan(v: string): string {
  return PENGAKUAN_LABELS[v] ?? v;
}

/**
 * Kalimat badge `sumber`. Ia menyebut KONSEKUENSINYA, bukan hanya namanya:
 * "dihitung ulang" tidak memberi tahu pembacanya bahwa angkanya masih bisa
 * bergerak, dan itu justru satu-satunya hal yang perlu ia tahu.
 */
export const SUMBER_LABELS: Record<string, string> = {
  beku: 'Angka beku (bulan sudah ditutup)',
  dihitung: 'Dihitung ulang — masih bisa berubah',
};

export function labelSumber(v: string): string {
  return SUMBER_LABELS[v] ?? v;
}

/** Bulan berjalan sebagai `YYYY-MM`, default pemilih bulan. */
export function bulanIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** bulanLalu menggeser sebuah `YYYY-MM` ke belakang n bulan (kalender). */
export function geserBulan(bulan: string, n: number): string {
  const [y, m] = bulan.split('-').map(Number);
  // `Date.UTC(y, m - 1 + n, 1)` menormalkan lintas tahun sendiri, jadi tidak ada
  // aritmetika modulo yang bisa salah di sini.
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getLaporanBulan(bulan: string): Promise<LaporanBulan> {
  return api.get<LaporanBulan>(`/accrual/months/${bulan}`);
}

export function tutupBulan(bulan: string): Promise<{ periode: PeriodeBuku }> {
  return api.post<{ periode: PeriodeBuku }>(`/accrual/months/${bulan}/close`);
}

/** Badan `POST /accrual/corrections` — `nilai` BERTANDA, `alasan` wajib. */
export interface KoreksiPayload {
  bulan: string;
  bulan_dikoreksi: string;
  nilai: string;
  alasan: string;
}

export function catatKoreksi(payload: KoreksiPayload): Promise<{ koreksi: BarisKoreksi }> {
  return api.post<{ koreksi: BarisKoreksi }>('/accrual/corrections', payload);
}
