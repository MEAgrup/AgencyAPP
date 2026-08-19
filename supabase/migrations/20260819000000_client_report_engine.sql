-- CDPS — MESIN LAPORAN KLIEN (mingguan/bulanan) dari export platform.
--
-- Backlog: docs/backlog/WAVE2_GAP_AUDIT.md Kelas C1 · Handoff:
-- docs/handoff/HANDOFF_WAVE2_GAP_AUDIT_SESI43.md §2.1 · Keputusan pemilik:
-- docs/DECISIONS.md 2026-08-19 (4 keputusan wawancara).
--
-- KENAPA INI ADA. `clients.total_sales` — sinyal GMV yang dibaca Health Score
-- (M13 §6.2 #5 lewat `health.ts:264`) — TIDAK DITULIS OLEH APA PUN di seluruh
-- proyek. Itulah gap C1. Arah pemilik (SESI42 §2.1) tegas: GMV live TIDAK boleh
-- ditulis langsung dari M8/M9/M10; ia lahir dari laporan yang di-upload, dan
-- mesin laporan adalah **penulis tunggal** kolom itu. Migrasi ini membangun
-- tempat laporan itu hidup.
--
-- ---------------------------------------------------------------------------
-- TIGA TABEL
-- ---------------------------------------------------------------------------
--  1. report_benchmark      — 11 ambang laporan, BERVERSI, Director-only.
--  2. client_reports        — satu baris per (toko klien × periode); payload
--                             mesin `cdps.report.tiktok.v1` + angka turunan.
--  3. client_report_berkas  — provenance export: sha256 + tipe + baris.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB (bukan hanya di TS)
-- ---------------------------------------------------------------------------
--  * NOL PREFIX ID BARU. Surogat `bigint GENERATED ALWAYS AS IDENTITY`, pola
--    `client_platforms`/`riset_awal_analisa`. Registry `entity_prefix` TETAP 35,
--    `sm_machines` TETAP 23, `notif_events` TETAP 58 — migrasi ini tak menyentuh
--    satu pun gate itu.
--  * DITAMBATKAN KE TOKO, BUKAN KE KLIEN (keputusan 4). FK ke `client_platforms`
--    supaya klien multi-platform punya satu laporan per toko dan angkanya bisa
--    dibandingkan antar platform. `client_id` didenormalisasi untuk RLS + rollup.
--  * SATU LAPORAN PER (TOKO × TIPE × RENTANG). UNIQUE-nya menyertakan
--    `periode_tipe`: laporan mingguan 1–7 Agustus dan laporan bulanan Agustus
--    hidup berdampingan (itu memang dua laporan berbeda), tapi mengunggah ulang
--    rentang yang sama = ConflictError, bukan penimpaan diam-diam.
--  * PAYLOAD IMMUTABLE (aturan rumah #3). Baris laporan = snapshot; tak ada
--    kolom yang sah diubah. Revisi = baris baru setelah yang lama dicabut.
--  * REPRODUCIBLE ATAU TIDAK SAH (aturan rumah #4). Setiap baris WAJIB membawa
--    `benchmark_versi` + `engine_versi`; tanpa keduanya skor tak bisa dihitung
--    ulang, dan angka yang tak bisa dihitung ulang adalah angka yang bohong.
--  * SATUAN `total_sales` DITEGAKKAN DI KOLOM. `gmv_runrate_bulanan` disimpan
--    TERPISAH dari `gmv_net` justru supaya laporan mingguan dan bulanan menulis
--    SATUAN YANG SAMA ke `clients.total_sales` (keputusan 3). Tanpa kolom ini,
--    satu unggahan mingguan akan menjatuhkan total_sales ~4x dan menghancurkan
--    Health Score klien karena alasan yang tak ada hubungannya dengan performa.
--  * RLS CERMIN SCOPE KLIEN. Account-scope (AM pemilik / lead Account / OD /
--    Director), arm lead/divisi DI-INLINE supaya detektor O48 (rls_checks §42)
--    melihatnya dan tabel ini TIDAK perlu masuk ledger.

-- ===========================================================================
-- 1. report_benchmark — 11 ambang laporan berversi (Director-only).
--    Di tool HTML pemilik, 11 angka ini bisa diedit AM di browser (`applyConfig`)
--    ⇒ dua AM menghasilkan skor berbeda untuk bulan yang sama, dan laporan lama
--    tak bisa dihitung ulang (melanggar #4). Di sini: append-only, berversi,
--    dan setiap laporan menyimpan versi yang dipakainya. Preseden persis
--    `riset_awal_benchmark`.
-- ===========================================================================
CREATE TABLE report_benchmark (
    versi        integer      NOT NULL PRIMARY KEY,
    -- Bentuknya cermin `REPORT_BENCH_V1` di packages/core/src/report/bench.ts:
    -- {kunci: {good, warn}}. AMBANG BULANAN — pro-rate ke periode dilakukan
    -- mesin (hanya kunci volume), bukan disimpan dua kali di sini.
    nilai        jsonb        NOT NULL,
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_report_benchmark_versi CHECK (versi >= 1)
);

COMMENT ON TABLE report_benchmark IS
  'Ambang laporan klien (11 nilai) berversi, Director-only. Append-only: kalibrasi baru = versi baru. Setiap client_reports menyimpan benchmark_versi yang dipakainya (aturan rumah #4). Nilai = ambang BULANAN; pro-rate mingguan dilakukan mesin.';

-- Versi 1 = ambang tool pemilik (`DEFAULT_BENCH`) apa adanya — titik kalibrasi
-- awal, bergerak lewat versi baru, bukan edit di tempat.
INSERT INTO report_benchmark (versi, nilai, catatan, dibuat_oleh) VALUES
    (1, jsonb_build_object(
        'roi_gmvmax',            jsonb_build_object('good', 8,      'warn', 4),        -- ROI GMV Max (x)
        'cpa_ratio',             jsonb_build_object('good', 0.10,   'warn', 0.20),     -- CPA / AOV (makin kecil makin baik)
        'ctr_ads',               jsonb_build_object('good', 0.03,   'warn', 0.015),    -- CTR iklan produk
        'gmv_per_jam_live',      jsonb_build_object('good', 300000, 'warn', 150000),   -- GMV per jam LIVE (Rp)
        'sesi_live',             jsonb_build_object('good', 20,     'warn', 12),       -- Sesi LIVE / bulan  (VOLUME)
        'gpm_video',             jsonb_build_object('good', 30000,  'warn', 10000),    -- GMV per 1.000 views (Rp)
        'pct_video_sales',       jsonb_build_object('good', 0.05,   'warn', 0.02),     -- % video ada penjualan
        'cvr_toko',              jsonb_build_object('good', 0.015,  'warn', 0.008),    -- CVR toko
        'pct_kreator_produktif', jsonb_build_object('good', 0.20,   'warn', 0.10),     -- % kreator produktif
        'quad_klik',             jsonb_build_object('good', 150,    'warn', 25),       -- Kuadran: klik produk (VOLUME)
        'quad_cvr',              jsonb_build_object('good', 0.015,  'warn', 0.005)     -- Kuadran: CVR produk
     ), 'Port ambang tool MEA TikTok Report Engine v1 (DEFAULT_BENCH).', 'SYSTEM');

CREATE OR REPLACE FUNCTION report_benchmark_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'report_benchmark: append-only — kalibrasi baru = versi baru, versi lama immutable (aturan rumah #4)';
END;
$$;
CREATE TRIGGER trg_report_benchmark_frozen BEFORE UPDATE OR DELETE ON report_benchmark
    FOR EACH ROW EXECUTE FUNCTION report_benchmark_frozen();

-- ===========================================================================
-- 2. client_reports — satu laporan per (toko klien × tipe periode × rentang).
-- ===========================================================================
CREATE TABLE client_reports (
    id                  bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id           varchar(32)  NOT NULL,
    client_platform_id  bigint       NOT NULL,
    platform            varchar(64)  NOT NULL,      -- denormalisasi (immutable jejak)

    periode_tipe        varchar(16)  NOT NULL,      -- mingguan|bulanan
    periode_mulai       date         NOT NULL,
    periode_akhir       date         NOT NULL,
    -- Panjang periode SEBENARNYA (inklusif). Inilah yang dipakai mesin untuk
    -- pro-rate ambang volume — sebuah minggu parsial 5 hari tidak dinilai
    -- dengan target satu minggu penuh.
    hari_periode        integer      NOT NULL,
    -- false = rentang tak terbaca dari berkas dan panjang baku dipakai. Disimpan
    -- supaya pembaca bisa membedakan bulan 28 hari yang nyata dari tebakan.
    rentang_dari_berkas boolean      NOT NULL DEFAULT true,

    payload             jsonb        NOT NULL,      -- cdps.report.tiktok.v1; IMMUTABLE

    -- Angka turunan yang di-denormalisasi supaya bisa di-query tanpa membongkar
    -- payload. Semuanya ADA di payload — ini indeks, bukan sumber kebenaran.
    skor                numeric(3,1) NULL,          -- 0.0–10.0
    skor_label          varchar(24)  NULL,          -- SEHAT|PERLU PERHATIAN|KRITIS
    gmv_net             numeric(15,2) NOT NULL,
    gmv_kotor           numeric(15,2) NOT NULL,
    -- GMV disetarakan ke 30 hari. INILAH satuan `clients.total_sales`
    -- (keputusan 3) — laporan mingguan & bulanan menulis satuan yang sama.
    gmv_runrate_bulanan numeric(15,2) NOT NULL,

    benchmark_versi     integer      NOT NULL,
    engine_versi        varchar(32)  NOT NULL,
    kelengkapan_file    jsonb        NULL,          -- {tipe_berkas: ada?}

    created_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          varchar(64)  NOT NULL,

    CONSTRAINT fk_report_client    FOREIGN KEY (client_id)          REFERENCES clients (id),
    CONSTRAINT fk_report_platform  FOREIGN KEY (client_platform_id) REFERENCES client_platforms (id),
    CONSTRAINT fk_report_benchmark FOREIGN KEY (benchmark_versi)    REFERENCES report_benchmark (versi),

    -- Satu laporan per toko per rentang per tipe. Mingguan 1–7 Agu dan bulanan
    -- Agustus boleh hidup berdampingan; unggah ulang rentang yang sama tidak.
    CONSTRAINT uq_client_report UNIQUE (client_platform_id, periode_tipe, periode_mulai, periode_akhir),

    CONSTRAINT ck_report_tipe   CHECK (periode_tipe IN ('mingguan', 'bulanan')),
    CONSTRAINT ck_report_urut   CHECK (periode_akhir >= periode_mulai),
    CONSTRAINT ck_report_hari   CHECK (hari_periode BETWEEN 1 AND 400),
    CONSTRAINT ck_report_skor   CHECK (skor IS NULL OR skor BETWEEN 0 AND 10),
    CONSTRAINT ck_report_label  CHECK (skor_label IS NULL OR skor_label IN ('SEHAT', 'PERLU PERHATIAN', 'KRITIS')),
    -- GMV tak boleh negatif; run-rate tak boleh nol saat GMV tidak nol (itu
    -- tanda pembagian yang salah, dan `clients.total_sales` membacanya).
    CONSTRAINT ck_report_gmv    CHECK (gmv_net >= 0 AND gmv_kotor >= 0 AND gmv_runrate_bulanan >= 0),
    CONSTRAINT ck_report_runrate CHECK (gmv_net = 0 OR gmv_runrate_bulanan > 0)
);
CREATE INDEX idx_client_reports_client   ON client_reports (client_id, periode_akhir DESC);
CREATE INDEX idx_client_reports_platform ON client_reports (client_platform_id, periode_akhir DESC);

COMMENT ON TABLE client_reports IS
  'Laporan performa klien mingguan/bulanan per toko, dari export platform. payload = cdps.report.tiktok.v1 (immutable). PENULIS TUNGGAL clients.total_sales (gap C1) — GMV live JANGAN ditulis langsung dari M8/M9/M10.';
COMMENT ON COLUMN client_reports.gmv_runrate_bulanan IS
  'GMV disetarakan ke 30 hari. Satuan clients.total_sales: laporan bulanan lewat apa adanya, laporan mingguan diskalakan (keputusan 3, DECISIONS 2026-08-19).';

CREATE OR REPLACE FUNCTION client_reports_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'client_reports: baris laporan immutable (payload/skor/GMV tak boleh diketik ulang, aturan rumah #3/#4) — revisi = cabut lalu buat baris baru';
END;
$$;
CREATE TRIGGER trg_client_reports_frozen BEFORE UPDATE ON client_reports
    FOR EACH ROW EXECUTE FUNCTION client_reports_frozen();

-- ===========================================================================
-- 3. client_report_berkas — provenance export (sidik jari + metadata, BUKAN
--    biner; Supabase Storage belum dikonfigurasi). Cermin
--    `riset_awal_sumber_berkas`.
-- ===========================================================================
CREATE TABLE client_report_berkas (
    id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id       bigint       NOT NULL,
    nama_berkas     varchar(255) NOT NULL,
    sha256          char(64)     NOT NULL,
    ukuran_bytes    bigint       NOT NULL,
    tipe_terdeteksi varchar(32)  NULL,             -- shop_tt|…|ttam_showcase; NULL = tak dikenali
    tipe_override   varchar(32)  NULL,             -- koreksi eksplisit AM
    jumlah_baris    integer      NULL,
    periode         jsonb        NULL,             -- {mulai, akhir} yang berkas ini cakup
    created_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      varchar(64)  NOT NULL,

    CONSTRAINT fk_report_berkas FOREIGN KEY (report_id) REFERENCES client_reports (id) ON DELETE CASCADE,
    CONSTRAINT ck_report_berkas_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_report_berkas_ukuran CHECK (ukuran_bytes >= 0)
);
CREATE INDEX idx_report_berkas_report ON client_report_berkas (report_id);
CREATE INDEX idx_report_berkas_sha256 ON client_report_berkas (sha256);

COMMENT ON TABLE client_report_berkas IS
  'Provenance export yang menghasilkan satu laporan (sha256 + tipe + baris). Menyimpan sidik jari + metadata, bukan biner.';

-- Fakta berkas beku seluruhnya: laporannya sendiri immutable, jadi tak ada
-- koreksi yang sah setelah baris laporan ada (koreksi = laporan baru).
CREATE OR REPLACE FUNCTION client_report_berkas_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'client_report_berkas: provenance beku — laporan yang dihasilkannya immutable, koreksi berarti laporan baru';
END;
$$;
CREATE TRIGGER trg_report_berkas_frozen BEFORE UPDATE ON client_report_berkas
    FOR EACH ROW EXECUTE FUNCTION client_report_berkas_frozen();

-- ===========================================================================
-- 4. RLS — Account-scope, arm lead/divisi DI-INLINE (rls_checks §42 / O48).
--    Tulis lewat service-role dengan izin ditegakkan di domain
--    (packages/domain/src/report.ts).
--
--    report_benchmark: NOL policy (default-deny), seperti riset_awal_benchmark /
--    kualifikasi_config — ambang dibaca hanya lewat service-role saat menskor.
-- ===========================================================================
REVOKE ALL ON public.client_reports       FROM anon;
REVOKE ALL ON public.client_reports       FROM authenticated;
REVOKE ALL ON public.client_report_berkas FROM anon;
REVOKE ALL ON public.client_report_berkas FROM authenticated;

ALTER TABLE public.client_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_report_berkas ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.client_reports, public.client_report_berkas TO authenticated;

CREATE POLICY client_reports_sel ON public.client_reports FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(client_id));

-- Anak: arm lead/divisi diulang INLINE (bukan hanya diwarisi lewat EXISTS)
-- supaya detektor sintaktik O48 melihatnya dan tabel ini tak perlu masuk ledger.
CREATE POLICY client_report_berkas_sel ON public.client_report_berkas FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR EXISTS (SELECT 1 FROM public.client_reports r
                       WHERE r.id = client_report_berkas.report_id
                         AND public.jwt_owns_client_am(r.client_id)));

REVOKE ALL ON public.report_benchmark FROM anon;
REVOKE ALL ON public.report_benchmark FROM authenticated;
ALTER TABLE public.report_benchmark ENABLE ROW LEVEL SECURITY;
