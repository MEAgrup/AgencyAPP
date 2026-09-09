/**
 * dailyops — kosakata Modul 19 (Creative Daily Ops), sisi TypeScript.
 *
 * ## KENAPA KONSTANTA, BUKAN `string`
 *
 * `task_type` (slot produksi) dan `alasan` (ketidaktersediaan PIC) datang dari
 * jadwal harian Leader Video dan keduanya enum TERTUTUP. Di DB mereka dijaga
 * CHECK constraint; kalau sisi TS cuma `string`, satu salah ketik lolos
 * typecheck, lolos review, dan baru gagal di INSERT dengan pesan constraint
 * mentah yang bukan bahasa pengguna.
 *
 * Jadi berkas ini hidup DUAL-HOME dengan CHECK constraint-nya — pola yang sama
 * dengan `storeops.ts` (M18), `DIVISIONS` ↔ `division_registry`, dan `PREFIXES`
 * ↔ `entity_prefix`. Yang memaksa keduanya identik adalah
 * `packages/db/src/dailyops.registry.test.ts`: ia membaca
 * `pg_get_constraintdef` dan membandingkan HIMPUNANNYA, bukan jumlahnya (dua
 * kesalahan bisa saling menutupi).
 *
 * ## KENAPA STUDIO IKUT DI SINI PADAHAL IA TABEL
 *
 * `studios` adalah registry ber-baris (punya flag `cek_konflik` per baris),
 * jadi ia tabel — pola `division_registry`, bukan CHECK constraint. Yang hidup
 * di berkas ini adalah SALINAN kanoniknya, dan tes registry yang sama memaksa
 * keduanya set-equal. Alasannya sama seperti `division.ts`: tipe TS tetap
 * sempit sekaligus menambah studio cukup satu baris di sini + satu migrasi.
 *
 * ## YANG SENGAJA TIDAK ADA DI SINI
 *
 * Nol nama state. Modul ini **nol mesin status** (PRD Rule 1/D1): `PROD-SLOT`
 * adalah catatan rencana, dan lifecycle-nya milik Asset/Task (M7/M12). Kalau
 * suatu saat ada yang menambahkan `SLOT_STATES` di bawah sini, itu tandanya
 * keputusan D1 sedang dibatalkan tanpa entri `DECISIONS.md`.
 *
 * Nol kosakata `SCS` (SMO & Content Strategist). Taksonomi 24 Kategori-nya
 * menunggu ketokan `M19-SCS-ENGINE` di `docs/DECISIONS.md` §Open.
 *
 * Rujukan: `docs/prd/CDPS_Module19_Creative_Daily_Ops.md`.
 */

/** M19 §5.1 — lima jenis pekerjaan satu slot, urutan sama dengan sheet. */
export const TASK_TYPES = [
  'Shoot',
  'Edit',
  'Script',
  'Voice Over',
  'Other',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

/**
 * M19 §5.1 / D4 — empat alasan seorang PIC tidak bisa dijadwalkan.
 *
 * Ini BUKAN jenis cuti HR dan tidak boleh tumbuh menjadi itu (nol "Cuti
 * Tahunan"/"Cuti Melahirkan"/"Unpaid"): CDPS bukan HRIS, dan tabelnya hanya
 * menjawab "boleh dijadwalkan hari itu atau tidak". Menambah nilai di sini
 * berarti memperluas klaim kewenangan atas data cuti — butuh entri
 * `DECISIONS.md`, bukan satu baris.
 */
export const ALASAN_TIDAK_TERSEDIA = [
  'Cuti',
  'Sakit',
  'Izin',
  'Dinas Luar',
] as const;

export type AlasanTidakTersedia = (typeof ALASAN_TIDAK_TERSEDIA)[number];

/** Satu ruang produksi. */
export interface Studio {
  /** Kunci registry, ditulis ke `prod_slots.studio_code`. */
  readonly code: string;
  /** Label yang dilihat orang, dan yang masuk pesan peringatan konflik. */
  readonly nama: string;
  /** Studio nonaktif tidak muncul di picker, tapi barisnya tetap ada. */
  readonly aktif: boolean;
  /**
   * `false` ⇒ tumpang-tindih waktu di lokasi ini TIDAK diperingatkan.
   * `Luar Kantor` bukan satu ruangan melainkan catch-all lokasi luar: dua shoot
   * di dua lokasi luar berbeda bukan konflik, dan memperingatkannya setiap hari
   * melatih orang mengabaikan peringatan.
   */
  readonly cekKonflik: boolean;
  /** Urutan kolom di grid jadwal dan di picker. */
  readonly urutan: number;
}

/** Registry kanonik — dual-home dengan tabel `studios`. */
export const STUDIOS: readonly Studio[] = [
  { code: 'KASUARI',     nama: 'Kasuari',     aktif: true, cekKonflik: true,  urutan: 1 },
  { code: 'RAJAWALI',    nama: 'Rajawali',    aktif: true, cekKonflik: true,  urutan: 2 },
  { code: 'CEMPAKA',     nama: 'Cempaka',     aktif: true, cekKonflik: true,  urutan: 3 },
  { code: 'LUAR_KANTOR', nama: 'Luar Kantor', aktif: true, cekKonflik: false, urutan: 4 },
];

export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}

export function isAlasanTidakTersedia(v: string): v is AlasanTidakTersedia {
  return (ALASAN_TIDAK_TERSEDIA as readonly string[]).includes(v);
}

/** Satu studio dari registry, atau `undefined` kalau kodenya tak dikenal. */
export function studioByCode(code: string): Studio | undefined {
  return STUDIOS.find((s) => s.code === code);
}

/** Nama tampil sebuah studio; kode mentah sebagai fallback (jangan pernah kosong). */
export function studioNama(code: string): string {
  return studioByCode(code)?.nama ?? code;
}

/** Studio aktif, urut — yang dipakai picker dan kolom grid. */
export function studiosAktif(): readonly Studio[] {
  return STUDIOS.filter((s) => s.aktif).slice().sort((a, b) => a.urutan - b.urutan);
}

/**
 * Apakah dua rentang waktu BERTUMPANG (setengah terbuka: `[mulai, selesai)`).
 *
 * Setengah terbuka, bukan tertutup, dan itu bukan detail: slot 09.00–12.00 dan
 * 12.00–14.00 adalah dua sesi yang bersambung, BUKAN konflik. Perbandingan
 * tertutup akan memperingatkan setiap pasangan slot yang berurutan rapi —
 * yaitu justru jadwal yang paling benar.
 *
 * Nilainya string `HH:MM` atau `HH:MM:SS` (kolom Postgres `time`); perbandingan
 * leksikografis sah untuk keduanya karena jamnya selalu dua digit.
 */
export function waktuBertumpang(
  aMulai: string, aSelesai: string, bMulai: string, bSelesai: string,
): boolean {
  return aMulai < bSelesai && bMulai < aSelesai;
}

/**
 * Apakah `tanggal` (YYYY-MM-DD) jatuh di dalam rentang ketidaktersediaan,
 * INKLUSIF di kedua ujung — beda dari `waktuBertumpang` di atas, dan bedanya
 * disengaja: cuti "10–12 September" berarti tanggal 12 orangnya masih tidak ada.
 */
export function tanggalDalamRentang(tanggal: string, mulai: string, selesai: string): boolean {
  return tanggal >= mulai && tanggal <= selesai;
}
