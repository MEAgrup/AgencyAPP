-- ============================================================================
-- G2-01-KUADRAN-SKU (lanjutan) — bagian laporan "produk" (Portfolio Produk).
-- `pdt_fact_sku_period.nama_produk` (BARU) — TAMPILAN UI SAJA (sama semangat
-- `pdt_sku_master.nama_produk`, migrasi 20261011010000: "Nama SKU TIDAK
-- PERNAH kunci di tabel manapun", Rule 20), disalin LANGSUNG dari kolom
-- 'Nama' `tt_product_analytics` (BUKAN lookup FK — `sku_id` di baris TikTok
-- SELALU null, keputusan `G1-09-2BII-ADS-CPC-SKU`, sama pola
-- `pdt_fact_ads.platform_product_id`).
--
-- Keputusan pemilik via AskUserQuestion (docs/DECISIONS.md, cari
-- "G2-01-KUADRAN-SKU (produk)"): tanpa nama produk, "produk" v1 hanya bisa
-- menampilkan RINGKASAN jumlah per kuadran — AM tidak tahu SKU MANA yang
-- perlu ditindak. Kolom 'Nama' SUDAH terverifikasi ada di whitelist
-- `tt_product_analytics` (`modules.ts`, sejak G1-01) — bukan sample baru.
-- ============================================================================
ALTER TABLE pdt_fact_sku_period
  ADD COLUMN nama_produk varchar(255) NULL; -- konsumen: report.dimensi_produk (bagian laporan "produk")
