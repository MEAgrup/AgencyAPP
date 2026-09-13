# HANDOFF — PDT (Pusat Data Toko) SESI 10 → SESI 11

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: … → sesi 9 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI9.md` untuk konteks G1-08 kalau
> perlu). Instruksi sesi ini: "lanjutkan build" (link ke `HANDOFF_PDT_SESI9.md`
> di GitHub) → sesi 9 §3 merekomendasikan mulai **G1-09**, tiket besar, dan
> secara eksplisit menyarankan memecahnya jadi sub-langkah. **Sub-langkah
> 1 dari ~3 SELESAI sesi ini.**

---

## 0. Ringkasan 60 detik

**G1-09 sub-langkah 1 — pratinjau deteksi batch, SELESAI:**
`POST /api/v1/account/pdt/batches/preview` menerima satu ZIP + `client_platform_id`,
menjalankan G1-04 (`bacaDanEkstrakPdtZip`) → G1-05 (`parsePdtZipEntries`) → G1-09
(`pdt.previewUploadBatch`, domain BARU) dan mengembalikan tabel hasil deteksi
(modul/baris header/kolom dipanen/kolom baru/status per berkas) + identitas
(Rule 2-4) + periode (Rule 5) — **nol tulis DB, nol upload storage**. Ini
pemanggil NYATA PERTAMA yang menyambungkan G1-02..08 (sampai sesi lalu hanya
dipanggil dari tes) ke baris `client_platforms`/`clients` sungguhan.

**BELUM dibangun (sengaja, sub-langkah 2/3):** dropdown override AM per
berkas ditegakkan, penulisan `pdt_upload_batch`/`pdt_file`, upload paket ke
bucket `pdt-raw`, rekonsiliasi (Rule 13-16), UI halaman upload di
`web-internal` (kontrak wire + FE type SUDAH ada, halaman/tombolnya belum).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2: commit (Flow A langkah 6-9).**
   Setelah AM meninjau tabel pratinjau (sub-langkah 1) dan (opsional)
   menimpa modul beberapa berkas dari dropdown (`moduleOptions` sudah
   dikirim pratinjau), AM menekan submit final. Endpoint BARU (mis.
   `POST /account/pdt/batches`, bukan `/preview`) yang:
   - Menerima ZIP yang SAMA + `client_platform_id` + (opsional) map
     override `{nama_entri: modul_kode}` per berkas yang AM timpa.
   - Menjalankan ulang pipeline G1-04/05 (atau menerima hasil pratinjau
     yang sudah dihitung sebelumnya — **putuskan salah satu**, jangan
     menebak: menjalankan ulang lebih aman/simple tapi 2x biaya parse;
     menerima cache pratinjau butuh state sementara di server/klien yang
     tidak ada hari ini).
   - Menulis `pdt_upload_batch` (status awal `parsing`) + `pdt_file` per
     entri (memakai override bila ada, `deteksi_oleh='override_am'` vs
     `'tanda_tangan'` — kolom ini SUDAH ada di skema G1-01, belum pernah
     ditulis).
   - Mengunggah paket ZIP mentah ke bucket `pdt-raw` (`raw_path`/`raw_sha256`/
     `raw_bytes`/`raw_entri`, `retensi_sampai` awal Rule 45) — **belum ada
     fungsi upload di `apps/api/src/lib/pdt-storage.ts` hari ini**, hanya
     `buatPdtRawSignedUrl` untuk DOWNLOAD (G1-04). Perlu fungsi baru untuk
     UPLOAD (baik lewat service-role langsung, atau signed-upload-URL
     browser→Storage — lihat `G1-09-BODY-BESAR` di bawah, keputusan ini
     terkait).
   - Menjalankan identitas (SUDAH ada di `pdt.previewUploadBatch`, tinggal
     dipanggil ulang dengan modul FINAL setelah override) dan menuliskan
     `identitas_sumber`/status `identitas_belum_terikat` bila perlu, atau
     `client_platforms.shop_id`/`shop_username`/`akun_konten_toko` bila AM
     mengonfirmasi usulan `usulkan_ikat`.
   - Menjalankan rekonsiliasi (`pdt.rekonsiliasiGmvPesanan`, G1-07 — BELUM
     PERNAH dipanggil sungguhan) untuk batch Shopee yang membawa
     `shopee_shop_stats` + `shopee_parent_sku` ber-status `ok` — basis
     mana yang dibandingkan (Dibuat/Siap Kirim — `dibayar` masih
     `G1-07-PERSKU-DIBAYAR`, Open) perlu diputuskan eksplisit di sini,
     BUKAN dihitung untuk ketiganya sekaligus (Rule 15: jangan campur
     basis).
   - Menulis baris fakta (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/dst.)
     dari kolom yang berhasil dipanen — **peta kolom→tabel BELUM ada**
     (catatan G1-05 sendiri: "belum memetakan kolomDipanen ke baris tabel
     fakta bertipe" — ini pekerjaan besar tersendiri, PERTIMBANGKAN
     memecahnya lagi jadi sub-langkah 2a *tulis batch+file+identitas+raw*
     vs sub-langkah 2b *tulis baris fakta*).
   - *Error path* (Flow A langkah 9): kegagalan di langkah manapun
     menyisakan `pdt_upload_batch.status='ditolak'` + `alasan_ditolak`,
     TETAP tersimpan (bukan rollback total) — beda dari pratinjau
     (sub-langkah 1) yang nol tulis sama sekali.
2. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Kontrak data
   (`web-internal/src/lib/pdt.ts`) sudah ada tapi **belum ada halaman/komponen
   yang memanggilnya** — `route-parity.test.ts` TIDAK menuntutnya (test itu
   hanya menuntut arah FE→route, bukan sebaliknya), tapi PRD Flow A tidak
   selesai tanpa AM bisa mengklik apa pun. Perlu: form pilih klien→toko→
   upload ZIP, tabel hasil deteksi (dari `/preview`), dropdown override
   per baris (`module_options`), tombol submit final (ke endpoint commit,
   sub-langkah 2).
3. **`G1-09-BODY-BESAR` (baru, `docs/DECISIONS.md` Open)** — route
   `/preview` menerima ZIP sebagai bytes mentah di badan request
   (`request.arrayBuffer()`). **BELUM diverifikasi** apakah Vercel
   Serverless Functions (deploy `apps/api`) mengizinkan badan sebesar
   batas Rule 42 (≤50 MB) — banyak platform serverless membatasi jauh di
   bawah itu. Kalau iya kena batas, AM dengan paket besar gagal di gerbang
   PLATFORM (mis. 413), bukan gagal dengan pesan BI yang jelas dari route
   ini. **Verifikasi ini SEBELUM/BERSAMA sub-langkah 2** — kalau body besar
   memang terblokir, sub-langkah 2 (upload ke `pdt-raw`) kemungkinan perlu
   pola signed-upload-langsung-ke-Storage (browser→Supabase Storage
   langsung, endpoint hanya menerima path+metadata sesudahnya) alih-alih
   lewat body route Next.js sama sekali — keputusan arsitektur, jangan
   ditebak, lihat baris Open untuk kerangkanya.
4. Item lama masih terbuka, masih tidak memblokir apa pun di atas:
   `G1-08-SEBAGIAN` (pemicu `parse_status='sebagian'` belum ada — G1-09
   sub-langkah 1 MEWARISI keputusan ini: `kolomDipanen` dipakai langsung
   sebagai daftar kolom wajib, lihat `docs/DECISIONS.md` baris G1-09 sesi
   ini), `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
5. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` masih belum
   pernah dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox manapun
   sejauh ini) — tidak memblokir sub-langkah 1 (yang dibangun sesi ini
   nol menyentuh Storage sama sekali), TAPI sub-langkah 2 (upload ke
   `pdt-raw`) akan butuh ini teruji sungguhan untuk pertama kalinya.

---

## 2. G1-09 sub-langkah 1 — SELESAI, rinci

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/header.ts` (+ `.test.ts`, 12 tes) | `temukanBarisHeader` (Rule 7 — baris header DICARI dari `barisHeaderHint` + nama kolom dikenal, bukan diasumsikan; PERTAMA KALI fungsi ini ada di repo — G1-06 sampai G1-08 semua menerima `barisHeader` sebagai parameter siap pakai), `hitungKolomDipanenBaru` (Rule 8) |
| `packages/core/src/pdt/zip-pagar.ts` (+ 4 tes baru) | `formatAlasanTolakEntri`/`formatAlasanTolakPaket` — pesan BI `[...]` Rule 41/42 |
| `packages/core/src/pdt/index.ts` | + `export * from './header'` |
| `packages/domain/src/pdt.ts` (+ 20 tes baru, `describeDb`) | `previewUploadBatch` + tipe-tipe pratinjau (`PdtPreviewBerkasInput/Hasil`, `PdtPreviewIdentitas`, `PdtPreviewBatchHasil`), `platformKeVokabPdt` (PDT-22), error classes `ValidationError`/`ForbiddenError`/`NotFoundError` |
| `packages/domain/src/index.ts` | `pdt` **AKHIRNYA** di-export (`export * as pdt from './pdt'`) — sampai kemarin nol baris ini, walau `pdt.ts` sudah ada sejak G1-01 |
| `apps/api/src/lib/pdt-preview.ts` (+ 7 tes, sintetik + end-to-end ZIP sungguhan) | `bangunPreviewBerkasInputs` — perekat G1-04/05 → domain |
| `apps/api/src/app/api/v1/account/pdt/batches/preview/route.ts` (+ 7 tes) | route handler |
| `apps/api/src/lib/wire.ts` | `pdtPreviewBatchToWire` + 5 interface `Pdt*Wire` |
| `apps/api/src/lib/http.ts` | `PdtValidationError`/`PdtForbiddenError`/`PdtNotFoundError` → 400/403/404 |
| `apps/api/src/lib/shape-parity.test.ts` | `pdt.ts` masuk `FE_FILES` + 5 baris `WIRE_TO_FE` |
| `web-internal/src/lib/pdt.ts` (BARU) | FE mirror 5 interface — **type-only, belum ada halaman yang mengimpornya** |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 1 baris Open (`G1-09-BODY-BESAR`) |
| `docs/backlog/PDT_BACKLOG.md` | catatan status di bawah DoD G1-09 |

### 2.2 Kontrak & keputusan penting

- **Status pratinjau PUNYA DUA NILAI di luar `pdt_file.parse_status` DB**
  (`ok`/`sebagian`/`gagal`): `ditolak_pagar` (entri ditolak Rule 41 SEBELUM
  ekstraksi) dan `perlu_pilih_modul` (ambigu/nol modul cocok). Keduanya
  BELUM berhak jadi baris DB — belum ada `pdt_upload_batch` untuk
  ditulisi sampai sub-langkah 2 ada. Tipe TS (`PdtPreviewBerkasStatus`)
  sengaja TERPISAH dari `pdt.PdtParseStatus` (G1-08) supaya perbedaan ini
  terlihat di compiler, bukan disembunyikan di balik nama yang sama.
- **`kolomDipanen` dipakai LANGSUNG sebagai daftar "kolom wajib"** untuk
  `validasiKolomWajib`/`turunkanParseStatus` (Rule 9-10) per berkas.
  `G1-08-SEBAGIAN` (Open, sesi lalu) sudah mencatat `PdtModuleDef` belum
  punya pembeda bucket wajib/opsional per kolom — ini SATU-SATUNYA daftar
  yang ada hari ini, dipakai apa adanya, DICATAT sebagai keputusan (bukan
  ditebak diam-diam). Efeknya: berkas yang hilang SATU SAJA dari
  `kolomDipanen` modulnya (mis. hanya 3 dari 10 kolom `shopee_parent_sku`)
  berstatus `gagal`, bukan `ok`/`sebagian` — tidak ada jalan tengah sampai
  bucket itu lahir.
- **`MODUL_PREAMBLE_SHOPEE` = `['shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live']`
  DIHARDCODE**, bukan diturunkan otomatis dari `PdtModuleDef` — diverifikasi
  ke Rule 2 PRD ("ketiga export iklan Shopee membawa preamble") + fakta
  ketiganya SATU-SATUNYA modul Shopee ber-`barisHeaderHint` 7/8 (menyisakan
  baris 1-6 untuk preamble, `modules.ts`). Identitas TikTok SEBALIKNYA
  dicari secara GENERIK — modul mana pun (di `PDT_MODULES`) yang
  `kolomDipanen`-nya memuat `'ID Kreator'` jadi kandidat, bukan dua kode
  modul hardcode — supaya modul TikTok baru kelak otomatis ikut jadi
  kandidat tanpa menyentuh fungsi ini lagi.
- **Route menerima ZIP sebagai bytes MENTAH** (`Content-Type: application/zip`,
  `request.arrayBuffer()`), BUKAN multipart/form-data atau base64 JSON —
  konsisten pola framework-free `pdt-zip.ts`/`pdt-parse.ts`, nol dependensi
  parser multipart baru. `client_platform_id` di QUERY STRING (bukan body,
  karena body sepenuhnya dipakai bytes ZIP). Lihat `G1-09-BODY-BESAR` (Open)
  untuk risiko batas badan request platform deploy — BELUM diverifikasi.
- **`web-internal/src/lib/pdt.ts` dibuat type-only, TANPA halaman yang
  memanggilnya** — ini SENGAJA, bukan lupa: `shape-parity.test.ts` menuntut
  SETIAP interface `wire.ts` punya pasangan FE terdaftar TANPA pengecualian
  "belum ada UI" (beda dari `route-parity.test.ts`'s `KNOWN_GAPS`, yang
  memang punya mekanisme "belum" — `shape-parity` tidak). Jadi kontrak
  datanya HARUS ditulis lebih dulu di sesi yang membangun route-nya, genap
  seukuran yang route benar-benar kirim (bukan ditebak untuk halaman yang
  belum dirancang) — sub-langkah 3 (halaman) tinggal mengimpornya.
- **`packages/domain/src/index.ts` tidak pernah mengekspor `pdt`
  sebelum sesi ini** — ditemukan saat mau memanggil `pdt.previewUploadBatch`
  dari route dan `@cdps/domain` tidak punya namespace `pdt` sama sekali,
  walau `packages/domain/src/pdt.ts` (predikat izin) sudah ada sejak G1-01.
  Bukan bug tersembunyi — G1-01..08 memang belum punya pemanggil nyata
  yang butuh mengimpornya lintas paket.
- **Diverifikasi (sandbox — `service postgresql start` + `db-rebuild.sh --yes`,
  pola `HANDOFF_PDT_SESI9.md` §1 butir 2b):**
  `npm run typecheck` bersih di `@cdps/core`/`@cdps/domain`/`@cdps/db`/
  `@cdps/api`/`web-internal` (enam workspace, termasuk yang di luar root
  npm workspace). `npm run lint -w @cdps/api -- --max-warnings 0` bersih.
  Dengan `DATABASE_URL` terpasang: **`@cdps/core` 1139/1139**,
  **`@cdps/domain` 2522/2522 (1 skip `wave1_uat.e2e`, sama seperti sesi
  lalu)**, **`@cdps/db` 107/107**, **`@cdps/api` 530/530 kecuali SATU
  kegagalan `gelombang-c-showcase.e2e.test.ts` — bug pra-ada YANG SAMA
  dikonfirmasi sesi 8/9, bukan regresi dari sesi ini**, **`web-internal`
  763/763**. `shape-parity`/`route-parity` keduanya hijau.

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Commit sungguhan** (`pdt_upload_batch`/`pdt_file`/upload `pdt-raw`/
  rekonsiliasi/baris fakta) — sub-langkah 2, lihat §1 butir 1.
- **Halaman upload `web-internal`** — sub-langkah 3, lihat §1 butir 2.
- **Verifikasi batas badan request platform deploy** — `G1-09-BODY-BESAR`.
- **Dropdown override AM ditegakkan** — `moduleOptions` sudah DIKIRIM
  pratinjau (bahan dropdown), tapi belum ada endpoint yang MENERIMA
  override AM dan menjalankan ulang deteksi dengan modul yang ditimpa.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A (§4), Rule 2-10/13-16/38-45.
- `docs/backlog/PDT_BACKLOG.md` — G1-09 (status sub-langkah di bawah DoD-nya).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-09 sub-langkah 1)
  + Open row `G1-09-BODY-BESAR` (dan `G1-08-SEBAGIAN`/`G1-06-PERIODE-TIKTOK`/
  `G1-07-PERSKU-DIBAYAR` dari sesi-sesi sebelumnya, masih terbuka).
- `packages/domain/src/pdt.ts` `previewUploadBatch` + `packages/domain/src/pdt.test.ts`.
- `apps/api/.../pdt/batches/preview/route.ts` + `apps/api/src/lib/pdt-preview.ts`.
- `web-internal/src/lib/pdt.ts` — kontrak FE, siap dipakai halaman sub-langkah 3.
- `apps/api/src/lib/pdt-storage.ts` — signed URL DOWNLOAD (G1-04) sudah ada;
  UPLOAD (dibutuhkan sub-langkah 2) belum.
- `docs/handoff/HANDOFF_PDT_SESI9.md` — riwayat G1-08 + PR #362 (sudah merge).
