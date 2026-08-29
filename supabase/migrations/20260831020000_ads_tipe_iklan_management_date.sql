-- CDPS M16 §4.2 (Ads) — LT-41 (Tipe Iklan) + LT-42 (Ads Management Date).
--
-- LT-41: Tipe Iklan (kamus istilah M16 2026-08-28 — bukan "Campaign", lihat
-- DECISIONS.md: pilihan setup Ads GMV Max Product/GMV Max Live/TTAM). Kolom
-- wajib pada `ad_campaigns`, posisi sama wajibnya dengan `platform`/`objective`
-- (divalidasi TS di `ads.ts createCampaign`; CHECK di sini adalah lapis kedua,
-- pola yang sama dengan `platform`/`objective` yang divalidasi TS tanpa CHECK
-- DB — tapi Tipe Iklan mendapat CHECK karena himpunannya sudah tertutup &
-- final sejak PRD, tidak seperti `platform` yang bisa bertambah operasional).
--
-- LT-42: Ads Management Date. `end_date` (Ads Management, BUKAN kolom
-- `ad_campaigns.end_date` M8 yang sudah ada — lihat catatan di bawah) adalah
-- TURUNAN READ-ONLY (aturan rumah #4):
--   end_date = start_date + durasi_jasa + additional_days + total_hari_hold
-- NOL kolom disimpan untuk end_date/total_hari_hold itu sendiri:
--   - `start_date`   = `ad_campaigns.start_date` yang SUDAH ADA (M8 §9.3) —
--                      dipakai apa adanya sebagai jangkar mulai management,
--                      TIDAK ada kolom start baru.
--   - `durasi_jasa`  = BARU, milik Master Service List (bukan Ads-spesifik —
--                      M17 §5.4 juga memakainya untuk item MSL AI Optimizer),
--                      diambil dari versi MSL yang dipin `services.master_service_id`
--                      + `services.master_version_no` (lihat `msl.ts effectiveAt`
--                      untuk pola baca versi terpin yang sama).
--   - `additional_days` = BARU, kolom pada `ad_campaigns` (tambahan manual,
--                      mis. libur Lebaran).
--   - `total_hari_hold` = TIDAK PERNAH kolom — diturunkan saat baca dari
--                      riwayat transisi `[Active]->[Paused]->[Active]` pada
--                      `audit_log` (entity_type='ad_campaign'), pola yang sama
--                      dengan `blockedMs()` M12. "Hari hold MEMPERPANJANG
--                      End-Date" (keputusan pemilik) berarti end_date BERGERAK
--                      SENDIRI setiap iklan di-resume — dihitung di
--                      `ads.ts computeAdsManagementEndDate`, TIDAK di sini.
--
-- KENAPA BUKAN `ad_campaigns.end_date` yang sudah ada: kolom itu adalah target
-- tanggal selesai CAMPAIGN yang diisi manual saat create (M8 §9.3, dipasangkan
-- dengan `target_kpi`) — semantiknya "target Advertiser", bukan "batas masa
-- kelola MEA atas layanan Ads klien". Menimpa artinya akan merusak Campaign
-- lama yang sudah memakainya untuk itu. Ads Management Date adalah KONSEP
-- KEDUA yang hidup berdampingan, dibaca lewat fungsi terpisah, tidak pernah
-- ditulis sebagai kolom `end_date`.
--
-- Satuan: KALENDER (bukan hari kerja) — durasi_jasa/additional_days/hold di
-- sini adalah konsep masa-langganan (mirip lead_time_restock_hari STRG A-6:
-- kalender), berbeda dari lead time produksi tahapan (M16 §2 Rule 6, hari
-- kerja). Dicatat sebagai keputusan implementasi untuk diverifikasi pemilik
-- saat merge (lihat HANDOFF_M16_AKUN_B.md).

ALTER TABLE ad_campaigns
    ADD COLUMN tipe_iklan      varchar(32) NOT NULL DEFAULT 'GMV Max Product',
    ADD COLUMN additional_days integer     NOT NULL DEFAULT 0;

ALTER TABLE ad_campaigns
    ADD CONSTRAINT ck_adc_tipe_iklan CHECK (tipe_iklan IN (
        'GMV Max Product', 'GMV Max Live', 'TTAM')),
    ADD CONSTRAINT ck_adc_additional_days_nonneg CHECK (additional_days >= 0);

COMMENT ON COLUMN ad_campaigns.tipe_iklan IS
  'M16 LT-41 — Tipe Iklan (kamus istilah, bukan "Campaign"): GMV Max Product | GMV Max Live | TTAM.';
COMMENT ON COLUMN ad_campaigns.additional_days IS
  'M16 LT-42 Ads Management Date — hari tambahan manual (mis. libur Lebaran) yang menambah end_date turunan. Bukan hari hold (itu diturunkan dari riwayat transisi, tidak disimpan).';

-- durasi_jasa: field generik Master Service List (dipakai Ads Management Date
-- DAN item MSL AI Optimizer baru, M17 §5.4). NULL = layanan tanpa durasi tetap
-- (mis. Komisi/passthrough) — Ads Management Date membaca NULL sebagai 0 hari
-- tambahan dari durasi_jasa (lihat `ads.ts`), bukan error.
ALTER TABLE master_service_versions
    ADD COLUMN durasi_jasa integer NULL;

ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_durasi_jasa_positive CHECK (durasi_jasa IS NULL OR durasi_jasa > 0);

COMMENT ON COLUMN master_service_versions.durasi_jasa IS
  'M16/M17 — durasi jasa dalam HARI KALENDER (mis. masa langganan Ads/AI Optimizer). NULL = tidak berlaku untuk layanan ini. Ditetapkan Admin (Sales Head/SPV/Director, canEditMasterServices) via createService/updateService — versi baru, bukan mutasi.';
