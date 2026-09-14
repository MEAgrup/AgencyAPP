# HANDOFF — PDT (Pusat Data Toko) SESI 20 → SESI 21 (lanjutan) → SESI 22

> **Dibuat 2026-09-14.** Baca berkas ini SEBELUM mulai kerja teknis baru — ia menutup rantai
> `HANDOFF_PDT_SESI19.md` (modul KEENAM `shopee_ads_cpc`) → `HANDOFF_PDT_SESI20.md` (admin
> merge PR #376/#377) → **sesi ini** (lanjutan otomatis "lanjutkan task berikutnya", PR
> #378/#379/#380 — investigasi PENUH ZIP Fim Motor). Instruksi pemilik untuk berkas ini:
> **"buat handoff detail untuk melanjutkan build di chat baru, kalau butuh keputusan berikan
> contoh kasus dan rekomendasi."**
>
> **ZIP `Shopee - Fim Motor.zip` HANYA ada di scratchpad sesi SEBELUMNYA — TIDAK terbawa ke
> sesi/chat baru.** Semua temuan penting darinya SUDAH dipindahkan ke dokumen ini +
> `PDT_KOLOM_DIPANEN.md` + `DECISIONS.md`. Kalau sesi berikutnya butuh memverifikasi ulang
> byte-per-byte, minta Yohan unggah ulang.

---

## 0. Apa yang terjadi sesi ini

Melanjutkan dari `HANDOFF_PDT_SESI20.md` (PR #376/#377 sudah merge), instruksi pemilik
"lanjutkan task berikutnya" (berulang beberapa kali) memicu **investigasi PENUH** ZIP Fim
Motor — bukan cuma dua-tiga berkas yang sudah dipakai sesi 19/20, tapi SELURUH 15 berkas,
dibaca isinya (bukan cuma nama kolom header) satu per satu. Hasilnya empat PR, semua **sudah
merge**:

| PR | Isi | Status |
|---|---|---|
| #376 | Modul KEENAM `shopee_ads_cpc` + bugfix AMS (sesi 19/20, sudah dilaporkan `HANDOFF_PDT_SESI20.md`) | ✅ merged (`101082c`) |
| #377 | Handoff admin sesi 20 (dokumentasi saja) | ✅ merged (`31c6faf`) |
| #378 | **4 bug `kolomDipanen` laten**: `shopee_ads_search`, `shopee_live`, `shopee_chat`, `shopee_chat_broadcast` | ✅ merged (`4877690`) |
| #379 | **Bug `kolomDipanen` ke-5**: `meta_ads` | ✅ merged (`9fc3438`) |
| #380 | **Temuan definitif `shopee_video`**: sample TIDAK PUNYA baris per video (dokumentasi saja, nol kode) | ✅ merged (`592536a`) |

**Pola bug yang ditemukan berulang kali (5 modul, PR #378/#379)**: `kolomDipanen` ditulis
sebelum sample asli pernah ada, ejaan meleset dari kolom sungguhan (biasanya kolom asli
punya SUFIKS yang tidak dituliskan — `"(IDR)"`, `"(Rp)"`, `"Khusus untuk Item Bersama"`,
dsb.) — `validasiKolomWajib` (exact-match per sel, `packages/core/src/pdt/parsestatus.ts`)
TIDAK PERNAH menemukannya, jadi `parse_status` akan SELALU `'gagal'` untuk berkas ASLI
walaupun `tandaTanganKolom` (deteksi, substring) sudah benar dan tes lama HIJAU (karena
fixture tes lama menuliskan header buatan yang kebetulan cocok tebakan, bukan sample nyata).
**Kalau sesi berikutnya menambah modul baru atau menyentuh yang lama: JANGAN percaya
`kolomDipanen` yang belum pernah dicocokkan ke `validasiKolomWajib` dengan header PERSIS
sample asli — tulis tes seperti `packages/core/src/pdt/parsestatus.test.ts` describe block
terbaru ("validasiKolomWajib × PDT_MODULES.kolomDipanen") untuk modul itu SEBELUM percaya
modul itu akan `parse_status='ok'` di produksi.**

**Ini menutup investigasi ZIP Fim Motor** — seluruh 15 berkas sudah dibaca minimal sekali.
Tabel status per berkas ada di §2.

## 1. Peta status registry modul PDT hari ini

25 modul total (`PDT_MODULES`, `packages/core/src/pdt/modules.ts`). Enam tabel fakta,
status penulis:

| Tabel fakta | Penulis | Catatan |
|---|---|---|
| `pdt_fact_ads` | `shopee_ads_live` (modul 1), `shopee_ads_cpc` (modul 6) | `shopee_ads_search` SIAP dibangun (lihat §3.B) tapi BELUM |
| `pdt_fact_content` | `tt_video` | `shopee_video` TIDAK BISA (§3.D), `shopee_live` BELUM (§3.E) |
| `pdt_sku_master` | `shopee_parent_sku` + `tt_orders` | UPSERT, bukan replace |
| `pdt_fact_creator_period` | `tt_transaction_creator` + `shopee_ams_afiliasi` | kedua platform |
| `pdt_fact_sku_period` | **NOL penulis** | modul KETUJUH (`shopee_ams_produk`) BLOCKED total oleh §3.A |
| `pdt_kesehatan_toko` (atau setara) | `shopee_kesehatan` | belum diverifikasi/disentuh sesi manapun sejauh catatan ini |

Modul dengan `kolomDipanen` benar (exact-match TERBUKTI, ada tes) per sesi ini: `shopee_ads_live`,
`shopee_ads_cpc`, `shopee_parent_sku`, `tt_orders`, `tt_transaction_creator`, `shopee_ams_produk`,
`shopee_ams_afiliasi`, `shopee_ads_search`, `shopee_live`, `shopee_chat`, `shopee_chat_broadcast`,
`shopee_voucher`, `meta_ads`, `tt_video`. Modul yang MASIH `UNVERIFIED_SIGNATURE`/kosong:
`shopee_diskon`, `shopee_flash_sale`, `shopee_video`.

## 2. Status per berkas ZIP Fim Motor (referensi, sudah tidak tersedia sesi ini)

| Berkas | Modul | Status sesi ini |
|---|---|---|
| `Data+Keseluruhan+Iklan+Shopee-*.csv` | `shopee_ads_cpc` | ✅ writer ada (sesi 19) |
| `Data-Semua-Iklan-Live-*.csv` | `shopee_ads_live` | ✅ writer ada (sesi 12-13) |
| `Search-Ads-Overall-Data-*.csv` | `shopee_ads_search` | 🟡 kolomDipanen benar, writer BELUM (§3.B) |
| `live_streaming_*.xlsx` | `shopee_live` | 🟡 kolomDipanen benar, identitas BLOCKED (§3.E) |
| `video-overview-v3*.csv` | `shopee_video` | 🔴 TIDAK BISA — sample salah grain (§3.D) |
| `ProductPerformance_*.csv` | `shopee_ams_produk` | 🟡 kolomDipanen benar, writer BLOCKED oleh §3.A |
| `AMSAffiliatePerformance_*.csv` | `shopee_ams_afiliasi` | ✅ writer ada (sesi 17), bug diperbaiki sesi 20 |
| `parentskudetail.*.xlsx` | `shopee_parent_sku` | ✅ writer ada (modul KETIGA) |
| `fim_motor.shopee-shop-stats.*.xlsx` | `shopee_shop_stats` | ✅ (rekonsiliasi 2b-i, sesi lama) |
| `voucher_*.xlsx` | `shopee_voucher` | ✅ kolomDipanen benar, writer BELUM ADA (tidak diprioritaskan) |
| `discount_*.xlsx` | `shopee_diskon` | 🔴 struktur didokumentasikan, whitelist BELUM diputuskan (§3.C) |
| `In_Shop_Flash_Sale_Metrics_*.xlsx` | `shopee_flash_sale` | 🔴 sama seperti diskon (§3.C) |
| `chat_*.xlsx` | `shopee_chat` | ✅ kolomDipanen benar, writer BELUM ADA |
| `Chat_Broadcast_overview_*.xlsx` | `shopee_chat_broadcast` | ✅ kolomDipanen benar, writer BELUM ADA |
| `Laporan-tanpa-judul-*.xlsx` | `meta_ads` | ✅ kolomDipanen benar (PDT-22, opsional) |

## 3. Keputusan yang dibutuhkan — contoh kasus + rekomendasi

Urutan berdasarkan dampak (paling menghambat modul lain lebih dulu).

### A. `G1-09-2BII-ADS-CPC-SKU` — lookup produk induk → SKU varian (PALING BERDAMPAK)

**Masalah.** `pdt_sku_master` berkunci PER VARIAN
(`client_platform_id, platform_product_id, platform_variation_id`). Tapi `shopee_ads_cpc`
(sudah jalan, `sku_id` selalu NULL) dan modul KETUJUH kandidat `shopee_ams_produk` →
`pdt_fact_sku_period` (`sku_id bigint NOT NULL`, BLOCKED TOTAL karena ini) sama-sama hanya
punya identitas level PRODUK INDUK (`Kode Produk`/`Kode Item`), bukan varian.

**Contoh kasus konkret (dari sample Fim Motor asli).** Produk "Cover Body Kasar Atas Bawah
Kolong Samping Tengah Vario 125 150 LED 2015 2016 2017" (`Kode Produk 22571212550`) punya
**14 varian** di `pdt_sku_master` (COVER RADIATOR, GARNIS, COVER TANGKI, BATOK BELAKANG ISS,
BATOK DEPAN, SAMBUNGAN BODY, DEK BAWAH, DEK PARU, dst. — masing-masing `platform_variation_id`
sendiri). `ProductPerformance_*.csv` (`shopee_ams_produk`) melaporkan SATU baris untuk
`Kode Item 22571212550` dengan `Omzet Penjualan(Rp) 54.587.884` — omzet itu adalah GABUNGAN
14 varian, sistem TIDAK PERNAH tahu varian mana yang menyumbang berapa dari baris ini saja.
Memaksa `sku_id` ke SALAH SATU dari 14 pilihan (mis. yang pertama di `pdt_sku_master`) akan
mengarang atribusi — persis kelas kesalahan Rule 13-16 dirancang untuk dicegah.

**Opsi & rekomendasi:**
1. **(Ditolak)** Pilih 1 varian "representatif" (mis. varian pertama/termurah) sebagai
   `sku_id`. — Ditolak: mengarang data, bukan menurunkannya, melanggar CLAUDE.md.
2. **(Ditolak)** Buat baris `pdt_fact_sku_period` DUPLIKAT untuk tiap varian dengan angka
   yang sama/dibagi rata. — Ditolak: angka per varian jadi fiktif, menyesatkan siapa pun yang
   membaca laporan per-SKU.
3. **✅ REKOMENDASI: Tambah kolom `platform_product_id varchar(64) NULL` (tanpa FK) di
   `pdt_fact_sku_period` DAN `pdt_fact_ads`, diisi LANGSUNG dari `Kode Produk`/`Kode Item`
   (copy identitas, BUKAN lookup) sementara `sku_id` tetap NULL untuk baris yang sumbernya
   level produk-induk.** Konsumen yang butuh angka PER VARIAN pakai baris dari modul yang
   MEMANG level varian (`shopee_parent_sku`/`tt_orders`, sudah UPSERT ke `pdt_sku_master`).
   Konsumen yang cukup dengan angka PER PRODUK (mis. dashboard "top produk by ads spend")
   query `pdt_fact_ads`/`pdt_fact_sku_period` langsung pakai `platform_product_id`, JOIN
   opsional ke `pdt_sku_master WHERE platform_product_id = ...` (1-ke-banyak) kalau perlu
   daftar varian di baliknya. Ini konsisten dengan pola `shopee_ads_cpc` yang SUDAH menaruh
   `Kode Produk` di `kolomDipanen` tanpa memaksakan `sku_id`.
   - **Trade-off**: satu migrasi baru (ALTER TABLE, kolom nullable — aman, backward
     compatible), dan setiap query "GMV per SKU" yang SEBELUMNYA berasumsi `sku_id` selalu
     terisi untuk semua baris `pdt_fact_ads`/`pdt_fact_sku_period` perlu direvisi untuk
     menangani campuran (`sku_id` ada) DAN (`platform_product_id` ada, `sku_id` NULL).
   - **Kapan TIDAK melakukan ini**: kalau ternyata TIDAK ADA konsumen hilir (dashboard/
     laporan) yang butuh angka level-produk sama sekali — cek dulu PRD §7/Section
     B/kuadran sebelum membangun kolom yang tidak dipakai.
4. Alternatif lebih sederhana kalau opsi 3 dianggap terlalu besar untuk sesi berikutnya:
   **tunda `shopee_ams_produk`/modul KETUJUH TANPA batas waktu**, `shopee_ads_cpc.sku_id`
   tetap NULL selamanya (status quo). Ini VALID tapi berarti dimensi "GMV per SKU dari
   iklan/AMS" tidak akan pernah terisi.

**Perlu keputusan dari**: Yohan/Hans/Anty (opsi 3 vs 4) — opsi 3 direkomendasikan kalau ada
kebutuhan bisnis nyata melihat GMV/komisi per PRODUK (bukan per varian) dari sumber-sumber
ini; kalau tidak ada, opsi 4 (tunda) lebih murah.

---

### B. `shopee_ads_search` — bangun writer `pdt_fact_ads` (pola SIAP, tinggal eksekusi)

**Konteks.** Sample asli (`Search-Ads-Overall-Data-*.csv`) TERNYATA punya `Nama Iklan` dan
`Biaya` — dua kolom yang `G1-09-2BII-ADS-SEARCH` (Open lama) klaim TIDAK ADA. Klaim itu
sudah usang. Pola pembangunannya identik `shopee_ads_cpc` (sesi 19).

**Contoh kasus konkret.** Satu-satunya baris data di sample: `Nama Iklan = "Iklan toko by
MEA"`, `Kata Pencarian = "Semua"`, `Biaya = 6.200.000`, `Jumlah Klik = 20.677`,
`Konversi = 330`, `Omzet Penjualan = 32.480.316`, `Efektifitas Iklan = 5.24`,
`ACOS = 19.09%`. Ini SATU baris per periode di sample — tapi sample hanya 1 baris, TIDAK
membuktikan apakah satu `Nama Iklan` yang sama bisa muncul BERKALI-KALI dengan `Kata
Pencarian` BERBEDA dalam satu periode (mis. satu iklan search menargetkan banyak keyword,
tiap keyword baris sendiri). Kalau itu terjadi, memakai `kampanye_id = nama iklan` SAJA
(pola `shopee_ads_cpc`) akan BENTROK di `uq_pdt_fact_ads` (sku_id/content_id NULL, NULL≠NULL
di Postgres tidak menyelamatkan — DELETE-then-INSERT replace-on-recommit yang sudah dipakai
`shopee_ads_cpc` akan diam-diam MENIMPA baris keyword lain sebagai baris terakhir yang
di-loop, bukan error yang kelihatan).

**Rekomendasi:**
1. **✅ REKOMENDASI: pakai `kampanye_id` KOMPOSIT** — `` `${namaIklan} :: ${kataPencarian}` ``
   (atau pemisah lain yang tidak mungkin muncul di teks bebas) BUKAN `nama iklan` polos —
   aman baik sample hanya 1 baris/iklan MAUPUN kalau ternyata banyak keyword per iklan.
   Kalau `Kata Pencarian` selalu `"Semua"` (tidak spesifik keyword), komposit ini
   berkurang jadi setara `nama iklan` saja (tidak ada downside).
2. Sebelum push ke produksi: **cek sample lain (toko lain/periode lain) untuk konfirmasi**
   apakah `Kata Pencarian` pernah berisi keyword spesifik (bukan cuma "Semua") — kalau iya,
   itu juga jawaban parsial untuk Q-6 (kolom `Kata Pencarian`/`SOV` bucket 3, masih DITAHAN
   menunggu Anty) tentang riset keyword.
3. Kolom yang dipanen untuk baris fakta: `Nama Iklan` (identitas), `Dilihat` (tayangan),
   `Jumlah Klik` (klik), `Konversi` (pesanan_sku), `Omzet Penjualan` (gmv), `Biaya` (biaya,
   NOT NULL), `Efektifitas Iklan` (roas) — PERSIS pola `ekstrakBarisShopeeAdsCpc`. `sku_id`
   tetap NULL (search ads tidak punya identitas produk sama sekali di whitelist ini).
4. **TAMBAHKAN `Nama Iklan`/`Biaya` ke `kolomDipanen` dulu** (belum ada — lihat catatan di
   `modules.ts`/`PDT_KOLOM_DIPANEN.md` §2.4 sesi ini) sebelum menulis fungsi ekstraksi.

**Perlu keputusan dari**: tidak perlu persetujuan bisnis — ini murni pekerjaan implementasi
mengikuti pola yang sudah ada. Boleh langsung dikerjakan sesi berikutnya TANPA menunggu
Yohan, asalkan komposit `kampanye_id` di atas dipakai (bukan `nama iklan` polos).

---

### C. `G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` — kolom mana yang dipanen

**Konteks.** Struktur asli `shopee_diskon`/`shopee_flash_sale` TERNYATA beda dari asumsi
lama (`PDT_KOLOM_DIPANEN.md` §2.8 lama menyamakannya dengan `shopee_voucher` — SALAH,
sudah dikoreksi). Signature deteksi AMAN untuk ditulis, tapi kolom yang mau dipanen adalah
keputusan bisnis (mirip Q-6), bukan cuma ejaan.

**Contoh kasus konkret — `shopee_diskon`** (`discount_*.xlsx`, sheet "Kriteria Utama"),
baris `Tipe Promosi = "Diskon"`: `Penjualan (Pesanan Dibuat) (IDR) = 1.132.581.681`,
`Penjualan (Pesanan Siap Dikirim) (IDR) = 1.048.535.693`, `Pesanan (Pesanan Dibuat) = 9.887`,
`Pesanan (Pesanan Siap Dikirim) = 9.312`, `Produk Terjual = 14.422/13.445`,
`Pembeli = 8.242/7.949`. Sheet "Rincian Performa" PULA punya baris PER PROMOSI individual
(nama promosi, periode, status) — mis. `"mika diskon"`, `Promo Toko`, `20-07-2026 23:30 -
05-08-2026 20:41`, `Telah Berakhir`, `Penjualan 15.136.718/14.619.955`.

**Rekomendasi — dua tingkat MVP:**
1. **✅ REKOMENDASI (MVP minimal, mulai dari sini)**: whitelist HANYA sheet "Kriteria Utama"
   (agregat harian per `Tipe Promosi`) dengan kolom `Tanggal`, `Tipe Promosi`,
   `Penjualan (Pesanan Dibuat) (IDR)`, `Penjualan (Pesanan Siap Dikirim) (IDR)`,
   `Pesanan (Pesanan Dibuat)`, `Pesanan (Pesanan Siap Dikirim)`. Cukup untuk pertanyaan
   "berapa GMV dari diskon toko per hari" — TIDAK menyentuh rincian Paket
   Diskon/Kombo Hemat (produk utama vs tambahan, 20 kolom lagi) yang belum ada yang minta.
   `shopee_flash_sale` sejajar: `Periode Waktu`, `Penjualan (Pesanan Dibuat)(Rp)`,
   `Penjualan (Pesanan Siap Dikirim)(Rp)`, `Pesanan (Pesanan Dibuat)`,
   `Pesanan (Pesanan Siap Dikirim)`, plus `Jumlah Produk Dilihat`/`Produk Diklik` (funnel,
   satu-satunya hal unik yang dibawa flash sale dibanding diskon/voucher).
2. **Opsi lebih lengkap (kalau Yohan/Hans/Anty mau tahu PROMOSI MANA yang paling efektif,
   bukan cuma agregat harian)**: tambahkan sheet "Rincian Performa" (`Nama Promosi`,
   `Tipe Promosi`, `Periode Promosi`, `Status`, `Penjualan` 2 basis) sebagai modul TERPISAH
   (atau kolom tambahan modul sama) — lebih mahal, tunda sampai ada yang benar-benar minta.
3. Signature deteksi yang aman (sudah terverifikasi lewat sample, tinggal ditulis):
   `shopee_diskon`: `must: ['Tanggal', 'Tipe Promosi']`.
   `shopee_flash_sale`: `must: ['Periode Waktu', 'Jumlah Produk Dilihat']` (kombinasi ini
   TIDAK dimiliki `shopee_voucher`/`shopee_diskon`, aman dari salah-slot).

**Perlu keputusan dari**: Anty/Hans — konfirmasi opsi 1 (MVP) cukup, atau langsung opsi 2.
Rekomendasi: mulai opsi 1, sangat murah untuk diperluas nanti (menambah baris `kolomDipanen`
tidak pernah breaking change untuk baris yang sudah ada).

---

### D. `G1-09-2BII-SHOPEEVIDEO-GRAIN` — `shopee_video` butuh SUMBER LAIN, bukan lagi investigasi

**Konteks.** Sudah terverifikasi DEFINITIF (§0 PR #380): `video-overview-v3*.csv` adalah
laporan AGREGAT satu akun per periode (32 baris total, SATU baris data + blok ringkasan per
sumber kunjungan), NOL identitas video di 54 kolom. Modul ini TIDAK BISA menulis
`pdt_fact_content` dari jenis laporan ini, titik — bukan soal kolom mana yang dipilih.

**Contoh kasus (sudah dijalankan, hasilnya negatif)**: baris data sample:
`Periode Data = "01-07-2026 - 31-07-2026"`, `User Id = 938383137`, lalu 52 kolom metrik
LAINNYA — semuanya angka TUNGGAL untuk seluruh bulan, bukan satu baris per video yang
diposting. Tidak ada "Tampilan-per-video-1, video-2, ..." di mana pun.

**Rekomendasi:**
1. **✅ REKOMENDASI: minta Yohan/tim cek Shopee Seller Center apakah ADA laporan lain**
   bernama sesuatu seperti "Content Performance"/"Daftar Video"/"Video List" (BUKAN "Video
   Overview") yang menampilkan SATU BARIS PER VIDEO dengan kolom identitas
   (ID Video/judul/tanggal upload per baris). Kalau ADA, itulah sample yang harus diunggah
   — TIDAK BISA ditebak namanya tanpa melihat Seller Center langsung (Rule 6 tetap
   berlaku: jangan menebak nama kolom dari nama berkas, TAPI di sini yang dicari cuma nama
   MENU laporannya, bukan isi kolom).
2. **Kalau TIDAK ADA laporan per-video di Shopee Seller Center sama sekali** (mungkin
   Shopee memang tidak mengekspos itu, beda dari TikTok yang punya `Video Performance
   List_*.xlsx` per video) — rekomendasi: turunkan `shopee_video` dari `wajib: true` PRD
   §7.2 ke opsional/dihapus, dan terima bahwa dimensi Video HANYA terisi dari TikTok
   (`tt_video`, sudah jalan) untuk sekarang. Ini butuh persetujuan pemilik karena mengubah
   scope PRD, bukan keputusan teknis.
3. **JANGAN** menyalakan deteksi (`tandaTanganKolom`) untuk `video-overview-v3` sambil
   menunggu keputusan di atas — modul itu memang TIDAK BISA menulis apa pun dari sumber
   ini, menyalakan deteksinya hanya akan membuat `parse_status='ok'` palsu (nol kolom
   tervalidasi karena `kolomDipanen: []`).

**Perlu keputusan dari**: Yohan (cek Seller Center) → lalu Hans/Anty/pemilik (kalau opsi 2,
turunkan wajib PRD).

---

### E. `G1-09-2BII-SHOPEELIVE` — identitas sesi live (TEMUAN BARU, layak dicoba)

**Konteks.** Open lama bilang `Informasi Streaming` (judul bebas AM) tidak aman jadi
identitas karena bisa berulang. BENAR — tapi sample asli sesi ini (`live_streaming_*.xlsx`
sheet "Daftar Streaming") membuka fakta baru: `Waktu Mulai` (format `DD-MM-YYYY HH:mm`)
tercatat PER MENIT, dan dalam sample (satu bulan, satu akun) TIDAK ADA dua sesi live dengan
`Waktu Mulai` yang sama — termasuk kasus judul BERULANG:

**Contoh kasus konkret.** Judul `"jual berbagai body motor"` muncul di DUA baris:
`Waktu Mulai = "03-07-2026 15:21"` dan `Waktu Mulai = "04-07-2026 11:11"` — judul sama,
`Waktu Mulai` beda. Ini masuk akal secara struktural: satu akun Shopee cuma bisa
menjalankan SATU sesi live pada satu waktu, jadi `Waktu Mulai` (menit presisi) SANGAT
mungkin unik per akun selama-lamanya (bukan cuma kebetulan di sample ini).

**Rekomendasi:**
1. **✅ REKOMENDASI: pakai `platform_content_id = to_char(waktu_mulai, 'YYYYMMDDHH24MI')`**
   (timestamp diformat jadi string, bukan `Informasi Streaming`) sebagai identitas
   `pdt_fact_content` untuk `shopee_live`. `Informasi Streaming` tetap disimpan sebagai
   kolom deskriptif (bukan identitas) kalau `pdt_fact_content` punya slot untuk itu, atau
   dibuang (kolomnya tidak esensial untuk metrik).
2. **Sebelum menganggap ini FINAL**: minta konfirmasi dari sample LEBIH BANYAK (toko lain,
   atau bulan lain toko yang sama) bahwa tidak pernah ada dua live dimulai di MENIT yang
   sama persis untuk satu akun — satu bulan satu toko adalah bukti kuat tapi bukan jaminan
   matematis. Kalau memungkinkan, cek juga apakah Shopee API/export punya "ID Sesi Live"
   yang literal (belum pernah dicari secara eksplisit di UI Seller Center, cuma di file
   export) — kalau ADA, itu lebih baik dari solusi timestamp manapun.
3. Ini TIDAK memerlukan keputusan bisnis — murni verifikasi teknis tambahan (opsional) lalu
   implementasi. Boleh dikerjakan langsung sesi berikutnya kalau tim nyaman dengan risiko
   "menit yang sama, dua live" (risiko sangat rendah, tapi bukan nol tanpa jaminan
   platform).

**Perlu keputusan dari**: opsional — Hans/Anty kalau mau super-hati-hati sebelum
implementasi (poin 2), TAPI bisa juga langsung dikerjakan Claude sesi berikutnya sebagai
keputusan teknis berisiko-rendah (dicatat sebagai deviasi di `DECISIONS.md` seperti biasa).

---

### F. `G1-09-2BII-SKU-STATUS-TRANSISI` (Open lama, tidak tersentuh sesi ini)

Ringkas: transisi `status_listing` SKU ke `'nonaktif'`/`'dihapus_platform'` belum ada
mesinnya — PRD tidak merinci pemicunya. **Rekomendasi** (dari opsi yang sudah tercatat):
pola (a) — job periodik (`Vercel Cron`, sama seperti `G1-10` job purge) yang membandingkan
SKU per `client_platform_id` terhadap batch `verified` TERBARU dan menandai SKU yang absen
sebagai `nonaktif`. Alasan: konsisten dengan pola cron yang SUDAH diputuskan untuk job lain
di PDT (`G1-10`), dan tidak butuh perubahan `commitUploadBatch` (yang sudah cukup rumit).
Baca `docs/DECISIONS.md` baris `G1-09-2BII-SKU-STATUS-TRANSISI` untuk detail 3 opsi lengkap.

## 4. Item lama sesi 17/18, TIDAK tersentuh sesi ini (ringkas + rekomendasi arah)

- **`G1-07-PERSKU-PESANAN`** — nol kolom jumlah-pesanan per-SKU terverifikasi di
  `shopee_parent_sku`. Rekomendasi: cek APAKAH ada kolom "Pesanan" (bukan cuma "Penjualan
  (IDR)") di sheet lain `parentskudetail.xlsx` (workbook 7-sheet, baru 1 sheet yang
  dipetakan) sebelum menyerah — kemungkinan ada di sheet "Cek Performa Iklan"/lainnya yang
  belum diperiksa.
- **`G1-07-TIKTOK-REKONSILIASI`** — nol mesin rekonsiliasi shop-level-vs-per-SKU untuk
  TikTok (yang ada baru untuk Shopee). Rekomendasi: tunda sampai ada klien TikTok aktif yang
  butuh rekonsiliasi 2b-i — nilainya rendah tanpa data TikTok nyata untuk diuji.
- **`G1-09-DETEKSI-PREAMBLE-AMBIGU`** — potensi AMBIGUOUS antara `shopee_ads_cpc` dan modul
  lain untuk berkas ber-preamble. Rekomendasi: verifikasi dengan `detectPdtModule` terhadap
  SEMUA sample asli yang sudah terkumpul sesi ini (Fim Motor) sebagai regresi — kalau tidak
  ada yang ambiguous secara nyata, tutup item ini sebagai "terbukti tidak masalah di
  praktik" alih-alih terus dicatat sebagai risiko teoretis.
- **`G1-08-SEBAGIAN`** — pemicu `parse_status='sebagian'` belum terdefinisi (PRD tidak
  merinci). Rekomendasi: TETAP tunda — butuh keputusan bisnis pemilik/PRD, bukan sesuatu
  yang bisa diturunkan dari sample data.
- **`G1-06-PERIODE-TIKTOK`** — nama kolom periode TikTok Shop Analytics belum
  terverifikasi. Rekomendasi: sama seperti diskon/flash-sale — perlu sample asli TikTok
  (belum pernah diunggah), tunda sampai ada.
- **`G1-07-PERSKU-DIBAYAR`** — nama kolom Σ basis "dibayar" `shopee_parent_sku` belum
  terverifikasi. Sama seperti `G1-07-PERSKU-PESANAN` — cek sheet lain workbook yang sama.

## 5. Setup teknis untuk sesi berikutnya

```
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
bash scripts/db-rebuild.sh --yes
```
Password TIDAK persisten antar restart cluster. `npm install` di root DAN
`cd web-internal && npm install` TERPISAH (bukan bagian dari root workspaces).

⚠️ **Jangan jalankan suite penuh `@cdps/domain` dua kali berturut-turut tanpa
`db-rebuild.sh` di antaranya** — `admin.test.ts`/`client.test.ts` menghitung baris
`audit_log` PERSIS dan gagal PALSU di run kedua (bukan regresi, sudah ditemukan berkali-kali
sesi-sesi sebelumnya).

Command verifikasi standar:
```
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm run test -w @cdps/<pkg>
npm run typecheck --workspaces
npm run lint -w @cdps/api -- --max-warnings 0
```

## 6. Rujukan

- `HANDOFF_PDT_SESI19.md`/`SESI20.md` — detail teknis modul KEENAM + bugfix AMS.
- `docs/DECISIONS.md` — SELURUH Decided/Open baris sesi ini (cari `2026-09-14` + kode
  `G1-09-2BII-*` untuk yang relevan).
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.4 (ads_search), §2.6 (live), §2.7 (video — temuan
  definitif), §2.8 (diskon/flash_sale — struktur asli), §2.9 (chat/chat_broadcast), §3.1
  (meta_ads) — semua diperbarui sesi ini.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah, empat paragraf
  baru sesi ini.
- `packages/core/src/pdt/parsestatus.test.ts` — describe block baru (`validasiKolomWajib` ×
  header PERSIS sample asli) sebagai TEMPLATE untuk memverifikasi modul baru/lama lainnya.
- PR #376/#377/#378/#379/#380 (semua merged) — diff kode lengkap.
