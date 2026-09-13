# HANDOFF — PDT (Pusat Data Toko) SESI 12 → SESI 13

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: … → sesi 11 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI11.md` untuk konteks
> `G1-09-BODY-BESAR` kalau perlu). Instruksi sesi ini: "lanjutkan build" (link
> ke `HANDOFF_PDT_SESI11.md` di GitHub) → sesi 11 §1 butir 1 (rekomendasi
> utama) eksplisit meminta **G1-09 sub-langkah 2: commit (Flow A langkah
> 6-9)**, dengan Storage `move`/`copy` API **diverifikasi lebih dulu**
> (§1 butir 2) sebelum ditulis.
>
> **Status: G1-09 sub-langkah 2 (lingkup 2a) SELESAI, PR dibuat:**
> `https://github.com/MEAgrup/AgencyAPP/pull/367` (`claude/zen-curie-yg8v8m` →
> `main`) — cek status merge/CI sebelum lanjut. **Baca §1 di bawah LEBIH DULU**
> — tiga pertanyaan untuk pemilik/Nerissa, masing-masing dengan contoh kasus
> konkret + rekomendasi, supaya begitu dijawab sesi ini bisa langsung eksekusi
> tanpa riset ulang.

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

Detail lengkap kedua bug ada di `docs/DECISIONS.md` baris teratas (2026-09-13).
**Tiga keputusan cakupan baru (identitas `tidak_dapat_divalidasi` lolos,
rekonsiliasi GMV-only, tanda tangan AMS bentrok) punya pertanyaan+contoh
kasus+rekomendasi lengkap di §1 di bawah — baca itu, bukan cuma ringkasan
`DECISIONS.md`, sebelum memutuskan apa pun.**

**Migrasi baru:** `20261014010000_g1_09_pdt_file_nullable_raw_cols.sql` —
`pdt_file.sha256`/`bytes`/`baris_header` dilonggarkan NULLable (Rule 10 butuh
baris utuh untuk entri `ditolakPagar`/`gagalEkstrak`, yang structural tidak
punya nilai itu). Nol tabel baru, nol gerbang CI bergerak (175/44/35/74
tetap, diverifikasi `db-rebuild.sh --yes` ulang).

---

## 1. Pertanyaan untuk pemilik/Nerissa — jawab dulu, supaya sesi berikutnya bisa langsung eksekusi

Tiga keputusan cakupan BARU sesi ini (bukan ketokan pemilik — default operasional
Claude, `docs/DECISIONS.md` Open rows). Tiap satu di bawah: konteks singkat,
**contoh kasus konkret** (angka/skenario nyata, bukan abstrak), pilihan, dan
rekomendasi Claude + alasan — supaya begitu dijawab, sesi berikutnya tinggal
eksekusi satu baris kode, bukan mulai riset dari nol lagi.

### 1a. `G1-09-TIDAKDAPATDIVALIDASI-LOLOS` — batch tanpa bukti identitas dari file, lolos atau ditolak?

**Konteks.** Rule 2/3 PRD: "identitas toko divalidasi DARI BERKAS, bukan dari
pilihan AM". Tapi tidak semua berkas Shopee membawa sinyal itu (hanya 3 modul
iklan Shopee yang bawa preamble `Username`/`ID Toko`). Kalau AM upload batch
yang SAMA SEKALI tidak mengandung salah satu dari ketiga modul itu, sistem
tidak punya apa pun untuk dicocokkan.

**Contoh kasus konkret.** Toko Fashion Bandung (shop_id `938284780`, SUDAH
terikat dari bulan lalu). Bulan ini AM Rizki cuma upload 2 file: `bisnis
saya.xlsx` (`shopee_shop_stats`) + `parentskudetail.xlsx` (`shopee_parent_sku`)
— karena bulan ini toko lagi nggak jalanin iklan berbayar sama sekali, jadi
nggak ada file iklan buat diunggah. Kedua file itu TIDAK bawa preamble
`Username`/`ID Toko` apa pun. Hari ini (perilaku sesi ini): batch tetap lolos
ke rekonsiliasi → `verified` kalau GMV cocok. **Kalau dibalik ke `ditolak`**:
Rizki nggak bisa commit laporan bulan ini sama sekali, padahal dia AM yang sah
buat toko ini dan datanya sendiri nggak ada yang salah — cuma kebetulan nggak
ada file pembawa sinyal identitas bulan ini.

**Pilihan:**
- **(A, sudah diimplementasikan) Lolos** — `canUploadBatch` sudah menggerbang
  bahwa Rizki memang AM pemilik toko ini SEBELUM baris identitas ini pernah
  dievaluasi. `tidak_dapat_divalidasi` = "nggak ada bukti TAMBAHAN", bukan
  "ada bukti salah".
- **(B) Ditolak** — patuh harfiah ke Rule 2/3, AM harus selalu menyertakan
  minimal satu file iklan (atau upload manual override) supaya identitas bisa
  dicek ulang tiap batch.
- **(C) Lolos, tapi HANYA kalau `shop_id` SUDAH terikat sebelumnya** (first-time
  upload — `shop_id` masih kosong — tetap ditolak/`identitas_belum_terikat`
  sampai ada bukti pertama). Ini beda dari (A): (A) tidak membedakan
  toko-baru vs toko-lama sama sekali.

**Rekomendasi Claude: (A), pertahankan seperti sekarang.** Alasan: (A) sudah
jalan, dan (C) menambah kompleksitas untuk kasus yang jarang (upload pertama
kali tanpa file identitas HAMPIR TIDAK PERNAH terjadi — batch pertama sebuah
toko baru biasanya AM sengaja unggah lengkap justru untuk memicu pengikatan
`shop_id`). (B) akan mem-blok operasional rutin tanpa manfaat keamanan nyata.

**Kalau pemilik jawab (A) [default]:** tidak perlu kode apa pun, tutup Open row ini.
**Kalau (B) atau (C):** ubah satu kondisi di `commitUploadBatch`
(`packages/domain/src/pdt.ts`, cari komentar "ketidakpastian #1") — untuk (C)
tambahkan cek `row.shop_id != null` sebelum membiarkan `tidak_dapat_divalidasi` lolos.

### 1b. `G1-09-PARENTSKU-PESANAN` — rekonsiliasi commit cuma GMV, bukan GMV+pesanan

**Konteks.** Rule 13/14 PRD minta gerbang rekonsiliasi membandingkan DUA
metrik: Σ GMV per-SKU vs shop-level, DAN Σ pesanan per-SKU vs shop-level.
Modul `shopee_parent_sku` (`packages/core/src/pdt/modules.ts`) whitelist-nya
cuma punya GMV (`Total Penjualan (Pesanan Dibuat) (IDR)`/`Penjualan (Pesanan
Siap Dikirim) (IDR)`) — NOL kolom jumlah-pesanan per-SKU.

**Contoh kasus konkret (angka Fim Motor UAT, sudah tervalidasi pemilik).**
Basis Siap Dikirim: shop-level GMV Rp1.515.002.476 / 12.801 pesanan.
Rekonsiliasi commit HARI INI hanya mengecek: Σ GMV per-SKU `shopee_parent_sku`
vs Rp1.515.002.476 (≤0,5% → `verified`). Kalau SUATU HARI ada kasus di mana
GMV per-SKU cocok (misalnya karena kebetulan/manipulasi rounding), TAPI jumlah
pesanan per-SKU sebenarnya beda jauh dari 12.801 (misal toko lain nyelip 500
pesanan tanpa GMV besar, mis. produk sample gratis) — gerbang GMV-only TIDAK
akan menangkapnya, karena tidak pernah menghitung sisi pesanan sama sekali.

**Pilihan:**
- **(A, sudah diimplementasikan) GMV-only, permanen** sampai ada bukti nyata
  butuh sisi pesanan.
- **(B) Minta Hans/Anty cari sample `parentskudetail.xlsx` ASLI** (40 kolom,
  `PDT_KOLOM_DIPANEN.md` §2.2 baru mencatat 10 dari 40) — cek apakah ada kolom
  semacam "Pesanan (Dibuat)"/"Jumlah Pesanan" di 30 kolom yang belum
  didokumentasikan. Kalau ADA: tambah ke `kolomDipanen` + `commitUploadBatch`
  panggil `rekonsiliasiGmvPesanan` penuh (fungsinya SUDAH ada di
  `packages/core/src/pdt/rekonsiliasi.ts`, tinggal dikasih angka pesanan asli).
  Kalau TIDAK ADA (Shopee memang tidak mengekspor ini per-SKU): tutup Open row
  ini sebagai "memang tidak bisa", bukan lagi "belum dicari".

**Rekomendasi Claude: (B).** Ini beda dari 1a — bukan soal kebijakan, tapi soal
"apakah datanya ADA". Kalau Hans/Anty sudah pernah pegang file
`parentskudetail.xlsx` asli (kemungkinan besar iya, dari proses onboarding
klien manapun), cek 5 menit selesai — jauh lebih murah daripada menebak.

**Kalau kolomnya ADA:** kirim nama kolom persis (copy-paste dari file, case
+ spasi apa adanya) ke sesi berikutnya — jangan diketik ulang dari ingatan.

### 1c. `G1-09-SIGNATURE-AMS-COLLISION` — deteksi otomatis gagal untuk 2 dari 3 modul iklan Shopee (prioritas TINGGI, dampak produksi)

**Konteks.** Tanda tangan `shopee_ams_afiliasi` (`must:['Omzet'],
anyOf:[Username|Kreator|Creator]`) otomatis cocok juga dengan
`shopee_ads_cpc`/`shopee_ads_live`, karena KEDUANYA (per Rule 2) membawa baris
preamble `Username: ...` DAN (per whitelist kolomnya sendiri) sama-sama punya
kolom yang mengandung kata "Omzet" (`omzet penjualan` pada `_cpc`, `Omzet`
literal pada `_live`).

**Contoh kasus konkret (dibuktikan lewat tes route commit, XLSX sungguhan).**
AM upload `iklan_cpc_juli.xlsx` — file iklan CPC Shopee yang 100% sah, berisi
preamble `Username: tokoku` + kolom `Kode Produk`/`Dilihat`/`Biaya`/`omzet
penjualan`. Hasil deteksi: `{kode: null, ambiguous: true, matches:
['shopee_ads_cpc', 'shopee_ams_afiliasi']}` — SETIAP kali, bukan kadang-kadang.
AM harus buka dropdown dan pilih manual "Shopee Ads — Iklan Keseluruhan (CPC)"
sendiri tiap upload, padahal ini modul paling sering diunggah.

**Temuan tambahan yang MEMPERMUDAH keputusan:** mesin LAMA (`report/shopee/detect.ts`,
komentar baris 20-24) SUDAH MENGAKUI masalah yang sama persis untuk trio
`ads_toko`/`ads_produk`/`ads_banner` ("identical column layout... the owner's
own tool cannot and does not distinguish them by content either — it relies
on the filename 100% of the time"). Jadi ini BUKAN bug baru PDT — ini
keterbatasan NYATA di format export Shopee sendiri, yang sistem LAMA
menyiasati dengan nama file, sesuatu yang Rule 6 PDT eksplisit LARANG.

**Pilihan:**
- **(A) Tunggu sample asli** `shopee_ams_afiliasi` berdampingan dengan
  `shopee_ads_cpc`/`shopee_ads_live` dari Hans/Anty, cari kolom yang BENAR-BENAR
  cuma ada di salah satu (mis. mungkin AMS punya kolom "ID Affiliates"/"Komisi"
  yang tidak pernah muncul di CPC/Live — `shopee_ams_afiliasi.kolomDipanen`
  sudah mencantumkan `ID Affiliates`/`Komisi` di `modules.ts`, TAPI belum
  diverifikasi bahwa keduanya benar-benar TIDAK PERNAH muncul di export
  CPC/Live manapun).
- **(B) Terima ambiguous selamanya** untuk pasangan ini — AM override manual,
  dicatat sebagai keterbatasan sadar (padanan keputusan sistem lama, tapi
  dengan pilihan eksplisit AM, bukan filename diam-diam).
- **(C) Reintroduksi nama file HANYA untuk pasangan ini** sebagai tie-breaker
  kalau ambiguous persis `{shopee_ads_cpc atau shopee_ads_live, shopee_ams_afiliasi}`
  — mengulang pola sistem lama, tapi terbatas dan eksplisit (bukan Rule 6
  penuh dibatalkan, cuma satu pengecualian tercatat).

**Rekomendasi Claude: coba (A) dulu pakai kolom yang SUDAH ada di kode**
(`ID Affiliates`/`Komisi` di `shopee_ams_afiliasi.kolomDipanen`) — kalau
Hans/Anty konfirmasi dua kolom itu memang cuma muncul di export AMS, tinggal
tambah `mustNot: ['ID Affiliates']` (atau `'Komisi'`) ke tanda tangan
`shopee_ads_cpc`/`shopee_ads_live` DAN `must` di `shopee_ams_afiliasi` — nol
sample baru dibutuhkan, cukup konfirmasi lisan/screenshot header dari Hans.
Kalau ternyata kolom itu JUGA ada di beberapa export CPC (jarang tapi
mungkin), baru benar-benar butuh sample sisi-demi-sisi (opsi A penuh). (C)
disimpan sebagai fallback kalau (A) buntu — TIDAK direkomendasikan duluan
karena mengulang jebakan Rule 6 yang PDT sengaja dibangun untuk menghindari.

**Kalau pemilik/Hans konfirmasi kolom pembeda:** tambahkan `mustNot`/`must` di
`packages/core/src/pdt/modules.ts` (dua tanda tangan, cari `shopee_ads_cpc`/
`shopee_ads_live`/`shopee_ams_afiliasi`), lalu jalankan tes fixture XLSX
SUNGGUHAN (pola `commit/route.test.ts`, BUKAN AoA hand-crafted seperti
`detect.test.ts` lama — supaya bukti "beneran ke-disambiguasi" bukan cuma di
teori) untuk membuktikan `ambiguous` sudah `false`.

---

## 2. Sisanya yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2b: baris fakta.** `commitUploadBatch`
   sekarang punya `terparse` (berkas 'ok' + modul + AoA + barisHeader) di
   tangan sebelum menulis DB — peta `kolomDipanen`→kolom `pdt_fact_*` BELUM
   ada (catatan lama G1-05 tetap benar: butuh keputusan tipe per kolom yang
   belum pernah dibuat). Pertimbangkan memecah lagi: fakta shop-level dulu
   (`pdt_fact_shop_daily`, sumbernya `parseShopeeShopStatsPerBasis` yang
   SUDAH ada dan sudah dipanggil dari rekonsiliasi) sebelum fakta per-SKU/
   konten/kreator/ads (butuh peta kolom baru per modul).
2. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Kontraknya sekarang
   LENGKAP tiga langkah: `POST .../upload-url` → PUT ZIP → `POST .../preview`
   (tabel hasil deteksi + dropdown override) → `POST .../commit` (`body`:
   `{client_platform_id, storage_path, module_overrides?,
   konfirmasi_ikat_identitas?}`, kontrak FE `PdtCommitBatch`
   `web-internal/src/lib/pdt.ts`) → tampilkan status batch (`verified`/
   `identitas_belum_terikat`/`ditolak` + `alasan_ditolak`). UI status paket
   (Rule 50 — tersedia/kedaluwarsa/legal hold) BELUM ada endpoint pembacanya
   sama sekali (butuh route baru: batch by id/list, di luar lingkup upload).
3. Item lama masih terbuka, masih tidak memblokir: `G1-08-SEBAGIAN`,
   `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR` (lihat `docs/DECISIONS.md`
   Open).
4. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` (TIGA suite sekarang
   — unduh G1-04, unggah/unduh G1-09-BODY-BESAR, **pindah G1-09 sesi ini**)
   masih belum pernah dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox
   manapun sejauh ini).
5. **Catatan sampingan (bukan blocker):** menjalankan test suite penuh
   berulang kali di sandbox ini (`packages/domain`, 89 berkas paralel)
   sesekali memunculkan 2 kegagalan flaky (`admin.test.ts`/`client.test.ts`,
   hitungan `audit_log`/notif meleset) yang TERBUKTI pra-ada (direproduksi di
   `main` tanpa perubahan sesi ini sama sekali) dan hilang begitu DB
   dibangun ulang bersih (`db-rebuild.sh --yes`) — bukan regresi, tidak
   diperbaiki di sini (di luar lingkup PDT).

---

## 3. G1-09 sub-langkah 2 (commit, lingkup 2a) — SELESAI, rinci

### 3.1 Berkas baru/diubah

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

### 3.2 Kontrak & keputusan penting

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
- **Ditemukan lewat full suite `packages/domain` (89 berkas paralel)**: cleanup
  `employees` generik (`created_by like 'ZZ-%'`) di `pdt.test.ts` sempat
  menghapus baris `employees` milik berkas test LAIN yang berjalan bersamaan
  (`admin.test.ts`/`client.test.ts` juga memakai `created_by='ZZ-TEST'`) —
  FK `dibuat_oleh` butuh baris `employees` (BARU, `commitUploadBatch` adalah
  penulis PERTAMA `pdt_upload_batch`, jadi masalah cleanup employees ini
  tidak pernah muncul sebelum sesi ini). **Diperbaiki**: cleanup dipersempit
  ke `employee_id` SPESIFIK (`= OWNER_AM`), bukan `created_by like 'ZZ-%'` —
  pola yang SAMA seperti sudah dipakai untuk `pdt_upload_batch`/`client_id`
  prefix (handoff SESI11 §2.2). **Kalau menambah tes PDT baru lagi yang
  insert `employees`, pakai pola `employee_id` spesifik ini, bukan
  `created_by like 'ZZ-%'`.**
- **Diverifikasi** (sandbox — `service postgresql start` + `db-rebuild.sh
  --yes`, password `postgres` di-set eksplisit; `npm install` root sudah
  terpasang dari sesi lalu): **`@cdps/core` 1147/1147**, **`@cdps/domain`
  2548/2548 (1 skip)**, **`@cdps/db` 107/107**, **`@cdps/api` 558/558 (15
  skip) kecuali SATU kegagalan `gelombang-c-showcase.e2e.test.ts` — bug
  pra-ada dikonfirmasi sesi 2-11, bukan regresi sesi ini**, **`web-internal`
  763/763**. `shape-parity`/`route-parity` hijau. `npm run lint -w @cdps/api
  -- --max-warnings 0` bersih.

### 3.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Baris fakta** (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/dst.) — sub-langkah 2b, §2 butir 1.
- **`pdt_usulan`/`pdt_laporan_kiriman`** — milik G4/G2, bukan G1.
- **Halaman upload `web-internal`** — sub-langkah 3, §2 butir 2.
- **Perbaikan tanda tangan `shopee_ams_afiliasi`** — §1c, butuh konfirmasi/sample dari Hans.
- **Verifikasi Storage sungguhan (`describeLive`)** — §2 butir 4, `SUPABASE_SERVICE_ROLE_KEY` tetap tidak tersedia di sandbox manapun sejauh ini.

---

## 4. Rujukan

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
- `packages/core/src/report/shopee/detect.ts` (baris 20-24, 226-231) — preseden mesin
  LAMA mengakui keterbatasan CONTENT-based detection yang sama persis (§1c di atas)
  untuk `ads_toko`/`ads_produk`/`ads_banner` DAN `aff_creator` (padanan lama
  `shopee_ams_afiliasi`), dan menyiasatinya lewat nama file — bacaan wajib sebelum
  memutuskan §1c.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.2 — status verifikasi kolom `shopee_parent_sku`
  (10 dari 40), rujukan §1b.
- `docs/handoff/HANDOFF_PDT_SESI11.md` — riwayat `G1-09-BODY-BESAR`.
- Pull request sesi ini: `https://github.com/MEAgrup/AgencyAPP/pull/367`.
