/**
 * Katalog jenis task per divisi untuk baris rencana kerja Plan (M6B P-C) —
 * CERMIN frontend.
 *
 * SUMBER KEBENARANNYA `packages/core/src/plantask.ts`. Sama seperti
 * `divisions.ts` di sebelah, berkas ini ada karena `web-internal` tidak punya
 * dependency ke `@cdps/*` (lihat `web-internal/package.json`) — ia bicara ke
 * `apps/api` lewat HTTP, jadi konstanta tidak bisa di-import. Kalau menambah
 * jenis task, ubah di KEDUA tempat; `plantask.test.ts` di sebelah menjaga
 * invariant strukturalnya, tapi ia tidak bisa membandingkan dengan core.
 *
 * KENAPA DROPDOWN, BUKAN TEKS BEBAS. `plan_row.satuan` dulu diisi bebas, jadi
 * satu deliverable tercatat "video", "vidio", dan "video seller" — dan laporan
 * yang menjumlahkan per satuan memecah satu angka jadi tiga. Pemilik meminta
 * (2026-09-02) task ke divisi operasional diberikan "dengan detail task sesuai
 * satuannya": AM memilih jenis, satuannya ikut.
 *
 * `Account`/`Ops` sengaja tak ada di sini — keduanya mengerjakan pekerjaan
 * internalnya sendiri tanpa deliverable satuan terdaftar, jadi barisnya lewat
 * jalur "Lainnya" (satuan teks bebas), yang tetap tersedia untuk SEMUA divisi.
 */

export interface PlanTaskJenis {
  /** Kunci stabil; sama dengan `TASK_CATALOG[divisi].jenis` bila ada di sana. */
  jenis: string;
  /** Label BI di dropdown "Jenis task". */
  label: string;
  /** Kata benda unit yang masuk ke `plan_row.satuan`. */
  satuan: string;
  /** Angkanya Rupiah, bukan hitungan ⇒ form merender input IDR + isi PC-7. */
  money?: boolean;
}

/** Nilai sentinel dropdown "Jenis task" untuk satuan teks bebas. */
export const JENIS_LAINNYA = '__lainnya__';

export const PLAN_TASK_CATALOG: Record<string, PlanTaskJenis[]> = {
  Creative: [
    { jenis: 'video_seller', label: 'Video seller', satuan: 'video' },
    { jenis: 'sku_optimize', label: 'SKU optimize', satuan: 'SKU' },
  ],
  Ads: [{ jenis: 'ads_spent', label: 'Ads spent', satuan: 'Rp', money: true }],
  KOL: [
    { jenis: 'video_creator', label: 'Video creator', satuan: 'video' },
    { jenis: 'live_stream_creator', label: 'Live stream creator', satuan: 'sesi' },
  ],
  'Live Stream': [
    { jenis: 'live_stream', label: 'Jumlah live stream', satuan: 'sesi' },
    { jenis: 'jam_live', label: 'Jam live (vendor)', satuan: 'jam live' },
  ],
  'AI Optimizer': [
    { jenis: 'sku_optimize_ai', label: 'SKU optimize (AI)', satuan: 'SKU' },
    { jenis: 'ai_video', label: 'AI video', satuan: 'video' },
  ],
  // Tiga pekerjaan yang pemilik ratifikasi 2026-09-02 dari DECISIONS.md LT-2
  // (sekaligus meratifikasi dua nama pengganti kamus istilah M16 2026-08-28).
  'Store Operation': [
    { jenis: 'banding_pelanggaran', label: 'Banding Pelanggaran', satuan: 'kasus' },
    { jenis: 'setup_promo_toko', label: 'Setup Promo Toko', satuan: 'promo' },
    { jenis: 'qc_konten_toko', label: 'QC Konten Toko', satuan: 'konten' },
  ],
};

/** Jenis task terdaftar untuk satu divisi; `[]` kalau divisi itu tak punya katalog. */
export function jenisFor(namaDivisi: string): PlanTaskJenis[] {
  return PLAN_TASK_CATALOG[namaDivisi] ?? [];
}

/** Satu jenis berdasarkan kuncinya, di dalam satu divisi. */
export function findJenis(namaDivisi: string, jenis: string): PlanTaskJenis | undefined {
  return jenisFor(namaDivisi).find((j) => j.jenis === jenis);
}

/**
 * Pulihkan jenis dari satuan yang TERSIMPAN di baris — `plan_row` sengaja tak
 * punya kolom `jenis_task` karena satuan unik di dalam satu divisi. Dipakai saat
 * form dibuka lagi atas baris yang sudah ada. `undefined` = satuan bebas.
 */
export function jenisBySatuan(namaDivisi: string, satuan: string): PlanTaskJenis | undefined {
  const s = satuan.trim().toLowerCase();
  if (s === '') return undefined;
  return jenisFor(namaDivisi).find((j) => j.satuan.toLowerCase() === s);
}

/**
 * Divisi PIC (PC-8) dalam dua grup picker. "Divisi Operasional" = enam divisi
 * delivery yang mengerjakan pekerjaan klien (cermin `DISPATCH_DIVISIONS`);
 * "Internal" = Account/Ops, yang boleh menerima Brief tapi mengerjakan
 * pekerjaan internalnya sendiri (keputusan pemilik 2026-08-27). Account/Ops
 * TETAP ada di picker: PC-8 mengizinkannya dan baris lama memakainya —
 * mengeluarkannya adalah regresi fungsi, bukan kerapian.
 */
export const PIC_GROUPS: { label: string; divisi: string[] }[] = [
  {
    label: 'Divisi Operasional',
    divisi: ['Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation'],
  },
  { label: 'Internal', divisi: ['Account', 'Ops'] },
];
