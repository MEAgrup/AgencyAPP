-- =============================================================================
-- F-03 lanjutan (M20 R9) · Koreksi `tt_ads_manager_videoviews` + seed TIGA
-- modul TTAM baru (`tt_ads_manager_consideration`/`_follows`/`_showcase`).
-- Cermin `packages/core/src/pdt/modules.ts` `PDT_MODULES` — pola sama
-- `20261122010000` (UPDATE kolom yang tidak cocok berkas nyata) + pola sama
-- `20261204010000`/`20261203020000` (INSERT modul baru yang lahir SESUDAH
-- seed awal G1-02).
--
-- KENAPA `tt_ads_manager_videoviews` DIKOREKSI: sample asli 2026-09-23
-- ('TTAM Video views' — Gold Pigeon/Cottonella/Lano Batik, TIGA berkas
-- TAMBAHAN di luar Ultrasleep yang jadi dasar migrasi 20261204010000)
-- membuktikan tanda tangan pertama SALAH ASUMSI "sample tunggal = seluruh
-- populasi": mayoritas ekspor nyata (2/3 sample baru) punya kolom literal
-- 'Video views' (BUKAN '6-second focused views' yang jadi anchor lama), dan
-- satu klien (Lano Batik) mengekspor dalam BAHASA INDONESIA sama sekali
-- (header 'Nama Iklan'/'Belanja'/'Impresi'/'Tayangan video', tapi 'CPM' tetap
-- Inggris). `mustNot: 'New consideration size'` BARU JUGA wajib — sample
-- Brand Considerations (baru tiba sesi yang sama) membuktikan berkas itu
-- JUGA punya 'Spend'+'CPM'+'6-second focused views', yang tanpa penyangkal
-- ini akan bikin `tt_ads_manager_videoviews` DAN `tt_ads_manager_consideration`
-- sama-sama cocok satu berkas (`ambiguous`). Lihat docblock modul di
-- `modules.ts` untuk analisis substring-collision lengkap (termasuk kenapa
-- `must: ['CPM']` sendirian tidak bertabrakan dengan `meta_ads`).
--
-- KENAPA TIGA MODUL BARU: sample asli KEEMPAT tipe TTAM (Brand
-- Considerations/Follows/Showcase/Video views) diunggah pemilik sekaligus
-- 2026-09-23, menutup `M20-TTAM-SAMPLE` sepenuhnya (sebelumnya hanya
-- videoviews yang punya bukti, keputusan pemilik lewat `AskUserQuestion`
-- "bangun videoviews sekarang" — `docs/DECISIONS.md` entri F-03 pertama).
--
-- `wajib = false` (opsional, sisi ads, bukan sisi rekonsiliasi GMV toko, pola
-- sama tiga modul TTAM lain), `versi = 1` (`pdt.registry.test.ts` menegakkan
-- versi===1 untuk seluruh modul — TIDAK dinaikkan di sini, sama alasan
-- migrasi `20261122010000`).
-- =============================================================================

UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["CPM"], "mustNot": ["New consideration size"], "anyOf": [{"must": ["Spend", "Video views"]}, {"must": ["Spend", "6-second focused views"]}, {"must": ["Belanja", "Tayangan video"]}]}'::jsonb
 WHERE kode = 'tt_ads_manager_videoviews';

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, kolom_opsional, wajib, versi) VALUES
('tt_ads_manager_consideration', 'tiktok', 'TikTok Ads Manager — Brand Considerations (upper funnel)',
 '{"must": ["New consideration size"]}'::jsonb,
 1,
 ARRAY['Ad name','Spend','Impressions','Clicks (destination)'],
 '{}',
 false, 1),
('tt_ads_manager_follows', 'tiktok', 'TikTok Ads Manager — Follows (upper funnel)',
 '{"must": ["Paid follows"], "mustNot": ["New consideration size"]}'::jsonb,
 1,
 ARRAY['Ad name','Spend','Impressions','Clicks (destination)'],
 '{}',
 false, 1),
('tt_ads_manager_showcase', 'tiktok', 'TikTok Ads Manager — Showcase (upper funnel)',
 '{"must": ["Spend"], "anyOf": [{"must": ["Adds to cart (Shop)"]}, {"must": ["Checkouts initiated (Shop)"]}]}'::jsonb,
 1,
 ARRAY['Ad name','Spend','Impressions','Clicks (destination)'],
 '{}',
 false, 1);
