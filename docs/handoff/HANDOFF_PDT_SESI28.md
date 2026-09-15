# HANDOFF — PDT (Pusat Data Toko) SESI 27 → SESI 28

> **Dibuat 2026-09-15.** Instruksi Yohan sesi ini: "Merge pr" (PR #387, `G1-09-DETEKSI-PREAMBLE-AMBIGU`)
> lalu "Kemudian lanjut task berikutnya". Rantai: `HANDOFF_PDT_SESI26.md` (G1-10 pass pertama, PR #386
> merged) → `HANDOFF_PDT_SESI27.md` (G1-09 ambiguitas ditutup + temuan baru `G1-09-SHEET-BUKAN-PERTAMA`,
> PR #387) → berkas ini.

---

## 0. Apa yang terjadi sesi ini

**PR #387 di-merge** (squash `f57d592`, sebelumnya draft — ditandai ready lalu di-merge langsung atas
instruksi eksplisit "Merge pr"). Menutup `G1-09-DETEKSI-PREAMBLE-AMBIGU` secara definitif di `main`.

**`G1-10-ORPHAN-PASS` DITUTUP** — pass kedua Flow E (Rule 49, objek yatim bucket `pdt-raw` > 7 hari)
dibangun, satu-satunya item G1 murni-teknis (nol keputusan bisnis) yang masih tersisa dari
`HANDOFF_PDT_SESI27.md` §1 sesudah dua item lain (deteksi-ambigu — selesai; SKU-status-transisi,
sheet-bukan-pertama, TikTok Avitaskin — semuanya butuh keputusan/data pemilik).

- `apps/api/src/lib/pdt-storage.ts`: **`listPdtRawObjekRekursif`** (baru) — Storage REST hanya
  menyediakan listing PER-FOLDER (`POST /object/list/{bucket}` + `prefix`), tidak ada mode
  "rekursif" bawaan. Folder ditandai `id: null` di tiap entri respons (dok resmi Supabase Storage);
  fungsi menelusuri sendiri, generik terhadap KEDUA bentuk path yang hidup di bucket ini (final
  `{client_id}/{client_platform_id}/{periode}/{batch}.zip`, staging
  `_staging/{client_id}/{client_platform_id}/{uuid}.zip}`) tanpa mengasumsikan kedalaman tertentu.
  Dipaginasi per folder (limit 1000, diuji pas di batas).
- `packages/domain/src/pdt.ts`: **`planPdtOrphanPurgeTick`/`finalizePdtOrphanPurgeTick`** (baru) —
  pola SAMA pass pertama (domain memutuskan APA yang dihapus lewat perbandingan murni, nol
  panggilan Storage; menerima daftar objek storage sebagai parameter, sudah dilisting pemanggil).
  "Yatim" = path nol baris `pdt_upload_batch` SAMA SEKALI (verified/ditolak/sudah-dihapus semuanya
  "dikenal") DAN `createdAt` > 7 hari; `createdAt` tidak diketahui ⇒ TIDAK PERNAH kandidat (pagar
  konservatif, semangat sama Rule 48). **Nol pagar 5% di pass ini** — Rule 48 bicara soal batch
  ber-`retensi_sampai`, objek yatim tidak punya kolom itu (dicek ulang ke teks PRD §3 Rule 48/49,
  bukan diasumsikan).
- Route `internal/pdt/purge/tick` menjalankan pass kedua SETELAH pass pertama, TERLEPAS dari hasil
  pagar pass pertama.
- `G1-10-RETENSI-RECOMPUTE` (Open dari sesi 26) **TETAP TERBUKA** — di luar cakupan sesi ini,
  menunggu G2-01 (`pdt_laporan_kiriman`)/G5 (`px_sku_volume`, masih diblokir).

Diverifikasi (DB lokal rebuild bersih ×3, antar `@cdps/domain`/`@cdps/db`/`@cdps/api`): `@cdps/core`
**1207/1207**, `@cdps/domain` **2613/2613 (1 skip)**, `@cdps/db` **107/107**, `@cdps/api`
**589/589 (2 skip)**; typecheck 4 paket + lint `@cdps/api --max-warnings 0` bersih. Nol migrasi
baru (murni kode + tes).

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **`G1-11` (reparse dari ZIP, Flow D)** — SEKARANG satu-satunya pekerjaan G1 murni-teknis yang
   belum disentuh sama sekali. Spec lengkap `docs/backlog/PDT_BACKLOG.md` §G1-11 (DoD: reparse
   mengubah angka pada fixture yang sengaja diparse dengan parser lama; batch ber-paket-terpurge
   muncul di daftar laporan, bukan hilang). Kandidat kuat sesi berikutnya.
2. **`G1-09-SHEET-BUKAN-PERTAMA`** (severity tinggi) — masih menunggu keputusan arsitektur pemilik
   (3 opsi, `docs/DECISIONS.md`). Mempengaruhi `shopee_live`/`shopee_shop_stats` produksi.
3. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — masih menunggu keputusan pemilik (`HANDOFF_PDT_SESI26.md`
   §1a, 3 opsi + rekomendasi, belum berubah).
4. **TikTok Avitaskin** — kalau pemilik unggah ulang ZIP "Sample nama asli" yang sama (scratchpad
   sesi lalu tidak ikut ke chat baru), tiga Open bisa digarap: `G1-06-PERIODE-TIKTOK`,
   `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
5. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi PERTAMA sebelum
   disambungkan (lihat catatan cakupan `planPdtPurgeTick` di `pdt.ts`).

## 2. Setup teknis

Sama seperti sesi-sesi lalu — start cluster Postgres (`pg_ctlcluster 16 main start` bila psql
menolak koneksi), `db-rebuild.sh --yes`, `npm install` terpisah tiap paket (root/`apps/api`/
`web-internal`).

## 3. Rujukan

- `docs/DECISIONS.md` — cari `2026-09-15`/`sesi 28` untuk baris Decided (`G1-10-ORPHAN-PASS`
  ditutup) dan baris Open `~~G1-10-ORPHAN-PASS~~` yang dicoret.
- `docs/backlog/PDT_BACKLOG.md` §G1-10 — status "sesi 28" baru di akhir blok.
- `apps/api/src/lib/pdt-storage.ts` (`listPdtRawObjekRekursif`), `packages/domain/src/pdt.ts`
  (`planPdtOrphanPurgeTick`/`finalizePdtOrphanPurgeTick`, komentar cakupan G1-10 di kepala seksi).
- `apps/api/src/app/api/v1/internal/pdt/purge/tick/route.ts` — urutan dua pass, docblock diperbarui.
