# HANDOFF — PDT (Pusat Data Toko) SESI 1 → SESI 2

> **Dibuat 2026-09-13.** Baca berkas ini **seluruhnya** sebelum menyentuh apa pun.
> Cabang kerja: `claude/beautiful-volta-obxpwq`. Commit terakhir: `ecffcda` (sudah di-push).
>
> **Status: dokumen sudah mendarat, NOL migrasi, NOL kode.** Sesi 2 melanjutkan dari §4.

---

## 0. Ringkasan 60 detik

PDT = satu lapisan fakta yang menggantikan **empat** tool: AM Baseline (Riset Awal + Video
Factory), AM Co-Pilot, Report Engine TikTok, Report Engine Shopee. AM mengunggah **satu paket ZIP
per toko per periode**; lima konsumen hilir membaca fakta yang sama.

**Yang sudah selesai (commit `ecffcda`):** PRD masuk repo, 10 keputusan `PDT-15`…`PDT-27` tercatat
di `DECISIONS.md`, backlog G1–G5 tersusun.

**Yang sesi 2 kerjakan:** §4 (5 tugas dokumen) lalu §5 (G0/G1). Semua keputusan yang dibutuhkan
**sudah diketok Nerissa** — lihat §2. Hanya 3 hal yang masih terbuka (§6).

**Satu hal yang paling penting untuk dibaca:** §3. PRD §7 melewatkan kolom yang kode
**wajibkan**, dan menyusun whitelist harfiah dari PRD akan mematikan 3 modul.

---

## 1. Peta: apa yang sudah ada di repo

| Berkas | Isi |
|---|---|
| `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` | PRD v1.1 + kepala "Catatan penyelarasan repo" (koreksi K-1…K-4) |
| `docs/backlog/PDT_BACKLOG.md` | §0 prasyarat · §1 G1-01…G1-11 · §2 G2 · §3 G3 · §4 G4 · §5 G5 (diblokir) · §6 status P-01…P-11 · §7 non-coding · §8 aturan strangler |
| `docs/DECISIONS.md` | 3 baris 2026-09-12: pembalikan invarian raw · PDT masuk repo + K-1…K-4 · verifikasi P-01…P-11 |
| `docs/prd/CDPS_Build_Plan.md` | baris manifest PDT |
| `docs/DATA_MODEL.md` | catatan "PDT minta nol prefix baru" |

### Koreksi yang sudah berlaku (K-1…K-4, ada di kepala PRD)
- **K-1** kode `D-15`…`D-27` → **`PDT-15`…`PDT-27`** (namespace `D-NN` sudah dipakai tiket M6D;
  `D-14` di sana = "Disiplin Rekap Mingguan").
- **K-2** semua tabel `pdt_*` = `bigint GENERATED ALWAYS AS IDENTITY`, **nol prefix baru** ⇒
  `entity_prefix` **tetap 44**.
- **K-3** `requirePermission` **tidak ada di repo ini**. Pola rumah = **predikat bernama** di
  `packages/domain/src/pdt.ts`, menyalin lingkup `showcase.canKelolaIzinPitch`
  (`packages/domain/src/showcase.ts:112`).
- **K-4** `level2_category` & `price_segment` **tidak punya tipe di CDPS** ⇒ jangan dilahirkan di
  migrasi G1; **G5 diblokir**.

---

## 2. Ketokan Nerissa 2026-09-13 — SUDAH DIPUTUS, jangan didesain ulang

### 2.1 Prinsip yang mengubah otoritas dokumen

> **"Revisi PRD mengikuti keadaan sebenarnya. Kalau ada kolom yang belum terhitung (ROAS 9×,
> GPM 100rb, dll), tambahkan di tool baru — bukan mengikuti PRD-nya."**

⚠️ Ini **deviasi dari aturan rumah** `CLAUDE.md` (*"If code and PRD disagree, the PRD wins"*).
Wajib satu baris `DECISIONS.md` tersendiri, **dengan batasnya dinyatakan**:
berlaku **hanya untuk daftar kolom yang diparse** — aturan bisnis, status, dan label BI tetap
PRD yang menang.

### 2.2 Delapan ketokan lain

| Kode | Ketokan | Akibat |
|---|---|---|
| **F-3/F-10** | "Kita sedang mulai pakai CDPS, bertahap; 12 bulan adaptasi 100%. Adopsi rendah justru KARENA tool HTML lama tidak membantu — AM berulang kali mengisi kolom yang sama." | Adopsi rendah = gejala yang PDT obati. Aturan strangler PDT-17 **dibiarkan apa adanya** |
| **F-4** | "Shop ID belum diisi karena Product Exchange memang belum dimulai." | Benar untuk PX — **tapi PDT Rule 2 memakai kolom yang sama untuk validasi identitas Shopee.** Solusinya Q-1 di bawah |
| **F-5** | "`client_platform` jadikan pilihan, bukan teks bebas. Yang melanggar itu toko testing." | CHECK/enum + normalisasi; 2 baris gabungan terhapus bersama data testing |
| **F-6** | "Tambahkan enum yang kurang." | `pdt_satuan_t` + **`rasio`** |
| **F-8** | "Klien tanpa AM mayoritas testing. Yang testing dihapus, yang belum di-assign." | `canUploadBatch(actor, ownerAm)` aman apa adanya |
| **F-9** | "SKU tanpa Kode Produk tidak akan dimasukkan ke Product Exchange." | **Rule 20 menang**; `skuKey` fallback-nama **tidak** dipakai di `pdt_sku_master` |

### 2.3 Q-1…Q-6 — semua terjawab

| # | Jawaban | Yang dieksekusi |
|---|---|---|
| **Q-1** | **A** | PDT **mengikat `shop_id` sendiri dari preamble berkas**, simetris dengan Rule 4 TikTok: batch Shopee pertama masuk `identitas_belum_terikat` → sistem usulkan `ID Toko` dari preamble → AM konfirmasi **sekali** → terikat permanen. `shop_id` terisi sebagai efek samping; PX ikut siap |
| **Q-2** | **150–300 klien** | Desain dikunci ke **300** (batas atas): ≈5,4 jt baris/thn di `pdt_fact_sku_period`, ≈0,72 GB ZIP pasca-purge, ≈5,3 GB fakta |
| **Q-3** | **A** | **Tidak partisi.** `periode` bertipe `date` (awal bulan) supaya partisi nanti = DDL murni. Ambang pemicu **ditulis di komentar migrasi** (mis. "tinjau saat > 20 jt baris atau 10 GB") |
| **Q-4** | **Cukup** | Kuota Supabase tidak memblokir; tinjau saat G2 |
| **Q-5** | **Rentang per export ≤ 28 hari; jendela mundur TikTok 6 bulan, Shopee 3 bulan** | Lihat §2.4 |
| **Q-6** | **Buang sesuai rekomendasi** | 11 kolom tanpa konsumen dibuang; `Kata Pencarian`/`SOV` **ditahan** menunggu Anty |

### 2.4 Q-5 — retensi, dan satu saran PRD yang SENGAJA tidak dijalankan

**PRD P-08 berbunyi:** *"Bila lebih pendek, retensi default PDT-26 harus **diturunkan** ke jendela
itu."* **Jangan dijalankan.**

| Platform | Jendela mundur | vs retensi 120 hari | Akibat |
|---|---|---|---|
| TikTok | 180 hari | 180 > 120 ✅ | "upload ulang" janji yang sah sepanjang masa retensi |
| **Shopee** | **90 hari** | **90 < 120** ⚠️ | ada **30 hari** di mana paket ZIP kita satu-satunya salinan |

Menurunkan retensi ke jendela platform berarti menghapus satu-satunya salinan tepat saat ia mulai
menjadi satu-satunya salinan. **Retensi tetap 120 hari.**

**Yang berubah:**
1. Status `perlu_upload_ulang` (Rule 11) butuh pasangan **`tidak_dapat_dipulihkan`**, ambangnya
   **per platform**: TikTok > 180 hari, Shopee > 90 hari. Menyuruh AM "upload ulang" di luar
   jendela itu adalah instruksi yang mustahil dijalankan.
2. Pagar 5%/hari (Rule 48) tetap penting untuk jendela Shopee 90–120 hari.

**Rentang per export (≤ 28 hari) — ketokan: "export sesuai sample, ada yang 28 hari ada yang 1
bulan, cek saja dari sample".**
- ⛔ **Jangan hardcode angka 28.** Rentang per modul **diturunkan dari sample**, dicatat di
  `pdt_parser_modul` — bukan konstanta di kode.
- **Rule 5 direvisi (ketokan: toleransi bulan-sama):** batch ditolak **hanya bila berkasnya
  berasal dari BULAN berbeda**. Rentang berbeda di dalam bulan yang sama (1–31 vs 1–28 Juli)
  **diterima**; `periode_mulai`/`periode_selesai` batch = **rentang terluas**. Maksud asli Rule 5
  (cegah Juli tercampur Agustus) utuh.
- **Catatan jujur:** rentang per modul belum bisa dicek — export asli **tidak disimpan di repo**
  (`UAT_TIKTOK_AVITASKIN_20260904.md:243-249`). Menempel ke tiket A-3 (Anty). Toleransi
  bulan-sama sudah membuat gerbang aman tanpa tahu angka pastinya — **ini tidak memblokir G1**.

---

## 3. 🔴 TEMUAN PALING PENTING — PRD §7 melewatkan kolom yang `requireCols` WAJIBKAN

Menyusun `kolom_dipanen` harfiah dari PRD §7 akan **mematikan 3 modul saat parse**.

| `requireCols(...)` di kode | Muncul di §7 PRD |
|---|---|
| `['Nama kampanye', 'Biaya', `**`'Pendapatan kotor'`**`]` — `packages/core/src/report/metrik.ts:150-151` | `Pendapatan kotor` → **0×** |
| `['Informasi Video', `**`'GPM (Rp)'`**`, `**`'GMV dari video (Rp)'`**`, 'VV']` — `:361` | keduanya → **0×** |
| `['Nama', 'GMV', `**`'Klik produk'`**`]` — `:457` | `Klik produk` → **0×** |

`Pendapatan kotor` adalah **sisi pendapatan dari ROAS**. Tanpanya kedua berkas Ads gagal parse dan
**dimensi ROAS berbobot 22% jadi `null`** — persis bug yang §1 PRD keluhkan.

**Total: 27 kolom ber-konsumen hilang dari §7**, plus satu modul yang tidak ada sama sekali:
**`shopee_kesehatan`** (pemasok dimensi 12% + Section B-4.3 poin penalti).

### Bobot dimensi — untuk menilai kerusakan tiap kolom yang hilang

**TikTok** (`packages/core/src/report/skor.ts:52-134`): `gmvmax` 0.22 · `live` 0.22 · `video` 0.18
· `kartu` 0.14 · `affiliate` 0.12 · `produk` 0.12

**Shopee** (`packages/core/src/report/shopee/skor.ts:114-121`): `roas_channel` 0.22 ·
`traffic_quality` 0.22 · `conversion_retention` 0.18 · `product_performance` 0.14 ·
`live_streaming` 0.12 · `kesehatan_toko` 0.12

### Daftar kolom yang WAJIB ditambahkan (bucket 2 — sudah disetujui F-1)

Diringkas; daftar lengkap 27 baris disusun di §4 tugas 2.

| Modul | Kolom yang §7 lewatkan | Dampak bila tetap hilang |
|---|---|---|
| `tt_ads_product`, `tt_ads_live` | **`Pendapatan kotor`** | `requireCols` throw → dimensi 0.22 mati |
| `tt_video` | **`GPM (Rp)`**, **`GMV dari video (Rp)`**, `Informasi Video` | dimensi 0.18 mati |
| `tt_product_analytics` | **`Klik produk`**, `Nama` | dimensi 0.12 mati; sumbu X kuadran SKU |
| `tt_shop_analytics` | **`Pengembalian dana`** + 5 kolom GMV-mix (`GMV dari LIVE kreator` dll) | `gmvNet` (standar GMV MEA) + dimensi 0.14 + B-2.3 |
| `tt_live` | `Penonton`, `CTOR`, `Kreator`/`Nama panggilan` | Co-Pilot L3; pemisah toko-vs-afiliasi |
| `tt_transaction_creator` | `Video`, `Siaran LIVE`, `Perkiraan komisi` | Co-Pilot A1/A2; **`commission_pct` untuk PX Flow D** |
| `shopee_parent_sku` | **`pengunjung produk (kunjungan)`** | sumbu X kuadran Shopee → dimensi 0.14 kolaps |
| `shopee_ads_cpc` | **`Efektifitas Iklan`** (ROAS), `(ACOS)`, `nama iklan`, `omzet penjualan` | dimensi 0.22 kehilangan input |
| **`shopee_kesehatan`** | **seluruh modul** (`poin pinalti` + deskripsi + durasi) | dimensi 0.12 permanen netral; B-4.3 kembali manual |
| `meta_ads` | `Minggu` | kunci baris pemisah ringkasan vs mingguan |

### Dua konsumen yang PDT-27 tidak hitung

PDT-27 menyebut lima konsumen. **Ada dua lagi** yang membaca export yang sama — membuang kolom
mematikan keduanya juga:
- **Ads Scanner** — `packages/core/src/adsscanner/tiktok/metrik.ts:58-170`
- **SKU Screener** — `packages/core/src/skuscreener/parse.ts:165-173`

Ejaan SKU Screener (`Total Penjualan`, `Jumlah Produk Dilihat`, `Persentase Klik`,
`Tingkat Konversi Pesanan`) adalah **alias** dari kolom `shopee_parent_sku` yang sama — masukkan
ke `pdt_kolom_alias`, bukan sebagai nama kanonik terpisah.

### Dua celah PX yang tidak punya sumber

- `commission_pct` → ada di `Perkiraan komisi` (TikTok) / `komisi` (AMS Shopee). Bisa ditutup.
- **`stock_status` → TIDAK ADA kolom export mana pun yang memasoknya**, padahal
  `requireStockIn: true` ada di policy PX ter-seed. Angkat sekarang, jangan ditemukan belakangan.

---

## 4. Tugas sesi 2 — 5 berkas dokumen, urut

> Semua dokumen. **Nol migrasi, nol kode.** Gerbang CI **161/44/35/74 tidak boleh bergerak.**

### Tugas 1 · `docs/DECISIONS.md` — dua baris baru
- **Baris A — ketokan Nerissa 2026-09-13**: delapan ketokan §2.2 + Q-1…Q-6 §2.3, masing-masing
  dengan konsekuensinya. Sebutkan **Q-5 dan alasan saran PRD tidak dijalankan** (§2.4).
- **Baris B — deviasi aturan rumah**: untuk **daftar kolom yang diparse**, konsumen nyata menang
  atas PRD. **Batasnya dinyatakan**: tidak berlaku untuk aturan bisnis, status, atau label BI.
  Sitir `CLAUDE.md` yang dideviasi, dan §3 sebagai buktinya.

Format rumah: tabel `| Date | Decision | Reason / trade-off | Approved by |`, **terbaru di atas**,
prosa Bahasa Indonesia, sebut alternatif yang ditolak, teks lama **dicoret bukan dihapus**.

### Tugas 2 · `docs/backlog/PDT_KOLOM_DIPANEN.md` — berkas BARU
Daftar `kolom_dipanen` per `pdt_parser_modul.kode`, tiap kolom ber-komentar konsumen bergaya §6.2:
`-- konsumen: report.dim_gmvmax(0.22), copilot.D1-D5, sectionB.B-2.3`

Tiga bucket:
1. **Derived-keep** — ada di §7 **dan** punya konsumen. Auto.
2. **Derived-add** — §7 lewatkan tapi konsumen wajibkan (**27 baris**, §3). Auto — **sudah
   disetujui ketokan F-1**.
3. **Human call** — 11 baris tanpa konsumen ⇒ **buang** (ketokan Q-6); `Kata Pencarian`/`SOV`
   **ditahan** menunggu Anty.

Plus: dua konsumen tambahan (§3), alias SKU Screener, dan dua celah PX (§3).

### Tugas 3 · Revisi `docs/prd/CDPS_PDT_Pusat_Data_Toko.md`
| Bagian | Revisi |
|---|---|
| §7 | **Tambahkan 27 kolom + modul `shopee_kesehatan`.** Beri catatan kepala: *"§7 diturunkan dari konsumen nyata, bukan sebaliknya — daftar yang mengikat ada di `PDT_KOLOM_DIPANEN.md`"* |
| §3 Rule 2 | Tambah pengikatan `shop_id` dari preamble (Q-1 opsi A), simetris Rule 4 |
| §3 Rule 5 | **Toleransi bulan-sama** (§2.4). Tolak hanya bila beda BULAN; periode batch = rentang terluas |
| §3 Rule 11 | Tambah status **`tidak_dapat_dipulihkan`** + ambang per platform (TikTok 180h, Shopee 90h) |
| §6.3 | `pdt_satuan_t` + **`rasio`** |
| §9 | P-01 ✅ · P-05 ✅ · P-06 ✅ (tertutup F-9) · P-08 ✅ (§2.4) · P-10 ✅ (150–300) · P-11 ✅ (SOP) |

### Tugas 4 · Perbarui `docs/backlog/PDT_BACKLOG.md`
- §6: status P-01/P-05/P-06/P-08/P-10/P-11 → **tertutup**, dengan jawabannya.
- **Tiket baru G1-00 · prasyarat data** (tanpa kode): hapus klien testing · assign AM ke klien
  real · `client_platforms.platform` jadi pilihan (CHECK + normalisasi ke `tiktok`/`shopee`/`meta`).
- G1-02 → menunjuk `PDT_KOLOM_DIPANEN.md`.
- G1-06 → memuat pengikatan `shop_id` (Q-1).
- G1-07 → memuat toleransi Rule 5 bulan-sama.
- G1-10 → retensi tetap 120 hari + status `tidak_dapat_dipulihkan` per platform.
- §8 → catat bahwa aturan strangler dibiarkan apa adanya (ketokan F-10).

### Tugas 5 · Commit
Satu commit dokumen ke `claude/beautiful-volta-obxpwq`. **Jangan buat PR kecuali diminta.**
Akhiri pesan commit dengan:
```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: <URL sesi>
```

---

## 5. Setelah §4 — urutan eksekusi

**G0 — prasyarat data (tanpa kode).** Hapus klien testing → assign AM → enum `platform`.
⚠️ **G1 tidak bisa lulus UAT sebelum G0 selesai.**

**G1 — mulai setelah G0.** Urutan tiket G1-01…G1-11 di `PDT_BACKLOG.md` §1 tidak berubah.
Yang berubah: G1-02 **punya daftar kolom siap pakai**, G1-06 memuat pengikatan `shop_id`,
G1-07 memuat toleransi Rule 5.

**Gerbang keluar G1:** ≥10 klien nyata `verified` (campuran TikTok & Shopee), bukan data seed.
Hari ini tepat 10 klien punya rekap mingguan — gerbang ini akan tercapai **seiring migrasi klien**,
bukan di minggu pertama. Itu diterima sadar (ketokan F-3).

**G5 tetap diblokir** sampai P-02/P-03 dijawab.

---

## 6. Yang MASIH terbuka (hanya 3)

| # | Isi | Pemilik | Memblokir |
|---|---|---|---|
| **P-02 / P-03** | `level2_category` & `price_segment_t` tidak ada di CDPS; hidup di MCN/MSDPS. Bagaimana taksonomi lintas-sistem masuk? | Hans | **G5 saja** |
| **A-3** | Kumpulkan sample ≥ 2 klien lain per platform; catat **rentang per modul** (28h vs 1 bulan) | Anty | presisi `pdt_parser_modul`; **tidak** memblokir G1 |
| **`Kata Pencarian` / `SOV`** | Riset keyword — konsumen yang belum dibangun, atau memang buang? | Anty | 2 kolom saja |

---

## 7. Fakta terverifikasi — jangan diverifikasi ulang, jangan ditebak ulang

### 7.1 DB live `egddxfcnrtecheiykhlf` (query read-only, 2026-09-12)

| Fakta | Nilai |
|---|---|
| Klien di CDPS | **27** (Agu 10 → Sep 17); 17 `released_to_account_at` |
| Toko aktif | **30** · TikTok Shop 16 · Shopee 11 · Tokopedia 1 · gabungan 2 |
| **`shop_id` terisi** | **0 dari 30** |
| Klien tanpa AM | **16 dari 27** (mayoritas testing — ketokan F-8) |
| AM pemegang klien | 4 (rata 2,8 · maks 5) |
| Punya rekap mingguan | **10** · Strategi **6** · **laporan pernah dibuat: 1** |
| Tabel terbesar | `audit_log` **3.642 baris / 1,2 MB** |
| Kosakata `platform` | `Shopee \| TikTok Shop \| TikTok Shop, Shopee \| TikTok Shop, Shopee, Tokopedia \| Tokopedia` — **nol CHECK** |
| `plan_row.satuan` | sudah berisi **`sku`** dan **`SKU`** sebagai dua nilai berbeda (dari 10 baris) |

### 7.2 P-01 — TERJAWAB, bukan asumsi lagi
Dua `Shop Analytics_Key metrics` di sample adalah **TikTok vs Tokopedia**, bukan filter produk.
`UAT_TIKTOK_AVITASKIN_20260904.md:43-44` → `shop_tt` dan `shop_tp`, **35 baris sama, periode
sama**. Pembeda: `GMV dari LIVE kreator` (TikTok) vs `Pendapatan bruto` (Tokopedia),
`packages/core/src/baseline/detect.ts:26-27`. Rp 130.097 = kanal Tokopedia yang nyaris mati.
⇒ `tt_orders` tetap sisi rekonsiliasi kanonik TikTok.

### 7.3 Satuan — kenapa `rasio` wajib ditambah
Katalog Co-Pilot memakai **7** satuan: `Rp`, `%`, **`x`**, `kreator`, `VV`, `video`, `jam`.
Enum usulan PRD (`rupiah, persen, hitungan, jam, hari, views`) **tidak punya slot untuk `x`** —
ROAS 9,63×. Memaksanya ke `hitungan` mencetak "9,63" tanpa satuan; ke `rupiah` mencetak
"Rp. 9,63" — persis bug yang Rule 27 ada untuk mencegah.

`AksiKatalog` (`packages/core/src/copilot.ts:101-123`) **tidak punya field platform sama sekali** —
diverifikasi: tiga kemunculan kata "platform" di berkas itu semuanya di komentar/string, nol di
struktur data. Komentar `:687-688` bahkan menyatakannya terang-terangan: *"tidak ada cabang per
platform di sini: kunci yang sebuah platform tak punya jadi `null`"*. Itu akar "klien Shopee dapat
nol usulan tanpa pesan" (Rule 29–30) — dan menjelaskan kenapa `platform_berlaku text[]` di
`pdt_usulan_katalog` benar-benar baru, bukan pemindahan.

### 7.4 Bug 5/10 yang Rule 12 hapus — lokasi persisnya
`packages/core/src/report/shopee/skor.ts:58`:
```ts
const MISSING = (label: string): string => `file ${label} tidak diunggah — dimensi ini dinilai netral (5/10)`;
```

### 7.5 Parse hari ini jalan di BROWSER, bukan server
`XLSX.read` ada di `web-internal/src/lib/{riset-awal,report,skuscreener,adsscanner}.ts`.
`xlsx@0.18.5` dependensi **`web-internal` saja**. Engine di `packages/core` **sudah murni** dan
menerima array-of-arrays — yang pindah ke server **hanya dekode berkasnya**.
⚠️ **Lisensi SheetJS pernah jadi ketidakpastian terbuka** (`RISET_AWAL_BASELINE_BACKLOG.md` §0) —
pastikan terjawab sebelum menambah dependensi di `apps/api`.

### 7.6 Empat registry tanda tangan yang harus disatukan ke `pdt_parser_modul`
`baseline/detect.ts` (12 tipe) · `report/detect.ts` (4 TTAM) · `report/shopee/detect.ts` (17) ·
`adsscanner/tiktok/detect.ts`. Pakai ulang `readSheet` (`baseline/sheet.ts:36`) — ia **sudah**
menangani header dua lapis + kolom duplikat via sufiks `nama#j` (perbaikan O70).
⛔ Jangan ubah heuristik hitungan LABEL UNIK-nya.

**Dua parser angka beda perilaku:** `baseline/angka.ts` `n()` → **0**;
`skuscreener/parse.ts` `parseIndonesianNumber()` → **NaN**.
⚠️ **`n()` BUKAN bug** — docblock-nya menyatakan *"a present-but-empty cell is 0. Absence of the
whole COLUMN is a different thing"*. Jangan "perbaiki". Fungsi PDT harus membedakan **tiga**
keadaan: sel kosong ⇒ `0` · nilai tak terbaca ⇒ `NaN` · kolom tak ada ⇒ kegagalan parse bernama.

### 7.7 Pola yang disalin, bukan dikarang
| Kebutuhan | Preseden |
|---|---|
| Tabel kalibrasi berversi | `adsscanner_benchmark` — `20260910010000_gelombang4_adsscanner.sql:81-148`. Versi aktif: `where aktif = true order by versi desc limit 1` (`packages/domain/src/adsscanner.ts:356,541`). **`aktif` tidak pernah dibalik**; versi boleh **lahir** non-aktif. Trigger `_frozen()` tolak semua UPDATE+DELETE. `REVOKE` + `ENABLE RLS` + **nol policy** |
| Predikat izin | `showcase.canKelolaIzinPitch` (`packages/domain/src/showcase.ts:112`); salinan: `productexchange.canIsiShopId` |
| Job terjadwal yang menyentuh API | **Vercel Cron** + `tickSecretOk` (`apps/api/src/lib/tick-auth.ts:57`), daftar di `apps/api/vercel.json`. ⛔ **Bukan `pg_cron`** — ia hanya bisa menyentuh baris DB, tidak objek storage |
| Snapshot beku append-only | `client_reports_frozen()` — `20260819000000_client_report_engine.sql` |

### 7.8 Gerbang CI — naikkan KEDUANYA dalam satu commit
`.github/workflows/ci.yml` **dan** `scripts/db-rebuild.sh` (pelajaran PR #170/#335).

| Gerbang | Sekarang | Bergerak untuk PDT? |
|---|---|---|
| `public` base tables | **161** | ✅ naik sebanyak tabel `pdt_*` |
| `entity_prefix` | **44** | ❌ **tidak** (K-2) |
| `sm_machines` | **35** | ❌ kecuali entitas PDT diberi lifecycle |
| `notif_events` | **74** | ⚠️ hanya bila katalog versi baru didaftarkan (O55) |

Plus: `route-parity.test.ts` **`KNOWN_GAPS` wajib tetap KOSONG** · `shape-parity.test.ts` menuntut
`null` eksplisit (kunci HILANG lebih berbahaya — kelas bug O43).

### 7.9 Keadaan suite hari ini
`npx vitest run --root packages/core` → **986 hijau**.
⚠️ `npm run typecheck` **GAGAL** di `@cdps/db` dan `@cdps/domain` — `error TS5101: Option 'baseUrl'
is deprecated`. **Sudah ada sebelum kerja PDT** (dibuktikan dengan `git stash`). **Bukan regresi,
jangan laporkan sebagai regresi, jangan perbaiki sebagai bagian PDT.**

---

## 8. Pagar yang tidak boleh dilanggar

1. Migrasi **hanya** `supabase/migrations/**` + `apply_migration` per berkas. ⛔ `psql -f` (O38),
   ⛔ `supabase db push` (O65).
2. Status ditulis **eksklusif** oleh `sm_transition` — atau **nol** state machine secara sengaja
   (preseden M19 `dailyops`).
3. Riwayat append-only (aturan rumah #3). **Purge menghapus OBJEK STORAGE saja** — baris fakta,
   laporan, verdict, `pdt_file`, dan `audit_log` **tidak pernah** ikut terhapus.
4. Pesan validasi Bahasa Indonesia dalam `[...]`, string persis dari PRD.
5. Izin = **predikat bernama** di `packages/domain`, bukan permission-key (K-3).
6. `archive/backend-go/**` **tidak disentuh** (C-05, arsip read-only).
7. Tiap kolom fakta **wajib menyebut konsumennya** di komentar migrasi. Kolom tanpa konsumen
   tidak boleh lahir (PDT-27).
8. ⛔ **Jangan lahirkan `level2_category` / `price_segment`** di migrasi G1 (K-4).
