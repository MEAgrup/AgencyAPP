-- CDPS M16 §4.2 (Ads) — LT-43: Mini / Monthly / Content Analysis report, DI ATAS
-- mekanisme `ads_weekly_reports` yang sudah ada (M8 laporan mingguan Advertiser,
-- `20260819020000`) — bukan tabel baru, sesuai instruksi ("jangan bangun ulang").
--
-- Kolom `jenis_laporan` baru, default `'Weekly'` supaya seluruh baris existing
-- (dan seluruh caller lama yang belum tahu kolom ini) tetap berperilaku persis
-- sama. Primary key diperluas dari `(brief_id, iso_year, iso_week)` menjadi
-- `(brief_id, iso_year, iso_week, jenis_laporan)` — beberapa JENIS laporan boleh
-- hidup berdampingan untuk minggu yang sama (mis. Weekly DAN Monthly di-file
-- pada minggu yang sama saat bulan tutup), tapi laporan yang SAMA jenisnya untuk
-- minggu yang sama tetap tunggal (aturan append-only lama, `MSG_LAPORAN_SUDAH_ADA`,
-- tidak berubah — hanya sekarang bersifat per-jenis).

ALTER TABLE ads_weekly_reports
    ADD COLUMN jenis_laporan varchar(24) NOT NULL DEFAULT 'Weekly';

ALTER TABLE ads_weekly_reports
    ADD CONSTRAINT ck_awr_jenis CHECK (jenis_laporan IN (
        'Weekly', 'Mini', 'Monthly', 'Content Analysis'));

ALTER TABLE ads_weekly_reports DROP CONSTRAINT ads_weekly_reports_pkey;
ALTER TABLE ads_weekly_reports
    ADD CONSTRAINT ads_weekly_reports_pkey
    PRIMARY KEY (brief_id, iso_year, iso_week, jenis_laporan);

COMMENT ON COLUMN ads_weekly_reports.jenis_laporan IS
  'M16 LT-43 — Weekly (default, mekanisme asli M8) | Mini | Monthly | Content Analysis. Baris yang sama shape-nya (analisa/saran/kendala per minggu ISO), hanya jenisnya berbeda — bukan mekanisme baru.';
