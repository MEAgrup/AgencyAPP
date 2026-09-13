# HANDOFF — PDT (Pusat Data Toko) SESI 12 → SESI 13

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: … → sesi 11 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI11.md` untuk konteks
> `G1-09-BODY-BESAR` kalau perlu). Instruksi sesi ini: "lanjutkan build" (link
> ke `HANDOFF_PDT_SESI11.md` di GitHub) → sesi 11 §1 butir 1 (rekomendasi
> utama) eksplisit meminta **G1-09 sub-langkah 2: commit (Flow A langkah
> 6-9)**, dengan Storage `move`/`copy` API **diverifikasi lebih dulu**
> (§1 butir 2) sebelum ditulis.
>
> **Status: G1-09 sub-langkah 2 (lingkup 2a) SELESAI.** PR belum dibuat —
> perubahan sesi ini masih di branch kerja saat berkas ini ditulis; lihat
> commit log branch untuk status terbaru.

---

## 0. Ringkasan 60 detik

**Storage `move` DIVERIFIKASI SEBELUM ditulis** — persis yang sesi 11 minta.
Sumber `@supabase/storage-js` (`StorageFileApi.ts`, `master` GitHub, diunduh
langsung lewat `raw.githubusercontent.com` — `SUPABASE_SERVICE_ROLE_KEY` masih
TIDAK tersedia di sandbox sesi ini, jadi `describeLive` tetap jadi verifikasi
pertama terhadap Storage REST sungguhan) mengonfirmasi:
- `POST /object/move` body `{bucketId, sourceKey, destinationKey}` →
  `{message}`. Diimplementasikan sebagai `pindahkanPdtRawObjek`
  (`apps/api/src/lib/pdt-storage.ts`).
- Sekalian MENGKONFIRMASI bentuk `/object/upload/sign/...` yang
  `G1-09-BODY-BESAR` (sesi 11) sudah TEBAK benar (`POST` body `{}` →
  `{url}`) — ketidakpastian itu DITUTUP tanpa mengubah kode.

**`commitUploadBatch` (Flow A langkah 6-9) dibangun — lingkup 2a saja**
(batch+file+identitas+raw+move, TANPA baris fakta) seperti direkomendasikan
sesi 11. `POST /account/pdt/batches/commit` (BARU) merangkai: unduh Storage →
parse ZIP → `commitUploadBatch` (INSERT `pdt_upload_batch`/`pdt_file`, opsional
ikat identitas) → `pindahkanPdtRawObjek` (staging → path final Rule 44) →
`tandaiRawTersimpan`/`tandaiBatchGagalRaw` tergantung hasil pemindahan.

**DUA BUG NYATA ditemukan dan diperbaiki** — bukan ketidakpastian PRD,
kesalahan implementasi yang baru kelihatan begitu G1-04→05→06 pertama kali
dirangkai sebagai SATU pipa dengan XLSX sungguhan (`XLSX.write`/`XLSX.read`
betulan, bukan AoA siap-pakai seperti seluruh unit test sebelumnya):

1. **`ekstrakPreambleShopee` kehilangan SELURUH preamble Shopee (identitas +
   periode) pada berkas nyata.** Heuristik lama (`row.length === 1` untuk
   bentuk "satu-sel") tidak PERNAH cocok sesudah `XLSX.utils.sheet_to_json`
   memadatkan setiap baris ke lebar sheet penuh (G1-05) — baris preamble
   "satu-sel" pada XLSX sungguhan selalu berakhir sepanjang N kolom dengan
   sel ke-2..N kosong, bukan literal panjang 1. **Diperbaiki**: deteksi
   sekarang dari `isBlank(row[1])` (sel kedua kosong), bukan `row.length`.
   Ini berarti **setiap batch Shopee di sesi-sesi sebelumnya yang mengandalkan
   identitas/periode dari preamble akan gagal diam-diam di produksi** — untung
   belum ada pemanggil nyata sampai sesi ini (previewUploadBatch/commitUploadBatch
   baru lahir sesi 9 dan sesi ini).
2. **Tanda tangan `shopee_ams_afiliasi` bentrok dengan `shopee_ads_cpc`/
   `shopee_ads_live`** pada data REALISTIS (preamble `Username` Rule 2 +
   kolom `omzet penjualan`/`Omzet`) — SETIAP unggahan sah kedua modul itu akan
   `ambiguous`, bukan langka. **TIDAK diperbaiki** (butuh sample asli untuk
   tahu kolom pembeda yang benar) — Open row baru `G1-09-SIGNATURE-AMS-COLLISION`,
   prioritas TINGGI (dampak produksi, bukan sekadar gap dokumentasi).

Detail lengkap kedua bug + tiga keputusan cakupan baru (identitas
`tidak_dapat_divalidasi` lolos, rekonsiliasi GMV-only, periode-tak-teresolusi
= 400 tanpa baris) ada di `docs/DECISIONS.md` baris teratas (2026-09-13).

**Migrasi baru:** `20261014010000_g1_09_pdt_file_nullable_raw_cols.sql` —
`pdt_file.sha256`/`bytes`/`baris_header` dilonggarkan NULLable (Rule 10 butuh
baris utuh untuk entri `ditolakPagar`/`gagalEkstrak`, yang structural tidak
punya nilai itu). Nol tabel baru, nol gerbang CI bergerak (175/44/35/74
tetap, diverifikasi `db-rebuild.sh --yes` ulang).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2b: baris fakta.** `commitUploadBatch`
   sekarang punya `terparse` (berkas 'ok' + modul + AoA + barisHeader) di
   tangan sebelum menulis DB — peta `kolomDipanen`→kolom `pdt_fact_*` BELUM
   ada (catatan lama G1-05 tetap benar: butuh keputusan tipe per kolom yang
   belum pernah dibuat). Pertimbangkan memecah lagi: fakta shop-level dulu
   (`pdt_fact_shop_daily`, sumbernya `parseShopeeShopStatsPerBasis` yang
   SUDAH ada dan sudah dipanggil dari rekonsiliasi) sebelum fakta per-SKU/
   konten/kreator/ads (butuh peta kolom baru per modul).
2. **`G1-09-SIGNATURE-AMS-COLLISION` (Open, prioritas TINGGI, dampak
   produksi)** — `shopee_ams_afiliasi` vs `shopee_ads_cpc`/`shopee_ads_live`.
   Butuh sample export ASLI ketiganya berdampingan dari Hans/Anty untuk tahu
   kolom pembeda yang benar sebelum menambah `mustNot` ke `modules.ts` —
   JANGAN menebak (pola `shopee_diskon`/`shopee_flash_sale` sudah menunjukkan
   ini berakhir salah). Sampai terjawab, AM cukup override manual dari
   dropdown (satu klik ekstra) — bukan blocker, tapi janji deteksi-otomatis
   Rule 6 gugur untuk dua modul yang paling sering diunggah.
3. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Kontraknya sekarang
   LENGKAP tiga langkah: `POST .../upload-url` → PUT ZIP → `POST .../preview`
   (tabel hasil deteksi + dropdown override) → `POST .../commit` (`body`:
   `{client_platform_id, storage_path, module_overrides?,
   konfirmasi_ikat_identitas?}`, kontrak FE `PdtCommitBatch`
   `web-internal/src/lib/pdt.ts`) → tampilkan status batch (`verified`/
   `identitas_belum_terikat`/`ditolak` + `alasan_ditolak`). UI status paket
   (Rule 50 — tersedia/kedaluwarsa/legal hold) BELUM ada endpoint pembacanya
   sama sekali (butuh route baru: batch by id/list, di luar lingkup upload).
4. **Tiga keputusan cakupan baru butuh konfirmasi pemilik** (Open rows baru,
   `docs/DECISIONS.md`): `G1-09-TIDAKDAPATDIVALIDASI-LOLOS` (default operasional
   dipilih Claude, BUKAN ketokan — Nerissa/Hans boleh membalikkannya kapan
   saja, satu baris kondisi) dan `G1-09-PARENTSKU-PESANAN` (Σ pesanan per-SKU
   `shopee_parent_sku` tidak ada kolomnya sama sekali — rekonsiliasi commit
   HANYA GMV, bukan GMV+pesanan seperti Rule 13/14 minta harfiah).
5. Item lama masih terbuka, masih tidak memblokir: `G1-08-SEBAGIAN`,
   `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR` (lihat `docs/DECISIONS.md`
   Open).
6. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` (TIGA suite sekarang
   — unduh G1-04, unggah/unduh G1-09-BODY-BESAR, **pindah G1-09 sesi ini**)
   masih belum pernah dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox
   manapun sejauh ini).

---

## 2. G1-09 sub-langkah 2 (commit, lingkup 2a) — SELESAI, rinci

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/retensi.ts` (+4 tes) | `hitungRetensiSampai` — Rule 45 baris `default`/`ditolak` saat commit (perpanjangan belakangan milik G1-10) |
| `packages/core/src/pdt/identitas.ts` | **Perbaikan bug** `ekstrakPreambleShopee` (`isBlank(row[1])`, bukan `row.length===1`) + 2 tes regresi |
| `packages/core/src/pdt/modules.ts` | `PDT_PARSER_VERSI = 1` |
| `packages/domain/src/pdt.ts` (+20 tes `pdt.test.ts`) | `commitUploadBatch` + `tandaiRawTersimpan` + `tandaiBatchGagalRaw` |
| `apps/api/src/lib/pdt-storage.ts` (+3 tes unit +1 `describeLive`) | `pindahkanPdtRawObjek` (Storage `/object/move`, DIVERIFIKASI) |
| `apps/api/.../pdt/batches/commit/route.ts` (BARU, 11 tes) | `POST` — unduh → parse → commit → pindah → tandai |
| `apps/api/src/lib/wire.ts` + `shape-parity.test.ts` | `PdtCommitBatchWire` + `pdtCommitBatchToWire` |
| `web-internal/src/lib/pdt.ts` | `PdtCommitBatch` (FE mirror, type-only — halaman belum ada) |
| `supabase/migrations/20261014010000_g1_09_pdt_file_nullable_raw_cols.sql` | `pdt_file.sha256`/`bytes`/`baris_header` → NULLable |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 3 baris Open baru |
| `docs/backlog/PDT_BACKLOG.md` | catatan status G1-09 sub-langkah 2 |

### 2.2 Kontrak & keputusan penting

- **`commitUploadBatch` TIDAK menyentuh jaringan** (larangan yang sama dengan
  fs/yauzl) — route yang merangkai INSERT (dapat `batch_id`) → Storage
  `move` (butuh `batch_id` untuk path final Rule 44) → UPDATE penutup
  (`tandaiRawTersimpan`/`tandaiBatchGagalRaw`). Urutan ini yang memaksa
  `raw_path` NULL sesaat sesudah INSERT — bukan bug, dijelaskan di komentar
  kepala fungsi.
- **`tandaiBatchGagalRaw` memakai `greatest()` pada `retensi_sampai`** — Rule
  45 "tidak pernah diperpendek": batch yang tadinya `verified` (120 hari)
  yang belakangan gagal dipindah Storage TIDAK kehilangan jendela diagnosanya
  hanya karena `ditolak` biasanya berarti 30 hari.
- **Rekonsiliasi commit HANYA Shopee, HANYA bila `shopee_shop_stats` DAN
  `shopee_parent_sku` sama-sama `parse_status='ok'`, HANYA basis
  `siap_dikirim`** (Rule 16 — basis default laporan klien). GMV saja, bukan
  GMV+pesanan (`G1-09-PARENTSKU-PESANAN`, Open). `reconcile_delta_pct`
  tersimpan baik lolos maupun ditolak (Rule 14 — sinyal diagnostik, bukan
  hanya penanda kegagalan).
- **`module_overrides` (Rule 4) menimpa modul APA PUN yang AM pilih**, bukan
  cuma yang ambiguous — divalidasi milik platform batch ini (`ValidationError`
  bila tidak), lalu `deteksi_oleh='override_am'` ditulis ke `pdt_file`.
  Berkas ber-status `perlu_pilih_modul` yang TIDAK di-override menolak
  seluruh commit (400, nol baris) — AM harus menyelesaikan SEMUA ambiguitas
  sebelum commit bisa jalan.
- **Precedence status**: `ditolak` (identitas mismatch ATAU rekonsiliasi
  gagal ATAU Storage move gagal) menang atas `identitas_belum_terikat`
  (usulan belum dikonfirmasi) menang atas `verified`.
- **Ditemukan lewat dua tes route (`preview`/`commit`) berjalan bersamaan**
  (vitest paralel antar-berkas): keduanya butuh baris `employees` (FK
  `dibuat_oleh`) — pola cleanup `created_by like 'ZZ-%'` generik AMAN untuk
  `employees` (dibersihkan per employee_id spesifik di tes commit,
  `packages/domain/src/pdt.test.ts` juga menambah `delete from employees
  where created_by like 'ZZ-%'` ke urutan cleanup — SETELAH `pdt_upload_batch`
  dihapus, FK `dibuat_oleh`).
- **Diverifikasi** (sandbox — `service postgresql start` + `db-rebuild.sh
  --yes`, password `postgres` di-set eksplisit; `npm install` root sudah
  terpasang dari sesi lalu): **`@cdps/core` 1147/1147**, **`@cdps/domain`
  2548/2548 (1 skip)**, **`@cdps/db` 107/107**, **`@cdps/api` 558/558 (15
  skip) kecuali SATU kegagalan `gelombang-c-showcase.e2e.test.ts` — bug
  pra-ada dikonfirmasi sesi 2-11, bukan regresi sesi ini**, **`web-internal`
  763/763**. `shape-parity`/`route-parity` hijau. `npm run lint -w @cdps/api
  -- --max-warnings 0` bersih.

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Baris fakta** (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/dst.) — sub-langkah 2b, §1 butir 1.
- **`pdt_usulan`/`pdt_laporan_kiriman`** — milik G4/G2, bukan G1.
- **Halaman upload `web-internal`** — sub-langkah 3, §1 butir 3.
- **Perbaikan tanda tangan `shopee_ams_afiliasi`** — §1 butir 2, butuh sample asli.
- **Verifikasi Storage sungguhan (`describeLive`)** — §1 butir 6, `SUPABASE_SERVICE_ROLE_KEY` tetap tidak tersedia di sandbox manapun sejauh ini.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A (§4 langkah 6-9), Rule 4/10/11/13-16/44-45.
- `docs/backlog/PDT_BACKLOG.md` — G1-09 (status di bawah DoD-nya, catatan sesi 13 ×3).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, sub-langkah 2) + 3 Open row baru
  (`G1-09-SIGNATURE-AMS-COLLISION`/`G1-09-PARENTSKU-PESANAN`/`G1-09-TIDAKDAPATDIVALIDASI-LOLOS`).
- `packages/domain/src/pdt.ts` `commitUploadBatch`/`tandaiRawTersimpan`/`tandaiBatchGagalRaw`
  + `packages/domain/src/pdt.test.ts`.
- `apps/api/src/lib/pdt-storage.ts` `pindahkanPdtRawObjek` (bentuk diverifikasi ke
  `storage-js` `StorageFileApi.move`/`createSignedUploadUrl`).
- `apps/api/.../pdt/batches/commit/route.ts` (BARU).
- `packages/core/src/pdt/identitas.ts` `ekstrakPreambleShopee` (perbaikan bug padding).
- `web-internal/src/lib/pdt.ts` — kontrak FE termasuk `PdtCommitBatch`, siap dipakai
  halaman sub-langkah 3.
- `docs/handoff/HANDOFF_PDT_SESI11.md` — riwayat `G1-09-BODY-BESAR`.
