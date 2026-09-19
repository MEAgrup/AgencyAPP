-- ============================================================================
-- KOREKSI REGISTRY DB agar cocok `packages/core/src/pdt/modules.ts`
-- (docs/DECISIONS.md 2026-09-19 "LIMA EJAAN WHITELIST").
--
-- `pdt_parser_modul`/`pdt_kolom_alias` adalah registry yang "hidup di DB, bukan
-- di kode" (komentar G1-01), dan `packages/db/src/pdt.registry.test.ts`
-- menegakkan keduanya set-equal dengan TS. Migrasi ini membawa sisi DB ke ejaan
-- yang sama — pola sama `20261019010000` (shopee_ads_cpc) dan `20261107010000`
-- (tt_ads_product/tt_ads_live).
--
-- KENAPA: lima ejaan `kolom_dipanen` tidak pernah cocok dengan satu pun berkas
-- ekspor nyata, dan karena `kolom_dipanen` = kolom WAJIB (`validasiKolomWajib`),
-- setiap berkas yang terkena jatuh ke `parse_status='gagal'` lalu DIBUANG dari
-- `terparse` seluruhnya. Disimulasikan atas 78 berkas nyata 12 klien:
-- **0 dari 10 klien bisa mencapai `verified`** di kedua platform sebelum
-- koreksi; **10 dari 10** sesudahnya, ΔGMV 0,0000% (TikTok juga ΔPesanan
-- 0,0000%) — bukan "di bawah ambang 0,5%" Rule 13/14, tapi nol persis.
--
-- Yang dikoreksi (kiri = yang tertulis, kanan = yang berkas nyata pakai):
--   shopee_ads_live       'Omzet'                     → 'Omzet Penjualan'
--   shopee_ads_live       'Efektivitas Iklan'         → 'Efektifitas Iklan'   (ejaan Shopee, dengan F)
--   tt_product_analytics  'AOV'                       → 'AOV (pesanan SKU)'
--   tt_product_analytics  'CTOR'                      → 'CTOR (pesanan SKU)'
--   shopee_parent_sku     'Tingkat Pesanan Berulang'  → 'Tingkat Pesanan Berulang (Pesanan Dibuat)'
--
-- `tt_product_analytics.'CTR'` SENGAJA tetap polos — kolom itu memang benar
-- bernama `CTR` di berkas nyata; hanya AOV/CTOR yang bersufiks.
--
-- Ejaan lama didaftarkan sebagai ALIAS (Rule 9, `pdt_kolom_alias` append-only)
-- supaya berkas/ekspor lama tetap terbaca. Dua alias `shopee_kesehatan` dan satu
-- `meta_ads` ikut ditambahkan dari korpus yang sama.
--
-- `meta_ads` SENGAJA TIDAK dikoreksi kanoniknya: kedua ejaan
-- ('CTR Unik (rasio klik tayang tautan)' dan 'CTR (rasio klik tayang tautan)')
-- sama-sama NYATA di periode yang sama, 3 klien masing-masing. Itu bukan salah
-- eja — itu dua varian ekspor Meta yang hidup berdampingan; yang lama tetap
-- kanonik, yang baru jadi alias.
--
-- `versi` SENGAJA TIDAK dinaikkan — `pdt.registry.test.ts` menegakkan
-- `versi === 1` untuk SELURUH modul (alasan sama migrasi `shopee_ads_cpc`).
-- ============================================================================

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['ID Iklan','Penonton','Pesanan','Omzet Penjualan','Biaya','Efektifitas Iklan']
 WHERE kode = 'shopee_ads_live';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['ID Produk','GMV','GMV dari kreator','GMV dari video penjual','GMV dari LIVE penjual','Pesanan SKU','AOV (pesanan SKU)','CTR','CTOR (pesanan SKU)','Impresi produk','Status daftar produk','Nama','Klik produk']
 WHERE kode = 'tt_product_analytics';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['Kode Produk','Kode Variasi','SKU Induk','Total Penjualan (Pesanan Dibuat) (IDR)','Penjualan (Pesanan Siap Dikirim) (IDR)','Jumlah Produk Dilihat','Produk Diklik','Tingkat Konversi (Pesanan yang Dibuat)','Tingkat Pesanan Berulang (Pesanan Dibuat)','Pengunjung Produk (Kunjungan)']
 WHERE kode = 'shopee_parent_sku';

-- Tujuh alias baru. `ON CONFLICT DO NOTHING` supaya migrasi idempoten kalau
-- salah satu pasangan sudah pernah mendarat lewat jalur lain.
INSERT INTO pdt_kolom_alias (modul_kode, kolom_kanonik, alias, versi_pertama) VALUES
('tt_product_analytics', 'AOV (pesanan SKU)',  'AOV',  1),
('tt_product_analytics', 'CTOR (pesanan SKU)', 'CTOR', 1),
('shopee_parent_sku', 'Tingkat Pesanan Berulang (Pesanan Dibuat)', 'repeat order', 1),
('shopee_ads_live', 'Omzet Penjualan', 'Omzet', 1),
('shopee_kesehatan', 'Poin Penalti', 'Poin Pinalti', 1),
('shopee_kesehatan', 'Deskripsi', 'Pinalti Berjalan', 1),
('meta_ads', 'CTR Unik (rasio klik tayang tautan)', 'CTR (rasio klik tayang tautan)', 1)
ON CONFLICT DO NOTHING;
