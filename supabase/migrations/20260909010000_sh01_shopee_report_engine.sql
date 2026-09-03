-- CDPS — Gelombang 2: Shopee Report Engine (`cdps.report.shopee.v1`).
--
-- Plan: docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md §5 (tiket SH-01..SH-06).
-- Port dari `docs/design/SHOPEE_REPORT_ENGINE.html` ke `packages/core/src/report/shopee/`.
--
-- KENAPA INI ADA. `client_reports` sejauh ini hanya melayani SATU mesin
-- (`cdps.report.tiktok.v1`). Migrasi ini membuat tabel yang sama bisa menyimpan
-- laporan Shopee TANPA menyentuh satu baris TikTok pun — tabel beku untuk
-- UPDATE (aturan rumah #3/#4), jadi setiap ALTER di sini murni ADD COLUMN
-- dengan DEFAULT, yang di Postgres tidak memicu trigger `BEFORE UPDATE` (baris
-- lama diisi lewat rewrite katalog, bukan lewat UPDATE per baris) — TIDAK ADA
-- statement UPDATE eksplisit di migrasi ini.
--
-- ---------------------------------------------------------------------------
-- DUA PERUBAHAN
-- ---------------------------------------------------------------------------
--  1. `client_reports.payload_schema` — penanda mesin mana yang menulis baris
--     ini. `renderReport` (packages/domain/src/report.ts) membaca kolom ini
--     untuk memilih renderer (`report.renderReportHtml` TikTok, atau
--     `reportShopee.renderReportHtml` Shopee).
--  2. `report_benchmark_shopee` — padanan `report_benchmark` (yang HANYA
--     berisi ambang TikTok) untuk CONFIG Shopee (`kuadran`/`health`/`layanan`
--     dari HTML sumber) — berversi & append-only dengan pola YANG SAMA, supaya
--     skor Shopee recomputable persis seperti skor TikTok (aturan rumah #4).
--
-- KENAPA TABEL BENCHMARK TERPISAH, BUKAN BARIS BARU DI `report_benchmark`:
-- `report_benchmark.nilai` berbentuk `{kunci: {good,warn}}` — bentuk CONFIG
-- Shopee (kuadran.percentile/absolute, dua flag boolean, sleeper_visitor_max)
-- tidak sama sekali cocok dengan bentuk itu, dan `report_benchmark.versi`
-- adalah PK tunggal yang dirujuk `client_reports.benchmark_versi` — mencampur
-- dua bentuk CONFIG berbeda di satu kolom jsonb linear versi yang sama akan
-- membuat versi Shopee dan versi TikTok berebut satu urutan angka yang tidak
-- ada hubungannya. Tabel sendiri, pola identik (append-only, frozen trigger,
-- Director-only lewat service role), FK sendiri.
--
-- KENAPA `client_reports` PAKAI DUA KOLOM BENCHMARK VERSI (bukan satu FK
-- polimorfik): Postgres tidak punya FK bersyarat native ("kalau schema=X,
-- rujuk tabel A; kalau Y, rujuk tabel B") tanpa trigger tambahan. Dua kolom
-- NULLABLE + CHECK yang memaksa TEPAT SATU terisi sesuai `payload_schema`
-- adalah pola paling sederhana yang tetap ditegakkan DI DB, bukan cuma di TS.

-- ===========================================================================
-- 1. report_benchmark_shopee — padanan Shopee dari report_benchmark.
-- ===========================================================================
CREATE TABLE report_benchmark_shopee (
    versi        integer      NOT NULL PRIMARY KEY,
    -- Bentuk cermin `ShopeeBench` (packages/core/src/report/shopee/types.ts):
    -- {kuadran:{cr_basis,percentile,absolute,medium_traffic_high_if_cr_high,
    -- medium_cr_high_if_traffic_high,sleeper_visitor_max}, health:{...}, layanan:{...}}.
    nilai        jsonb        NOT NULL,
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_report_benchmark_shopee_versi CHECK (versi >= 1)
);

COMMENT ON TABLE report_benchmark_shopee IS
  'Ambang laporan Shopee (CONFIG.kuadran/health/layanan dari MEA Shopee Report Engine) berversi, Director-only. Append-only: kalibrasi baru = versi baru. Setiap client_reports (payload_schema=cdps.report.shopee.v1) menyimpan benchmark_versi_shopee yang dipakainya (aturan rumah #4).';

-- Versi 1 = CONFIG tool pemilik (docs/design/SHOPEE_REPORT_ENGINE.html) apa adanya.
INSERT INTO report_benchmark_shopee (versi, nilai, catatan, dibuat_oleh) VALUES
    (1, jsonb_build_object(
        'kuadran', jsonb_build_object(
            'cr_basis', 'pesanan_per_pengunjung',
            'percentile', jsonb_build_object('traffic_high_pct', 0.75, 'traffic_low_pct', 0.25, 'cr_high_pct', 0.75, 'cr_low_pct', 0.25),
            'absolute', jsonb_build_object('traffic_low_max', 150, 'traffic_high_min', 500, 'conversion_low_max', 0.02, 'conversion_high_min', 0.04),
            'medium_traffic_high_if_cr_high', true,
            'medium_cr_high_if_traffic_high', true,
            'sleeper_visitor_max', 50
        ),
        'health', jsonb_build_object(
            'roas_good', 4, 'roas_warn', 2,
            'acos_good', 0.25, 'acos_warn', 0.40,
            'ctr_good', 0.005, 'cr_good', 0.015,
            'csat_good', 0.85, 'chat_respon_max_detik', 3600
        ),
        'layanan', jsonb_build_object(
            'chat_response_rate_good', 0.95,
            'chat_order_conversion_good', 0.20,
            'csat_good', 0.85,
            'chat_respon_max_detik', 3600,
            'cancel_rate_good', 0.05,
            'cancel_rate_warn', 0.10
        )
     ), 'Port CONFIG MEA Shopee Report Engine v1 apa adanya.', 'SYSTEM');

CREATE OR REPLACE FUNCTION report_benchmark_shopee_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'report_benchmark_shopee: append-only — kalibrasi baru = versi baru, versi lama immutable (aturan rumah #4)';
END;
$$;
CREATE TRIGGER trg_report_benchmark_shopee_frozen BEFORE UPDATE OR DELETE ON report_benchmark_shopee
    FOR EACH ROW EXECUTE FUNCTION report_benchmark_shopee_frozen();

REVOKE ALL ON public.report_benchmark_shopee FROM anon;
REVOKE ALL ON public.report_benchmark_shopee FROM authenticated;
ALTER TABLE public.report_benchmark_shopee ENABLE ROW LEVEL SECURITY;
-- NOL policy (default-deny) — sama seperti report_benchmark: ambang dibaca
-- hanya lewat service-role saat menskor.

-- ===========================================================================
-- 2. client_reports — payload_schema + kolom benchmark Shopee.
--    Tabel BEKU untuk UPDATE (trg_client_reports_frozen) — setiap kolom di
--    bawah ini ditambah dengan DEFAULT/NULL, mengisi baris lama TANPA UPDATE.
-- ===========================================================================
ALTER TABLE client_reports
    ADD COLUMN payload_schema varchar(48) NOT NULL DEFAULT 'cdps.report.tiktok.v1';

COMMENT ON COLUMN client_reports.payload_schema IS
  'Mesin laporan yang menulis payload baris ini — cdps.report.tiktok.v1 (default, baris lama) atau cdps.report.shopee.v1. renderReport (packages/domain/src/report.ts) memilih renderer dari kolom ini.';

-- benchmark_versi jadi NULLABLE: baris Shopee mengisi benchmark_versi_shopee,
-- bukan kolom ini (lihat CHECK ck_report_benchmark_by_schema di bawah). Baris
-- TikTok yang sudah ada TIDAK terpengaruh — nilainya tetap terisi, CHECK baru
-- otomatis benar untuk mereka karena payload_schema mereka default ke TikTok.
ALTER TABLE client_reports
    ALTER COLUMN benchmark_versi DROP NOT NULL;

ALTER TABLE client_reports
    ADD COLUMN benchmark_versi_shopee integer NULL
        REFERENCES report_benchmark_shopee (versi);

COMMENT ON COLUMN client_reports.benchmark_versi_shopee IS
  'Versi report_benchmark_shopee yang dipakai — HANYA terisi saat payload_schema=cdps.report.shopee.v1 (lihat CHECK ck_report_benchmark_by_schema). Padanan benchmark_versi (TikTok) untuk mesin Shopee.';

ALTER TABLE client_reports
    ADD CONSTRAINT ck_report_payload_schema
        CHECK (payload_schema IN ('cdps.report.tiktok.v1', 'cdps.report.shopee.v1'));

-- Tepat SATU dari dua kolom benchmark terisi, sesuai payload_schema — DI DB,
-- bukan hanya konvensi TS. Baris TikTok lama: payload_schema default ke
-- TikTok DAN benchmark_versi sudah terisi (kolom lama, NOT NULL sebelum
-- migrasi ini) DAN benchmark_versi_shopee otomatis NULL (kolom baru) — CHECK
-- ini benar untuk mereka tanpa satu UPDATE pun.
ALTER TABLE client_reports
    ADD CONSTRAINT ck_report_benchmark_by_schema
        CHECK (
            (payload_schema = 'cdps.report.tiktok.v1' AND benchmark_versi IS NOT NULL AND benchmark_versi_shopee IS NULL)
            OR
            (payload_schema = 'cdps.report.shopee.v1' AND benchmark_versi_shopee IS NOT NULL AND benchmark_versi IS NULL)
        );
