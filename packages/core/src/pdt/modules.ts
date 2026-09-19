/**
 * PDT (Pusat Data Toko) — registry modul parser, G1-02.
 *
 * Cermin `pdt_parser_modul` (migrasi
 * `supabase/migrations/20261012010000_g1_02_seed_pdt_parser_modul.sql`) —
 * pola yang sama dengan `../adsscanner/tiktok/bench.ts` mencerminkan
 * `adsscanner_benchmark`: satu sumber TS yang dites, migrasi menyalin
 * nilainya literal. Menyatukan EMPAT registry lama:
 *  - `../baseline/detect.ts` (12 tipe Seller Center TikTok)
 *  - `../report/detect.ts` (4 tipe TikTok Ads Manager — TIDAK dipakai di sini;
 *    PDT §7 tidak mendaftarkan modul Ads Manager terpisah, lihat catatan di
 *    bawah)
 *  - `../report/shopee/detect.ts` (17 tanda tangan Shopee)
 *  - `../adsscanner/tiktok/detect.ts` (4 tanda tangan Ads Scanner)
 * plus tiga modul baru yang PRD §7 sebut belum py registry (`shopee_video`
 * header 2 lapis, `shopee_chat_broadcast`, `meta_ads`).
 *
 * Sumber kolom per modul, per prioritas (dicatat per baris di bawah):
 *  1. `docs/backlog/PDT_KOLOM_DIPANEN.md` — whitelist `kolom_dipanen` MENGIKAT
 *     (menang atas literal §7 PRD bila berbeda, sesuai preambulnya sendiri).
 *  2. `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §7 — nama modul, berkas sample,
 *     baris header (Rule 7), dan literal Title-Case yang PDT_KOLOM_DIPANEN
 *     tidak sebutkan.
 *  3. Registry lama (`detect.ts` yang disebut di atas) dan fixture teruji di
 *     `report/shopee/shopee.test.ts` — dipakai HANYA untuk `tandaTanganKolom`
 *     (deteksi), tidak pernah untuk mengarang `kolomDipanen` (whitelist
 *     panen) yang tidak disebut PDT_KOLOM_DIPANEN/PRD.
 *
 * ⛔ JANGAN ubah string nama kolom pada `tandaTanganKolom` — itu (bersama
 * pemindaian isi, bukan nama berkas — Rule 6) satu-satunya cara berkas
 * dikenali.
 *
 * Modul dengan sinyal isi BELUM terverifikasi (dicatat `docs/DECISIONS.md`
 * 2026-09-13 G1-02, bukan ditebak):
 *  - ~~`shopee_diskon` / `shopee_flash_sale`~~ — **TIDAK LAGI berlaku sejak
 *    2026-09-19 (G4-03 aksi 4).** Catatan lama ("hanya terselesaikan lewat NAMA
 *    BERKAS MENTAH `discount_`/`flash_sale`, Rule 6 PDT larang") benar pada
 *    sample TUNGGAL Fim Motor; ia gugur pada korpus 6 klien nyata:
 *    `shopee_diskon` menang tunggal lewat (`Tanggal` + `Tipe Promosi`) dan
 *    `shopee_flash_sale` lewat (`Periode Waktu` + `Jumlah Produk Dilihat`),
 *    NOL ambiguitas di 6 dari 6 berkas, nol andalan nama berkas. Header
 *    aslinya terekam `header-nyata.fixture.ts`; keduanya sudah punya tanda
 *    tangan isi sungguhan di bawah (sejak sesi 23) dan kini punya writer fakta
 *    (`pdt_fact_promo`).
 *  - `shopee_video` — PDT_KOLOM_DIPANEN §2.7 dan PRD §7.2 sama-sama menulis
 *    "11 dari 54 kolom" secara ABSTRAK; tak satu pun dari 54 nama kolom
 *    tertulis literal di dokumen atau kode manapun di repo ini (fixture
 *    `bisnisVideoAoa` di `report/shopee/shopee.test.ts` memodelkan berkas
 *    LAIN — ekspor "[bisnis]-Video" konvensi tim yang lebih sederhana, bukan
 *    `video-overview-v3` mentah 54-kolom 2-lapis header).
 * `shopee_video` memakai `UNVERIFIED_SIGNATURE` — lihat `types.ts`. Baris seed-nya
 * tetap ada (DoD G1-02: "setiap modul di PRD §7 punya baris"), tapi
 * deteksinya sengaja TIDAK PERNAH menang secara otomatis — AM memilih modul
 * lewat dropdown (Rule G1-09) sampai sample asli membuka pembedanya.
 */
import type { PdtKolomAliasDef, PdtModuleDef, PdtSignature } from './types';

/**
 * Sentinel: sebuah `must` yang mustahil cocok ke isi berkas nyata mana pun.
 * Dipakai HANYA untuk dua modul di atas — lihat komentar file.
 */
export const UNVERIFIED_SIGNATURE: PdtSignature = {
  must: ['__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__'],
};

export const PDT_MODULES: readonly PdtModuleDef[] = [
  // ===========================================================================
  // TikTok (PRD §7.1 / PDT_KOLOM_DIPANEN §1) — 9 modul
  // ===========================================================================
  {
    kode: 'tt_orders',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Semua Pesanan',
    // PDT_KOLOM_DIPANEN §1.1 — tak ada registry lama untuk berkas ini (P-01
    // rekonsiliasi belum dipindah dari alat lama); kombinasi 4 kolom identitas
    // pesanan yang tak dipakai modul TikTok lain mana pun.
    tandaTanganKolom: { must: ['Order ID', 'SKU ID', 'Order Status', 'Paid Time'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity',
      'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Status', 'Paid Time',
      'Product Category', 'Creator Handle',
    ],
    wajib: true,
  },
  {
    kode: 'tt_product_analytics',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Analitik Produk',
    // Sama persis `baseline/detect.ts` TYPES.prod_tt.
    tandaTanganKolom: { must: ['ID Produk', 'GMV dari kreator', 'Klik produk'] },
    barisHeaderHint: 4, // Rule 7: "product_list baris 4"
    // `'AOV'`/`'CTOR'` DIKOREKSI → `'AOV (pesanan SKU)'`/`'CTOR (pesanan SKU)'` (sesi 43).
    // Kedua ejaan lama TIDAK PERNAH cocok ke berkas nyata mana pun — diverifikasi ke ENAM
    // ekspor: kelima klien ZIP "Sample tiktok 5 client" DAN sample asli Avitaskin
    // (`product_list_20260701.xlsx`) yang dipakai sesi 33, semuanya menulis sufiks
    // `(pesanan SKU)`. `CTR` polos MEMANG ada (kolom terpisah, tetap kanonik).
    // Ini bug PALING mahal dari lima yang ditemukan sesi 43: `wajib: true`, jadi
    // `tt_product_analytics` selalu `gagal` ⇒ dikeluarkan dari `terparse` ⇒ pasangan
    // rekonsiliasi TikTok (Rule 13-14) tidak pernah lengkap ⇒ **nol batch TikTok yang
    // pernah bisa mencapai `verified`**, sejak modul ini dibangun. Sesi 33 menghitung
    // paritas Σper-SKU vs shop-level LANGSUNG dari berkas (bukan lewat pipeline), jadi
    // bug ini lolos dari verifikasi itu. Ejaan lama tetap hidup sebagai alias Rule 9.
    kolomDipanen: [
      'ID Produk', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual',
      'Pesanan SKU', 'AOV (pesanan SKU)', 'CTR', 'CTOR (pesanan SKU)', 'Impresi produk',
      'Status daftar produk', 'Nama', 'Klik produk',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.2 — dibutuhkan report.dim_produk(0.12)/
    // adsscanner, bukan gerbang PDT sendiri (Rule 13-16/PX). Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Nama', 'Klik produk'],
    wajib: true,
  },
  {
    kode: 'tt_transaction_product',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Transaction Analysis (Produk)',
    // Tak ada registry lama; kombinasi baru dari PDT_KOLOM_DIPANEN §1.3 —
    // 'Sampel terkirim' tidak muncul di modul TikTok lain mana pun.
    tandaTanganKolom: { must: ['Product ID', 'Product category', 'Sampel terkirim'] },
    barisHeaderHint: 1,
    kolomDipanen: ['Product ID', 'Product category', 'GMV dari kreator', 'CTOR', 'Video', 'Siaran LIVE', 'Sampel terkirim'],
    wajib: true,
  },
  {
    kode: 'tt_transaction_creator',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Transaction Analysis (Kreator)',
    // Sama persis `baseline/detect.ts` TYPES.aff_kr.
    tandaTanganKolom: { must: ['Creator name', 'GMV dari kreator'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video',
      'Video', 'Siaran LIVE', 'Perkiraan komisi',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.4 — dibutuhkan copilot A1/A2 +
    // PX Flow D commission_pct, bukan gerbang PDT sendiri. Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Video', 'Siaran LIVE', 'Perkiraan komisi'],
    wajib: true,
  },
  {
    kode: 'tt_video',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Video Performance List',
    // Sama persis `baseline/detect.ts` TYPES.vid_toko/vid_aff (toko vs afiliasi
    // diputuskan di lapisan lain — `client_platforms.akun_konten_toko` — bukan di sini).
    tandaTanganKolom: { must: ['Informasi Video', 'GPM (Rp)'] },
    barisHeaderHint: 3, // Rule 7
    kolomDipanen: [
      'ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator',
      'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.5 — dibutuhkan report.dim_video(0.18),
    // bukan gerbang PDT sendiri. Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'],
    wajib: true,
  },
  {
    kode: 'tt_live',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Live Analysis',
    // Sama persis `baseline/detect.ts` TYPES.live_toko/live_aff.
    // G1-09-2BII-TTLIVE DITUTUP — sample asli ("Tiktok - Avitaskin.zip") membuktikan
    // `ID Kreator` + `Waktu Live` (menit presisi) 100% unik (149 baris nyata, nol
    // duplikat) — dipakai sebagai `platform_content_id` (`ekstrakBarisTtLive`,
    // `fakta.ts`), pola sama `shopee_live`/`Waktu Mulai`.
    tandaTanganKolom: { must: ['GMV dari LIVE (Rp)', 'Waktu Live'] },
    barisHeaderHint: 3, // Rule 7
    kolomDipanen: ['ID Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR', 'Kreator'],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.6 — dibutuhkan report.dim_live(0.22)/
    // copilot L3/pemisah toko-vs-afiliasi, bukan gerbang PDT sendiri. Hilang ⇒ 'sebagian'.
    kolomOpsional: ['Penonton', 'CTOR', 'Kreator'],
    wajib: true,
  },
  {
    kode: 'tt_shop_analytics',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Shop Analytics (Key Metrics)',
    // Diturunkan dari `baseline/detect.ts` TYPES.shop_tt, DIPERSEMPIT dengan
    // sengaja: sig aslinya `mustNot: ['ID Produk', 'ID']` — negasi kedua
    // ('ID' polos) ada untuk menolak file Tokopedia (`shop_tp`/`prod_tp`),
    // yang tidak pernah masuk daftar modul PDT (Tokopedia bukan platform PDT).
    // Di bawah pencocok tanda-tangan-di-mana-pun-dalam-sheet (`detect.ts`),
    // needle pendek 'ID' akan cocok ke substring "id" di dalam kata biasa
    // (mis. "video") dan menolak modul ini sendiri secara keliru — jadi hanya
    // separuh negasi yang relevan untuk TikTok yang diikutkan. Dicatat
    // `docs/DECISIONS.md` 2026-09-13 G1-02.
    tandaTanganKolom: { must: ['GMV', 'GMV dari LIVE kreator', 'Pengunjung'], mustNot: ['ID Produk'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
      'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi',
      'GMV dari video akun tertaut',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.7 — dibutuhkan gmvNet/channel-mix
    // (baseline/metrik.ts toko(), report B-2.3), bukan gerbang PDT sendiri. Hilang ⇒ 'sebagian'.
    kolomOpsional: [
      'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut',
      'GMV dari video afiliasi', 'GMV dari video akun tertaut',
    ],
    wajib: true,
  },
  {
    kode: 'tt_ads_product',
    platform: 'tiktok',
    namaTampilan: 'TikTok Ads Manager — Product Campaigns',
    // Sama persis `adsscanner/tiktok/detect.ts` FILE_SIGS.ads.
    tandaTanganKolom: { must: ['Nama kampanye', 'ID produk', 'Biaya'] },
    barisHeaderHint: 1, // adsscanner headerRow 0 (0-based) => baris 1
    // PENTING (lihat komentar `shopee_ads_cpc` di bawah): `kolomDipanen` di
    // sini adalah kolom WAJIB (`validasiKolomWajib` — `@cdps/domain` `pdt.ts`
    // memeriksa SELURUH daftar ini terhadap SATU baris header, gagal satu ⇒
    // seluruh berkas `status: 'gagal'`), BUKAN daftar dokumentasi "semua
    // kolom nyata". Karena itu HANYA kolom yang benar-benar diekstrak
    // (`ekstrakBarisTtAdsProduct`, `@cdps/core` `pdt/fakta.ts`) yang didaftar
    // — kolom lain di file asli (26 kolom A–Z, diverifikasi 2026-09-16
    // terhadap sample Avitaskin "creative data for product campaigns" Juli
    // 2026, `G1-09-2BII-TTADS-SAMPLE` DITUTUP) SENGAJA TIDAK didaftar supaya
    // tetap muncul sebagai `kolomBaru` (informational, Rule 8) bukan
    // memblokir parse. `Impresi iklan produk`/`Jumlah klik iklan produk`
    // ditambahkan sesi ini (baru diekstrak jadi tayangan/klik).
    kolomDipanen: ['ID Campaign', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor', 'Impresi iklan produk', 'Jumlah klik iklan produk'],
    // G1-08-SEBAGIAN: 'Pendapatan kotor' Bucket 2 PDT_KOLOM_DIPANEN.md §1.8 — dibutuhkan
    // report.dim_gmvmax(0.22) (sisi pendapatan ROAS), bukan gerbang PDT sendiri. Kolom lain di
    // sini SUDAH bucket 1 atau tambahan undokumentasi ('Impresi iklan produk'/'Jumlah klik iklan
    // produk') — dibiarkan wajib, tidak ditebak. Hilang 'Pendapatan kotor' ⇒ 'sebagian'.
    kolomOpsional: ['Pendapatan kotor'],
    wajib: false, // opsional — sisi ads, bukan sisi rekonsiliasi GMV toko
  },
  {
    kode: 'tt_ads_live',
    platform: 'tiktok',
    namaTampilan: 'TikTok Ads Manager — Live Campaigns',
    // Sama persis `adsscanner/tiktok/detect.ts` FILE_SIGS.adslive.
    tandaTanganKolom: { must: ['Nama LIVE', 'Nama kampanye', 'Biaya'] },
    barisHeaderHint: 1, // adsscanner headerRow 0
    // Sama alasan `tt_ads_product` di atas — HANYA kolom yang diekstrak
    // (`ekstrakBarisTtAdsLive`) didaftar. **`ROI` DIHAPUS sesi ini
    // (`G1-09-2BII-TTADS-SAMPLE` DITUTUP)** — sample asli (Avitaskin
    // "livestream data for live campaigns" Juli 2026, HEADER saja, nol baris
    // data) membuktikan nama kolom asli adalah `ROI (Toko saat ini)`, BUKAN
    // `ROI` polos; membiarkannya di sini akan membuat `validasiKolomWajib`
    // GAGAL untuk setiap file live-campaign nyata begitu ada baris data
    // (bug laten sejak modul ini dibangun tanpa sample — sama kelas bug
    // `ID Toko`/`Periode` `shopee_ads_cpc`, lihat komentarnya). Kolom itu
    // toh tidak pernah dibaca (`roas` diturunkan gmv÷biaya). `Tayangan LIVE`
    // ditambahkan (baru diekstrak jadi tayangan).
    kolomDipanen: ['Nama LIVE', 'ID Campaign', 'Biaya', 'Pesanan SKU', 'Pendapatan kotor', 'Tayangan LIVE'],
    // G1-08-SEBAGIAN: 'Pendapatan kotor' Bucket 2 PDT_KOLOM_DIPANEN.md §1.9 — dibutuhkan
    // report.dim_gmvmax(0.22), bukan gerbang PDT sendiri. 'Tayangan LIVE' tambahan
    // undokumentasi — dibiarkan wajib, tidak ditebak. Hilang 'Pendapatan kotor' ⇒ 'sebagian'.
    kolomOpsional: ['Pendapatan kotor'],
    wajib: false,
  },
  {
    kode: 'tt_affiliate_video',
    platform: 'tiktok',
    namaTampilan: 'TikTok Shop Affiliate — Custom Report (Campaign/Creator/Product/Shop/Video)',
    // Ekspor sisi PARTNER AFILIASI/TAP, bukan sisi seller — itulah yang
    // membedakannya dari `tt_video`/`tt_transaction_creator` yang header-nya
    // berbahasa Indonesia. Tanda tangannya dua kolom yang hanya ada di sisi
    // partner; `Video ID` sendirian tidak cukup (bisa bertabrakan dengan
    // ekspor lain berbahasa Inggris di masa depan).
    tandaTanganKolom: { must: ['Affiliate video-attributed GMV', 'Video ID'] },
    barisHeaderHint: 1,
    // Diverifikasi dari sample asli pemilik (Anjalie Factory, periode
    // 2026-08-01..31, 180 baris data + 1 baris `Summary`). **`Estimated
    // affiliate partner commission ` BERAKHIR SPASI** di file aslinya — ditulis
    // apa adanya di sini, sama seperti koreksi ejaan kolom sample-driven
    // lain (`ROI (Toko saat ini)` di `tt_ads_live`). Menormalkannya diam-diam
    // akan membuat `validasiKolomWajib` gagal untuk setiap file nyata.
    kolomDipanen: [
      'Date', 'Campaign ID', 'Campaign name', 'Creator name', 'Creator follower count',
      'Product ID', 'Product name', 'Shop ID', 'Shop code', 'Shop name',
      'Video ID', 'Video name', 'Post time', 'Duration',
      'Affiliate video-attributed GMV', 'Creator video-attributed orders', 'Affiliate video orders',
      'Estimated affiliate partner commission ', 'Actual affiliate partner commission',
      'Video views', 'Video likes', 'Video product RPM', 'Creator-attributed items sold',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §1.10 — dipanen ke berkas mentah tapi
    // BELUM PUNYA kolom tujuan di pdt_fact_content (bukan gerbang PDT sendiri, yang hanya
    // butuh 8 kolom Bucket 1: Date/Video ID/Shop ID/Creator name/Affiliate video-attributed
    // GMV/Video views/Video likes/Duration). Hilang salah satu ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: [
      'Campaign ID', 'Campaign name', 'Creator follower count', 'Product ID', 'Product name',
      'Shop code', 'Shop name', 'Video name', 'Post time',
      'Creator video-attributed orders', 'Affiliate video orders', 'Creator-attributed items sold',
      'Estimated affiliate partner commission ', 'Actual affiliate partner commission',
      'Video product RPM',
    ],
    // Berkas ini NOL baris preamble (header di baris 1) — rentangnya ada di
    // kolom data `Date`, konstan `2026-08-01-2026-08-31` di seluruh 180 baris
    // sample dan sama persis dengan rentang di nama berkasnya. Lihat docblock
    // `PdtModuleDef.kolomPeriode` untuk kenapa ini pengecualian ber-nama,
    // bukan pelonggaran aturan "periode selalu dari preamble".
    kolomPeriode: 'Date',
    wajib: false,
  },

  // ===========================================================================
  // Shopee (PRD §7.2 / PDT_KOLOM_DIPANEN §2) — 15 modul
  // ===========================================================================
  {
    kode: 'shopee_shop_stats',
    platform: 'shopee',
    namaTampilan: 'Shopee — Bisnis Saya (Home, 12 sheet)',
    // G1-09-SHEET-BUKAN-PERTAMA (docs/DECISIONS.md, sesi 27 menemukan, sesi
    // berikutnya menutup): tanda tangan LAMA (`must: ['Pesanan Dibuat', 'Total
    // Pengunjung']`, "penanda seksi + header cocok lewat pemindaian-semua-baris")
    // TERBUKTI SALAH terhadap sample asli 12-sheet (`fim_motor.shopee-shop-stats.*.xlsx`):
    // 'Pesanan Dibuat' HANYA muncul sebagai NAMA TAB (sheet pertama dari 12),
    // BUKAN sebagai isi sel — isi sheet itu LANGSUNG dimulai dari header
    // ('Tanggal'/'Total Penjualan (IDR)'/dst.), nol baris penanda. Ketiga basis
    // GMV (Rule 16: Dibuat/Siap Dikirim/Dibayar) ternyata SHEET TERPISAH
    // (nama tab persis 'Pesanan Dibuat'/'Pesanan Siap Dikirim'/'Pesanan
    // Dibayar'), bukan tiga section dalam satu sheet seperti tebakan lama.
    // `commitUploadBatch` (packages/domain/src/pdt.ts) HANYA memakai basis
    // 'Siap Dikirim' (default laporan klien, Rule 16) — `namaSheet` di bawah
    // mengunci modul ini ke SATU sheet itu; sinyal deteksi diganti ke kolom
    // yang SUNGGUH ADA di dalamnya (sudah di `kolomDipanen` sejak awal).
    // G1-09-SHOPEESHOPSTATS-BASIS-TOTAL DITUTUP (docs/DECISIONS.md, sesi
    // berikutnya) — pemilik mengunggah ZIP kedua ("Shopee - Fim Motor.zip",
    // sample asli). Sheet 'Pesanan Siap Dikirim' TERBUKTI: header baris 1,
    // baris TEPAT SESUDAHNYA (baris 2) ringkasan PERIODE PENUH (kolom
    // `Tanggal` berisi rentang, bukan satu tanggal) — Σ 31 baris harian
    // PERSIS sama dengan baris ringkasan itu. `parseShopeeShopStatsBasisTerisolasi`
    // (`rekonsiliasi.ts`, menggantikan `parseShopeeShopStatsPerBasis` yang
    // dihapus) membaca baris itu langsung — nol tebakan tersisa.
    namaSheet: 'Pesanan Siap Dikirim',
    // G1-09-2BII-SHOPDAILY-SHOPEE (sesi 34 lanjutan): dua sheet basis LAIN
    // (Rule 16) untuk EKSTRAKSI `pdt_fact_shop_daily` (`ekstrakBarisShopDailyShopee`,
    // `fakta.ts`) — BUKAN untuk deteksi (`namaSheet` di atas tidak berubah,
    // tanda tangan tetap hanya dicek terhadap 'Pesanan Siap Dikirim'). Lihat
    // `PdtModuleDef.sheetTambahan` (`types.ts`) untuk kenapa DUA modul
    // terpisah ber-tanda-tangan identik akan meregresi deteksi jadi ambigu.
    sheetTambahan: ['Pesanan Dibuat', 'Pesanan Dibayar'],
    tandaTanganKolom: { must: ['Total Penjualan (IDR)', 'Total Pengunjung'] },
    barisHeaderHint: 1, // header LANGSUNG di baris 1 di sheet terisolasi (nol baris penanda seksi)
    // 14-15 metrik per basis (PDT_KOLOM_DIPANEN §2.1: "3 basis × 14 metrik" —
    // literal di bawah diverifikasi lewat report/shopee/metrik.ts + shopee.test.ts
    // HOME_HEADER, dites terhadap angka Fim Motor UAT persis). "Asal kunjungan"/
    // "asal penjualan" (dua sheet lain di workbook 12-sheet) TIDAK dimasukkan —
    // nama kolom literalnya belum terverifikasi di dokumen/kode manapun di repo
    // ini; dicatat sebagai gap terbuka di docs/DECISIONS.md, bukan ditebak.
    kolomDipanen: [
      'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
      'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
      'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
      'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
    ],
    wajib: true,
  },
  {
    kode: 'shopee_parent_sku',
    platform: 'shopee',
    namaTampilan: 'Shopee — Parent SKU Detail',
    tandaTanganKolom: { must: ['Kode Produk', 'Kode Variasi', 'SKU Induk'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Kode Produk', 'Kode Variasi', 'SKU Induk',
      'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
      'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
      // `'repeat order'` DIKOREKSI → `'Tingkat Pesanan Berulang (Pesanan Dibuat)'` (sesi 43).
      // Ejaan lama adalah DESKRIPSI konsep (huruf kecil semua, bahasa Inggris di berkas
      // berbahasa Indonesia), bukan nama sel — nol kecocokan di keenam ekspor nyata.
      // `wajib: true` ⇒ modul ini selalu `gagal` ⇒ pasangan rekonsiliasi Shopee tidak
      // pernah lengkap, cermin persis kasus `tt_product_analytics` di atas.
      'Tingkat Pesanan Berulang (Pesanan Dibuat)', 'Pengunjung Produk (Kunjungan)',
    ],
    // G1-08-SEBAGIAN: Bucket 2 PDT_KOLOM_DIPANEN.md §2.2 — dibutuhkan dim
    // product_performance(0.14)/sumbu X 4-kuadran Shopee, bukan gerbang PDT sendiri
    // (Rule 13-16/PX). Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Pengunjung Produk (Kunjungan)'],
    wajib: true,
  },
  {
    kode: 'shopee_ads_cpc',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Iklan Keseluruhan (CPC)',
    tandaTanganKolom: { must: ['Kode Produk', 'Dilihat', 'Biaya'] },
    barisHeaderHint: 8, // PRD §7.2 + PDT_KOLOM_DIPANEN §2.3: "header baris 8"; DIKONFIRMASI baris 8 persis lewat sample asli Fim Motor sesi 19.
    // `ID Toko`/`Periode` DIHAPUS dari daftar ini sesi 19 (docs/DECISIONS.md
    // 2026-09-14 modul KEENAM) — keduanya PREAMBLE (baris 1-6, divalidasi
    // `ekstrakPreambleShopee`/Rule 2), BUKAN kolom baris header. Menaruhnya di
    // sini membuat `validasiKolomWajib` (yang memeriksa SELURUH kolomDipanen
    // terhadap SATU baris header saja) SELALU gagal untuk berkas ASLI apa pun
    // — bug laten sejak G1-02, tidak pernah tertangkap karena fixture tes
    // sebelum sesi ini menaruh 'ID Toko'/'Periode' sebagai SEL header buatan
    // (tidak merefleksikan bentuk berkas asli). `shopee_ads_live`/
    // `shopee_ads_search` tidak pernah membuat kesalahan yang sama — preseden
    // yang benar, bukan modul ini. Kolom ACOS DIKOREKSI ke ejaan PERSIS sample
    // asli (`Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)`) —
    // ejaan lama (`Biaya Iklan Terhadap Omzet (ACOS) (%)`) adalah TEBAKAN
    // (PDT_KOLOM_DIPANEN.md §2.3 sendiri menulis "mis." di depannya) yang
    // TIDAK PERNAH cocok dengan berkas nyata mana pun.
    kolomDipanen: [
      'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
      'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)',
    ],
    // G1-08-SEBAGIAN: 'ACOS' Bucket 2 PDT_KOLOM_DIPANEN.md §2.3 — dibutuhkan HealthAds.acos/
    // B-4.3, bukan gerbang PDT sendiri. Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)'],
    wajib: false,
  },
  {
    kode: 'shopee_ads_search',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Search Ads',
    // 'Kata Pencarian' terverifikasi (PRD §7.2, Title Case) — meski isinya
    // (bucket 3) DITAHAN dari kolomDipanen (PDT_KOLOM_DIPANEN §2.4, ketokan
    // Q-6 menunggu Anty), kolomnya sendiri boleh dipakai untuk DETEKSI.
    tandaTanganKolom: { must: ['Kata Pencarian'] },
    barisHeaderHint: 8, // PRD §7.2: "header baris 8"; DIKONFIRMASI baris 8 persis lewat sample asli Fim Motor (Search-Ads-Overall-Data-*.csv).
    // Ejaan DIKOREKSI terhadap sample asli Fim Motor sesi lalu — casing lama
    // huruf kecil ('klik'/'konversi') TIDAK PERNAH cocok header nyata
    // (`validasiKolomWajib` exact per-sel setelah normalisasi kosakata, sel
    // sungguhan ber-'Jumlah Klik'/'Konversi', bukan sel literal 'klik'/
    // 'konversi' — bug laten kelas sama `shopee_ads_cpc` sesi 19).
    // **`G1-09-2BII-ADS-SEARCH` DITUTUP sesi ini (docs/DECISIONS.md
    // 2026-09-14, modul KETUJUH)** — 'Nama Iklan'/'Biaya' DITAMBAHKAN:
    // sample yang sama membuktikan keduanya SUNGGUH ADA (identitas kampanye
    // + NOT NULL `pdt_fact_ads.biaya`), murni pekerjaan implementasi
    // mengikuti pola `shopee_ads_cpc` (handoff SESI21 §3.B, "boleh langsung
    // dikerjakan TANPA menunggu pemilik"). 'Kata Pencarian' SENGAJA TETAP
    // TIDAK ada di sini — Q-6 (bucket 3, isinya) masih DITAHAN menunggu
    // Anty, TAPI kolomnya tetap dibaca oleh `ekstrakBarisShopeeAdsSearch`
    // (`@cdps/core` `pdt/fakta.ts`) untuk membentuk `kampanye_id` KOMPOSIT —
    // itu memakai IDENTITAS baris, bukan menjadikan isinya dimensi laporan,
    // jadi tidak melanggar penahanan Q-6.
    kolomDipanen: ['Jumlah Klik', 'Konversi', 'Nama Iklan', 'Biaya'],
    wajib: false,
  },
  {
    kode: 'shopee_ads_live',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Live',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.ads_live.
    tandaTanganKolom: { must: ['Nama Iklan', 'Penonton'] },
    barisHeaderHint: 7, // PRD §7.2 + PDT_KOLOM_DIPANEN §2.5: "header baris 7"
    // `'Omzet'` DIKOREKSI → `'Omzet Penjualan'` (sesi 43, ZIP "Sample shopee 5 client" +
    // "Sample nama asli" pemilik). Ejaan lama TIDAK PERNAH cocok ke satu pun berkas nyata:
    // keenam ekspor Shopee Ads Live yang ada di repo (5 klien baru + Fim Motor) menulis
    // `Omzet Penjualan` di baris header 7. Konsekuensinya BUKAN kolom kosong melainkan
    // modul GAGAL total — `validasiKolomWajib` menolak, berkas dikeluarkan dari `terparse`,
    // dan `pdt_fact_ads` tidak pernah menerima satu pun baris iklan Live Shopee. Ejaan lama
    // dipertahankan sebagai ALIAS di `PDT_KOLOM_ALIAS` (Rule 9, append-only) — bukan dibuang,
    // supaya ekspor lama (bila ada) tetap terbaca. Pola koreksi SAMA `meta_ads` di bawah.
    kolomDipanen: ['ID Iklan', 'Penonton', 'Pesanan', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan'],
    wajib: false,
  },
  {
    kode: 'shopee_live',
    platform: 'shopee',
    namaTampilan: 'Shopee — Live Streaming',
    // G1-09-SHEET-BUKAN-PERTAMA (docs/DECISIONS.md, sesi 27 menemukan, sesi
    // berikutnya menutup): `namaSheet` di bawah TERLAMBAT satu sesi — sesi 24
    // SUDAH mengonfirmasi sheet ini ke sample asli (komentar `barisHeaderHint`
    // di bawah), tapi tidak ada yang mengecek apakah PIPELINE (`pdt-parse.ts`)
    // benar-benar membaca sheet itu. Sebelum ini pipeline SELALU membaca sheet
    // PERTAMA workbook ("Tinjauan", ringkasan agregat struktur beda total,
    // tidak pernah cocok tanda tangan ini) — modul ini adalah kode mati di
    // produksi sampai `namaSheet` menutup celah itu.
    namaSheet: 'Daftar Streaming',
    tandaTanganKolom: { must: ['Informasi Streaming', 'Waktu Mulai'] },
    barisHeaderHint: 1, // DIKONFIRMASI: sheet "Daftar Streaming" (dari 3 sheet workbook), sample asli Fim Motor `live_streaming_*.xlsx`.
    // 'Penjualan' DIKOREKSI ke ejaan PERSIS sample asli — ejaan lama adalah
    // TEBAKAN yang tidak pernah cocok berkas nyata (kolom sungguhan
    // 'Penjualan (Pesanan Siap Dikirim)(Rp)'), bug laten kelas sama
    // `shopee_ads_cpc` sesi 19.
    // **`G1-09-2BII-SHOPEELIVE` DITUTUP sesi 24 (docs/DECISIONS.md
    // 2026-09-14)** — blocker itu soal `Informasi Streaming` (judul bebas
    // AM, bukan ID platform stabil) sebagai identitas `pdt_fact_content`.
    // Sample asli membuktikan `Waktu Mulai` (menit presisi, format `DD-MM-
    // YYYY HH:mm`) TIDAK PERNAH berulang untuk satu akun (satu toko cuma
    // bisa live SATU sesi pada satu waktu) — dipakai sebagai identitas
    // sebagai gantinya (`platform_content_id`, lihat docblock
    // `ekstrakBarisShopeeLive`, `@cdps/core` `pdt/fakta.ts`). `Informasi
    // Streaming` TETAP di `kolomDipanen` (deskriptif) tapi TIDAK dipetakan
    // ke kolom manapun di `pdt_fact_content` (tabel tidak punya slot judul).
    kolomDipanen: ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan (Pesanan Siap Dikirim)(Rp)'],
    wajib: true, // menutup dimensi Live Shopee yang hari ini struktural maks 5/10 (PRD §7.2)
  },
  {
    kode: 'shopee_video',
    platform: 'shopee',
    namaTampilan: 'Shopee — Video Overview',
    // TERVERIFIKASI DEFINITIF sesi lanjutan pasca-sesi 20 (PR #380, docs/DECISIONS.md
    // 2026-09-14) — TIDAK "belum diverifikasi", tapi berkas "Video Overview" (`video-overview-
    // v3*.csv`) TERBUKTI secara struktural tidak bisa menulis apa pun ke sini: sample dibaca
    // PENUH (32 baris), satu-satunya baris data adalah AGREGAT SATU AKUN untuk seluruh periode,
    // NOL dari 54 kolom adalah identitas video. `tandaTanganKolom` TETAP `UNVERIFIED_SIGNATURE`
    // (menyalakan deteksi untuk berkas yang tidak bisa menulis apa pun tetap tidak berguna).
    tandaTanganKolom: UNVERIFIED_SIGNATURE,
    barisHeaderHint: 1, // header 2 lapis (Rule 7) — readSheet sudah menangani kolom duplikat lewat sufiks nama#j
    kolomDipanen: [],
    // `wajib` DITURUNKAN true → false sesi 23 (docs/DECISIONS.md 2026-09-14, `G1-09-2BII-
    // SHOPEEVIDEO-GRAIN` DITUTUP) — deviasi PRD §7.2, DISETUJUI PEMILIK langsung: dikonfirmasi
    // Shopee Seller Center TIDAK punya laporan lain yang satu baris per video ("D. Tidak ada").
    // Dimensi Video HANYA terisi dari TikTok (`tt_video`, sudah jalan) sampai Shopee mengekspos
    // laporan begitu di masa depan.
    wajib: false,
  },
  {
    kode: 'shopee_voucher',
    platform: 'shopee',
    namaTampilan: 'Shopee — Voucher Toko',
    // Sama persis cabang OR kedua `report/shopee/detect.ts`
    // CONTENT_SIGNATURES.promo_voucher (cabang 'nama voucher' tidak dipakai di
    // sini karena PDT_KOLOM_DIPANEN §2.8 tidak menyebut kolom itu literal).
    tandaTanganKolom: { must: ['Periode Waktu', 'Klaim'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)',
      'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_diskon',
    platform: 'shopee',
    namaTampilan: 'Shopee — Diskon Toko',
    // **`G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` DITUTUP sesi 23 (docs/DECISIONS.md 2026-09-14,
    // MVP dipilih pemilik — "jalan rekomendasi").** Deskripsi lama ("sama struktur
    // shopee_voucher") TERBUKTI SALAH sesi lanjutan pasca-sesi 20 — sample asli Fim Motor
    // (`discount_*.xlsx` sheet "Kriteria Utama") TIDAK punya `Klaim`/`Tingkat Penggunaan`/
    // `Total Biaya` sama sekali; strukturnya 26 kolom (`Tanggal`, `Tipe Promosi`, penjualan 2
    // basis, produk terjual 2 basis, pembeli 2 basis, PLUS rincian Paket Diskon/Kombo Hemat).
    // Whitelist di sini SENGAJA MVP — HANYA agregat harian sheet "Kriteria Utama" ("berapa GMV
    // dari diskon toko per hari"), BUKAN sheet "Rincian Performa" (per-promosi individual, 20+
    // kolom lagi, belum ada yang minta — HANDOFF_PDT_SESI21.md §3.C opsi 2, ditunda).
    // **Writer fakta ADA sejak G4-03 aksi 4 (2026-09-19)** — `pdt_fact_promo`, lihat
    // `ekstrakBarisPromoDiskonShopee` (`pdt/fakta.ts`). Modul ini dikeluarkan dari daftar
    // "nol writer fact-table" (yang kini tinggal shopee_voucher/shopee_chat_broadcast/meta_ads;
    // `shopee_chat` keluar lebih dulu lewat G3-02a `pdt_fact_layanan_chat`).
    // ⚠️ Baris `Tipe Promosi='Semua'` MEN-DEDUP, bukan menjumlah baris komponen — jangan
    // pernah menjumlahkan baris tabel faktanya; angka pembuktiannya ada di docblock ekstraktor.
    tandaTanganKolom: { must: ['Tanggal', 'Tipe Promosi'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Tanggal', 'Tipe Promosi', 'Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
      'Pesanan (Pesanan Dibuat)', 'Pesanan (Pesanan Siap Dikirim)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_flash_sale',
    platform: 'shopee',
    namaTampilan: 'Shopee — Flash Sale Toko',
    // `G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` DITUTUP sesi 23 bersama `shopee_diskon` di atas —
    // lihat catatannya untuk konteks lengkap. Struktur asli (`In_Shop_Flash_Sale_Metrics_*.xlsx`
    // sheet "Kriteria Utama") lebih dekat ke `shopee_voucher` (sama-sama `Periode Waktu`) TAPI
    // juga tidak punya `Klaim`/`Total Biaya` — kolom uniknya `Jumlah Produk Dilihat`/`Produk
    // Diklik` (funnel tampilan, satu-satunya hal unik dibanding diskon/voucher), dipanen di sini.
    // **Writer fakta ADA sejak G4-03 aksi 4 (2026-09-19)** — `pdt_fact_promo` `jenis='flash_sale'`,
    // lihat `ekstrakBarisPromoFlashSaleShopee`. ⚠️ Kolom uangnya bersufiks `(Rp)` TANPA spasi,
    // BEDA dari diskon yang memakai ` (IDR)` — menyalin ejaan diskon ke sini menghasilkan seluruh
    // kolom `null` tanpa satu pun error.
    tandaTanganKolom: { must: ['Periode Waktu', 'Jumlah Produk Dilihat'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Periode Waktu', 'Penjualan (Pesanan Dibuat)(Rp)', 'Penjualan (Pesanan Siap Dikirim)(Rp)',
      'Pesanan (Pesanan Dibuat)', 'Pesanan (Pesanan Siap Dikirim)', 'Jumlah Produk Dilihat', 'Produk Diklik',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_chat',
    platform: 'shopee',
    namaTampilan: 'Shopee — Performa Chat',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.layanan_chat
    // (tiga cabang OR — 'grafik kriteria' sendirian, atau 'periode waktu'+CSAT,
    // atau 'periode waktu'+'jumlah chat').
    tandaTanganKolom: {
      anyOf: [
        { must: ['Grafik Kriteria'] },
        { must: ['Periode Waktu', 'CSAT'] },
        { must: ['Periode Waktu', 'Jumlah Chat'] },
      ],
    },
    barisHeaderHint: 1, // DIKONFIRMASI: sheet "Kriteria Utama", sample asli Fim Motor `chat_*.xlsx`.
    // 'Persentase Chat Dibalas' DIHAPUS sesi ini — sample asli TIDAK punya
    // kolom itu sama sekali (Rule 9 exact-match tidak pernah menemukannya,
    // bug laten kelas sama `shopee_ads_cpc`/AMS). Sample punya
    // 'Tingkat Konversi (Chat Dibalas)' — SEMANTIK BERBEDA (tingkat konversi,
    // bukan persentase dibalas), bukan pengganti 1:1, jadi tidak disubstitusi
    // begitu saja (CLAUDE.md: jangan mengarang). Sembilan kolom lain di
    // bawah SUDAH cocok persis (exact match) ke sample asli.
    kolomDipanen: [
      'Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
      'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_chat_broadcast',
    platform: 'shopee',
    namaTampilan: 'Shopee — Chat Broadcast',
    // PRD §7.3 (baris shopee_chat_broadcast §7.2 sebenarnya) menulis
    // "penerima, dibaca, diklik, pesanan" huruf kecil — parafrase, bukan
    // kutipan literal. `tandaTanganKolom` TIDAK diubah (substring
    // case-insensitive lintas-sel-dalam-satu-baris tetap cocok ke header
    // asli — 'penerima' ada di sel 'Total Penerima', 'dibaca' di sel
    // 'Persentase Chat Dibaca', 'diklik' di sel 'Persentase Chat Diklik' —
    // deteksi SUDAH benar sejak awal, sama pola `shopee_ams_afiliasi`).
    tandaTanganKolom: { must: ['penerima', 'dibaca', 'diklik'] },
    barisHeaderHint: 1, // DIKONFIRMASI: sample asli Fim Motor `Chat_Broadcast_overview_*.xlsx` (sheet pertama).
    // `kolomDipanen` DIKOREKSI ke ejaan PERSIS sample asli — `validasiKolomWajib`
    // (EXACT per-sel, beda dari deteksi substring di atas) TIDAK PERNAH
    // menemukan sel literal 'penerima'/'dibaca'/'diklik' (hanya 'pesanan'
    // yang kebetulan cocok exact ke sel 'Pesanan') — modul ini SELALU
    // `parse_status='gagal'` untuk berkas asli sejak G1-02, bug laten kelas
    // sama `shopee_ads_cpc`/AMS (belum pernah tertangkap, modul ini belum
    // pernah punya writer `pdt_fact_*`).
    kolomDipanen: ['Total Penerima', 'Penerima yang Membaca', 'Penerima yang Mengklik', 'Pesanan'],
    wajib: false,
  },
  {
    kode: 'shopee_ams_produk',
    platform: 'shopee',
    namaTampilan: 'Shopee AMS — Performa Produk (Afiliasi)',
    // Dikoreksi sesi 20 (docs/DECISIONS.md 2026-09-14) terhadap sample EKSPOR ASLI
    // (Fim Motor, `ProductPerformance_*.csv`) — ejaan lama ('Nama Produk'/'Omzet'/
    // 'Komisi') TIDAK PERNAH cocok berkas nyata: header sungguhan ber-'Nama Item'
    // (bukan 'Nama Produk' — deteksi lama gagal total, bukan cuma kolomDipanen).
    // 'Kode Item' (satu-satunya identitas modul ini yang tidak dimiliki
    // `shopee_ams_afiliasi`) dipakai sebagai penanda `must`, `mustNot 'ID
    // Affiliates'` menjaga dua modul tetap terpisah (bukan cermin
    // `report/shopee/detect.ts` lagi — signature lama itu sendiri tidak pernah
    // diverifikasi ke sample asli).
    tandaTanganKolom: { must: ['Kode Item', 'Omzet'], mustNot: ['ID Affiliates'] },
    barisHeaderHint: 1,
    kolomDipanen: ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'],
    wajib: false,
  },
  {
    kode: 'shopee_ams_afiliasi',
    platform: 'shopee',
    namaTampilan: 'Shopee AMS — Performa Afiliasi (Kreator)',
    // Tanda tangan (substring, `detect.ts` `containsSomewhere`) TIDAK berubah —
    // 'Omzet'/'Username' tetap cocok sebagai SUBSTRING dari 'Omzet Penjualan(Rp)'/
    // 'Username Affiliate' sungguhan, jadi deteksi modul ini SUDAH benar sejak
    // awal. `kolomDipanen` DIKOREKSI sesi 20 (docs/DECISIONS.md 2026-09-14) —
    // `validasiKolomWajib` (exact PER SEL, beda dari deteksi) memakai ejaan lama
    // ('Username'/'Omzet'/'Komisi') yang TIDAK PERNAH cocok berkas nyata
    // (`AMSAffiliatePerformance_*.csv`: 'Username Affiliate'/'Omzet
    // Penjualan(Rp)'/'Estimasi Komisi(Rp)') — bug laten sejak G1-02, modul ini
    // SELALU `parse_status='gagal'` untuk berkas asli walau modul KELIMA (sesi
    // 17) sudah menulis `pdt_fact_creator_period` dari sini; fixture tes lama
    // memalsukan header persis kelas yang sama dengan `shopee_ads_cpc`.
    //
    // `mustNot: ['ID Toko']` DITAMBAHKAN sesi 27 (`G1-09-DETEKSI-PREAMBLE-
    // AMBIGU` DITUTUP, `docs/DECISIONS.md`) — sample EKSPOR ASLI (Fim Motor,
    // ZIP "Sample nama asli" pemilik) MEMBUKTIKAN ambiguitas ini nyata, bukan
    // hipotetis: `Data+Keseluruhan+Iklan+Shopee-*.csv` (shopee_ads_cpc) dan
    // `Search-Ads-Overall-Data-*.csv` (shopee_ads_search) SAMA-SAMA membawa
    // preamble baris 2 `Username,<nama_toko>` (Rule 2) — memenuhi `anyOf`
    // ('Username') — DAN kolom header masing-masing mengandung substring
    // 'Omzet' ('omzet penjualan'/'Omzet Penjualan') — memenuhi `must`
    // ('Omzet') — sehingga `detectPdtModule` (memindai SELURUH sheet, bukan
    // cuma baris header) mencocokkan KEDUANYA ke modul ini juga, persis
    // seperti dugaan `G1-09-DETEKSI-PREAMBLE-AMBIGU`. Pola sama
    // `shopee_ams_produk` (`mustNot: 'ID Affiliates'` di atas): 'ID Toko'
    // adalah baris preamble Rule 2 yang HANYA dimiliki laporan per-toko
    // (`shopee_ads_cpc`/`shopee_ads_search`/`shopee_ads_live`/
    // `shopee_shop_stats`/dst.) — export AMS backend (`AMSAffiliatePerformance_
    // *.csv`/`ProductPerformance_*.csv`) TERBUKTI di sample asli TIDAK PERNAH
    // membawa baris ini sama sekali (nol identitas toko, murni tabel per-
    // kreator/produk). `shopee_ads_live` TIDAK ambigu dengan cara yang sama
    // (preamble-nya tidak membawa baris `Username`) — dikonfirmasi lewat
    // sample yang sama, `mustNot` di sini murni menutup DUA modul yang
    // terbukti bentrok, bukan tebakan defensif.
    tandaTanganKolom: {
      must: ['Omzet'],
      mustNot: ['ID Toko'],
      anyOf: [{ must: ['Username'] }, { must: ['Kreator'] }, { must: ['Creator'] }],
    },
    barisHeaderHint: 1,
    kolomDipanen: ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'],
    wajib: false,
  },
  {
    kode: 'shopee_kesehatan',
    platform: 'shopee',
    namaTampilan: 'Shopee — Kesehatan Toko',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.bisnis_kesehatan
    // ('Poin Pinalti' varian salah eja yang memang muncul di export nyata).
    tandaTanganKolom: { anyOf: [{ must: ['Poin Pinalti'] }, { must: ['Poin Penalti'] }] },
    barisHeaderHint: 1, // seluruh sheet hanya 3 kolom (PRD §7.2)
    // Ejaan KANONIK sengaja TIDAK diubah (beda dari `shopee_ads_live`/`tt_product_analytics`
    // di berkas ini): `tandaTanganKolom` di atas sudah lama mengakui DUA ejaan 'Penalti'/
    // 'Pinalti' sebagai sama-sama nyata, jadi ini kasus Rule 9 murni (dua ejaan hidup
    // berdampingan) — bukan whitelist yang salah tulis. Kelima ekspor nyata sesi 43 memakai
    // `Poin Pinalti` + `Pinalti Berjalan`; keduanya masuk `PDT_KOLOM_ALIAS` di bawah.
    // Tanpa alias itu modul ini GAGAL di 5/5 klien nyata — dan `wajib: true`, jadi ia
    // menghentikan dimensi Kesehatan Toko (0,12) untuk setiap batch Shopee.
    kolomDipanen: ['Poin Penalti', 'Deskripsi', 'Durasi'],
    wajib: true, // modul baru sesi 2 — tidak ada di PRD v1.1, dimensi Kesehatan Toko 0,12
  },

  // ===========================================================================
  // Lintas platform (PRD §7.3) — 1 modul
  // ===========================================================================
  {
    kode: 'meta_ads',
    platform: 'meta',
    namaTampilan: 'Meta Ads — Laporan Kampanye',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.meta.
    // `tandaTanganKolom` TIDAK berubah — substring 'dibelanjakan' tetap cocok
    // sel asli 'Jumlah yang dibelanjakan (IDR)' (deteksi sudah benar).
    tandaTanganKolom: { must: ['Minggu', 'Dibelanjakan'] },
    barisHeaderHint: 1, // DIKONFIRMASI: sheet "Raw Data Report", sample asli Fim Motor `Laporan-tanpa-judul-*.xlsx`.
    // `kolomDipanen` DIKOREKSI sesi lanjutan pasca-sesi 20 terhadap sample
    // asli — 6 dari 11 entri lama TIDAK PERNAH cocok (exact-match) sel
    // sungguhan, yang punya sufiks panjang khas Meta Ads Manager ("(IDR)",
    // "Khusus untuk Item Bersama", dsb.) yang tidak dituliskan sebelumnya —
    // bug laten kelas sama `shopee_ads_cpc`/AMS. Set kolom yang dipanen
    // TIDAK berubah secara konsep, cuma ejaannya dikoreksi.
    kolomDipanen: [
      'Nama kampanye', 'Nama iklan', 'Jumlah yang dibelanjakan (IDR)',
      'Nilai Konversi Pembelian Khusus untuk Item Bersama', 'ROAS pembelian khusus untuk item bersama',
      'Impresi', 'Klik tautan', 'CTR Unik (rasio klik tayang tautan)', 'CPM (Biaya Per 1.000 Tayangan)',
      'CPC (biaya per klik tautan)', 'Minggu',
    ],
    // G1-08-SEBAGIAN: 'Minggu' Bucket 2 PDT_KOLOM_DIPANEN.md §3.1 — kunci pemisah baris
    // ringkasan vs mingguan, bukan gerbang PDT sendiri (modul ini `wajib: false` sudah, PDT-22).
    // Hilang ⇒ 'sebagian', bukan 'gagal'.
    kolomOpsional: ['Minggu'],
    wajib: false, // opsional (PDT-22) — tidak masuk rekonsiliasi GMV toko
  },
];

/**
 * Alias nama kolom → kolom kanonik (`pdt_kolom_alias`, Rule 9, append-only).
 * `versiPertama` selalu 1 di seed pertama ini.
 */
export const PDT_KOLOM_ALIAS: readonly PdtKolomAliasDef[] = [
  // PDT_KOLOM_DIPANEN.md §1.7 — tt_shop_analytics: dua ejaan lama untuk kolom
  // sesi-2 yang sama.
  { modulKode: 'tt_shop_analytics', kolomKanonik: 'GMV dari LIVE akun tertaut', alias: 'GMV LIVE penjual' },
  { modulKode: 'tt_shop_analytics', kolomKanonik: 'GMV dari LIVE akun tertaut', alias: 'GMV tidak langsung dari LIVE penjual' },
  // PDT_KOLOM_DIPANEN.md §1.6 — tt_live: 'Kreator' kadang muncul sebagai
  // 'Nama panggilan'.
  { modulKode: 'tt_live', kolomKanonik: 'Kreator', alias: 'Nama panggilan' },
  // PDT_KOLOM_DIPANEN.md §5 — alias SKU Screener (skuscreener/parse.ts:165-173)
  // → kolom kanonik shopee_parent_sku. 'Persentase Klik' SENGAJA tidak masuk
  // (§5 baris ketiga: ejaan kanoniknya di export 40-kolom belum terverifikasi
  // — sample asli tak ada di repo, sama dengan catatan A-3 handoff. Menulisnya
  // di sini akan mengarang alias yang belum ada dasarnya).
  { modulKode: 'shopee_parent_sku', kolomKanonik: 'Total Penjualan (Pesanan Dibuat) (IDR)', alias: 'Total Penjualan' },
  { modulKode: 'shopee_parent_sku', kolomKanonik: 'Tingkat Konversi (Pesanan yang Dibuat)', alias: 'Tingkat Konversi Pesanan' },

  // -------------------------------------------------------------------------
  // Sesi 43 — lima modul yang kolom wajibnya TIDAK PERNAH cocok ke berkas nyata.
  // Ditemukan dengan menjalankan SELURUH 78 berkas tiga ZIP pemilik ("Sample
  // shopee 5 client", "Sample tiktok 5 client", "Sample nama asli") lewat
  // `detectPdtModule` + `temukanBarisHeader` + `validasiKolomWajib` yang asli.
  // Empat ejaan lama di bawah dipertahankan sebagai ALIAS, bukan dihapus:
  // append-only (Rule 9) dan nol biaya — bila ekspor lama benar-benar pernah
  // memakainya, ia tetap terbaca. Ejaan yang MENANG sekarang ada di
  // `kolomDipanen` masing-masing modul di atas.
  // -------------------------------------------------------------------------
  { modulKode: 'tt_product_analytics', kolomKanonik: 'AOV (pesanan SKU)', alias: 'AOV' },
  { modulKode: 'tt_product_analytics', kolomKanonik: 'CTOR (pesanan SKU)', alias: 'CTOR' },
  { modulKode: 'shopee_parent_sku', kolomKanonik: 'Tingkat Pesanan Berulang (Pesanan Dibuat)', alias: 'repeat order' },
  { modulKode: 'shopee_ads_live', kolomKanonik: 'Omzet Penjualan', alias: 'Omzet' },

  // `shopee_kesehatan` — DUA ejaan sama-sama nyata (bukan whitelist salah
  // tulis): `tandaTanganKolom` modul ini sudah lama ber-`anyOf` 'Poin Pinalti'/
  // 'Poin Penalti', dan `report/shopee/metrik.ts` `parseKesehatan` legacy
  // menerima keduanya juga. Yang belum pernah ditulis di mana pun adalah nama
  // sel kolom kedua: kelima ekspor nyata menulis `Pinalti Berjalan`, sementara
  // whitelist meminta `Deskripsi` (nama konsep, bukan nama sel).
  { modulKode: 'shopee_kesehatan', kolomKanonik: 'Poin Penalti', alias: 'Poin Pinalti' },
  { modulKode: 'shopee_kesehatan', kolomKanonik: 'Deskripsi', alias: 'Pinalti Berjalan' },

  // `meta_ads` — juga dua ejaan yang sama-sama nyata, dan ini SATU-SATUNYA dari
  // lima yang terbukti bercabang DI DALAM satu periode yang sama: dari 5 klien
  // Juli 2026, dua ("Eighty eight", "Healthy") mengekspor `CTR Unik (rasio klik
  // tayang tautan)` dan tiga ("Nubutik", "Pawlovin", "Umar Media") `CTR (rasio
  // klik tayang tautan)`. Karena itu kanoniknya TIDAK dikoreksi — menggantinya
  // hanya memindahkan kegagalan dari tiga klien ke dua klien lain.
  { modulKode: 'meta_ads', kolomKanonik: 'CTR Unik (rasio klik tayang tautan)', alias: 'CTR (rasio klik tayang tautan)' },
];
