/**
 * Endpoint yang mati bersama pensiunnya **AM Co-Pilot** dan **AM Baseline**.
 *
 * Ketokan pemilik 2026-09-21 (`docs/DECISIONS.md` "PENSIUN-AMTOOLS"): kedua alat
 * HTML ter-embed itu dicabut, dan bersamanya mesin aturan yang menebak pilar
 * Section E dari payload baseline. Penggantinya **editor pilar manual** di
 * Section E: AM memilih sendiri dari katalog 20 aksi, tanpa Riset Awal.
 *
 * Yang dipensiunkan di sini cuma SATU path — `GET /strategi/{id}/copilot`, yang
 * menyajikan usulan mesin itu. Sisa pensiunnya murni frontend (nav, iframe,
 * panel impor), karena kedua alat itu memang tidak pernah menulis ke server:
 * `strategi-video-factory.ts` menyatakannya sendiri ("modul ini tidak menulis
 * apa pun ke server"), dan `riset_awal_analisa` diisi server lewat
 * `baseline.runBaseline()` di `@cdps/core`, bukan oleh tool.
 *
 * Kenapa 410 dan bukan menghapus route-nya: alasan yang sama dengan
 * `retired-str.ts`. `route-parity.test.ts` menuntut setiap path yang dipanggil
 * `web-internal` dilayani `apps/api`, dan sebuah path yang HILANG tidak bisa
 * dibedakan dari salah tulis. 410 Gone adalah jawaban yang jujur: pernah ada,
 * sengaja dicabut, dan jangan dicoba lagi. 404 akan terbaca sebagai "id-nya
 * salah" dan 405 sebagai "method-nya salah" — dua-duanya mengirim pemanggilnya
 * mencari bug yang tidak ada. Bookmark AM dan tab yang masih terbuka juga
 * mendarat di sini, bukan di halaman blank.
 *
 * Yang TETAP hidup: `strategi_pillar` dan seluruh pembacanya, tabel
 * `pdt_usulan_katalog`, dan katalog 20 aksinya (`@cdps/core` `pilarkatalog`) —
 * editor manual justru dibangun di atasnya. Pensiun ini mencabut mesin yang
 * MENEBAK aksi dari angka baseline, bukan daftar aksinya.
 */
import { errorJson } from './http';

/**
 * Pesan BI untuk jalur AM Co-Pilot. Menyebut penggantinya, karena penolakan
 * yang tidak memberi jalan keluar hanya memindahkan kebingungan.
 */
export const MSG_COPILOT_PENSIUN =
  '[AM Co-Pilot sudah tidak dipakai, pilih pilar langsung di Section E halaman Strategi]';

/** 410 Gone untuk jalur usulan pilar AM Co-Pilot yang sudah dicabut. */
export function copilotPensiun(): Response {
  return errorJson(MSG_COPILOT_PENSIUN, 410);
}
