-- CDPS — Modul Interview / "Kelola Klien" LANGKAH 1 (Riset Awal), BAGIAN 2:
--   **kolom isian + mesin baseline dari export** (RAB-01).
--
-- Handoff: docs/handoff/HANDOFF_M6ABC_SESI31.md · Backlog: RISET_AWAL_BASELINE_BACKLOG.md
-- Keputusan pemilik: docs/DECISIONS.md 2026-08-17 (7 keputusan) + resolusi §5.
--
-- SESI30 §3 sengaja meninggalkan `interview_riset_awal` **tipis** (hanya jangkar
-- waktu) supaya "bagian 2" bisa menambah tabel anak TANPA membongkar apa pun
-- (`20260812100000_interview_riset_awal.sql:14-16`). Ini bagian 2 itu: empat tabel
-- yang membuat riset awal punya isian + tempat untuk hasil analisa export.
--
-- ---------------------------------------------------------------------------
-- EMPAT TABEL (RAB-01)
-- ---------------------------------------------------------------------------
--  1. riset_awal_analisa       — satu baris per (riset awal × platform aktif);
--                                hasil mesin baseline (payload) + Skor Kondisi Toko.
--  2. riset_awal_sumber_berkas — provenance export: sha256 + tipe + periode + rows.
--                                Inilah yang mengisi `sumber_data` + `lampiran` M6A
--                                secara sah (Rule 5 akhirnya benar-benar terpenuhi).
--  3. interview_riset_awal_isian — pola `interview_answer`: baris per field bertipe,
--                                plus `sumber` + `nilai_usulan` (immutable) + `dikonfirmasi`.
--  4. riset_awal_benchmark     — 16 ambang `BENCH` tool, BERVERSI, Director-only.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB (bukan hanya di TS)
-- ---------------------------------------------------------------------------
--  * NOL PREFIX ID BARU. Surogat = `bigint GENERATED ALWAYS AS IDENTITY` (pola
--    `client_platforms`) / kunci alami (pola `interview_answer`) / `versi` integer
--    (pola `kualifikasi_config`). Registry `entity_prefix` TETAP 35 (RAB-01).
--  * KONDISI TOKO ≠ VERDICT BLOK C. `kondisi_toko` CHECK 5 nilai, kosakata TIDAK
--    beririsan dengan VERDICT Blok C (handoff §2.3). `belum_dapat_diukur` = "belum
--    ada mesin analisa untuk platform ini" — WAJIB ada, TIDAK boleh dilebur dengan
--    `mesin_belum_terbangun` ("analisa jalan, toko memang lemah").
--  * MANUAL ⇒ NUL. `metode_baseline='manual'` ⇒ `kondisi_toko='belum_dapat_diukur'`
--    DAN `skor IS NULL` (CHECK). Skor hanya sah dari `analisa_penuh` (TikTok Shop),
--    dan skor apa pun WAJIB membawa `benchmark_versi`+`parser_versi` (recompute,
--    aturan rumah #4) — angka yang tak bisa dihitung ulang adalah angka yang bohong.
--  * PROVENANCE ANGKA IMMUTABLE. `payload` (hasil parse mentah) & `nilai_usulan`
--    (usulan analisa asli) beku (trigger, aturan rumah #3). Keputusan 1: yang
--    tercatat = hasil KONFIRMASI AM; usulan asli disimpan supaya bug parser tak
--    bisa menggeser verdict tanpa manusia menyetujui, dan supaya jejaknya utuh.
--  * BENCHMARK BERVERSI. Di tool 16 angka `BENCH` bisa diedit AM di browser ⇒ dua
--    AM menghasilkan skor beda untuk toko sama, dan skor lama tak bisa dihitung
--    ulang (melanggar #4). Di sini benchmark = tabel append-only berversi; skor
--    menyimpan `benchmark_versi` yang dipakainya. Preseden `kualifikasi_config`.
--  * RLS CERMIN `interview_riset_awal`. Riset awal memuat baseline toko klien —
--    hard-internal Account (kelas Blok B), Sales default-deny. Sales melihat
--    VERDICT (view aditif) tapi TIDAK isian/analisa/sumber berkas.

-- ===========================================================================
-- 1. riset_awal_benchmark — ambang MEA berversi (Director-only). Didefinisikan
--    DULUAN karena riset_awal_analisa.benchmark_versi menunjuk ke sini.
--    Append-only: kalibrasi baru = versi baru; versi lama immutable-readable
--    supaya skor lama selalu bisa dihitung ulang (aturan rumah #4).
-- ===========================================================================
CREATE TABLE riset_awal_benchmark (
    versi        integer      NOT NULL PRIMARY KEY,
    -- 16 ambang `BENCH` tool sebagai DATA, bukan literal di kode. Bentuknya
    -- cermin objek `B` di packages/core/src/baseline (RAB-02). Skor menyimpan
    -- `benchmark_versi` supaya reproducible.
    nilai        jsonb        NOT NULL,
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_benchmark_versi CHECK (versi >= 1)
);

COMMENT ON TABLE riset_awal_benchmark IS
  'Ambang MEA (16 nilai BENCH) berversi, Director-only. Append-only: kalibrasi baru = versi baru. Skor Kondisi Toko menyimpan benchmark_versi yang dipakainya (aturan rumah #4).';

-- Versi 1 = ambang tool `BASELINE_TOOL_TIKTOK_v1.html:339-356` apa adanya (port
-- langsung, keputusan 4). Titik kalibrasi awal — bergerak lewat versi baru, bukan
-- edit di tempat.
INSERT INTO riset_awal_benchmark (versi, nilai, dibuat_oleh) VALUES
    (1, jsonb_build_object(
        'cr',           1.0,      -- Persentase konversi toko (%)
        'refund',       5.0,      -- Refund rate maksimal (%)
        'vidPostToko',  30,       -- Video toko / bulan
        'vidSalesToko', 8.0,      -- Video toko ada penjualan (%)
        'vidSalesAff',  8.0,      -- Video afiliasi ada penjualan (%)
        'gpmToko',      100000,   -- GPM median video toko (Rp)
        'liveSesi',     20,       -- Sesi LIVE toko / bulan
        'liveJam',      60,       -- Jam LIVE toko / bulan
        'liveGmvJam',   300000,   -- GMV per jam LIVE (Rp)
        'liveCtor',     1.5,      -- CTOR LIVE (%)
        'krSales',      40,       -- Kreator posting yg ada penjualan (%)
        'krKonsen',     60,       -- Konsentrasi GMV top-5 kreator (% maks)
        'skuSales',     30,       -- SKU ada penjualan (%)
        'roas',         6,        -- ROAS iklan minimal (x)
        'adsDep',       60,       -- Ketergantungan iklan maksimal (% maks)
        'spikeFlag',    1.8       -- Ambang bulan campaign-driven (x median)
     ), 'SYSTEM');

-- Append-only: versi yang sudah terbit tak boleh diubah/dihapus (kalau bisa,
-- skor yang menunjuknya tak lagi reproducible). Kalibrasi baru = INSERT versi baru.
CREATE OR REPLACE FUNCTION riset_awal_benchmark_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'riset_awal_benchmark: append-only — kalibrasi baru = versi baru, versi lama immutable (aturan rumah #4)';
END;
$$;
CREATE TRIGGER trg_benchmark_frozen BEFORE UPDATE OR DELETE ON riset_awal_benchmark
    FOR EACH ROW EXECUTE FUNCTION riset_awal_benchmark_frozen();

-- ===========================================================================
-- 2. riset_awal_analisa — satu baris per (riset awal × platform aktif).
--    Di-anchor ke baris `client_platforms` yang `active` lewat FK, supaya "satu
--    baris per platform aktif" (RAB-04 DoD) bisa ditegakkan dan hasil menempel
--    ke TOKO spesifik, bukan sekadar string platform. Baris ini = snapshot hasil
--    mesin: sekali tulis, tak ada kolom yang sah diubah ⇒ append-only.
-- ===========================================================================
CREATE TABLE riset_awal_analisa (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id       varchar(32)  NOT NULL,
    client_platform_id bigint       NOT NULL,
    platform           varchar(64)  NOT NULL,       -- denormalisasi (immutable jejak)

    metode_baseline    varchar(24)  NOT NULL,       -- analisa_penuh|analisa_tipis|manual
    periode_referensi  jsonb        NULL,           -- {mulai, akhir, bulan} rentang baseline
    payload            jsonb        NOT NULL,        -- hasil parse mentah (cdps.baseline.*); IMMUTABLE

    kondisi_toko       varchar(32)  NOT NULL,       -- 5 nilai; BUKAN verdict Blok C
    skor               integer      NULL,           -- Skor Kondisi Toko; NULL kecuali analisa_penuh
    benchmark_versi    integer      NULL,           -- FK riset_awal_benchmark; wajib bila ada skor
    parser_versi       varchar(32)  NULL,           -- versi mesin baseline; wajib bila ada skor
    cakupan_riwayat    varchar(16)  NULL,           -- cukup|kurang (<3 bulan ⇒ kurang)
    kelengkapan_file   jsonb        NULL,           -- {tipe_file: ada?} per tipe wajib

    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         varchar(64)  NOT NULL,

    CONSTRAINT fk_analisa_riset    FOREIGN KEY (interview_id)       REFERENCES interview_riset_awal (interview_id) ON DELETE CASCADE,
    CONSTRAINT fk_analisa_platform FOREIGN KEY (client_platform_id) REFERENCES client_platforms (id),
    CONSTRAINT fk_analisa_benchmark FOREIGN KEY (benchmark_versi)   REFERENCES riset_awal_benchmark (versi),
    -- Satu analisa per (riset awal × baris platform). Klien multi-platform ⇒ satu
    -- baris per platform aktif (RAB-04 DoD).
    CONSTRAINT uq_analisa UNIQUE (interview_id, client_platform_id),

    CONSTRAINT ck_analisa_metode CHECK (
        metode_baseline IN ('analisa_penuh', 'analisa_tipis', 'manual')),
    -- 5 nilai Kondisi Toko (RAB-01/RAB-03). `belum_dapat_diukur` WAJIB & tak boleh
    -- dilebur dengan `mesin_belum_terbangun` (handoff §2.3).
    CONSTRAINT ck_analisa_kondisi CHECK (
        kondisi_toko IN ('mesin_jalan', 'mesin_sebagian', 'fondasi_perlu_dibenahi',
                         'mesin_belum_terbangun', 'belum_dapat_diukur')),
    -- Manual ⇒ tak terukur & tanpa skor (keputusan 5 + §2.4). Menggigit di DB.
    CONSTRAINT ck_analisa_manual_null CHECK (
        metode_baseline <> 'manual'
        OR (kondisi_toko = 'belum_dapat_diukur' AND skor IS NULL)),
    -- Skor hanya sah dari analisa_penuh (TikTok Shop 5 pilar). Tokopedia tipis &
    -- manual ⇒ belum_dapat_diukur, nol skor.
    CONSTRAINT ck_analisa_skor_penuh CHECK (
        skor IS NULL OR metode_baseline = 'analisa_penuh'),
    -- 4 verdict terhitung hanya dari analisa_penuh; sisanya belum_dapat_diukur.
    CONSTRAINT ck_analisa_kondisi_computed CHECK (
        kondisi_toko = 'belum_dapat_diukur' OR metode_baseline = 'analisa_penuh'),
    CONSTRAINT ck_analisa_skor_range CHECK (skor IS NULL OR skor BETWEEN 0 AND 100),
    -- Skor apa pun WAJIB reproducible: benchmark_versi + parser_versi (aturan #4).
    CONSTRAINT ck_analisa_provenance CHECK (
        skor IS NULL OR (benchmark_versi IS NOT NULL AND parser_versi IS NOT NULL)),
    CONSTRAINT ck_analisa_cakupan CHECK (
        cakupan_riwayat IS NULL OR cakupan_riwayat IN ('cukup', 'kurang'))
);
CREATE INDEX idx_analisa_interview ON riset_awal_analisa (interview_id);
CREATE INDEX idx_analisa_platform  ON riset_awal_analisa (client_platform_id);

COMMENT ON TABLE riset_awal_analisa IS
  'Hasil mesin baseline per (riset awal × platform aktif). payload immutable; skor = Skor Kondisi Toko (BUKAN verdict Blok C), hanya dari analisa_penuh, wajib membawa benchmark_versi+parser_versi (aturan rumah #4).';

-- Snapshot append-only: tak ada kolom yang sah diubah (payload beku, skor turunan
-- reproducible). Re-analisa = baris baru. UPDATE ditolak; DELETE dibiarkan (hanya
-- via CASCADE dari interview — produksi tak pernah menghapus interview).
CREATE OR REPLACE FUNCTION riset_awal_analisa_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'riset_awal_analisa: baris hasil immutable (payload/skor tak boleh diketik ulang, aturan rumah #3/#4) — re-analisa = baris baru';
END;
$$;
CREATE TRIGGER trg_analisa_frozen BEFORE UPDATE ON riset_awal_analisa
    FOR EACH ROW EXECUTE FUNCTION riset_awal_analisa_frozen();

-- ===========================================================================
-- 3. riset_awal_sumber_berkas — provenance export seller centre. Inilah yang
--    mengisi `sumber_data` + `lampiran` M6A secara SAH (Rule 5 akhirnya terpenuhi
--    dengan sumber nyata, bukan teks bebas). Yang disimpan: sidik jari + metadata,
--    BUKAN biner (Supabase Storage belum dikonfigurasi — §6 "yang tidak dikerjakan").
-- ===========================================================================
CREATE TABLE riset_awal_sumber_berkas (
    id               bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id     varchar(32)  NOT NULL,
    platform         varchar(64)  NULL,             -- platform yang berkas ini dukung
    nama_berkas      varchar(255) NOT NULL,
    sha256           char(64)     NOT NULL,          -- identitas berkas; beku
    ukuran_bytes     bigint       NOT NULL,
    tipe_terdeteksi  varchar(32)  NULL,              -- shop_tt|prod_tt|... (deteksi mesin); NULL=tak dikenali
    tipe_override    varchar(32)  NULL,              -- override AM (satu-satunya kolom yang boleh diubah)
    jumlah_baris     integer      NULL,
    periode          jsonb        NULL,              -- {mulai, akhir} yang berkas ini cakup
    tanggal_ambil    date         NULL,              -- kapan AM menarik export
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       varchar(64)  NOT NULL,

    CONSTRAINT fk_berkas_riset FOREIGN KEY (interview_id) REFERENCES interview_riset_awal (interview_id) ON DELETE CASCADE,
    CONSTRAINT ck_berkas_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_berkas_ukuran CHECK (ukuran_bytes >= 0)
);
CREATE INDEX idx_berkas_interview ON riset_awal_sumber_berkas (interview_id);
CREATE INDEX idx_berkas_sha256    ON riset_awal_sumber_berkas (sha256);

COMMENT ON TABLE riset_awal_sumber_berkas IS
  'Provenance export seller centre (sha256 + tipe + periode + baris). Mengisi sumber_data + lampiran M6A secara sah. Menyimpan sidik jari + metadata, bukan biner (Supabase Storage belum ada).';

-- Fakta berkas beku; hanya `tipe_override` (koreksi tipe oleh AM) yang boleh
-- diubah. DELETE dibiarkan (AM boleh mencabut berkas salah unggah sebelum submit).
CREATE OR REPLACE FUNCTION riset_awal_sumber_berkas_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.sha256          IS DISTINCT FROM OLD.sha256          THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: sha256 beku (identitas berkas)'; END IF;
    IF NEW.nama_berkas     IS DISTINCT FROM OLD.nama_berkas     THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: nama_berkas beku'; END IF;
    IF NEW.ukuran_bytes    IS DISTINCT FROM OLD.ukuran_bytes    THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: ukuran_bytes beku'; END IF;
    IF NEW.tipe_terdeteksi IS DISTINCT FROM OLD.tipe_terdeteksi THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: tipe_terdeteksi beku (pakai tipe_override untuk mengoreksi)'; END IF;
    IF NEW.jumlah_baris    IS DISTINCT FROM OLD.jumlah_baris    THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: jumlah_baris beku'; END IF;
    IF NEW.periode         IS DISTINCT FROM OLD.periode         THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: periode beku'; END IF;
    IF NEW.tanggal_ambil   IS DISTINCT FROM OLD.tanggal_ambil   THEN RAISE EXCEPTION 'riset_awal_sumber_berkas: tanggal_ambil beku'; END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_berkas_frozen BEFORE UPDATE ON riset_awal_sumber_berkas
    FOR EACH ROW EXECUTE FUNCTION riset_awal_sumber_berkas_frozen();

-- ===========================================================================
-- 4. interview_riset_awal_isian — pola `interview_answer` (20260811030000:230):
--    baris per field, nilai bertipe (kolom terpisah). Tambahan riset-awal:
--    `sumber` (dari mana angka datang) · `nilai_usulan` (usulan analisa asli,
--    IMMUTABLE) · `dikonfirmasi` (keputusan 1: AM konfirmasi per angka).
--    Yang dikonfirmasi masuk nilai_* (boleh dikoreksi); usulan asli tetap utuh.
-- ===========================================================================
CREATE TABLE interview_riset_awal_isian (
    interview_id  varchar(32)  NOT NULL,
    section       varchar(8)   NOT NULL,     -- cermin katalog interview (B0..B11) / RA-*
    field_key     varchar(16)  NOT NULL,

    nilai_teks    text         NULL,
    nilai_angka   numeric      NULL,
    nilai_uang    bigint       NULL,          -- minor units (money.ts)
    nilai_bool    boolean      NULL,
    nilai_enum    varchar(64)  NULL,
    nilai_jsonb   jsonb        NULL,

    sumber        varchar(16)  NOT NULL,      -- analisa|manual|sales
    nilai_usulan  jsonb        NULL,          -- usulan asli (mis. dari analisa); IMMUTABLE
    dikonfirmasi  boolean      NOT NULL DEFAULT false,

    updated_at    timestamptz  NOT NULL DEFAULT now(),
    updated_by    varchar(64)  NOT NULL,

    PRIMARY KEY (interview_id, section, field_key),
    CONSTRAINT fk_isian_riset FOREIGN KEY (interview_id) REFERENCES interview_riset_awal (interview_id) ON DELETE CASCADE,
    CONSTRAINT ck_isian_sumber CHECK (sumber IN ('analisa', 'manual', 'sales')),
    -- Field bersumber analisa WAJIB membawa usulan aslinya — supaya bug parser tak
    -- bisa menggeser verdict tanpa manusia menyetujui (keputusan 1). Manual/sales
    -- boleh tanpa usulan (AM/qualified_forms mengisi langsung).
    CONSTRAINT ck_isian_usulan CHECK (sumber <> 'analisa' OR nilai_usulan IS NOT NULL)
);
CREATE INDEX idx_isian_interview ON interview_riset_awal_isian (interview_id);

COMMENT ON TABLE interview_riset_awal_isian IS
  'Isian riset awal per field (pola interview_answer). sumber = analisa|manual|sales; nilai_usulan = usulan asli (immutable); dikonfirmasi per angka (keputusan 1). Yang dikonfirmasi masuk nilai_*.';

-- nilai_usulan (+ sumber, sebuah fakta asal) beku; nilai_*/dikonfirmasi boleh
-- diubah (AM mengoreksi & mengkonfirmasi). DELETE dibiarkan HANYA lewat CASCADE
-- dari interview (produksi tak pernah menghapus interview — cermin alasan
-- `interview_riset_awal` & `interview_answer` sendiri); tak ada rute aplikasi yang
-- menghapus isian, jadi "usulan tanpa jalur DELETE" ditegakkan di lapisan itu,
-- bukan dengan memblok cascade (yang justru mengunci interview selamanya).
CREATE OR REPLACE FUNCTION interview_riset_awal_isian_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.nilai_usulan IS NOT NULL AND NEW.nilai_usulan IS DISTINCT FROM OLD.nilai_usulan THEN
        RAISE EXCEPTION 'interview_riset_awal_isian: nilai_usulan beku (usulan analisa asli, aturan rumah #3)';
    END IF;
    IF NEW.sumber IS DISTINCT FROM OLD.sumber THEN
        RAISE EXCEPTION 'interview_riset_awal_isian: sumber beku (asal angka adalah fakta)';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_isian_guard BEFORE UPDATE ON interview_riset_awal_isian
    FOR EACH ROW EXECUTE FUNCTION interview_riset_awal_isian_guard();

-- ===========================================================================
-- 5. RLS — cermin persis `interview_riset_awal` (20260812100000:157-173):
--    scope Account (assigned AM / Account lead / OD / Director), Sales default-deny.
--    Arm lead/divisi DI-INLINE supaya detektor O48 (rls_checks.sql §42) melihatnya
--    dan tabel-tabel ini TIDAK perlu masuk ledger. Tulis via service-role dengan
--    izin ditegakkan di domain (packages/domain/src/interview.ts).
--
--    riset_awal_benchmark: NOL policy (default-deny), seperti kualifikasi_config —
--    ambang sensitif dibaca hanya lewat RPC/service-role saat menskor.
-- ===========================================================================

-- 5a. Tiga tabel anak riset awal — Account-scope, cermin interview_riset_awal.
REVOKE ALL ON public.riset_awal_analisa       FROM anon;
REVOKE ALL ON public.riset_awal_analisa       FROM authenticated;
REVOKE ALL ON public.riset_awal_sumber_berkas FROM anon;
REVOKE ALL ON public.riset_awal_sumber_berkas FROM authenticated;
REVOKE ALL ON public.interview_riset_awal_isian FROM anon;
REVOKE ALL ON public.interview_riset_awal_isian FROM authenticated;

ALTER TABLE public.riset_awal_analisa         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riset_awal_sumber_berkas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_riset_awal_isian ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.riset_awal_analisa, public.riset_awal_sumber_berkas,
      public.interview_riset_awal_isian TO authenticated;

CREATE POLICY riset_awal_analisa_sel ON public.riset_awal_analisa FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY riset_awal_sumber_berkas_sel ON public.riset_awal_sumber_berkas FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_riset_awal_isian_sel ON public.interview_riset_awal_isian FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));

-- 5b. riset_awal_benchmark — NOL policy (default-deny), seperti kualifikasi_config
--     / margin_deduksi_config. Ambang dibaca hanya lewat RPC/service-role saat
--     menskor; SENGAJA tidak memberi authenticated SELECT (reverse-engineering
--     ambang menghancurkan sinyal), dan menghindari baris ledger O48.
REVOKE ALL ON public.riset_awal_benchmark FROM anon;
REVOKE ALL ON public.riset_awal_benchmark FROM authenticated;
ALTER TABLE public.riset_awal_benchmark ENABLE ROW LEVEL SECURITY;
