-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — modul KEENAM: `shopee_ads_cpc` → `pdt_fact_ads`
-- (docs/backlog/PDT_BACKLOG.md §G1-09, docs/DECISIONS.md 2026-09-14 "modul
-- KEENAM"). `pdt_fact_ads.kampanye_id varchar(128)` dirancang G1-01 dengan
-- asumsi ISI-nya selalu ID pendek (`ID Iklan` numerik Shopee, `ID Campaign`
-- TikTok) — asumsi itu PECAH begitu `shopee_ads_cpc` dipetakan: modul ini
-- TIDAK punya ID kampanye numerik sama sekali di whitelist-nya (Rule 8,
-- `PDT_KOLOM_DIPANEN.md` §2.3), kunci baris satu-satunya yang tersedia adalah
-- `nama iklan` — TEKS BEBAS yang bisa sepanjang nama produk yang dicerminnya
-- (sample Fim Motor asli sudah mencapai 116 karakter untuk satu baris,
-- mendekati batas 128).
--
-- Dilebarkan ke varchar(255) — MENCERMIN `pdt_sku_master.nama_produk
-- varchar(255)` (G1-01), bukan angka sembarang: batas panjang judul produk
-- Shopee sendiri. `sumber` lain yang sudah memakai kolom ini (`shopee_ads_live`
-- `ID Iklan`, numerik pendek) tidak terpengaruh — melebarkan varchar tidak
-- mengubah nilai yang sudah tersimpan (ALTER COLUMN TYPE varchar(N) ke N yang
-- lebih besar adalah operasi metadata murni di Postgres, bukan rewrite tabel).
-- ============================================================================
ALTER TABLE pdt_fact_ads ALTER COLUMN kampanye_id TYPE varchar(255);

COMMENT ON COLUMN pdt_fact_ads.kampanye_id IS
  'Kunci baris per sumber (bagian uq_pdt_fact_ads). ID platform pendek untuk sumber ber-ID (shopee_ads_live "ID Iklan", *_ads_product/*_ads_live "ID Campaign") — TEKS BEBAS (nama iklan, bisa sepanjang judul produk) untuk shopee_ads_cpc, yang tidak punya ID kampanye numerik di kolomDipanen-nya (docs/DECISIONS.md 2026-09-14 modul KEENAM). varchar(255) mencermin batas panjang judul produk Shopee (pdt_sku_master.nama_produk), bukan batas ID.';
