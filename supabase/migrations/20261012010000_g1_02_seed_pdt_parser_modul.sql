-- G1-02 · Seed `pdt_parser_modul` + `pdt_kolom_alias` — menyatukan EMPAT
-- registry lama (baseline/detect.ts, report/detect.ts, report/shopee/detect.ts,
-- adsscanner/tiktok/detect.ts) + tiga modul baru yang PRD §7 sebut belum py
-- registry (shopee_video header 2 lapis, shopee_chat_broadcast, meta_ads).
-- Lihat docs/backlog/PDT_BACKLOG.md G1-02 dan docs/prd/CDPS_PDT_Pusat_Data_Toko.md §7.
--
-- CERMIN `packages/core/src/pdt/modules.ts` (`PDT_MODULES`/`PDT_KOLOM_ALIAS`) —
-- pola sama dengan `adsscanner_benchmark` ↔ `ADSSCANNER_BENCH_V1`
-- (20260910010000): satu sumber TS yang dites (packages/core/src/pdt/detect.test.ts,
-- 29 tes), migrasi ini menyalin nilainya literal. Dijaga tetap sinkron oleh
-- packages/db/src/pdt.registry.test.ts (dual-home, gated DATABASE_URL).
--
-- Sumber per kolom, per prioritas — lihat komentar lengkap di modules.ts:
--  1. docs/backlog/PDT_KOLOM_DIPANEN.md (whitelist kolom_dipanen MENGIKAT)
--  2. docs/prd/CDPS_PDT_Pusat_Data_Toko.md §7 (nama modul, sample, baris header)
--  3. Registry lama (detect.ts) + fixture teruji report/shopee/shopee.test.ts
--     (HANYA untuk tanda_tangan_kolom/deteksi, tidak pernah mengarang kolom_dipanen)
--
-- Rule 6 (deteksi TIDAK PERNAH bergantung nama berkas) dan Rule 7 (baris
-- header dicari, tidak diasumsikan) berlaku di `tanda_tangan_kolom`: bentuknya
-- {must, mustNot?, anyOf?} dicocokkan lewat pemindaian SELURUH baris sheet,
-- bukan indeks tetap (packages/core/src/pdt/detect.ts).
--
-- DUA MODUL BELUM TERVERIFIKASI (dicatat docs/DECISIONS.md 2026-09-13, bukan
-- ditebak): `shopee_diskon`/`shopee_flash_sale` (UAT Fim Motor SHP-3
-- membuktikan pasangan ini hanya terselesaikan lewat nama berkas mentah, yang
-- Rule 6 larang; nol kolom pembeda yang terverifikasi) dan `shopee_video`
-- (PDT_KOLOM_DIPANEN §2.7 menulis "11 dari 54 kolom" abstrak — tak satu pun
-- dari 54 nama kolom tertulis literal di dokumen/kode manapun di repo ini).
-- Ketiganya di-seed dengan sentinel `{"must": ["__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__"]}`
-- — sebuah string yang mustahil cocok ke isi berkas nyata, supaya deteksi
-- otomatis TIDAK PERNAH "menang" untuk modul ini secara diam-diam. Baris
-- seed-nya tetap ada (DoD: "setiap modul di PRD §7 punya baris"), AM memilih
-- modulnya lewat dropdown (Rule G1-09) sampai sample asli menutup gapnya.

-- ===========================================================================
-- 1. pdt_parser_modul — 25 modul (9 TikTok + 15 Shopee + 1 lintas platform)
-- ===========================================================================
INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, wajib, versi) VALUES

-- --- TikTok (PRD §7.1 / PDT_KOLOM_DIPANEN §1) -------------------------------
('tt_orders', 'tiktok', 'TikTok — Semua Pesanan',
 '{"must": ["Order ID", "SKU ID", "Order Status", "Paid Time"]}'::jsonb,
 1,
 ARRAY['Order ID','SKU ID','Seller SKU','Product Name','Variation','Quantity','SKU Unit Original Price','SKU Subtotal After Discount','Order Status','Paid Time','Product Category','Creator Handle'],
 true, 1),

('tt_product_analytics', 'tiktok', 'TikTok — Analitik Produk',
 '{"must": ["ID Produk", "GMV dari kreator", "Klik produk"]}'::jsonb,
 4,
 ARRAY['ID Produk','GMV','GMV dari kreator','GMV dari video penjual','GMV dari LIVE penjual','Pesanan SKU','AOV','CTR','CTOR','Impresi produk','Status daftar produk','Nama','Klik produk'],
 true, 1),

('tt_transaction_product', 'tiktok', 'TikTok — Transaction Analysis (Produk)',
 '{"must": ["Product ID", "Product category", "Sampel terkirim"]}'::jsonb,
 1,
 ARRAY['Product ID','Product category','GMV dari kreator','CTOR','Video','Siaran LIVE','Sampel terkirim'],
 true, 1),

('tt_transaction_creator', 'tiktok', 'TikTok — Transaction Analysis (Kreator)',
 '{"must": ["Creator name", "GMV dari kreator"]}'::jsonb,
 1,
 ARRAY['Creator name','GMV dari kreator','AOV','CTOR','Pesanan teratribusi','Tayangan video','Video','Siaran LIVE','Perkiraan komisi'],
 true, 1),

('tt_video', 'tiktok', 'TikTok — Video Performance List',
 '{"must": ["Informasi Video", "GPM (Rp)"]}'::jsonb,
 3,
 ARRAY['ID Kreator','ID Video','Waktu','Produk','VV','Likes','Dibagikan','Klik Produk','Nama Kreator','Informasi Video','GPM (Rp)','GMV dari video (Rp)'],
 true, 1),

('tt_live', 'tiktok', 'TikTok — Live Analysis',
 '{"must": ["GMV dari LIVE (Rp)", "Waktu Live"]}'::jsonb,
 3,
 ARRAY['ID Kreator','Waktu Live','Durasi','GMV dari LIVE (Rp)','Produk Terjual','Penonton','CTOR','Kreator'],
 true, 1),

('tt_shop_analytics', 'tiktok', 'TikTok — Shop Analytics (Key Metrics)',
 '{"must": ["GMV", "GMV dari LIVE kreator", "Pengunjung"], "mustNot": ["ID Produk"]}'::jsonb,
 1,
 ARRAY['GMV','Pesanan','Pembeli','Pesanan SKU','Pengunjung','Persentase konversi','Pendapatan bruto','Pengembalian dana','GMV dari LIVE akun tertaut','GMV dari LIVE kreator','GMV dari video afiliasi','GMV dari video akun tertaut'],
 true, 1),

('tt_ads_product', 'tiktok', 'TikTok Ads Manager — Product Campaigns',
 '{"must": ["Nama kampanye", "ID produk", "Biaya"]}'::jsonb,
 1,
 ARRAY['ID Campaign','ID produk','ID video','Akun TikTok','Biaya','Pesanan SKU','Biaya per pesanan','Pendapatan kotor'],
 false, 1),

('tt_ads_live', 'tiktok', 'TikTok Ads Manager — Live Campaigns',
 '{"must": ["Nama LIVE", "Nama kampanye", "Biaya"]}'::jsonb,
 1,
 ARRAY['Nama LIVE','ID Campaign','Biaya','Pesanan SKU','ROI','Pendapatan kotor'],
 false, 1),

-- --- Shopee (PRD §7.2 / PDT_KOLOM_DIPANEN §2) -------------------------------
('shopee_shop_stats', 'shopee', 'Shopee — Bisnis Saya (Home, 12 sheet)',
 '{"must": ["Pesanan Dibuat", "Total Pengunjung"]}'::jsonb,
 2,
 ARRAY['Total Penjualan (IDR)','Total Pesanan','Penjualan per Pesanan','Produk Diklik','Total Pengunjung','Tingkat Konversi Pesanan','Pesanan Dibatalkan','Penjualan Dibatalkan','Pesanan Dikembalikan','Penjualan Dikembalikan','Pembeli','Total Pembeli Baru','Total Pembeli Saat Ini','Total Potensi Pembeli','Tingkat Pembelian Berulang'],
 true, 1),

('shopee_parent_sku', 'shopee', 'Shopee — Parent SKU Detail',
 '{"must": ["Kode Produk", "Kode Variasi", "SKU Induk"]}'::jsonb,
 1,
 ARRAY['Kode Produk','Kode Variasi','SKU Induk','Total Penjualan (Pesanan Dibuat) (IDR)','Penjualan (Pesanan Siap Dikirim) (IDR)','Jumlah Produk Dilihat','Produk Diklik','Tingkat Konversi (Pesanan yang Dibuat)','repeat order','Pengunjung Produk (Kunjungan)'],
 true, 1),

('shopee_ads_cpc', 'shopee', 'Shopee Ads — Iklan Keseluruhan (CPC)',
 '{"must": ["Kode Produk", "Dilihat", "Biaya"]}'::jsonb,
 8,
 ARRAY['ID Toko','Periode','Kode Produk','Dilihat','Jumlah Klik','Konversi','Biaya','nama iklan','omzet penjualan','Efektifitas Iklan','Biaya Iklan Terhadap Omzet (ACOS) (%)'],
 false, 1),

('shopee_ads_search', 'shopee', 'Shopee Ads — Search Ads',
 '{"must": ["Kata Pencarian"]}'::jsonb,
 8,
 ARRAY['klik','konversi'],
 false, 1),

('shopee_ads_live', 'shopee', 'Shopee Ads — Live',
 '{"must": ["Nama Iklan", "Penonton"]}'::jsonb,
 7,
 ARRAY['ID Iklan','Penonton','Pesanan','Omzet','Biaya','Efektifitas Iklan'],
 false, 1),

('shopee_live', 'shopee', 'Shopee — Live Streaming',
 '{"must": ["Informasi Streaming", "Waktu Mulai"]}'::jsonb,
 1,
 ARRAY['Informasi Streaming','Waktu Mulai','Pengunjung','Penjualan'],
 true, 1),

('shopee_video', 'shopee', 'Shopee — Video Overview',
 '{"must": ["__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__"]}'::jsonb,
 1,
 ARRAY[]::text[],
 true, 1),

('shopee_voucher', 'shopee', 'Shopee — Voucher Toko',
 '{"must": ["Periode Waktu", "Klaim"]}'::jsonb,
 1,
 ARRAY['Periode Waktu','Klaim','Pesanan (Pesanan Dibuat)','Penjualan (Pesanan Dibuat) (IDR)','Tingkat Penggunaan (Pesanan Dibuat)','Pembeli (Pesanan Dibuat)','Total Biaya (Pesanan Dibuat) (IDR)'],
 false, 1),

('shopee_diskon', 'shopee', 'Shopee — Diskon Toko',
 '{"must": ["__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__"]}'::jsonb,
 1,
 ARRAY[]::text[],
 false, 1),

('shopee_flash_sale', 'shopee', 'Shopee — Flash Sale Toko',
 '{"must": ["__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__"]}'::jsonb,
 1,
 ARRAY[]::text[],
 false, 1),

('shopee_chat', 'shopee', 'Shopee — Performa Chat',
 '{"anyOf": [{"must": ["Grafik Kriteria"]}, {"must": ["Periode Waktu", "CSAT"]}, {"must": ["Periode Waktu", "Jumlah Chat"]}]}'::jsonb,
 1,
 ARRAY['Periode Waktu','Pengunjung','Jumlah Chat','Chat Dibalas','Waktu Respon Rata-rata','CSAT %','Persentase Chat Dibalas','Total Pesanan','Penjualan (IDR)','Tingkat Konversi (Chat Dibalas)'],
 false, 1),

('shopee_chat_broadcast', 'shopee', 'Shopee — Chat Broadcast',
 '{"must": ["penerima", "dibaca", "diklik"]}'::jsonb,
 1,
 ARRAY['penerima','dibaca','diklik','pesanan'],
 false, 1),

('shopee_ams_produk', 'shopee', 'Shopee AMS — Performa Produk (Afiliasi)',
 '{"must": ["Omzet", "Nama Produk"], "mustNot": ["Username", "Kreator", "Creator"]}'::jsonb,
 1,
 ARRAY['Kode Item','Omzet','Nama Produk','Komisi','ROI'],
 false, 1),

('shopee_ams_afiliasi', 'shopee', 'Shopee AMS — Performa Afiliasi (Kreator)',
 '{"must": ["Omzet"], "anyOf": [{"must": ["Username"]}, {"must": ["Kreator"]}, {"must": ["Creator"]}]}'::jsonb,
 1,
 ARRAY['ID Affiliates','Username','Omzet','Produk Terjual','Pesanan','Komisi','ROI'],
 false, 1),

('shopee_kesehatan', 'shopee', 'Shopee — Kesehatan Toko',
 '{"anyOf": [{"must": ["Poin Pinalti"]}, {"must": ["Poin Penalti"]}]}'::jsonb,
 1,
 ARRAY['Poin Penalti','Deskripsi','Durasi'],
 true, 1),

-- --- Lintas platform (PRD §7.3) ---------------------------------------------
('meta_ads', 'meta', 'Meta Ads — Laporan Kampanye',
 '{"must": ["Minggu", "Dibelanjakan"]}'::jsonb,
 1,
 ARRAY['Nama kampanye','Nama iklan','Jumlah yang dibelanjakan','Nilai Konversi Pembelian','ROAS','Impresi','Klik tautan','CTR','CPM','CPC','Minggu'],
 false, 1);

-- ===========================================================================
-- 2. pdt_kolom_alias — alias yang sudah diketahui (PDT_KOLOM_DIPANEN §1.6/1.7/5)
-- ===========================================================================
INSERT INTO pdt_kolom_alias (modul_kode, kolom_kanonik, alias, versi_pertama) VALUES
('tt_shop_analytics', 'GMV dari LIVE akun tertaut', 'GMV LIVE penjual', 1),
('tt_shop_analytics', 'GMV dari LIVE akun tertaut', 'GMV tidak langsung dari LIVE penjual', 1),
('tt_live', 'Kreator', 'Nama panggilan', 1),
('shopee_parent_sku', 'Total Penjualan (Pesanan Dibuat) (IDR)', 'Total Penjualan', 1),
('shopee_parent_sku', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Tingkat Konversi Pesanan', 1);
