/**
 * PPN — kosakata perlakuan pajak, dan SATU tempat angka tarifnya hidup
 * (Gelombang D, gerbang D-4).
 *
 * KETOKAN D-4 (pemilik 2026-09-07): *"Bruto dulu untuk harga; Sales/Finance
 * yang memilih kena PPN atau tidak. Nilai disimpan BRUTO; perlakuan PPN jadi
 * pilihan EKSPLISIT per transaksi. Mesin accrual TIDAK menghitung PPN sendiri
 * — ia menyimpan nilai bruto + penanda pilihan, manusia yang memilih."*
 *
 * APA MODUL INI ADALAH. Dua hal, dan tidak lebih: kosakata pilihannya, dan
 * tarifnya sebagai konstanta bernama. Ia sengaja **tidak** punya fungsi yang
 * menghitung apa pun — perhitungan PPN yang ada di sistem ini hidup di satu
 * tempat (`sales.applyPPN`, kalkulator penawaran pra-negosiasi), dan menambah
 * tempat kedua adalah persis yang ketokan D-4 larang.
 *
 * KENAPA DI `@cdps/core` DAN BUKAN DI `domain`. Yang memilih adalah Sales (saat
 * Closing) dan Finance (saat menerbitkan invoice) — dua modul domain yang tidak
 * boleh saling impor: `finance.ts` sudah mengimpor `sales.ts`, jadi arah
 * baliknya akan membentuk siklus. Kosakata yang dipakai keduanya karena itu
 * harus berada di bawah keduanya. Ini alasan yang sama yang menaruh kosakata
 * `pengakuan` di `accrual.ts` (core) alih-alih di `msl.ts` (domain).
 *
 * KENAPA `null` ADALAH NILAI YANG SAH, DAN BUKAN "BELUM DIISI YANG BISA
 * DIABAIKAN". Ketokan D-4 memberi pilihan itu kepada MANUSIA. Sebuah default
 * `false`/`'tidak_kena'` akan menjawab pertanyaan itu untuk mereka — diam-diam,
 * untuk setiap transaksi yang belum pernah ditanyakan, dan tanpa cara
 * membedakan "sudah diputuskan tidak kena" dari "belum ada yang memutuskan".
 * Itu aturan kerja #4 (*ketiadaan yang diam tidak bisa dibedakan dari
 * kerusakan*), kelas yang sama dengan `0` vs `null`, dan kelas yang sama yang
 * melahirkan `pengakuan` di D-KOM. Jadi kolomnya NULLABLE tanpa default, dan
 * `belumDipilih()` ada supaya pemanggil menulis maksudnya alih-alih `=== null`.
 */

/**
 * Perlakuan PPN satu transaksi, sebagaimana DIPILIH manusia.
 *
 * `null` (di luar tipe ini) berarti belum ada yang memilih — lihat header.
 */
export type PpnPilihan = 'kena' | 'tidak_kena';

export const PPN_KENA: PpnPilihan = 'kena';
export const PPN_TIDAK_KENA: PpnPilihan = 'tidak_kena';

/** Kedua nilai, persis kosakata yang ditegakkan CHECK `ck_trx_ppn_pilihan`. */
export const PPN_PILIHAN_SEMUA: readonly PpnPilihan[] = [PPN_KENA, PPN_TIDAK_KENA];

/**
 * Kalimat Bahasa Indonesia per pilihan, dipakai halaman apa adanya — termasuk
 * kalimat untuk keadaan BELUM DIPILIH, karena halaman yang menampilkan sel
 * kosong di situ akan terbaca sebagai "tidak kena PPN".
 */
export const PPN_KALIMAT: Readonly<Record<PpnPilihan, string>> = {
  kena: 'Kena PPN',
  tidak_kena: 'Tidak kena PPN',
};

/** Kalimat untuk transaksi yang perlakuan PPN-nya belum pernah dipilih. */
export const PPN_BELUM_DIPILIH_KALIMAT = 'Belum dipilih';

/**
 * Penjelasan satu baris untuk halaman: nilai yang tersimpan BRUTO, dan penanda
 * ini hanya mencatat pilihannya — nol perhitungan.
 */
export const PPN_PENJELASAN =
  'Nilai transaksi disimpan BRUTO. Penanda ini hanya mencatat pilihan perlakuan PPN-nya (ketokan pemilik D-4, 2026-09-07); sistem tidak menambah atau mengurangi PPN dari nilai yang tersimpan.';

/** isPpnPilihan menyempitkan sebuah string ke kosakata yang sah. */
export function isPpnPilihan(v: unknown): v is PpnPilihan {
  return v === PPN_KENA || v === PPN_TIDAK_KENA;
}

/**
 * belumDipilih menyatakan maksudnya di tempat pemanggil, alih-alih `=== null`
 * yang terbaca seperti pemeriksaan teknis.
 */
export function belumDipilih(v: PpnPilihan | null | undefined): boolean {
  return v === null || v === undefined;
}

/**
 * kalimat merender pilihan (atau ketiadaannya) untuk dibaca manusia — satu
 * fungsi, supaya "Belum dipilih" tidak pernah jadi string kosong di satu
 * halaman dan kalimat penuh di halaman lain.
 */
export function kalimat(v: PpnPilihan | null | undefined): string {
  return belumDipilih(v) ? PPN_BELUM_DIPILIH_KALIMAT : PPN_KALIMAT[v as PpnPilihan];
}

/**
 * TARIF PPN jasa Indonesia sebagai pembilang persen bulat, DAN satu-satunya
 * tempat angka itu ditulis di seluruh repo.
 *
 * Sebelum D-4 angka ini adalah literal di `sales.ts` (`PPN_NUMERATOR = 11n`).
 * Dipindah ke sini bukan demi kerapian: begitu perlakuan PPN jadi pilihan per
 * transaksi, tarifnya akan dibaca dari lebih dari satu tempat, dan sebuah tarif
 * pajak yang punya dua definisi akan berbeda pada perubahan pertama — yang
 * untuk pajak berarti dua angka berbeda di dua dokumen yang sama-sama dicetak.
 *
 * `SKALA` = 0 berarti pembilangnya persen bulat (11%), dipakai bersama
 * `money.percentOf(base, PPN_TARIF_PEMBILANG, PPN_TARIF_SKALA)`.
 */
export const PPN_TARIF_PEMBILANG = 11n;
export const PPN_TARIF_SKALA = 0;
