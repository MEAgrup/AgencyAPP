-- ============================================================================
-- G1-08-SEBAGIAN — pemicu `pdt_file.parse_status = 'sebagian'` (docs/DECISIONS.md,
-- opsi (a) diketok pemilik): tambah bucket wajib/opsional PER KOLOM ke
-- `pdt_parser_modul`, mencerminkan `PdtModuleDef.kolomOpsional` baru
-- (`packages/core/src/pdt/types.ts`/`modules.ts`) — dijaga sinkron oleh
-- `packages/db/src/pdt.registry.test.ts` (dual-home, gated DATABASE_URL),
-- pola sama seperti `kolom_dipanen` (komentar G1-01: "hidup di sini, bukan di
-- kode").
--
-- `kolom_opsional` adalah SUBSET `kolom_dipanen` — kolom yang boleh hilang
-- tanpa membuat berkas `gagal` (turun ke `sebagian` saja). Persis "Bucket 2
-- (derived-add)" `docs/backlog/PDT_KOLOM_DIPANEN.md` per modul: dibutuhkan
-- KONSUMEN LAIN (mesin laporan — `requireCols`, dimensi skor Rule 12), TIDAK
-- dibutuhkan gerbang penerimaan PDT sendiri (rekonsiliasi Rule 13-16/PX).
--
-- SEBELAS modul diisi di sini — persis modul yang PDT_KOLOM_DIPANEN.md
-- menulis heading "Bucket 2" (dengan daftar kolom) TERPISAH dari "Bucket 1"
-- untuknya. Modul yang dokumen tulis "Tidak ada baris bucket 2" (tt_orders,
-- tt_transaction_product, shopee_shop_stats, shopee_ads_search,
-- shopee_ads_live, shopee_live, shopee_chat/_broadcast, shopee_ams_produk/
-- _afiliasi) SENGAJA tidak disentuh — default `'{}'` (seluruh kolom_dipanen
-- tetap wajib, perilaku lama, tidak berubah). `shopee_video`/`shopee_diskon`/
-- `shopee_flash_sale`/`shopee_kesehatan` JUGA tidak disentuh: dua yang
-- pertama masih `UNVERIFIED_SIGNATURE`/tanda tangan belum ada tempat
-- kolom_dipanen untuk dibagi; `shopee_kesehatan` modul baru TANPA heading
-- Bucket 1 terpisah di dokumen (seluruh 3 kolomnya "Bucket 2" sekaligus
-- SATU-SATUNYA kolom modul itu) — membagi wajib/opsional di antara ketiganya
-- akan MENGARANG pembedaan yang dokumen sendiri tidak buat.
--
-- `tt_ads_product`/`tt_ads_live` PUNYA kolom tambahan ('Impresi iklan
-- produk'/'Jumlah klik iklan produk'/'Tayangan LIVE') yang ditambahkan
-- SESUDAH PDT_KOLOM_DIPANEN.md ditulis — dibiarkan wajib (tidak diklasifikasi
-- dokumen, tidak ditebak di sini).
--
-- `versi` SENGAJA TIDAK dinaikkan (sama seperti migrasi koreksi kolom_dipanen
-- sebelumnya — pdt.registry.test.ts menegakkan versi === 1 untuk seluruh
-- modul hari ini).
-- ============================================================================

ALTER TABLE pdt_parser_modul
  ADD COLUMN kolom_opsional text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN pdt_parser_modul.kolom_opsional IS
  'G1-08-SEBAGIAN — subset kolom_dipanen yang boleh hilang tanpa menggagalkan berkas '
  '(parse_status turun ke ''sebagian'', bukan ''gagal''). Bucket 2 (derived-add) '
  'PDT_KOLOM_DIPANEN.md per modul.';

-- 1.2 tt_product_analytics — report.dim_produk(0.12)/adsscanner
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Nama', 'Klik produk']
 WHERE kode = 'tt_product_analytics';

-- 1.4 tt_transaction_creator — copilot A1/A2 + PX Flow D commission_pct
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Video', 'Siaran LIVE', 'Perkiraan komisi']
 WHERE kode = 'tt_transaction_creator';

-- 1.5 tt_video — report.dim_video(0.18)
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)']
 WHERE kode = 'tt_video';

-- 1.6 tt_live — report.dim_live(0.22)/copilot L3/pemisah toko-vs-afiliasi
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Penonton', 'CTOR', 'Kreator']
 WHERE kode = 'tt_live';

-- 1.7 tt_shop_analytics — gmvNet/channel-mix (baseline/metrik.ts toko(), report B-2.3)
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY[
    'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut',
    'GMV dari video afiliasi', 'GMV dari video akun tertaut'
  ]
 WHERE kode = 'tt_shop_analytics';

-- 1.8 tt_ads_product — report.dim_gmvmax(0.22), sisi pendapatan ROAS
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Pendapatan kotor']
 WHERE kode = 'tt_ads_product';

-- 1.9 tt_ads_live — report.dim_gmvmax(0.22)
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Pendapatan kotor']
 WHERE kode = 'tt_ads_live';

-- 1.10 tt_affiliate_video — dipanen ke berkas mentah, belum punya kolom tujuan di pdt_fact_content
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY[
    'Campaign ID', 'Campaign name', 'Creator follower count', 'Product ID', 'Product name',
    'Shop code', 'Shop name', 'Video name', 'Post time',
    'Creator video-attributed orders', 'Affiliate video orders', 'Creator-attributed items sold',
    'Estimated affiliate partner commission ', 'Actual affiliate partner commission',
    'Video product RPM'
  ]
 WHERE kode = 'tt_affiliate_video';

-- 2.2 shopee_parent_sku — dim product_performance(0.14)/sumbu X 4-kuadran Shopee
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Pengunjung Produk (Kunjungan)']
 WHERE kode = 'shopee_parent_sku';

-- 2.3 shopee_ads_cpc — HealthAds.acos/B-4.3
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)']
 WHERE kode = 'shopee_ads_cpc';

-- 3.1 meta_ads — kunci pemisah baris ringkasan vs mingguan
UPDATE pdt_parser_modul SET kolom_opsional = ARRAY['Minggu']
 WHERE kode = 'meta_ads';
