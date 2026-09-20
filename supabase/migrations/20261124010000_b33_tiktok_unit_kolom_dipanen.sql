-- ============================================================================
-- B33-TIKTOK-UNIT — `tt_product_analytics` memanen `'Produk terjual'`
-- (docs/DECISIONS.md 2026-09-20).
--
-- `pdt_parser_modul` adalah registry yang "hidup di DB, bukan di kode"
-- (komentar G1-01), dan `packages/db/src/pdt.registry.test.ts` menegakkannya
-- set-equal dengan `packages/core/src/pdt/modules.ts`. Migrasi ini membawa sisi
-- DB ke whitelist yang sama — pola persis `20261123010000`, `20261122010000`
-- dan `20261119010000`.
--
-- KENAPA: QA pemilik 2026-09-20 atas PDT TikTok Shop — "B-3.3 unit terjual
-- HARUSNYA terisi otomatis dari PDT". Benar. Dikonfirmasi atas produksi:
-- `pdt_fact_sku_period` TikTok (basis `net`, 24 baris) punya `nama_produk`
-- 24/24 tapi `produk_terjual` **0/24**.
--
-- Akarnya satu kolom yang tidak pernah dipanen. Docblock
-- `ekstrakBarisTtProductAnalytics` menyatakan `'Produk terjual'` "TIDAK dipanen
-- modul ini sama sekali ... bukan celah — kolomnya memang tidak pernah masuk
-- whitelist". Pernyataan itu KELIRU, dan dibuktikan dengan membaca berkas
-- aslinya (`product_list_20260701.xlsx`, Avitaskin Juli 2026 — berkas yang SAMA
-- dengan batch produksi #7): berkas itu punya 176 kolom, dan kolom ke-22 di
-- bawah kelompok `'Semua'` bernama persis `Produk terjual`.
--
-- Nilainya juga diverifikasi, bukan diasumsikan — tiga produk teratas:
--
--   ID Produk              Pesanan   Pesanan SKU   Produk terjual
--   1731432176719595405         57            57               58
--   1731432242309728141         27            27               27
--   1731432161391839117         12            12               12
--
-- `Produk terjual` selalu ≥ `Pesanan SKU`, hubungan yang memang harus berlaku
-- antara UNIT dan PESANAN — dan yang membuktikan keduanya kolom BERBEDA.
-- `Pesanan SKU` sudah dipanen sejak awal dan dipetakan ke `pesanan_sku`; ia
-- BUKAN pengganti unit terjual.
--
-- Kolomnya ikut `kolom_opsional` DENGAN SENGAJA, alasan yang sama persis
-- `20261123010000`: `tt_product_analytics` adalah modul `wajib`, jadi menaruh
-- kolom baru sebagai WAJIB berarti satu ekspor yang tidak membawanya jatuh ke
-- `parse_status='gagal'`, dibuang dari `terparse`, dan menggagalkan pasangan
-- rekonsiliasi TikTok (Rule 13-14) — menukar satu kolom B-3.3 yang kosong
-- dengan pintu upload yang tertutup. Ini persis regresi yang `20261122010000`
-- baru saja bereskan untuk modul INI (ejaan `AOV`/`CTOR` membuat nol batch
-- TikTok pernah mencapai `verified`). Hilang ⇒ `sebagian`: berkasnya TETAP
-- dipakai, hanya `produk_terjual`-nya yang tidak lahir.
--
-- `versi` SENGAJA TIDAK dinaikkan — `pdt.registry.test.ts` menegakkan
-- `versi === 1` untuk SELURUH modul (alasan sama migrasi-migrasi di atas).
-- Yang naik `PDT_PARSER_VERSI` (kode, bukan DB), supaya tick reparse G1-11
-- menyapu batch lama — lihat migrasi pendamping di PR yang sama.
--
-- Nol perubahan SKEMA: `pdt_fact_sku_period.produk_terjual` sudah ada sejak
-- G1-01. Yang kurang selama ini pemanennya, bukan tempatnya.
-- ============================================================================

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'ID Produk','GMV','GMV dari kreator','GMV dari video penjual','GMV dari LIVE penjual',
         'Pesanan SKU','AOV (pesanan SKU)','CTR','CTOR (pesanan SKU)','Impresi produk',
         'Status daftar produk','Nama','Klik produk','Produk terjual'
       ],
       kolom_opsional = ARRAY['Nama','Klik produk','Produk terjual']
 WHERE kode = 'tt_product_analytics';
