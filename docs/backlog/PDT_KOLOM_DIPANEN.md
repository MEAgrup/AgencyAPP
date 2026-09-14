# `kolom_dipanen` per modul — PDT (Pusat Data Toko)

> Disusun sesi 2, 2026-09-13, sebagai Tugas 2 dari `docs/handoff/HANDOFF_PDT_SESI1.md` §4.
> Ini adalah **daftar sumber** untuk `pdt_parser_modul.kolom_dipanen` (PDT-27) — bukan migrasi,
> bukan kode. Format komentar konsumen mengikuti gaya `-- konsumen: report.dim_gmvmax(0.22),
> copilot.D1-D5, sectionB.B-2.3` yang diminta di §4 Tugas 2.
>
> **Tiga bucket**, per keputusan Nerissa §2.3 Q-6 dan §4 Tugas 2:
> 1. **Derived-keep** — sudah ada di PRD §7 **dan** punya konsumen nyata. **Auto**, dipindahkan
>    apa adanya dari §7 (daftar itu sendiri sudah diverifikasi konsumennya saat PRD ditulis).
> 2. **Derived-add** — §7 **melewatkan** kolom ini padahal kode mewajibkannya
>    (`docs/handoff/HANDOFF_PDT_SESI1.md` §3). **27 baris**, **Auto** — sudah disetujui ketokan F-1.
>    Setiap baris dikutip ke `requireCols`/pemanggil kolom yang sebenarnya, dengan nomor baris.
> 3. **Human call** — kolom tanpa konsumen ⇒ dibuang (ketokan Q-6 "Buang sesuai rekomendasi"),
>    kecuali `Kata Pencarian`/`SOV` yang **ditahan** menunggu Anty. **Satu gap dicatat apa
>    adanya**: daftar 11 nama kolom yang direkomendasikan dibuang tidak tertulis di repo mana pun
>    yang bisa ditemukan sesi ini — lihat §3 di bawah. Menebak nama kolomnya melanggar
>    `CLAUDE.md` ("never invent fields") dan PDT_BACKLOG.md §7 butir 1 ("menebaknya = whitelist
>    salah yang memegang data"), jadi baris itu **tidak** ditulis di sini.
>
> Kolom `platform_product_id`/`Seller SKU`/harga satuan/`Product category`/`gmv_dari_kreator`/
> `Sampel terkirim`/`ID Video`/`ID Kreator`/GMV basis **pesanan dibayar** — field Product Exchange
> yang PRD Rule 8 wajibkan meski laporan klien tidak memakainya — sudah masuk bucket 1 di bawah,
> ditandai `[PX]`. Jangan dihapus karena "tidak ada di report".

---

## 1. TikTok

### 1.1 `tt_orders` — `Semua pesanan-*.csv`
Bucket 1 (derived-keep), dari PRD §7.1:

| Kolom | Konsumen |
|---|---|
| `Order ID` | -- konsumen: pdt_fact_sku_period.basis_dibayar (kunci baris) |
| `SKU ID` | -- konsumen: pdt_sku_master.platform_product_id [PX] |
| `Seller SKU` | -- konsumen: pdt_sku_master.seller_sku [PX] |
| `Product Name` | -- konsumen: pdt_sku_master.nama_produk |
| `Variation` | -- konsumen: pdt_sku_master.nama_variasi |
| `Quantity` | -- konsumen: pdt_fact_sku_period.produk_terjual |
| `SKU Unit Original Price` | -- konsumen: pdt_sku_master.harga_satuan_terakhir [PX] — **bukan** input `price_segment` (K-4, kolom itu sendiri diblokir; harga mentahnya tetap boleh disimpan) |
| `SKU Subtotal After Discount` | -- konsumen: pdt_fact_sku_period.gmv basis dibayar [PX] |
| `Order Status` | -- konsumen: filter status pesanan dibayar |
| `Paid Time` | -- konsumen: periode/basis pesanan dibayar (PDT-19) |
| `Product Category` | -- konsumen: pdt_sku_master.kategori_platform [PX] |
| `Creator Handle` | -- konsumen: atribusi kreator, `is_akun_toko` |

Tidak ada baris bucket 2 untuk modul ini — `tt_orders` sudah kanonik sisi rekonsiliasi TikTok
(P-01), dan §7 sudah lengkap terhadap konsumen yang diverifikasi.

### 1.2 `tt_product_analytics` — `product_list_*.xlsx` (176 kolom, header baris 4)
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `ID Produk` | -- konsumen: pdt_fact_sku_period (kunci) [PX] |
| `GMV` | -- konsumen: pdt_fact_sku_period.gmv |
| `GMV dari kreator` | -- konsumen: pdt_fact_sku_period.gmv_dari_kreator [PX] |
| `GMV dari video penjual` / `GMV dari LIVE penjual` | -- konsumen: pdt_fact_sku_period.gmv_video_penjual / gmv_live_penjual |
| `Pesanan SKU` | -- konsumen: pdt_fact_sku_period.pesanan_sku |
| `AOV` | -- konsumen: pdt_fact_sku_period (turunan) |
| `CTR` | -- konsumen: pdt_fact_sku_period.ctr |
| `CTOR` | -- konsumen: pdt_fact_sku_period.ctor |
| `Impresi produk` | -- konsumen: pdt_fact_sku_period.impresi |
| `Status daftar produk` | -- konsumen: pdt_sku_master.status_listing |

Bucket 2 (derived-add — `report/metrik.ts:457`, `adsscanner/tiktok/metrik.ts:58-77`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Nama` | -- konsumen: report.dim_produk(0.12) label sumbu, adsscanner.nama (`adsscanner/tiktok/metrik.ts:67`) | `requireCols` throw di `report/metrik.ts:457` |
| `Klik produk` | -- konsumen: report.dim_produk(0.12) sumbu X kuadran SKU, adsscanner.klik (`:62`) | dimensi Portfolio Produk 0.12 mati; sumbu X kuadran hilang |

### 1.3 `tt_transaction_product` — `Transaction_Analysis_Product_List_*.xlsx`
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `Product ID` | -- konsumen: pdt_sku_master (kunci) [PX] |
| `Product category` | -- konsumen: pdt_sku_master.kategori_platform [PX] |
| `GMV dari kreator` | -- konsumen: sinyal PX ("SKU sudah jalan di afiliasi") [PX] |
| `CTOR` | -- konsumen: pdt_fact_sku_period.ctor |
| `Video` / `Siaran LIVE` | -- konsumen: hitungan konten per SKU |
| `Sampel terkirim` | -- konsumen: pdt_fact_creator_period.sampel_terkirim [PX] |

Tidak ada baris bucket 2 — §7 sudah lengkap untuk modul ini.

### 1.4 `tt_transaction_creator` — `Transaction_Analysis_Creator_List_*.xlsx`
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `Creator name` | -- konsumen: pdt_fact_creator_period (kunci) |
| `GMV dari kreator` | -- konsumen: pdt_fact_creator_period.gmv |
| `AOV` | -- konsumen: pdt_fact_creator_period.aov |
| `CTOR` | -- konsumen: pdt_fact_creator_period.ctor |
| `Pesanan teratribusi` | -- konsumen: pdt_fact_creator_period.pesanan_teratribusi |
| `Tayangan video` | -- konsumen: copilot A1/A2 |

Bucket 2 (derived-add — `report/metrik.ts:540-545` `affiliateReport`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Video` | -- konsumen: pdt_fact_creator_period.jumlah_video, copilot A1/A2 | jumlah LIVE/video kreator tak terhitung |
| `Siaran LIVE` | -- konsumen: pdt_fact_creator_period.jumlah_live, copilot A1/A2 | idem |
| `Perkiraan komisi` | -- konsumen: copilot A1/A2, **PX Flow D `commission_pct`** (celah PX #1, §4 di bawah) | `commission_pct` PX kehilangan satu-satunya sumber TikTok |

### 1.5 `tt_video` — `Video Performance List_*.xlsx` (header baris 3)
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `ID Kreator` | -- konsumen: pdt_fact_content.creator_platform_id [PX] |
| `ID Video` | -- konsumen: pdt_fact_content.platform_content_id [PX] — menutup GMV Impact organik (PRD §6.2) |
| `Waktu` | -- konsumen: pdt_fact_content.waktu_posting |
| `Produk` | -- konsumen: pdt_fact_content.sku_id |
| `VV` | -- konsumen: pdt_fact_content.vv, report.dim_video(0.18) |
| `Likes` | -- konsumen: pdt_fact_content.likes |
| `Dibagikan` | -- konsumen: pdt_fact_content.dibagikan |
| `Klik Produk` | -- konsumen: pdt_fact_content.klik_produk |
| `Nama Kreator` | -- konsumen: label tampilan (fallback bila `ID Kreator` kosong) |

Bucket 2 (derived-add — `report/metrik.ts:361` `videoRows`, dimensi Video 0.18):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Informasi Video` | -- konsumen: report.dim_video(0.18) — caption/judul video (Rule O71: caption kosong ≠ video dibuang, `ID Video` tetap identitas) | `requireCols` throw di `:361` |
| `GPM (Rp)` | -- konsumen: report.dim_video(0.18) — "Avg GPM" per video | idem |
| `GMV dari video (Rp)` | -- konsumen: report.dim_video(0.18), pdt_fact_content.gmv | idem — dimensi 0.18 mati |

### 1.6 `tt_live` — `Live Analysis*.xlsx` (header baris 3)
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `ID Kreator` | -- konsumen: pdt_fact_content.creator_platform_id [PX] |
| `Waktu Live` | -- konsumen: pdt_fact_content.waktu_posting |
| `Durasi` | -- konsumen: pdt_fact_content.durasi_detik |
| `GMV dari LIVE (Rp)` | -- konsumen: pdt_fact_content.gmv, report.dim_live(0.22) |
| `Produk Terjual` | -- konsumen: pdt_fact_content (turunan) |

Bucket 2 (derived-add — `report/metrik.ts:299-311` `liveReport`, `baseline/metrik.ts:186-189` `live()`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Penonton` | -- konsumen: report.dim_live(0.22), copilot L3 | rata-rata penonton per sesi tidak terhitung |
| `CTOR` | -- konsumen: copilot L3 (`baseline/metrik.ts:188` `ctorMed`) | median CTOR LIVE hilang |
| `Kreator` (alias: `Nama panggilan`) | -- konsumen: `is_akun_toko` — pemisah toko-vs-afiliasi | sesi LIVE tak bisa dipisah toko vs kreator afiliasi |

### 1.7 `tt_shop_analytics` — `Shop Analytics_Key metrics_*.xlsx`
⚠️ P-01 terbuka (§6 handoff) — belum boleh jadi satu-satunya sisi rekonsiliasi; `tt_orders` kanonik.

Bucket 1:

| Kolom | Konsumen |
|---|---|
| `GMV` | -- konsumen: pdt_fact_shop_daily.gmv, sisi rekonsiliasi |
| `Pesanan` | -- konsumen: pdt_fact_shop_daily.pesanan |
| `Pembeli` | -- konsumen: pdt_fact_shop_daily.pembeli |
| `Pesanan SKU` | -- konsumen: pdt_fact_shop_daily (turunan) |
| `Pengunjung` | -- konsumen: pdt_fact_shop_daily.pengunjung |
| `Persentase konversi` | -- konsumen: pdt_fact_shop_daily.cr |
| `Pendapatan bruto` | -- konsumen: sisi rekonsiliasi Tokopedia (P-01, `baseline/detect.ts:26-27`) |

Bucket 2 (derived-add — `baseline/metrik.ts:55,63-72` `toko()`, dipakai ulang verbatim oleh report engine):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Pengembalian dana` | -- konsumen: `gmvNet` (standar GMV MEA = GMV − refund), report B-2.3 | `requireCols` throw di `baseline/metrik.ts:55`; `gmvNet` tidak bisa dihitung |
| `GMV dari LIVE kreator` | -- konsumen: kanal.live_kreator, dim kartu/live-split B-2.3 | idem (kolom wajib yang sama) |
| `GMV dari LIVE akun tertaut` (alias: `GMV LIVE penjual` / `GMV tidak langsung dari LIVE penjual`) | -- konsumen: kanal.live_toko (`report/metrik.ts:111-112`) | channel-mix GMV live toko-vs-afiliasi jatuh ke `null` |
| `GMV dari video afiliasi` | -- konsumen: kanal.video_kreator | channel-mix video jatuh ke `null` |
| `GMV dari video akun tertaut` | -- konsumen: kanal.video_toko, `kartu` (residual = GMV − live − video, `report/metrik.ts:113`) | `kartu` (Kartu Produk/Shop Tab) tidak terhitung — dimensi 0.14 kehilangan input |

### 1.8 `tt_ads_product` — `creative data for product campaigns *.xlsx`
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `ID Campaign` | -- konsumen: pdt_fact_ads.kampanye_id |
| `ID produk` | -- konsumen: pdt_fact_ads.sku_id |
| `ID video` | -- konsumen: pdt_fact_ads.content_id |
| `Akun TikTok` | -- konsumen: label kreatif |
| `Biaya` | -- konsumen: pdt_fact_ads.biaya, report.dim_gmvmax(0.22) |
| `Pesanan SKU` | -- konsumen: pdt_fact_ads.pesanan_sku |
| `Biaya per pesanan` | -- konsumen: pdt_fact_ads (turunan CPA) |

Bucket 2 (derived-add — `report/metrik.ts:150,171` `adsReport`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Pendapatan kotor` | -- konsumen: pdt_fact_ads.gmv/roas, report.dim_gmvmax(0.22) — sisi pendapatan ROAS | `requireCols` throw di `:150`; dimensi 0.22 mati — persis bug §1 PRD |

### 1.9 `tt_ads_live` — `livestream data for live campaigns *.xlsx`
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `Nama LIVE` | -- konsumen: pdt_fact_ads label |
| `ID Campaign` | -- konsumen: pdt_fact_ads.kampanye_id |
| `Biaya` | -- konsumen: pdt_fact_ads.biaya, report.dim_gmvmax(0.22) |
| `Pesanan SKU` | -- konsumen: pdt_fact_ads.pesanan_sku |
| `ROI` | -- konsumen: pdt_fact_ads.roas (turunan) |

Bucket 2 (derived-add — `report/metrik.ts:151,191` `adsReport`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Pendapatan kotor` | -- konsumen: pdt_fact_ads.gmv/roas, report.dim_gmvmax(0.22) | `requireCols` throw di `:151`; dimensi 0.22 mati |

---

## 2. Shopee

### 2.1 `shopee_shop_stats` — `*.shopee-shop-stats.*.xlsx` (12 sheet)
Bucket 1 — 3 basis (`Pesanan Dibuat`/`Pesanan Siap Dikirim`/`Pesanan Dibayar`) × 14 metrik + asal
kunjungan + asal penjualan, semua ⇒ `pdt_fact_shop_daily` per basis (Rule 15). Tidak ada baris
bucket 2 — §7 sudah menandainya "3 basis × 14 metrik" secara utuh.

### 2.2 `shopee_parent_sku` — `parentskudetail.*.xlsx` (7 sheet, 40 kolom, 1.504 baris sample)
Bucket 1:

| Kolom | Konsumen |
|---|---|
| `Kode Produk` | -- konsumen: pdt_sku_master.platform_product_id [PX] |
| `Kode Variasi` | -- konsumen: pdt_sku_master.platform_variation_id [PX] |
| `SKU Induk` | -- konsumen: pdt_sku_master (grouping varian→induk) |
| `Total Penjualan (Pesanan Dibuat) (IDR)` / `Penjualan (Pesanan Siap Dikirim) (IDR)` | -- konsumen: pdt_fact_sku_period.gmv per basis (Rule 15/16) |
| `Jumlah Produk Dilihat` | -- konsumen: pdt_fact_sku_period (turunan CTR) |
| `Produk Diklik` | -- konsumen: pdt_fact_sku_period.klik |
| `Tingkat Konversi (Pesanan yang Dibuat)` | -- konsumen: pdt_fact_sku_period.cr |
| repeat order | -- konsumen: dim conversion_retention(0.18) |

Bucket 2 (derived-add — `report/shopee/metrik.ts:250` `pengunjung_produk`, sumbu X kuadran Shopee):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Pengunjung Produk (Kunjungan)` (alias: `pengunjung produk`) | -- konsumen: dim product_performance(0.14), sumbu X 4-kuadran Shopee (`report/shopee/metrik.ts:747-749` `computeQuadrants`) | sumbu traffic kuadran kolaps → dimensi 0.14 tak bisa dihitung |

### 2.3 `shopee_ads_cpc` — `Data+Keseluruhan+Iklan+Shopee-*.csv` (header baris 8)
> **Dikoreksi sesi 19 (docs/DECISIONS.md 2026-09-14 modul KEENAM) terhadap sample EKSPOR ASLI
> (Fim Motor)** — dua koreksi terhadap versi sebelumnya di sini, keduanya TEBAKAN yang TIDAK
> PERNAH cocok berkas nyata: (1) `ID Toko`/`Periode` adalah PREAMBLE (baris 1-6, Rule 2),
> **BUKAN** kolom baris header — dipindah dari bucket 1 di bawah (dulu ditulis seolah kolom
> header, sempat membuat `kolomDipanen`/`pdt_parser_modul` SALAH selama G1-02 s.d. sesi 18: baris
> header manapun tidak akan pernah punya sel bernama "ID Toko"/"Periode" secara harfiah). (2)
> Kolom ACOS **bukan** "mis." lagi — ejaan PERSIS sample asli: `Persentase Biaya Iklan terhadap
> Penjualan dari Iklan (ACOS)`. **Grain baris TERBUKTI per IKLAN** (bukan per produk) — baris
> "Shop GMV Max" di sample asli TIDAK punya `Kode Produk` sama sekali (iklan toko, bukan iklan
> produk) tapi tetap baris data sah; `kampanye_id` (`pdt_fact_ads`) karena itu memakai `nama
> iklan`, bukan `Kode Produk` (lihat `packages/core/src/pdt/fakta.ts` docblock kepala berkas untuk
> rincian). `Kode Produk` **TIDAK** dipakai sebagai `pdt_fact_ads.sku_id` (dikoreksi dari baris di
> bawah) — ia level PRODUK INDUK, `pdt_sku_master` berkunci PER VARIAN, jadi lookup langsung akan
> mengarang varian; `sku_id` modul ini tetap `null` (Open `G1-09-2BII-ADS-CPC-SKU`).

Preamble (Rule 2, DIVALIDASI terpisah dari kolom baris header — lihat `ekstrakPreambleShopee`,
bukan bagian `kolomDipanen`):

| Kolom | Konsumen |
|---|---|
| `ID Toko` | -- konsumen: identitas toko (Rule 2) |
| `Periode` | -- konsumen: periode batch (Rule 5) |

Bucket 1 (kolom baris header sesungguhnya):

| Kolom | Konsumen |
|---|---|
| `nama iklan` | -- konsumen: pdt_fact_ads.kampanye_id (KUNCI baris — bukan Kode Produk, lihat catatan di atas) |
| `Kode Produk` | -- konsumen: identitas produk untuk konsumen LAIN (bukan `sku_id`, lihat catatan di atas — bisa `'-'` untuk iklan toko) |
| `Dilihat` | -- konsumen: pdt_fact_ads.tayangan |
| `Jumlah Klik` | -- konsumen: pdt_fact_ads.klik |
| `Konversi` | -- konsumen: pdt_fact_ads.pesanan_sku |
| `Biaya` | -- konsumen: pdt_fact_ads.biaya, dim roas_channel(0.22) |
| `omzet penjualan` | -- konsumen: pdt_fact_ads.gmv, dim roas_channel(0.22) |
| `Efektifitas Iklan` | -- konsumen: pdt_fact_ads.roas, dim roas_channel(0.22) (`metrik.ts:464`) |

Bucket 2 (derived-add — `report/shopee/metrik.ts:460-477` `ads_toko`/`ads_produk`/`ads_banner`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)` | -- konsumen: `HealthAds.acos`, B-4.3 (`metrik.ts:465-466`) — TIDAK ada kolom skema `pdt_fact_ads` untuknya, konsumennya domain LAIN | ACOS toko tak terhitung |

### 2.4 `shopee_ads_search` — `Search-Ads-Overall-Data-*.csv` (header baris 8)
Bucket 1: `Jumlah Klik`, `Konversi` ⇒ `pdt_fact_ads`. **Ejaan DIKOREKSI sesi lanjutan pasca-sesi
20 (docs/DECISIONS.md 2026-09-14)** terhadap sample EKSPOR ASLI Fim Motor — ejaan huruf kecil
sebelumnya (`klik`/`konversi`) tidak pernah diverifikasi dan tidak pernah cocok berkas nyata.

**Temuan baru sesi ini (belum diimplementasikan, belum jadi keputusan whitelist):** sample asli
JUGA membuktikan kolom `Nama Iklan` (identitas kampanye) dan `Biaya` (`pdt_fact_ads.biaya` NOT
NULL) SUNGGUH ADA di berkas ini — premis `G1-09-2BII-ADS-SEARCH` ("nol kolom biaya/identitas")
sudah usang. Menambah keduanya ke `kolomDipanen` (memungkinkan modul ini akhirnya menulis
`pdt_fact_ads`, pola sama `shopee_ads_cpc`) BELUM dilakukan — itu keputusan desain whitelist baru
(sama kelas Q-6), bukan koreksi ejaan, sengaja tidak ditebak sesi ini.

Bucket 3 (human call — **ditahan**, bukan dibuang, ketokan Q-6): `Kata Pencarian`, `SOV`. Riset
keyword belum punya konsumen yang dibangun; menunggu Anty menjawab apakah dibangun atau memang
dibuang secara permanen (§6 handoff, baris ketiga).

### 2.5 `shopee_ads_live` — `Data-Semua-Iklan-Live-*.csv` (header baris 7)
Bucket 1: `ID Iklan`, `Penonton`, `Pesanan`, `Omzet`, `Biaya`, `Efektifitas Iklan` ⇒ `pdt_fact_ads`.
Tidak ada baris bucket 2.

### 2.6 `shopee_live` — `live_streaming_*.xlsx` (3 sheet, sheet "Daftar Streaming")
Bucket 1: `Informasi Streaming`, `Waktu Mulai`, `Pengunjung`, `Penjualan (Pesanan Siap Dikirim)(Rp)`
⇒ `pdt_fact_content` jenis `live`. **Ejaan kolom terakhir DIKOREKSI sesi lanjutan pasca-sesi 20**
terhadap sample asli Fim Motor (`'Penjualan'` polos tidak pernah cocok). Tidak ada baris bucket 2.
Blocker identitas `G1-09-2BII-SHOPEELIVE` (tidak ada kolom ID sesi live yang stabil di sample yang
sama) TETAP terbuka — koreksi ini tidak menyentuhnya.

### 2.7 `shopee_video` — `video-overview-v3*.csv` (header 2 lapis, 54 kolom)
Bucket 1: transaksi, kunjungan, sumber penonton, konversi (11 dari 54 kolom) ⇒ `pdt_fact_content`.
Tidak ada baris bucket 2 — §7 menandai modul ini sudah lengkap terhadap konsumen yang
diverifikasi; 43 kolom sisanya sengaja tidak dipanen (Example §5).

### 2.8 `shopee_voucher` / `shopee_diskon` / `shopee_flash_sale`
`shopee_voucher` bucket 1: penjualan 2 basis, klaim, tingkat penggunaan, biaya promo ⇒ dimensi
promo + biaya promo (`modules.ts` — SUDAH cocok persis sample asli `voucher_*.xlsx`). Tidak ada
baris bucket 2.

> **`shopee_diskon`/`shopee_flash_sale` MASIH `UNVERIFIED_SIGNATURE` (kode tidak diubah sesi ini)
> — TAPI struktur header asli sudah terbaca sesi lanjutan pasca-sesi 20** (Fim Motor
> `discount_20260701-20260731.xlsx` sheet "Kriteria Utama"/"Rincian Performa" dan
> `In_Shop_Flash_Sale_Metrics_*.xlsx` sheet "Kriteria Utama"). Deskripsi prosa di atas ("penjualan
> 2 basis, klaim, tingkat penggunaan, biaya promo" — disamakan dengan `shopee_voucher`) TERNYATA
> **TIDAK COCOK** untuk `shopee_diskon`: sample asli TIDAK PUNYA kolom `Klaim`/`Tingkat
> Penggunaan`/`Total Biaya` sama sekali — strukturnya justru jauh lebih kaya (26 kolom: `Tanggal`,
> `Tipe Promosi` [nilai: "Semua"/"Diskon"/"Paket Diskon"/"Kombo Hemat"], penjualan 2 basis, produk
> terjual 2 basis, pembeli 2 basis, PLUS rincian "Paket Diskon"/"Kombo Hemat" — produk utama vs
> produk tambahan). Anchor pembeda YANG TERVERIFIKASI: `Tanggal`+`Tipe Promosi` (tidak dimiliki
> `shopee_voucher`, yang ber-`Periode Waktu`+`Klaim`).
>
> `shopee_flash_sale` (`In_Shop_Flash_Sale_Metrics_*.xlsx`) LEBIH dekat ke struktur `shopee_voucher`
> (sama-sama `Periode Waktu`) TAPI juga TIDAK punya `Klaim`/`Total Biaya` — kolom uniknya `Jumlah
> Produk Dilihat`/`Produk Diklik`/`Persentase Klik` (funnel tampilan, bukan promo cost). Anchor
> pembeda yang terverifikasi: `Periode Waktu`+`Jumlah Produk Dilihat` (tidak dimiliki
> `shopee_voucher`/`shopee_diskon`).
>
> **Kenapa TIDAK langsung dikodekan sesi ini**: sinyal deteksi (`tandaTanganKolom`) BISA ditulis
> dari temuan di atas, tapi `kolomDipanen` (kolom mana yang genuinely mau dipanen dari struktur
> yang TERNYATA beda dari asumsi PRD) adalah keputusan desain baru — kelas sama Q-6 — bukan
> koreksi ejaan. Menyalakan deteksi TANPA `kolomDipanen` yang diputuskan berarti modul akan
> `parse_status='ok'` vakum (nol kolom divalidasi, nol data dipanen) tanpa AM pernah tahu —
> lebih berbahaya daripada tetap `UNVERIFIED_SIGNATURE`. Dicatat sebagai Open baru
> `docs/DECISIONS.md` untuk Anty/Hans: kolom mana dari struktur asli di atas yang mau dipanen.

### 2.9 `shopee_chat` / `shopee_chat_broadcast`
> **`kolomDipanen` DIKOREKSI sesi lanjutan pasca-sesi 20 (docs/DECISIONS.md 2026-09-14)** terhadap
> sample EKSPOR ASLI (Fim Motor, `chat_*.xlsx` + `Chat_Broadcast_overview_*.xlsx`). `shopee_chat`:
> `'Persentase Chat Dibalas'` DIHAPUS — sample tidak punya kolom itu sama sekali (bukan salah eja).
> `shopee_chat_broadcast`: SELURUH whitelist huruf kecil (`penerima`/`dibaca`/`diklik`/`pesanan`,
> "TEBAKAN KONVENSI" per catatan lama) dikoreksi ke ejaan Title Case PERSIS sample asli — modul ini
> SELALU `parse_status='gagal'` sejak G1-02 (belum punya writer, jadi belum pernah terlihat di
> produksi, beda dari `shopee_ams_afiliasi` yang sudah SEMPAT rusak diam-diam di produksi).

Bucket 1: `Periode Waktu`, `Pengunjung`, `Jumlah Chat`, `Chat Dibalas`, `Waktu Respon Rata-rata`,
`CSAT %`, `Total Pesanan`, `Penjualan (IDR)`, `Tingkat Konversi (Chat Dibalas)` (`shopee_chat`);
`Total Penerima`, `Penerima yang Membaca`, `Penerima yang Mengklik`, `Pesanan`
(`shopee_chat_broadcast`) ⇒ dimensi layanan / CRM. Tidak ada baris bucket 2.

### 2.10 `shopee_ams_produk` / `shopee_ams_afiliasi`
> **Ejaan kolom DIKOREKSI sesi 20 (docs/DECISIONS.md 2026-09-14) terhadap sample EKSPOR ASLI**
> (Fim Motor, `ProductPerformance_*.csv` + `AMSAffiliatePerformance_*.csv`) — ejaan sebelumnya di
> sini ('Nama Produk' untuk `shopee_ams_produk`; 'Username'/'Omzet'/'Komisi' polos untuk
> keduanya) TIDAK PERNAH cocok berkas nyata: header sungguhan ber-`Nama Item` (bukan `Nama
> Produk` — deteksi `shopee_ams_produk` GAGAL TOTAL, bukan cuma kolomDipanen), `Username
> Affiliate` (bukan `Username` polos), `Omzet Penjualan(Rp)` (bukan `Omzet` polos), `Estimasi
> Komisi(Rp)` (bukan `Komisi` polos). Tabel di bawah sudah ejaan yang BENAR.

Bucket 1: `Kode Item` (`shopee_ams_produk`) / `ID Affiliates`+`Username Affiliate`
(`shopee_ams_afiliasi`), `Omzet Penjualan(Rp)`, **`Estimasi Komisi(Rp)`**, `ROI` ⇒ sinyal PX sisi
Shopee / `pdt_fact_creator_period` Shopee (afiliasi saja — `shopee_ams_produk` grain PER PRODUK,
lihat catatan `fakta.ts` kenapa saudaranya TIDAK dipetakan ke tabel per-kreator ini). `Estimasi
Komisi(Rp)` di sini adalah sumber **`commission_pct`** Shopee untuk PX Flow D (celah PX #1, §4) —
sudah bucket 1, bukan tambahan baru. Tidak ada baris bucket 2.

### 2.11 `shopee_kesehatan` — **MODUL BARU, tidak ada di §7 sama sekali**
Bucket 2 (derived-add — modul penuh, `report/shopee/metrik.ts:516-540` `parseKesehatan`,
`report/shopee/detect.ts:217`, deteksi konten `anyRowHas(aoa, 'poin pinalti'/'poin penalti')`):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Poin Penalti` | -- konsumen: dim kesehatan_toko(0.12), Section B-4.3 poin penalti (`skor.ts:104-111`) | dimensi kesehatan_toko permanen netral 5/10 |
| `Deskripsi` | -- konsumen: dim kesehatan_toko catatan, insight §"Pulihkan kesehatan toko" (`insight.ts:96-104`) | rekomendasi tidak bisa menyebut pelanggaran apa |
| `Durasi` | -- konsumen: insight timeline penalti (`insight.ts:104`: `"Segera — penalti berlaku ${p0?.durasi}"`) | AM tidak tahu sampai kapan penalti berlaku |

Header sheet-nya sendiri hanya tiga kolom ini (`Poin Penalti`, `Deskripsi`, `Durasi`) — bukan
kasus "27 kolom dari sekian ratus", modulnya sendiri yang absen dari §7.

---

## 3. Lintas platform

### 3.1 `meta_ads` — `Laporan-tanpa-judul-Jul-*.xlsx` (sheet "Raw Data Report")
> **Ejaan kolom DIKOREKSI sesi lanjutan pasca-sesi 20 (docs/DECISIONS.md 2026-09-14)** terhadap
> sample EKSPOR ASLI Fim Motor — 6 dari 11 kolom lama hilang sufiks panjang khas Meta Ads Manager
> yang sel asli sungguh punya (mis. `'Jumlah yang dibelanjakan'` → `'Jumlah yang dibelanjakan
> (IDR)'`, `'ROAS'` → `'ROAS pembelian khusus untuk item bersama'`). Set kolom TIDAK berubah
> secara konsep, cuma ejaannya dikoreksi.

Bucket 1: `Nama kampanye`, `Nama iklan`, `Jumlah yang dibelanjakan (IDR)`, `Nilai Konversi
Pembelian Khusus untuk Item Bersama`, `ROAS pembelian khusus untuk item bersama`, `Impresi`, `Klik
tautan`, `CTR Unik (rasio klik tayang tautan)`, `CPM (Biaya Per 1.000 Tayangan)`, `CPC (biaya per
klik tautan)` ⇒ modul opsional (PDT-22), tidak masuk rekonsiliasi.

Bucket 2 (derived-add):

| Kolom | Konsumen | Dampak bila hilang |
|---|---|---|
| `Minggu` | -- konsumen: kunci baris pemisah ringkasan vs mingguan | baris ringkasan dan baris mingguan tidak bisa dibedakan saat parse |

---

## 4. Dua konsumen tambahan yang PDT-27 tidak hitung

PDT-27 (§6.2 PRD) menyebut **lima** konsumen. Dua lagi membaca export yang **sama** — modulnya
sudah masuk bucket di atas, jadi ini bukan kolom baru, hanya konsumen tambahan yang wajib dicatat
di komentar migrasi supaya kolomnya tidak dianggap yatim saat modul konsumen aslinya (report/PX)
tidak ada:

- **Ads Scanner** (`packages/core/src/adsscanner/tiktok/metrik.ts:58-170`) — membaca
  `tt_product_analytics` (`ID Produk`, `GMV`, `Impresi produk`, `Klik produk`, `Pesanan SKU`,
  `Nama`, `Status daftar produk`, `GMV dari kreator`, `GMV dari video penjual`, `GMV dari LIVE
  penjual`, `CTR`, `Persentase tambahkan ke keranjang`), `tt_ads_product` (`ID produk`, `Biaya`,
  `Pendapatan kotor`, `Pesanan SKU`, `Nama kampanye`), dan `tt_video` (`Produk`, `VV`, `Nama
  Kreator`, `ID Video`, `Informasi Video`, `Waktu`, `Persentase Video yang Ditonton Hingga
  Selesai`).
- **SKU Screener** (`packages/core/src/skuscreener/parse.ts:165-173`) — membaca `shopee_parent_sku`
  lewat ejaan kolomnya sendiri; lihat alias §5 di bawah.

## 5. Alias SKU Screener → `shopee_parent_sku`

Ejaan kolom yang dibaca `readPerformaProduk` (`skuscreener/parse.ts:165-173`) bukan nama kanonik
terpisah — masuk `pdt_kolom_alias` sebagai alias dari `shopee_parent_sku`:

| Alias (SKU Screener) | Kanonik `shopee_parent_sku` |
|---|---|
| `Total Penjualan` | `Total Penjualan (Pesanan Dibuat) (IDR)` |
| `Jumlah Produk Dilihat` | `Jumlah Produk Dilihat` |
| `Persentase Klik` | CTR (nama kolom persis di export 40-kolom **belum terverifikasi** — sample asli tidak ada di repo, sama seperti catatan A-3 §2.4 handoff; jangan ditutup sampai sample datang) |
| `Tingkat Konversi Pesanan` | `Tingkat Konversi (Pesanan yang Dibuat)` |
| `Kode Produk` | `Kode Produk` (sudah kanonik, bukan alias) |
| `Kode Variasi` | `Kode Variasi` (sudah kanonik, bukan alias) |
| `Produk` | `Produk` (sudah kanonik, bukan alias) |
| `Pesanan Dibuat` | `Pesanan Dibuat` (sudah kanonik, bukan alias) |

## 6. Dua celah Product Exchange yang tidak punya sumber (§3 handoff)

1. **`commission_pct`** — **tertutup**. Sumbernya `Perkiraan komisi` (TikTok, §1.4 bucket 2) dan
   `komisi` (AMS Shopee, §2.10 bucket 1). Kedua kolom sudah masuk daftar ini.
2. **`stock_status`** — **TIDAK tertutup**. Tidak ada satu kolom export pun (TikTok maupun
   Shopee) yang memasoknya, padahal `requireStockIn: true` sudah ada di policy PX ter-seed
   (`px_eligibility_policy`). Ini **bukan** kolom yang bisa ditambahkan ke whitelist — sumbernya
   memang tidak ada di export platform manapun yang sample-nya diverifikasi. Diangkat di sini
   supaya tidak "ditemukan belakangan" saat G5 dibuka; jawabannya kemungkinan besar butuh sumber
   di luar PDT (mis. Seller Center API terpisah, atau input manual AM) — **bukan** keputusan yang
   diambil sesi ini.

---

## 7. Bucket 3 — kolom tanpa konsumen (Q-6 "buang sesuai rekomendasi")

**Status: tidak lengkap, dicatat apa adanya.** §2.3 Q-6 handoff menyebut *"11 kolom tanpa konsumen
dibuang"* sebagai ketokan yang sudah diputuskan Nerissa. Sesi ini mencari rekomendasi asli
(11 nama kolom) di seluruh `docs/` dan tidak menemukannya — bukan di PRD, bukan di
`PDT_BACKLOG.md`, bukan di handoff manapun. Yang tertulis eksplisit hanya **dua** kolom yang
**ditahan** (bukan dibuang): `Kata Pencarian` dan `SOV` (§2.4 di atas).

Menulis 11 nama kolom di sini tanpa sumber berarti **menebak isi whitelist yang akan memegang
data** — persis yang `PDT_BACKLOG.md` §7 butir 1 dan `CLAUDE.md` ("never invent fields") larang.
**Baris ini dibiarkan kosong dengan sengaja.** Yang perlu terjadi sebelum G1-02: rekomendasi asli
(dari Hans/Anty, yang sudah disetujui Nerissa sebagai "sesuai rekomendasi") ditempelkan di sini
apa adanya, bukan direkonstruksi.
