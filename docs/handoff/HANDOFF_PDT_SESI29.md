# HANDOFF — PDT (Pusat Data Toko) SESI 28 → SESI 29

> **Dibuat 2026-09-15.** Instruksi Yohan sesi ini: "lanjutkan" (setelah PR #388 —
> `G1-10-ORPHAN-PASS` — dikonfirmasi hijau dan menunggu review). Rantai:
> `HANDOFF_PDT_SESI27.md` (G1-09 ambiguitas ditutup, PR #387) → `HANDOFF_PDT_SESI28.md`
> (G1-10 pass kedua, PR #388) → berkas ini.

---

## 0. Apa yang terjadi sesi ini

**PR #388 di-merge** (squash, sebelumnya draft — ditandai ready lalu di-merge atas instruksi
eksplisit "Merge pr"). Menutup `G1-10-ORPHAN-PASS` secara definitif di `main`.

**`G1-11` (reparse dari paket ZIP, Flow D) DITUTUP** — SEKARANG satu-satunya item G1 murni-teknis
(nol keputusan bisnis) sejak awal `PDT_BACKLOG.md`, dan sekarang benar-benar item G1 murni-teknis
TERAKHIR sesudah G1-09/G1-10 selesai sesi-sesi lalu.

**Cakupan SENGAJA dipersempit ke bacaan literal Flow D** — PRD hanya menyebut TIGA hal ("memparse
ulang", "menaikkan `parser_versi` baris fakta", "mencatat `audit_logs`"), nol penyebutan status
batch/identitas/periode/`reconcile_delta_pct`. `reparsePdtBatch` (baru,
`packages/domain/src/pdt.ts`) karena itu HANYA menulis ulang baris fakta untuk batch yang SUDAH
ADA (memakai `id`-nya apa adanya, TIDAK PERNAH membuat baris `pdt_upload_batch` baru), TIDAK
menyentuh status/identitas/periode/reconcile/`pdt_file`. Ini selaras pesan error
`commitUploadBatch` sendiri yang MENGARAHKAN AM ke reparse justru untuk MENGHINDARI konflik
`uq_pdt_upload_batch_verified` — mempertahankan status apa adanya adalah prasyarat supaya saran
itu tidak membentur constraint yang sama terhadap dirinya sendiri. Dicatat sebagai Open baru
(`G1-11-REPARSE-RECOMPUTE-STATUS`) untuk kasus jarang: bug parser yang juga mengubah HASIL
rekonsiliasi (bukan hanya angka) — belum terjadi di histori manapun, jadi tidak diblokir.

**Refactor pendamping:** SEMBILAN blok penulis baris fakta (G1-09 sub-langkah 2b-ii — ads_live,
ads_cpc, ads_search, tt_video, shopee_live, sku_master ×2 modul, tt_transaction_creator,
shopee_ams_afiliasi, shopee_ams_produk) diekstrak dari `commitUploadBatch` ke fungsi privat baru
`tulisFaktaModulTerparse`, dipakai ULANG `reparsePdtBatch` — nol duplikasi SQL untuk logika yang
harus tetap identik antara commit-baru dan reparse. Diverifikasi nol regresi: 109 test
`pdt.test.ts` yang ADA SEBELUM sesi ini tetap hijau persis sebelum 5 `describeDb` baru G1-11
ditambahkan.

**AM override dipertahankan otomatis** — `reparsePdtBatch` membaca `pdt_file.deteksi_oleh =
'override_am'` dari commit ASLI (bukan parameter terpisah), sementara berkas lain di-deteksi ULANG
dengan `tandaTanganKolom` TERKINI — bug deteksi yang sudah diperbaiki (mis. PR #387, ambiguitas
`shopee_ams_afiliasi`) ikut membetulkan batch LAMA, bukan cuma batch baru sejak perbaikan.

**Trigger: tick harian** (`internal/pdt/reparse/tick`, cron `0 18 * * *` — 15 menit setelah purge)
— dipilih karena Flow D terstruktur SEJAJAR Flow E ("Purge harian (otomatis)") di PRD §4; PRD
tidak menyebut mekanisme trigger selain "job reparse". `planPdtReparseTick` memilih
`parser_versi < PDT_PARSER_VERSI` + `raw_path` ada — nol biaya pada hari biasa (predikat kosong
sampai `PDT_PARSER_VERSI` dinaikkan), otomatis memproses backlog begitu ia naik. Batch berpaket
purged dilaporkan di respons JSON tick (`perlu_upload_ulang`) — status ini derived sejak migrasi
G1-01 ("dihitung job G1-10/pembaca G1-11"), nol kolom/migrasi baru dibutuhkan.

Diverifikasi (DB lokal rebuild bersih ×2, antar `@cdps/domain`/`@cdps/db`/`@cdps/api`): `@cdps/core`
**1207/1207**, `@cdps/domain` **2618/2618 (1 skip)**, `@cdps/db` **107/107**, `@cdps/api`
**594/594 (2 skip)**; typecheck 4 paket + lint `@cdps/api --max-warnings 0` bersih. Nol migrasi
baru (murni kode + tes).

## 1. Kesimpulan penting: G1 (fondasi PDT) SEKARANG selesai untuk seluruh item murni-teknis

Sisa item G1 SEMUANYA menunggu keputusan/data pemilik, bukan pekerjaan Claude lagi tanpa itu:

1. **`G1-09-SHEET-BUKAN-PERTAMA`** (severity tinggi) — butuh keputusan arsitektur pemilik (3 opsi,
   `docs/DECISIONS.md`). Mempengaruhi `shopee_live`/`shopee_shop_stats` produksi.
2. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — butuh keputusan pemilik (3 opsi + rekomendasi,
   `HANDOFF_PDT_SESI26.md` §1a).
3. **TikTok Avitaskin** — butuh ZIP diunggah ulang (scratchpad sesi lalu tidak ikut ke chat baru).
   Membuka `G1-06-PERIODE-TIKTOK`, `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
4. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi pertama.
5. **`G1-11-REPARSE-RECOMPUTE-STATUS`** (baru sesi ini) — pertanyaan desain jarang-terjadi, tidak
   memblokir apa pun hari ini.

Sesi berikutnya yang tidak punya jawaban #1/#2/#3 dari pemilik akan mendapati G1 nol pekerjaan baru
murni-teknis untuk digarap — langkah wajar berikutnya adalah mulai G2 (Laporan sebagai view,
`docs/backlog/PDT_BACKLOG.md` §2), TAPI `docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler"
mensyaratkan G1 exit criteria (≥10 klien nyata verified, campuran TikTok & Shopee) sebelum G2 boleh
mulai menggantikan Report Engine lama — exit criteria itu sendiri butuh KLIEN NYATA yang belum ada
di sistem, bukan sesuatu yang Claude bisa penuhi lewat kode.

## 2. Setup teknis

Sama seperti sesi-sesi lalu — start cluster Postgres (`pg_ctlcluster 16 main start` bila psql
menolak koneksi), `db-rebuild.sh --yes`, `npm install` terpisah tiap paket (root/`apps/api`/
`web-internal`).

## 3. Rujukan

- `docs/DECISIONS.md` — cari `2026-09-15`/`sesi 29` untuk baris Decided (G1-11 ditutup) dan Open
  baru `G1-11-REPARSE-RECOMPUTE-STATUS`.
- `docs/backlog/PDT_BACKLOG.md` §G1-11 — status "sesi 29" baru di akhir blok.
- `packages/domain/src/pdt.ts` — komentar kepala seksi G1-11 (cakupan literal Flow D),
  `tulisFaktaModulTerparse` (fungsi diekstrak, dipakai `commitUploadBatch` DAN `reparsePdtBatch`),
  `reparsePdtBatch`/`planPdtReparseTick`.
- `apps/api/src/app/api/v1/internal/pdt/reparse/tick/route.ts` (baru) — pipeline unduh-ekstrak-
  deteksi-reparse, urutan kerja lengkap di docblock kepala berkas.
