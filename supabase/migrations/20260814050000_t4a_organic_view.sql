-- T-4a (RM-4 / RM-C, M6D): View Organik (blended) di rekap mingguan.
--
-- Keputusan pemilik 2026-08-14 atas "sumber view organik?": *"ada dari platform,
-- perlu dibuat blended sama dengan ctr, cvr (ada summary blendednya)"*.
--
-- Interpretasi (dicatat DECISIONS 2026-08-14, menunggu tanda tangan): view organik
-- BUKAN paid `total_view` (Σ viewer live M10) — dimensi berbeda, jangan dicampur
-- (guardrail SESI1). Ia angka dari report platform yang di-INPUT AM per minggu
-- lewat jalur manual RM-C yang sudah ada (D-04, `recordRecapMetrikManual`), lalu
-- rekap menampilkan SUMMARY BLENDED = paid `total_view` + `view_organik` (derivasi
-- read-time di halaman rekap; nol penyimpanan ganda, house rule #4).
--
-- Tak ada tabel/mesin/event/prefix baru — hanya perluasan kosakata metrik.

ALTER TABLE wrr_metrik DROP CONSTRAINT ck_wrr_metrik_key;
ALTER TABLE wrr_metrik ADD CONSTRAINT ck_wrr_metrik_key CHECK (metrik IN (
    'gmv_interim', 'roas_ads', 'total_view', 'view_organik',
    'ctr', 'cvr', 'cpc', 'cpm', 'ad_spend'));
