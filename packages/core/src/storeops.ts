/**
 * storeops — kosakata Modul 18 (Store Operation), sisi TypeScript.
 *
 * ## KENAPA KONSTANTA, BUKAN `string`
 *
 * `request_type` dan `jenis_gambar` datang dari worksheet divisi (M18 §3.3/§3.4)
 * dan keduanya enum TERTUTUP. Di DB mereka dijaga CHECK constraint; kalau sisi TS
 * cuma `string`, satu salah ketik lolos typecheck, lolos review, dan baru gagal
 * di INSERT dengan pesan constraint mentah yang bukan bahasa pengguna.
 *
 * Jadi berkas ini hidup DUAL-HOME dengan CHECK constraint-nya, pola yang sama
 * dengan `DIVISIONS` ↔ `division_registry` dan `PREFIXES` ↔ `entity_prefix`.
 * Yang memaksa keduanya identik adalah `packages/db/src/storeops.registry.test.ts`
 * — ia membaca `pg_get_constraintdef` dan membandingkan HIMPUNANNYA, bukan
 * jumlahnya (dua kesalahan bisa saling menutupi kalau yang dibandingkan hitungan).
 *
 * ## KENAPA STATUS IKUT DI SINI
 *
 * Nama state dipakai di tiga tempat (mesin `store_ops_sku` di `sm_edges`, gerbang
 * domain, dan label FE) dan ketiganya harus mengeja hal yang sama persis termasuk
 * kurung sikunya. `SKU_STATES` adalah ejaan kanoniknya; tesnya membandingkan
 * dengan `sm_edges`/`sm_machines` sungguhan.
 *
 * Rujukan: `docs/prd/CDPS_Module18_Store_Ops.md`.
 */

/** M18 §3.3 — tujuh jenis permintaan, urutan sama dengan worksheet divisi. */
export const REQUEST_TYPES = [
  'Shopee New',
  'Shopee Revision',
  'Shopee Additional',
  'Tiktok New',
  'Tiktok Revision',
  'Tiktok Additional',
  'CPAS New',
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

/** M18 §3.4 — empat jenis gambar. */
export const JENIS_GAMBAR = [
  'Cover Only',
  'Cover + Pendamping',
  'Varian + Pendamping',
  'Iklan CPAS',
] as const;

export type JenisGambar = (typeof JENIS_GAMBAR)[number];

/**
 * M18 §4 — state mesin `store_ops_sku` (mesin #32), ejaan kanonik.
 *
 * `[Terupload]` adalah SELESAI PRODUKSI (ketokan K-6) — ia sengaja BUKAN terminal:
 * `[Dievaluasi]` adalah langkah review ±30 hari kemudian yang mengisi angka
 * dampak. Menggabungkan keduanya akan mencemari lead time produksi dengan waktu
 * tunggu pasar.
 */
export const SKU_STATES = [
  '[Menunggu Eksekusi]',
  '[Dikerjakan]',
  '[Terupload]',
  '[Gagal Upload]',
  '[Dievaluasi]',
] as const;

export type SkuState = (typeof SKU_STATES)[number];

/** State awal saat baris SKU di-INSERT (bukan lewat `sm_transition` — nol from-state). */
export const SKU_INITIAL_STATE: SkuState = '[Menunggu Eksekusi]';

/** Satu-satunya state terminal (M18 §4). */
export const SKU_TERMINAL_STATE: SkuState = '[Dievaluasi]';

/**
 * State yang berarti "produksi sudah selesai" untuk keperluan rollup Brief
 * (M18 §8). `[Dievaluasi]` ikut karena ia SESUDAH `[Terupload]`; menahan rollup
 * sampai `[Dievaluasi]` akan menahan Brief ~30 hari setelah pekerjaannya betul
 * betul selesai — persis yang K-6 larang.
 */
export const SKU_PRODUKSI_SELESAI: readonly SkuState[] = ['[Terupload]', '[Dievaluasi]'];

/**
 * Penanda sisi penulis (M18 §6). Nilai GUC `cdps.sku_writer`, transaction-local.
 *
 * Ini BUKAN kosmetik: jalur tulis CDPS berjalan privileged tanpa klaim JWT, jadi
 * trigger dinding dua-penulis tidak punya cara lain mengetahui sisi mana yang
 * sedang menulis. UPDATE tanpa penanda ditolak seluruhnya.
 */
export const SKU_WRITER_GUC = 'cdps.sku_writer';
export const SKU_WRITER_AM = 'am';
export const SKU_WRITER_OPS = 'ops';

/** Apakah `v` salah satu `request_type` terdaftar? */
export function isRequestType(v: string): v is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(v);
}

/** Apakah `v` salah satu `jenis_gambar` terdaftar? */
export function isJenisGambar(v: string): v is JenisGambar {
  return (JENIS_GAMBAR as readonly string[]).includes(v);
}

/** Apakah `v` salah satu state mesin `store_ops_sku`? */
export function isSkuState(v: string): v is SkuState {
  return (SKU_STATES as readonly string[]).includes(v);
}

/** Sudah lewat gerbang produksi (M18 §8) — dipakai rollup Brief. */
export function produksiSelesai(state: string): boolean {
  return (SKU_PRODUKSI_SELESAI as readonly string[]).includes(state);
}
