/**
 * Jalur tulis `STR-` (M6 §4 `strategy_plans`) — DIPENSIUNKAN.
 *
 * Ketokan pemilik 2026-09-08: **`STRG-` (M6A, `strategi`) yang kanonik.** Sampai
 * ketokan itu ada, CDPS punya DUA fitur Strategy yang hidup berdampingan di web
 * dan hanya satu yang membuka gerbang Brief — `STR-` lewat `/persetujuan`, dan
 * `STRG-` lewat `/account/strategi/{id}`. Sesudah A-3 menyambungkan `STRG-` ke
 * mesin status Service, keduanya jadi penulis hidup ke `services.status`, dan itu
 * bisa dijangkau: STRG- disetujui lebih dulu ⇒ persetujuan STR- untuk Service
 * yang sama GAGAL TOTAL dengan `[transisi status tidak diizinkan]` dan
 * ter-rollback, sehingga SPV terkunci permanen dari Plan itu. Terukur di tes
 * probe sebelum ketokan; nol instance di produksi (nol Service memegang kedua
 * record), jadi ia laten, bukan aktif.
 *
 * Kenapa 410 dan bukan menghapus route-nya: `route-parity.test.ts` menuntut
 * setiap path yang dipanggil `web-internal` dilayani `apps/api`, dan sebuah path
 * yang HILANG tidak bisa dibedakan dari salah tulis. 410 Gone adalah jawaban
 * yang jujur: pernah ada, sengaja dicabut, dan jangan dicoba lagi. 404 akan
 * terbaca sebagai "id-nya salah" dan 405 sebagai "method-nya salah" — dua-duanya
 * mengirim pemanggilnya mencari bug yang tidak ada.
 *
 * Yang TETAP hidup: pembacaan (`GET /strategies`, `GET /strategies/{id}`). Dua
 * baris `STR-` di produksi sudah `[Strategy Approved]` dan merupakan riwayat
 * kesepakatan yang sungguhan — riwayat tidak dipensiunkan, hanya pintu
 * majunya (aturan rumah #3).
 *
 * Rujukan: `docs/DECISIONS.md` 2026-09-08, `docs/STATE_MACHINES.md` §6a.
 */
import { errorJson } from './http';

/**
 * Pesan BI untuk setiap jalur tulis `STR-`. Menyebut penggantinya, karena
 * penolakan yang tidak memberi jalan keluar hanya memindahkan kebingungan.
 */
export const MSG_STR_PENSIUN =
  '[jalur Strategy & Plan (STR-) sudah tidak dipakai, gunakan Strategi (STRG-) di halaman layanan]';

/** 410 Gone untuk satu jalur tulis `STR-` yang sudah dicabut. */
export function strPensiun(): Response {
  return errorJson(MSG_STR_PENSIUN, 410);
}
