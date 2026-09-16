-- ============================================================================
-- G1-09-2BII-TTADS-SAMPLE (DITUTUP) — koreksi `pdt_parser_modul` (seed G1-02)
-- untuk `tt_ads_product`/`tt_ads_live`, mencerminkan koreksi yang sama di
-- `packages/core/src/pdt/modules.ts` (docs/DECISIONS.md 2026-09-16) — supaya
-- kedua registry ("hidup di sini, bukan di kode", komentar G1-01
-- `pdt_parser_modul.kolom_dipanen`) tidak DRIFT satu sama lain, sama alasan
-- migrasi `shopee_ads_cpc` (20261019010000).
--
-- Diverifikasi terhadap sample EKSPOR ASLI klien (Avitaskin, Juli 2026),
-- bukan tebakan:
--  1. `tt_ads_product`: `Impresi iklan produk`/`Jumlah klik iklan produk`
--     DITAMBAHKAN — kolom nyata (100% baris terisi di sample, 2093 baris),
--     sekarang diekstrak jadi `pdt_fact_ads.tayangan`/`klik`
--     (`ekstrakBarisTtAdsProduct`, `@cdps/core` `pdt/fakta.ts`).
--  2. `tt_ads_live`: `ROI` DIHAPUS — nama kolom asli adalah `ROI (Toko saat
--     ini)`, bukan `ROI` polos; membiarkannya akan membuat
--     `validasiKolomWajib` (kolom_dipanen = kolom WAJIB) gagal untuk setiap
--     file live-campaign nyata begitu ada baris data (bug laten sejak modul
--     ini dibangun tanpa sample — kolom itu toh tidak pernah dibaca, `roas`
--     diturunkan gmv÷biaya). `Tayangan LIVE` DITAMBAHKAN — diekstrak jadi
--     `pdt_fact_ads.tayangan`.
-- ============================================================================
-- `versi` SENGAJA TIDAK dinaikkan (sama alasan migrasi `shopee_ads_cpc`
-- — `pdt.registry.test.ts` menegakkan `versi === 1` untuk SELURUH modul).
UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['ID Campaign','ID produk','ID video','Akun TikTok','Biaya','Pesanan SKU','Biaya per pesanan','Pendapatan kotor','Impresi iklan produk','Jumlah klik iklan produk']
 WHERE kode = 'tt_ads_product';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['Nama LIVE','ID Campaign','Biaya','Pesanan SKU','Pendapatan kotor','Tayangan LIVE']
 WHERE kode = 'tt_ads_live';
