-- =============================================================================
-- F-04 (M20 R9 lanjutan) — kolom `hasil` di `pdt_fact_ads`: hitungan metrik
-- OPTIMASI per modul TTAM upper-funnel, digenericisasi satu kolom (pola sama
-- `biaya`/`tayangan`/`klik` yang sudah dipakai lintas `sumber`):
--   - `tt_ads_manager_videoviews` → jumlah video views ('Video views' /
--     '6-second focused views' / 'Tayangan video', tiga varian bilingual
--     F-03) — konsumen: report.tahap `vv_views`.
--   - `tt_ads_manager_follows`    → jumlah 'Paid follows' — konsumen:
--     report.tahap `fol_follows`.
--   - `tt_ads_manager_showcase`   → jumlah 'Adds to cart (Shop)' — konsumen:
--     report.tahap `sc_atc` DAN funnel puncak langkah `atc` (satu-satunya
--     langkah funnel yang benar-benar bersumber dari Ads Manager).
--   - `tt_ads_manager_consideration` → TIDAK dipanen (nol konsumen di
--     report saat ini — 'New consideration size' bukan field yang
--     ditampilkan), `hasil` PERMANEN null untuk sumber ini, sama pola
--     `gmv`/`pesanan_sku`/`roas` di keempat modul TTAM.
--
-- `vv_cpm`/`vv_per1k`/`fol_cost`/`sc_cost_atc` (report.tahap) SENGAJA tidak
-- dapat kolom sendiri — semuanya turunan `biaya`/`tayangan`/`hasil` yang
-- sudah ada (Rule 4: auto-calculated, selalu recomputable, tidak pernah
-- disimpan).
--
-- `docs/DECISIONS.md` M20-R9-F-04-TAHAP-FUNNEL.
-- =============================================================================

ALTER TABLE pdt_fact_ads ADD COLUMN hasil integer NULL;
ALTER TABLE pdt_fact_ads ADD CONSTRAINT ck_pdt_fact_ads_hasil CHECK (hasil IS NULL OR hasil >= 0);

COMMENT ON COLUMN pdt_fact_ads.hasil IS
  'Hitungan hasil optimasi per sumber TTAM upper-funnel: video views (videoviews), '
  'paid follows (follows), add-to-cart Shop (showcase). NULL untuk consideration '
  '(nol konsumen report) dan seluruh sumber lain (tt_ads_product/tt_ads_live/'
  'shopee_*/meta_ads) yang tidak punya metrik "hasil" bergrain sama.';
