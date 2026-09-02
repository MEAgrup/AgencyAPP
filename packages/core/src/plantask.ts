/**
 * Katalog **jenis task per divisi** untuk baris rencana kerja Plan (M6B P-C).
 *
 * KENAPA ADA. PC-6 adalah "Angka + unit (mis. 40 video, 7 listing, 36 jam
 * live)", dan sampai sekarang `satuan` diisi sebagai TEKS BEBAS di form
 * `/account/plan/{id}`. Konsekuensinya persis kelas masalah yang registry divisi
 * (`division.ts`) dibuat untuk menghentikan: satu deliverable ditulis "video",
 * "vidio", "video seller", dan "Video" oleh empat AM, lalu laporan yang
 * menjumlahkan per satuan diam-diam memecah satu angka jadi empat. Pemilik
 * meminta (2026-09-02) task bisa diberikan ke divisi operasional "dengan detail
 * task sesuai satuannya" — jadi satuan berhenti jadi teks bebas dan jadi
 * turunan dari jenis task yang dipilih.
 *
 * HUBUNGAN DENGAN `account.TASK_CATALOG`. Bukan katalog kedua yang menyaingi:
 * `jenis` di sini SENGAJA memakai kunci yang SAMA dengan `TASK_CATALOG`
 * (`video_seller`, `ads_spent`, `sku_optimize_ai`, …) supaya kuota komitmen
 * Strategi dan realisasi baris Plan bisa dijoin per `jenis` tanpa tabel
 * pemetaan. Yang ditambahkan berkas ini adalah `satuan` — kata benda unitnya —
 * yang `TASK_CATALOG` tidak punya karena label-nya sudah berupa hitungan
 * ("Jumlah video seller"). `plantask.registry.test.ts` gagal kalau sebuah
 * `jenis` ada di satu katalog tapi tidak di katalog lainnya untuk divisi yang
 * sama.
 *
 * TIDAK ADA KOLOM `plan_row.jenis_task`, dan itu disengaja. `jenis` bisa
 * dipulihkan dari pasangan (`divisi_pic`, `satuan`) karena satuan UNIK di dalam
 * satu divisi — invariant yang dijaga `plantask.test.ts`. Menambah kolom yang
 * bisa diturunkan berarti dua sumber untuk satu fakta, dan migrasi untuk nol
 * informasi baru.
 *
 * DIVISI YANG TIDAK ADA DI SINI (Account, Ops) bukan kelalaian: keduanya
 * mengerjakan pekerjaan internalnya sendiri tanpa deliverable satuan yang
 * terdaftar (`division.ts`, `punyaKuotaSatuan: false`), jadi barisnya tetap
 * memakai satuan teks bebas — jalur "Lainnya" di form.
 */
import * as division from './division';

/** Satu jenis deliverable yang bisa jadi baris kerja Plan. */
export interface PlanTaskJenis {
  /**
   * Kunci stabil, sama dengan `account.TASK_CATALOG[divisi].jenis` bila ada di
   * sana. Unik SECARA GLOBAL, bukan hanya per divisi — laporan yang
   * menjumlahkan per `jenis` tak boleh mencampur pekerjaan dua tim (alasan
   * `sku_optimize_ai` tidak memakai nama `sku_optimize` milik Creative).
   */
  readonly jenis: string;
  /** Label BI di dropdown "Jenis task". */
  readonly label: string;
  /**
   * Kata benda unit yang masuk ke `plan_row.satuan` (varchar(32)). Unik di
   * dalam satu divisi — lihat header soal kenapa tak ada kolom `jenis_task`.
   */
  readonly satuan: string;
  /**
   * Angkanya Rupiah, bukan hitungan. Form merender input IDR dan menyetel
   * PC-7 `budget` = angka yang sama (untuk baris `ads_spent` keduanya memang
   * satu angka: PC-7 adalah "Rp yang dialokasikan ke baris ini").
   */
  readonly money?: boolean;
}

/**
 * Katalog kanonik, dikunci per NAMA divisi (`division.Division.nama` — label BI
 * yang benar-benar tersimpan di `plan_row.divisi_pic`).
 *
 * Lima divisi pertama menyalin `jenis` dari `account.TASK_CATALOG` apa adanya.
 * Store Operation baru: pemilik meratifikasi tiga pekerjaan yang sudah pernah
 * ia sebut di `docs/DECISIONS.md` LT-2 (Banding Pelanggaran, Setup Promo Toko,
 * QC Konten Toko) pada 2026-09-02 — sekaligus meratifikasi dua nama pengganti
 * yang masih berstatus usulan di kamus istilah M16 (2026-08-28).
 */
export const PLAN_TASK_CATALOG: Readonly<Record<string, readonly PlanTaskJenis[]>> = {
  Creative: [
    { jenis: 'video_seller', label: 'Video seller', satuan: 'video' },
    { jenis: 'sku_optimize', label: 'SKU optimize', satuan: 'SKU' },
  ],
  Ads: [
    { jenis: 'ads_spent', label: 'Ads spent', satuan: 'Rp', money: true },
  ],
  KOL: [
    { jenis: 'video_creator', label: 'Video creator', satuan: 'video' },
    { jenis: 'live_stream_creator', label: 'Live stream creator', satuan: 'sesi' },
  ],
  // Dua satuan, keduanya dari PRD dan keduanya dipakai di tempat berbeda:
  // `live_stream` = "Jumlah live stream" (TASK_CATALOG, QA revisi 2026-08-12),
  // `jam_live` = angka yang M6A F-4/D-4 dan B-7.2 sebut "jam live per bulan"
  // dan yang jadi contoh PC-6 sendiri ("36 jam live"). Bukan invensi: keduanya
  // tertulis, jadi keduanya ditawarkan alih-alih memaksa satu.
  'Live Stream': [
    { jenis: 'live_stream', label: 'Jumlah live stream', satuan: 'sesi' },
    { jenis: 'jam_live', label: 'Jam live (vendor)', satuan: 'jam live' },
  ],
  'AI Optimizer': [
    { jenis: 'sku_optimize_ai', label: 'SKU optimize (AI)', satuan: 'SKU' },
    { jenis: 'ai_video', label: 'AI video', satuan: 'video' },
  ],
  'Store Operation': [
    { jenis: 'banding_pelanggaran', label: 'Banding Pelanggaran', satuan: 'kasus' },
    { jenis: 'setup_promo_toko', label: 'Setup Promo Toko', satuan: 'promo' },
    { jenis: 'qc_konten_toko', label: 'QC Konten Toko', satuan: 'konten' },
  ],
};

/** Jenis task yang terdaftar untuk satu divisi; `[]` kalau divisi itu tak punya katalog. */
export function jenisFor(namaDivisi: string): readonly PlanTaskJenis[] {
  return PLAN_TASK_CATALOG[namaDivisi] ?? [];
}

/** Apakah divisi ini punya katalog jenis task (⇒ satuan dropdown, bukan teks bebas)? */
export function punyaKatalog(namaDivisi: string): boolean {
  return jenisFor(namaDivisi).length > 0;
}

/**
 * Pulihkan jenis task dari pasangan (`divisi_pic`, `satuan`) — satu-satunya
 * jalur baca, karena `plan_row` sengaja tak menyimpan `jenis_task` (header).
 * `undefined` untuk baris bersatuan teks bebas ("Lainnya") atau divisi tanpa
 * katalog.
 */
export function jenisBySatuan(namaDivisi: string, satuan: string): PlanTaskJenis | undefined {
  const s = satuan.trim().toLowerCase();
  return jenisFor(namaDivisi).find((j) => j.satuan.toLowerCase() === s);
}

/**
 * Divisi yang boleh jadi PIC baris Plan (PC-8), dipisah jadi dua grup untuk
 * picker form. "Operasional" = divisi delivery yang mengerjakan pekerjaan
 * klien (cermin `division.dispatchNames()`); "Internal" = sisanya yang boleh
 * menerima Brief tapi mengerjakan pekerjaan internalnya sendiri (Account/Ops,
 * keputusan pemilik 2026-08-27). Urutannya urutan registry, bukan alfabet.
 */
export function picGroups(): { label: string; divisi: string[] }[] {
  const operasional = division.dispatchNames();
  const internal = division.briefAssignableNames().filter((n) => !operasional.includes(n));
  return [
    { label: 'Divisi Operasional', divisi: operasional },
    { label: 'Internal', divisi: internal },
  ];
}
