# HANDOFF — PDT (Pusat Data Toko) SESI 11 → SESI 12

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: … → sesi 10 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI10.md` untuk konteks G1-09
> sub-langkah 1 kalau perlu). Instruksi sesi ini: "lanjutkan build" (link ke
> `HANDOFF_PDT_SESI10.md` di GitHub) → sesi 10 §1 butir 3 (`G1-09-BODY-BESAR`)
> secara eksplisit meminta verifikasi **SEBELUM/BERSAMA** sub-langkah 2
> (commit). **Sesi ini memverifikasi risiko itu — ternyata NYATA, bukan
> teoretis — dan memperbaiki arsitekturnya SEBELUM lanjut ke commit.**
>
> **Status: G1-09-BODY-BESAR DITUTUP.** Belum ada PR/merge — perubahan sesi
> ini masih di branch kerja saat berkas ini ditulis; lihat commit log branch
> untuk status terbaru. Sub-langkah 2 (commit sungguhan) **BELUM dimulai** —
> sesi ini murni memperbaiki jalur unggah SEBELUM sub-langkah 2 dibangun di
> atasnya (kalau dibalik, sub-langkah 2 akan mewarisi bug 413 yang sama).

---

## 0. Ringkasan 60 detik

**G1-09-BODY-BESAR — TERKONFIRMASI dan DITUTUP:** riset ke dokumentasi resmi
Vercel (`functions/limitations`, error `FUNCTION_PAYLOAD_TOO_LARGE`, panduan
resmi "bypass 4.5MB body size limit") mengonfirmasi Vercel Serverless
Functions membatasi badan request/respons ke **4,5 MB KERAS** — bukan
konfigurasi yang bisa dinaikkan, dan jauh di bawah Rule 42 (paket ZIP boleh
sampai **50 MB**). Ini berarti route `POST /account/pdt/batches/preview`
sesi lalu (menerima ZIP sebagai bytes mentah di badan request) akan gagal di
gerbang **platform** (413) untuk paket ZIP produksi realistis — bug nyata
yang akan menghantam AM pertama yang mencoba paket > 4,5 MB, bukan risiko
masa depan yang bisa ditunda sampai sub-langkah commit.

**Perbaikan: pola signed-upload-langsung-ke-Storage, diterapkan ke preview
SEKALIGUS disiapkan untuk commit.** ZIP TIDAK PERNAH lagi lewat badan
request route Next.js:
1. `POST /account/pdt/batches/upload-url` (**BARU**) — gerbang izin
   (`pdt.siapkanUploadBatch`) + signed upload URL Storage
   (`buatPdtRawSignedUploadUrl`, **BARU**). Mengembalikan path **staging**
   (`_staging/{client_id}/{client_platform_id}/{uuid}.zip`), BUKAN path
   final Rule 44.
2. Browser meng-PUT ZIP **LANGSUNG** ke Storage — request itu tidak pernah
   menyentuh route CDPS.
3. `POST /account/pdt/batches/preview` (**DIRETROFIT**) — body sekarang JSON
   `{client_platform_id, storage_path}`. Route mengunduh balik dari Storage
   **SERVER-KE-SERVER** (`unduhPdtRawObjek`, **BARU**, service-role — bukan
   badan request masuk, jadi tidak tersentuh limit yang sama), lalu pipeline
   G1-04/05/09 yang sudah ada (sesi 10) berjalan **TIDAK BERUBAH**.

Objek staging yang tidak pernah dipakai (AM batal, gagal upload, preview
berulang) **SENGAJA tidak dibersihkan sinkron** oleh route mana pun — ini
persis objek "yatim" yang Rule 49 sudah antisipasi (purge otomatis > 7 hari,
nol baris `pdt_upload_batch`), jadi nol aturan retensi baru dibutuhkan.

**Sub-langkah 2 (commit) BELUM dimulai** — tapi sekarang tinggal
**memindahkan** objek staging ke path final Rule 44 (Storage `move`, kalau
API-nya memang begitu — lihat §1 butir 2), bukan mengunggah ulang dari nol.

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2: commit (Flow A langkah 6-9).**
   Sama seperti direkomendasikan sesi 10 §1 butir 1, TAPI sekarang jalur
   unggahnya sudah benar (staging Storage, bukan body route) — putuskan:
   - **Menjalankan ulang G1-04/05 pipeline dari objek staging** (route commit
     memanggil `unduhPdtRawObjek` lagi dengan `storage_path` yang sama yang
     dipakai preview) — **direkomendasikan**: konsisten filosofi route
     stateless repo ini (nol state server antara preview dan commit), biaya
     parse 2× diterima sebagai trade-off (paket ≤50 MB, bukan operasi berat).
     Alternatif "cache hasil pratinjau di server" butuh state sementara yang
     tidak ada infrastrukturnya hari ini — JANGAN dibangun tanpa keputusan
     eksplisit di `docs/DECISIONS.md` kalau nanti ternyata perlu.
   - Setelah `pdt_upload_batch` dibuat (dapat `batch_id`) dan `periode_selesai`
     diketahui (dari hasil parse ulang), **pindahkan objek dari path staging
     ke path final Rule 44** (`{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`).
     **BELUM diverifikasi**: apakah Supabase Storage REST punya endpoint
     `move`/`copy` antar-path dalam satu bucket yang bisa dipanggil dengan
     service-role key (kemungkinan besar `POST /storage/v1/object/move` —
     **cek dokumentasi Storage REST sungguhan sebelum menulis kode**, jangan
     tebak bentuk request/response-nya seperti sesi ini terpaksa menebak
     beberapa bentuk Storage lain yang belum diverifikasi — lihat §1 butir 4).
     Alternatif kalau `move` tidak ada/tidak cocok: unduh dari staging +
     unggah ke path final + hapus staging (3 panggilan, bukan 1) — lebih
     mahal tapi tidak butuh endpoint yang belum pasti ada.
   - Override AM per berkas (`moduleOptions` sudah dikirim pratinjau sejak
     sesi 10): endpoint commit menerima map override `{nama_entri: modul_kode}`,
     menjalankan ulang deteksi dengan modul yang ditimpa,
     `deteksi_oleh='override_am'` vs `'tanda_tangan'` (kolom sudah ada G1-01,
     belum pernah ditulis).
   - Menulis `pdt_upload_batch` (status awal `parsing`) + `pdt_file` per
     entri + `raw_path`/`raw_sha256`/`raw_bytes`/`raw_entri`/`retensi_sampai`
     awal (Rule 45).
   - Menjalankan identitas (`previewUploadBatch` sudah punya logikanya,
     tinggal dipanggil ulang dengan modul FINAL setelah override) dan
     menuliskan `identitas_sumber`/`client_platforms.shop_id`/`shop_username`/
     `akun_konten_toko` bila AM mengonfirmasi `usulkan_ikat`.
   - Menjalankan rekonsiliasi (`pdt.rekonsiliasiGmvPesanan`, G1-07 — BELUM
     PERNAH dipanggil sungguhan) untuk batch Shopee yang membawa
     `shopee_shop_stats` + `shopee_parent_sku` ber-status `ok`. **Putuskan
     basis eksplisit di sini**: Rule 16 — basis default laporan klien Shopee
     = **Pesanan Siap Dikirim** (dipakai untuk gerbang `verified`/`ditolak`
     Flow A langkah 7); basis **Pesanan Dibayar** (PDT-19, gerbang Product
     Exchange) adalah pemakaian TERPISAH, bukan bagian dari gerbang Flow A
     ini, dan lagipula `G1-07-PERSKU-DIBAYAR` (Open, masih terbuka) berarti
     rekonsiliasi per-SKU basis Dibayar belum bisa jalan sampai kolom
     SKU-level-nya ketemu. Rule 15: JANGAN mencampur basis dalam satu total.
   - Menulis baris fakta (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/dst.)
     — **peta kolom→tabel BELUM ada** (catatan G1-05 sendiri). PERTIMBANGKAN
     memecah lagi jadi sub-langkah 2a (batch+file+identitas+raw+move — tanpa
     baris fakta) vs sub-langkah 2b (baris fakta), sama seperti direkomendasikan
     sesi 10.
   - *Error path* (Flow A langkah 9): kegagalan di langkah manapun
     menyisakan `pdt_upload_batch.status='ditolak'` + `alasan_ditolak`, TETAP
     tersimpan (bukan rollback total) — beda dari preview yang nol tulis.
2. **Verifikasi Storage `move`/`copy` API SEBELUM menulisnya ke sub-langkah 2**
   — lihat butir 1 di atas. Kalau ada akses ke dokumentasi Storage REST
   sungguhan (atau `SUPABASE_SERVICE_ROLE_KEY` untuk `describeLive`), cek di
   sana dulu; jangan menebak bentuk request/response seperti beberapa bentuk
   Storage lain di sesi ini terpaksa ditandai belum-terverifikasi (butir 4).
3. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Sama seperti
   direkomendasikan sesi 10 — sekarang kontraknya sudah termasuk
   `PdtUploadUrl` (`web-internal/src/lib/pdt.ts`): form pilih klien→toko →
   `POST .../upload-url` → PUT ZIP ke `upload_url` yang dikembalikan →
   `POST .../preview` dengan `storage_path` yang sama → tabel hasil deteksi
   → dropdown override → submit final (endpoint commit, sub-langkah 2).
4. **Ketidakpastian BARU (dicatat di `docs/DECISIONS.md` baris teratas,
   BUKAN Open row terpisah — belum ada kode yang bergantung padanya):**
   bentuk request/response endpoint Storage upload-sign
   (`/object/upload/sign/...`) — termasuk apakah ia menerima parameter
   `expiresIn` seperti endpoint download-sign (Rule 44) — **BELUM
   diverifikasi ke Storage REST sungguhan**. `describeLive` baru di
   `pdt-storage.test.ts` (skip tanpa `SUPABASE_SERVICE_ROLE_KEY`, TIDAK
   tersedia di sandbox sesi ini, sama seperti seluruh `describeLive`
   sebelumnya) adalah tempat pertama ini akan diverifikasi begitu ada yang
   menjalankannya dengan kredensial CDPS SG sungguhan.
5. Item lama masih terbuka, masih tidak memblokir apa pun di atas:
   `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR` (lihat
   `docs/DECISIONS.md` Open — baris `G1-07-PERSKU-DIBAYAR` relevan langsung
   ke keputusan basis rekonsiliasi butir 1 di atas).
6. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` (dua suite sekarang
   — unduh G1-04 + unggah/unduh G1-09-BODY-BESAR sesi ini) masih belum
   pernah dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox manapun
   sejauh ini) — tidak memblokir apa pun hari ini, TAPI sub-langkah 2 (move
   ke path final) akan butuh Storage sungguhan teruji untuk pertama kalinya
   juga.

---

## 2. G1-09-BODY-BESAR — SELESAI, rinci

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/domain/src/pdt.ts` (+ 9 tes baru `pdt.test.ts`) | `siapkanUploadBatch` (gerbang izin + path staging) + `loadClientPlatformUntukPdt` (diekstrak dari `previewUploadBatch`, dipakai bersama — nol duplikasi query) |
| `apps/api/src/lib/pdt-storage.ts` (+ 8 tes unit + 1 `describeLive` baru) | `buatPdtRawSignedUploadUrl` (signed URL UNGGAH — pasangan `buatPdtRawSignedUrl` yang UNDUH) + `unduhPdtRawObjek` (unduh server-ke-server, service-role, nol signed URL) |
| `apps/api/src/app/api/v1/account/pdt/batches/upload-url/route.ts` (BARU, 6 tes) | `POST` — gerbang izin → signed upload URL → wire |
| `apps/api/.../pdt/batches/preview/route.ts` (DIRETROFIT, 9 tes — 2 baru) | Body JSON `{client_platform_id, storage_path}`, unduh Storage dulu, pipeline G1-04/05/09 TIDAK BERUBAH |
| `apps/api/src/lib/wire.ts` | `PdtUploadUrlWire` + `pdtUploadUrlToWire` |
| `apps/api/src/lib/shape-parity.test.ts` | `PdtUploadUrlWire` terdaftar |
| `web-internal/src/lib/pdt.ts` | `PdtUploadUrl` (FE mirror, type-only — halaman belum ada, sama seperti `PdtPreviewBatch` sesi lalu) |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + `G1-09-BODY-BESAR` (Open) ditutup |
| `docs/backlog/PDT_BACKLOG.md` | catatan status tambahan di bawah G1-09 |

### 2.2 Kontrak & keputusan penting

- **Path staging (`_staging/{client_id}/{client_platform_id}/{uuid}.zip`)
  BUKAN path final Rule 44** — `periode_selesai`/`batch_id` belum diketahui
  sebelum paket diparse (batch belum dibuat). Objek staging yang tidak
  pernah dipakai adalah objek "yatim" Rule 49 sudah antisipasi — **nol
  aturan retensi baru** dibutuhkan untuk staging, keputusan sadar (bukan
  celah yang lupa ditutup).
- **`unduhPdtRawObjek` memakai GET langsung ke objek (service-role), BUKAN
  signed URL** — beda dari `buatPdtRawSignedUrl` (untuk browser). Ini
  panggilan server-ke-server, nol kebutuhan token sementara, dan secara
  eksplisit BUKAN badan request masuk — inilah yang membuatnya tidak
  tersentuh limit 4,5 MB yang memicu seluruh perbaikan sesi ini.
- **Route test (`preview`/`upload-url`) menyuntik `globalThis.fetch`**,
  BUKAN parameter DI — kontrak Next.js `POST(request)` tetap, jadi seam
  testability-nya di `fetch` global (disimpan/dipulihkan tiap tes), pola
  yang SAMA prinsipnya dengan `fetchImpl` yang sudah ada di `pdt-storage.ts`
  (di layer fungsi, bukan layer route).
- **Ditemukan saat menulis dua route test PDT baru berjalan bersamaan:**
  keduanya memakai literal `created_by='ZZ-TEST'` (konvensi umum repo) +
  cleanup `where created_by like 'ZZ-%'` — vitest menjalankan berkas test
  PARALEL, jadi dua berkas dengan pola cleanup generik yang SAMA bisa saling
  menghapus baris satu sama lain (FK violation `client_platforms`→`clients`).
  Diperbaiki dengan mempersempit cleanup ke prefix `client_id` per-berkas
  (`CLI-PDTRT-`/`CLI-PDTUU-`) — BUKAN mengubah literal `created_by` (tetap
  konsisten konvensi repo untuk kolom itu sendiri). **Kalau menambah berkas
  test PDT baru lagi yang insert `clients`/`client_platforms`, pakai pola
  cleanup ber-prefix-`client_id` ini, bukan `created_by like 'ZZ-%'`.**
- **Diverifikasi (sandbox — `service postgresql start` + `db-rebuild.sh --yes`,
  password role `postgres` di-set eksplisit karena default sandbox menolak
  `postgres://postgres:postgres@…` — `ALTER USER postgres WITH PASSWORD
  'postgres'` lewat `su postgres -c psql`; `npm install` root + `web-internal`
  belum terpasang di awal sesi ini, dipasang sebelum test jalan):
  **`@cdps/core` 1141/1141**, **`@cdps/domain` 2528/2528 (1 skip
  `wave1_uat.e2e`, sama seperti sesi lalu)**, **`@cdps/db` 107/107**,
  **`@cdps/api` 544/544 (14 skip — termasuk 4 `describeLive` PDT baru/lama)
  kecuali SATU kegagalan `gelombang-c-showcase.e2e.test.ts` — bug pra-ada
  YANG SAMA dikonfirmasi sesi 2-10, bukan regresi sesi ini**, **`web-internal`
  763/763**. `shape-parity`/`route-parity` hijau. `npm run lint -w @cdps/api
  -- --max-warnings 0` bersih.

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Commit sungguhan** (`pdt_upload_batch`/`pdt_file`/move ke `pdt-raw` path
  final/rekonsiliasi/baris fakta) — sub-langkah 2, lihat §1 butir 1.
- **Verifikasi Storage `move`/`copy` API** — §1 butir 2, dibutuhkan sub-langkah 2.
- **Halaman upload `web-internal`** — sub-langkah 3, lihat §1 butir 3.
- **Verifikasi bentuk request/response Storage upload-sign sungguhan** — §1
  butir 4, `describeLive` menunggu kredensial CDPS SG sungguhan.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A (§4), Rule 42/44/49.
- `docs/backlog/PDT_BACKLOG.md` — G1-09 (status di bawah DoD-nya, dua catatan sesi 13).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, G1-09-BODY-BESAR ditutup) +
  Open row `G1-09-BODY-BESAR` (sekarang dicoret/ditutup) + Open lama
  (`G1-08-SEBAGIAN`/`G1-06-PERIODE-TIKTOK`/`G1-07-PERSKU-DIBAYAR`, masih terbuka).
- `packages/domain/src/pdt.ts` `siapkanUploadBatch` + `packages/domain/src/pdt.test.ts`.
- `apps/api/src/lib/pdt-storage.ts` — unduh (G1-04) + unggah/unduh (sesi ini).
- `apps/api/.../pdt/batches/upload-url/route.ts` (BARU) +
  `apps/api/.../pdt/batches/preview/route.ts` (diretrofit).
- `web-internal/src/lib/pdt.ts` — kontrak FE termasuk `PdtUploadUrl`, siap
  dipakai halaman sub-langkah 3.
- `docs/handoff/HANDOFF_PDT_SESI10.md` — riwayat G1-09 sub-langkah 1.
