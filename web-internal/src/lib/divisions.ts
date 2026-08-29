/**
 * Daftar divisi untuk web-internal — SATU salinan frontend (M16).
 *
 * KENAPA ADA SALINAN SAMA SEKALI. `web-internal` tidak punya dependency ke
 * `@cdps/*` (lihat `web-internal/package.json`) — ia bicara ke `apps/api` lewat
 * HTTP, bukan lewat import. Jadi konstanta divisi tidak bisa di-import dari
 * `packages/core/src/division.ts`. Sebelum berkas ini, konsekuensinya adalah
 * TIGA salinan terpisah (`penugasan.ts`, `tasks.ts`, `strategi.ts`) yang
 * masing-masing harus diingat saat divisi bertambah. Sekarang satu.
 *
 * SUMBER KEBENARANNYA TETAP `packages/core/src/division.ts` (+ tabel
 * `division_registry`). Berkas ini cermin ketiga yang dijaga MANUAL — kalau
 * menambah divisi, ubah di sini juga. Menjadikannya benar-benar satu sumber
 * menuntut endpoint `GET /divisions` yang di-fetch saat runtime; itu pekerjaan
 * tersendiri dan sengaja tidak digabung ke fondasi M16.
 *
 * DUA KONSEP BERBEDA, jangan disatukan:
 *   - `DIVISI_KERJA`     — divisi yang bisa menerima Brief klien (cermin
 *                          `briefAssignableNames()`).
 *   - `PENUGASAN_DIVISIONS` — SELURUH divisi perusahaan, termasuk Sales /
 *                          Marketing / Finance yang tidak pernah menerima
 *                          Brief. Penugasan Internal (`TSK-`) memang lintas
 *                          perusahaan dan sengaja di luar rantai klien
 *                          (STATE_MACHINES §17), jadi daftarnya superset.
 */

/**
 * Divisi yang boleh menerima Brief (cermin `BRIEF_ASSIGNABLE_DIVISIONS`,
 * ditegakkan server-side oleh `listDivisionQueue`).
 *
 * Live Stream ada di daftar untuk visibilitas baca walau dikerjakan vendor dan
 * di luar mesin eksekusi M12. Account/Ops tidak punya board divisi sendiri —
 * antrian generik ini satu-satunya tempat Brief mereka terlihat (keputusan
 * pemilik, DECISIONS.md 2026-08-27). Store Operation belum punya pipeline
 * tahapan (DECISIONS.md LT-2) tapi tetap bisa menerima Brief.
 */
export const DIVISI_KERJA = [
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
  'Account',
  'Ops',
  'AI Optimizer',
  'Store Operation',
] as const;

/**
 * Divisi tujuan dispatch Strategi (cermin `DISPATCH_DIVISIONS`, M6A I-2).
 * Lebih sempit dari `DIVISI_KERJA`: Account/Ops mengerjakan pekerjaan internal
 * mereka sendiri dan bukan tujuan dispatch Strategi.
 */
export const DISPATCH_DIVISIONS = [
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
  'AI Optimizer',
  'Store Operation',
] as const;

/**
 * Divisi perusahaan untuk Penugasan Internal (`TSK-`) — SUPERSET dari
 * `DIVISI_KERJA`: penugasan atasan→bawahan tidak terikat rantai klien, jadi
 * Sales / Marketing / Finance ikut.
 */
export const PENUGASAN_DIVISIONS = [
  'Sales',
  'Marketing',
  'Finance',
  ...DIVISI_KERJA,
] as const;
