-- =============================================================================
-- F-02 · `pdt_fact_ads.tujuan` (upper/lower funnel) — R9 guardrail di KOLOM,
-- bukan cuma prosa
--
-- KENAPA KOLOM INI ADA. PRD `CDPS_Module20_PDT_Laporan_Klien.md` R9 (§3, TikTok
-- Ads Manager, Gelombang F selanjutnya) membawa EMPAT modul baru:
-- `tt_ads_manager_consideration`/`follows`/`showcase`/`videoviews` — SEMUANYA
-- kampanye upper-funnel (jangkauan/awareness/add-to-cart), BUKAN kampanye
-- penjualan. Guardrail-nya, diport apa adanya dari M14: "belanja Ads Manager
-- TIDAK boleh masuk perhitungan ROI GMV Max — kampanye ini dioptimasi ke
-- jangkauan/checkout, bukan pesanan; mencampurnya membuat kampanye penjualan
-- terlihat lebih buruk dari kenyataan."
--
-- Sebelum kolom ini, `recomputeAdsMetricEntriesPdt` (M20 E-03, PR #504) —
-- penulis `metric_entries` untuk ROAS Attainment (Health Score) — MENJUMLAH
-- SELURUH baris `pdt_fact_ads` untuk satu (client_platform_id, periode), nol
-- filter `sumber`/funnel. Begitu Gelombang F menulis baris TTAM ke tabel yang
-- SAMA, jumlah itu diam-diam kemasukan belanja awareness/showcase — persis bug
-- yang guardrail M14 sudah cegah di sisi lama, dan PDT belum.
--
-- BINER, bukan taksonomi kaya — PRD menulis "upper/lower funnel" berulang kali,
-- tidak pernah "awareness/consideration/conversion" bertingkat. `tt_ads_manager_
-- showcase` MEMBAWA data ATC/Initiate Checkout (funnel Shop), tapi tetap
-- 'upper': ia dioptimasi ke checkout bukan pesanan tuntas, dan R9 sendiri
-- menaruhnya satu baris dengan tiga modul awareness lain tanpa pembeda.
--
-- Backfill: KEENAM `sumber` yang sudah ada hari ini (`shopee_ads_cpc`,
-- `shopee_ads_search`, `shopee_ads_live`, `tt_ads_product`, `tt_ads_live`,
-- `meta_ads` — lihat komentar kolom `sumber`) SEMUANYA kampanye penjualan
-- (lower-funnel, dioptimasi ke pesanan/GMV) — nol modul upper-funnel ada
-- sebelum Gelombang F. `NOT NULL` (bukan nullable seperti
-- `tipe_kampanye_sumber`) karena BUKAN "berkas ini tidak membawa kolomnya" —
-- setiap baris fakta, dari sumber manapun, PUNYA jawaban upper-atau-lower;
-- absennya nilai akan jadi lubang guardrail, bukan ketidaktahuan yang sah.
-- =============================================================================

ALTER TABLE pdt_fact_ads
  ADD COLUMN tujuan varchar(8) NULL;

UPDATE pdt_fact_ads SET tujuan = 'lower' WHERE tujuan IS NULL;

ALTER TABLE pdt_fact_ads
  ALTER COLUMN tujuan SET NOT NULL,
  ADD CONSTRAINT ck_pdt_fact_ads_tujuan CHECK (tujuan IN ('upper', 'lower'));

COMMENT ON COLUMN pdt_fact_ads.tujuan IS
  'upper = kampanye jangkauan/awareness/checkout (TikTok Ads Manager, Gelombang F) — '
  'DIKELUARKAN dari ROI GMV Max (R9 guardrail). lower = kampanye penjualan (Shopee Ads, '
  'TikTok Shop Ads) — dihitung ke ROAS Attainment/Health Score seperti sekarang. Ditegakkan '
  'di packages/domain/src/pdt.ts::recomputeAdsMetricEntriesPdt (`and tujuan = ''lower''`).';
