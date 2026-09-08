// D-3 — kunci tutup buku per bulan.
//
// Bentuk di sini MENCERMINKAN `apps/api/src/lib/wire.ts` (snake_case), dan itu
// dikunci gerbang `shape-parity.test.ts`: menambah field di satu sisi tanpa
// sisi lain akan membuat gerbangnya merah, bukan membuat halaman ini blank
// diam-diam (kelas bug O43).
//
// Semua rupiah datang SUDAH terformat dari server ("Rp. X.XXX.XXX,00") dan
// dirender apa adanya — halaman ini tidak pernah menghitung uang sendiri.

import { api } from '@/lib/api';

export interface Periode {
  periode: string;
  status: string;
  versi_terakhir: number;
  dibuka_pada: string | null;
  dibuka_oleh: string | null;
  alasan_buka: string | null;
}

export interface BarisAngka {
  service_id: string;
  client_id: string;
  nama: string;
  jumlah: string;
  jumlah_idr: string;
  hangus: string;
}

/**
 * Layanan yang TIDAK bisa dihitung, dengan sebabnya.
 *
 * Ditampilkan menonjol, bukan disembunyikan: bulan yang punya baris di sini
 * angkanya lebih kecil dari kenyataan, dan orang yang menekan "Tutup Buku"
 * berhak tahu itu SEBELUM menekannya.
 */
export interface LayananTidakTerhitung {
  service_id: string;
  nama: string;
  sebab: string;
}

export interface AngkaPeriode {
  periode: string;
  penghitung: string;
  total_diakui: string;
  total_diakui_idr: string;
  total_hangus: string;
  jumlah_layanan: number;
  baris: BarisAngka[];
  tidak_terhitung: LayananTidakTerhitung[];
}

export interface SnapshotVersi {
  periode: string;
  versi: number;
  ditutup_oleh: string;
  ditutup_pada: string;
  penghitung: string;
  angka: AngkaPeriode;
}

export interface SelisihBaris {
  service_id: string;
  nama: string;
  sebelum: string | null;
  sesudah: string | null;
  selisih: string;
  selisih_idr: string;
}

export interface SelisihVersi {
  periode: string;
  versi_sebelum: number;
  versi_sesudah: number;
  total_sebelum: string;
  total_sesudah: string;
  total_selisih: string;
  total_selisih_idr: string;
  baris: SelisihBaris[];
}

export interface JurnalKoreksi {
  periode_dikoreksi: string;
  periode_catat: string;
  keterangan: string;
  /** null = catatan tanpa nilai, BUKAN nol. */
  nilai: string | null;
  nilai_idr: string | null;
  dicatat_oleh: string;
  dicatat_pada: string;
}

/** Detail satu bulan; `beku` menjawab "ini angka terkunci atau hitungan hari ini". */
export interface DetailPeriode {
  periode: Periode | null;
  angka: AngkaPeriode;
  beku: boolean;
  versi_ditampilkan: number | null;
  versi: Omit<SnapshotVersi, 'angka'>[];
}

export function listPeriode(): Promise<{ data: Periode[] }> {
  return api.get<{ data: Periode[] }>('/finance/tutup-buku');
}

export function getPeriode(periode: string): Promise<{ data: DetailPeriode }> {
  return api.get<{ data: DetailPeriode }>(`/finance/tutup-buku/${periode}`);
}

export function tutupBuku(
  periode: string,
): Promise<{ data: { periode: Periode; versi: number; angka: AngkaPeriode } }> {
  return api.post(`/finance/tutup-buku/${periode}`);
}

export function bukaBuku(periode: string, alasan: string): Promise<{ data: Periode }> {
  return api.post(`/finance/tutup-buku/${periode}/buka`, { alasan });
}

export function listVersi(periode: string): Promise<{ data: SnapshotVersi[] }> {
  return api.get<{ data: SnapshotVersi[] }>(`/finance/tutup-buku/${periode}/versi`);
}

export function bandingkanVersi(
  periode: string,
  dari: number,
  ke: number,
): Promise<{ data: SelisihVersi }> {
  return api.get<{ data: SelisihVersi }>(
    `/finance/tutup-buku/${periode}/selisih?dari=${dari}&ke=${ke}`,
  );
}

export function listJurnalKoreksi(periode: string): Promise<{ data: JurnalKoreksi[] }> {
  return api.get<{ data: JurnalKoreksi[] }>(`/finance/tutup-buku/${periode}/jurnal-koreksi`);
}

export function catatJurnalKoreksi(
  periodeDikoreksi: string,
  periodeCatat: string,
  keterangan: string,
  /** null = catatan tanpa nilai. JANGAN kirim 0 untuk maksud itu. */
  nilai: string | null,
): Promise<{ data: JurnalKoreksi }> {
  // Badan permintaan ditulis sebagai literal di sini, bukan diteruskan dari
  // sebuah parameter objek: gerbang `body-parity.test.ts` membaca literal ini
  // untuk mengadu nama field-nya dengan yang dibaca route. Objek yang datang
  // dari parameter tidak bisa ia telusuri, dan badan yang tak tertelusuri
  // tidak memeriksa apa pun.
  return api.post(`/finance/tutup-buku/${periodeDikoreksi}/jurnal-koreksi`, {
    periode_catat: periodeCatat,
    keterangan,
    nilai,
  });
}
