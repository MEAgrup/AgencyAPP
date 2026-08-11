-- CDPS — Modul Interview ("Kelola Klien" tab 1): jadwal + form discovery +
-- kualifikasi (verdict advisory non-blocking) + handoff ke Strategi.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB (bukan hanya di TS)
-- ---------------------------------------------------------------------------
--  * Verdict ADVISORY. Tidak ada kolom/gate yang memblok pembuatan Strategi
--    berdasarkan verdict. Tidak ada enum routing, tidak ada jalur reject.
--  * Deal-breaker mengalahkan skor (I14): baris interview_kualifikasi dengan
--    hambatan_mendasar tak-kosong TAPI verdict != 'tidak_siap' DITOLAK CHECK.
--    Tidak ada kolom override, dan tidak ada yang menambahkannya.
--  * Field skor wajib tidak boleh dikirim kosong (I3): CHECK di interview_answer
--    menolak wajib_kosong pada field key skor — cermin SCORED_FIELD_KEYS di
--    packages/core/src/interview.ts. Estimasi tanpa dasar tertulis ditolak DB.
--  * Margin diturunkan wajib reproducible: basis 'diturunkan_dari_kotor'
--    menuntut margin_derivasi_input + margin_kotor non-null (I21).
--  * Ambang kualifikasi = DATA berversi (kualifikasi_config) + di-snapshot per
--    interview (config_snapshot) ⇒ rekalibrasi tidak pernah menulis ulang
--    verdict lama (I15).
--  * Field terhitung (skor/verdict/bep_roas/rasio_target) hanya ditulis jalur
--    scoring: RLS tidak memberi authenticated hak tulis apa pun di sini.
--  * ITV = house ID PREFIX-YYYYMM-NNNN via ident_next (BUKAN ITV-YYYY-NNNNN dari
--    PRD) — preseden STRG/PLAN/VND (DECISIONS 2026-08-06), dicatat 2026-08-11.

-- ===========================================================================
-- 1. Prefix ITV — registry memutuskan (M6A §7). ITV BEBAS per backfill 31 baris.
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('ITV', 'Interview (Kualifikasi Klien)', 'M6-Interview');

-- ===========================================================================
-- 2. kualifikasi_config — ambang berversi (I15). Editable Direksi / Head of
--    Account lewat RPC/service-role (RLS default-deny tulis). Semua band =
--    DATA di `bands` jsonb, bukan literal di kode. Baris v1 = titik kalibrasi
--    awal (spesifikasi menuntut kalibrasi di minggu-minggu pertama).
-- ===========================================================================
CREATE TABLE kualifikasi_config (
    version                     integer      NOT NULL PRIMARY KEY,
    skor_growth_ready           integer      NOT NULL DEFAULT 75,
    skor_bersyarat_min          integer      NOT NULL DEFAULT 55,
    margin_hambatan_persen      numeric(5,2) NOT NULL DEFAULT 15,
    margin_zona_abu_abu_toleransi numeric(5,2) NOT NULL DEFAULT 3,
    rasio_target_hambatan       numeric(5,2) NOT NULL DEFAULT 5,
    daya_tahan_hambatan_bulan   integer      NOT NULL DEFAULT 1,
    target_roas_advertiser      numeric(5,2) NOT NULL DEFAULT 7.5,
    -- Semua batas band C-A2/C-A3/C-C3/C-E1 sebagai data. Bentuknya cermin
    -- DEFAULT_KUALIFIKASI_CONFIG di packages/core/src/interview.ts (AOV dalam
    -- minor units — money.ts). config_snapshot menyimpan objek ini apa adanya.
    bands                       jsonb        NOT NULL,
    aktif                       boolean      NOT NULL DEFAULT true,
    created_at                  timestamptz  NOT NULL DEFAULT now(),
    created_by                  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_kualifikasi_config_versi CHECK (version >= 1)
);

INSERT INTO kualifikasi_config (version, bands, created_by) VALUES
    (1, jsonb_build_object(
        'marginBands',  jsonb_build_array(
            jsonb_build_object('min', 35, 'poin', 12),
            jsonb_build_object('min', 25, 'poin', 9),
            jsonb_build_object('min', 20, 'poin', 6),
            jsonb_build_object('min', 15, 'poin', 3)),
        -- AOV min dalam MINOR UNITS (money.ts): Rp150k=15000000, Rp80k=8000000, Rp50k=5000000
        'aovBands',     jsonb_build_array(
            jsonb_build_object('min', 15000000, 'poin', 8),
            jsonb_build_object('min', 8000000,  'poin', 6),
            jsonb_build_object('min', 5000000,  'poin', 4),
            jsonb_build_object('min', 0,        'poin', 2)),
        'skuBands',     jsonb_build_array(
            jsonb_build_object('min', 30, 'poin', 5),
            jsonb_build_object('min', 10, 'poin', 4),
            jsonb_build_object('min', 3,  'poin', 2),
            jsonb_build_object('min', 0,  'poin', 1)),
        -- rasioTargetBands: max-inclusive ascending (<=2 ->7, <=3 ->5, <=5 ->2, >5 deal-breaker)
        'rasioTargetBands', jsonb_build_array(
            jsonb_build_object('min', 2, 'poin', 7),
            jsonb_build_object('min', 3, 'poin', 5),
            jsonb_build_object('min', 5, 'poin', 2))),
     'SYSTEM');

-- ===========================================================================
-- 3. margin_deduksi_config — default deduksi untuk menurunkan net dari gross
--    (I21). BERVERSI. Nilai di sini PLACEHOLDER — komisi platform & norma ongkir
--    adalah fakta bisnis yang HARUS datang dari Account, bukan dari prompt.
--    is_placeholder=true menyala; UI wajib menandai bahwa deduksi berasal dari
--    config, bukan dari klien, sebelum sebuah margin turunan mencapai verdict.
-- ===========================================================================
CREATE TABLE margin_deduksi_config (
    version                   integer      NOT NULL,
    scope_type                varchar(16)  NOT NULL,   -- 'channel' | 'kategori'
    scope_key                 varchar(64)  NOT NULL,
    komisi_platform_persen    numeric(5,2) NULL,        -- untuk scope_type='channel'
    ongkir_ditanggung_persen  numeric(5,2) NULL,        -- untuk scope_type='kategori'
    is_placeholder            boolean      NOT NULL DEFAULT true,
    aktif                     boolean      NOT NULL DEFAULT true,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    created_by                varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (version, scope_type, scope_key),
    CONSTRAINT ck_deduksi_scope CHECK (scope_type IN ('channel', 'kategori')),
    CONSTRAINT ck_deduksi_value_by_scope CHECK (
        (scope_type = 'channel'  AND komisi_platform_persen   IS NOT NULL AND ongkir_ditanggung_persen IS NULL)
     OR (scope_type = 'kategori' AND ongkir_ditanggung_persen IS NOT NULL AND komisi_platform_persen   IS NULL))
);

COMMENT ON TABLE margin_deduksi_config IS
  'PLACEHOLDER deductions untuk derivasi net<-gross (I21). Nilai riil (komisi platform per channel, norma subsidi ongkir per kategori) HARUS dari Account. is_placeholder wajib true sampai diganti.';

-- Placeholder seed — DITANDAI is_placeholder=true. Angka ini BUKAN fakta bisnis.
INSERT INTO margin_deduksi_config (version, scope_type, scope_key, komisi_platform_persen, ongkir_ditanggung_persen) VALUES
    (1, 'channel',  'Shopee',        6.00, NULL),
    (1, 'channel',  'Tokopedia',     5.00, NULL),
    (1, 'channel',  'TikTok Shop',   8.00, NULL),
    (1, 'channel',  'Lazada',        5.00, NULL),
    (1, 'kategori', 'Fashion',       NULL, 3.00),
    (1, 'kategori', 'Beauty',        NULL, 2.00),
    (1, 'kategori', 'Food',          NULL, 5.00),
    (1, 'kategori', 'Home Living',   NULL, 8.00),
    (1, 'kategori', 'Elektronik',    NULL, 4.00),
    (1, 'kategori', 'Health',        NULL, 3.00);

-- ===========================================================================
-- 4. interview — entitas ITV. Satu interview AKTIF per kontrak (unique partial).
-- ===========================================================================
CREATE TABLE interview (
    id                  varchar(32)  NOT NULL PRIMARY KEY,
    client_id           varchar(32)  NOT NULL,
    contract_id         varchar(32)  NULL,
    service_id          varchar(32)  NULL,

    -- I1: diisi AM yang memegang klien (assigned AM), atau SPV acting-for.
    am_pengisi_id       varchar(64)  NOT NULL,
    acting_for_am_id    varchar(64)  NULL,        -- SPV bertindak untuk AM (dicatat)
    sales_closing_id    varchar(64)  NULL,        -- sales yang closing (auto dari kontrak)

    status              varchar(48)  NOT NULL DEFAULT 'Belum Dijadwalkan',

    -- Rantai versi (I9): re-interview -> versi n+1; versi n immutable-readable.
    versi_no            integer      NOT NULL DEFAULT 1,
    interview_induk_id  varchar(32)  NULL,
    versi_sebelumnya_id varchar(32)  NULL,

    -- I4: profil pertanyaan (Blok C hanya jalan untuk full_management dsb).
    interview_profile   varchar(32)  NOT NULL DEFAULT 'full_management',

    retroaktif          boolean      NOT NULL DEFAULT false,   -- I19 (dikecualikan SLA)
    alasan_kekosongan   text         NULL,                     -- I11 (Blok B gaps)
    alasan_pembatalan   text         NULL,                     -- any -> Dibatalkan

    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          varchar(64)  NOT NULL,

    CONSTRAINT fk_interview_client   FOREIGN KEY (client_id)   REFERENCES clients (id),
    CONSTRAINT fk_interview_contract FOREIGN KEY (contract_id, client_id) REFERENCES contracts (id, client_id),
    CONSTRAINT fk_interview_service  FOREIGN KEY (service_id)  REFERENCES services (id),
    CONSTRAINT fk_interview_am        FOREIGN KEY (am_pengisi_id)    REFERENCES employees (employee_id),
    CONSTRAINT fk_interview_actingfor FOREIGN KEY (acting_for_am_id) REFERENCES employees (employee_id),
    CONSTRAINT fk_interview_sales     FOREIGN KEY (sales_closing_id) REFERENCES employees (employee_id),
    CONSTRAINT fk_interview_induk FOREIGN KEY (interview_induk_id)   REFERENCES interview (id),
    CONSTRAINT fk_interview_prev  FOREIGN KEY (versi_sebelumnya_id)  REFERENCES interview (id),
    CONSTRAINT ck_interview_versi CHECK (versi_no >= 1),
    CONSTRAINT ck_interview_lineage CHECK (
        (versi_no = 1 AND interview_induk_id IS NULL AND versi_sebelumnya_id IS NULL)
     OR (versi_no > 1 AND interview_induk_id IS NOT NULL AND versi_sebelumnya_id IS NOT NULL)),
    -- any -> Dibatalkan butuh alasan (route handler menulis alasan SEBELUM
    -- sm_transition di tx yang sama; CHECK biasa cukup karena non-deferrable).
    CONSTRAINT ck_interview_batal_alasan CHECK (
        status <> 'Dibatalkan' OR (alasan_pembatalan IS NOT NULL AND length(btrim(alasan_pembatalan)) > 0))
);

CREATE INDEX idx_interview_client   ON interview (client_id);
CREATE INDEX idx_interview_contract ON interview (contract_id);
CREATE INDEX idx_interview_am       ON interview (am_pengisi_id);

-- Satu interview AKTIF per kontrak. "Aktif" = belum terminal (bukan Selesai*/
-- Dibatalkan) dan bukan versi lama. Partial unique atas contract_id.
CREATE UNIQUE INDEX uq_interview_aktif_per_kontrak
    ON interview (contract_id)
    WHERE contract_id IS NOT NULL
      AND status NOT IN ('Selesai', 'Selesai Dengan Catatan', 'Dibatalkan');

-- ===========================================================================
-- 5. interview_jadwal — Blok A (1:1). Termasuk penanda idempotensi cron (step 5).
-- ===========================================================================
CREATE TABLE interview_jadwal (
    interview_id        varchar(32)  NOT NULL PRIMARY KEY,
    tanggal_waktu       timestamptz  NULL,           -- IA-3 (WIB disimpan UTC)
    durasi_menit        integer      NULL,           -- IA-4
    format              varchar(16)  NULL,           -- IA-5
    lokasi_link         text         NULL,           -- IA-6 (cond. format)
    peserta_klien       jsonb        NOT NULL DEFAULT '[]',  -- IA-7 [{nama, peran}]
    peserta_mea         jsonb        NOT NULL DEFAULT '[]',  -- IA-8 [employee_id]
    catatan_persiapan   text         NULL,           -- IA-10
    data_diminta        jsonb        NOT NULL DEFAULT '[]',  -- IA-11 [{item, status}]

    -- Idempotensi pengingat (dipakai pg_cron step 5; disimpan di sini supaya
    -- "ganti tanggal MENGGANTI reminder, tidak menumpuk" = reset kolom ini).
    pengingat_h1_pada     date       NULL,
    pengingat_hday_pada   date       NULL,
    overdue_emitted       integer    NOT NULL DEFAULT 0,
    overdue_escalated     boolean    NOT NULL DEFAULT false,
    butuh_data_nudge      integer    NOT NULL DEFAULT 0,
    terakhir_diproses     date       NULL,

    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT fk_interview_jadwal FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE,
    CONSTRAINT ck_jadwal_format CHECK (format IS NULL OR format IN ('Onsite', 'Video Call', 'Telepon', 'Chat')),
    CONSTRAINT ck_jadwal_durasi CHECK (durasi_menit IS NULL OR durasi_menit > 0)
);

-- IA-9 Riwayat Jadwal — append-only (setiap reschedule: lama, baru, alasan, actor).
CREATE TABLE interview_jadwal_riwayat (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id  varchar(32)  NOT NULL,
    jadwal_lama   timestamptz  NULL,
    jadwal_baru   timestamptz  NULL,
    alasan        text         NOT NULL,
    actor         varchar(64)  NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT fk_jadwal_riwayat FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE,
    CONSTRAINT ck_jadwal_riwayat_alasan CHECK (length(btrim(alasan)) > 0)
);
CREATE INDEX idx_jadwal_riwayat_interview ON interview_jadwal_riwayat (interview_id);

-- ===========================================================================
-- 6. interview_answer — jawaban Blok B, baris per (interview, section, field).
--    Nilai bertipe (kolom terpisah) + jsonb untuk struct. Field skor tidak boleh
--    kosong; estimasi butuh dasar tertulis.
-- ===========================================================================
CREATE TABLE interview_answer (
    interview_id   varchar(32)  NOT NULL,
    section        varchar(8)   NOT NULL,     -- B0..B11
    field_key      varchar(16)  NOT NULL,     -- e.g. B2-7

    nilai_teks     text         NULL,
    nilai_angka    numeric      NULL,
    nilai_uang     bigint       NULL,          -- minor units (money.ts)
    nilai_bool     boolean      NULL,
    nilai_enum     varchar(64)  NULL,          -- canonical code (packages/core enums)
    nilai_jsonb    jsonb        NULL,          -- struct answers (validated in TS + here)

    sumber_angka   varchar(24)  NULL,          -- I3: klien_hitung|dari_margin_kotor|estimasi_am
    dasar_estimasi text         NULL,          -- required when sumber_angka=estimasi_am
    wajib_kosong   boolean      NOT NULL DEFAULT false,

    updated_at     timestamptz  NOT NULL DEFAULT now(),
    updated_by     varchar(64)  NOT NULL,

    PRIMARY KEY (interview_id, section, field_key),
    CONSTRAINT fk_answer_interview FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE,
    CONSTRAINT ck_answer_sumber CHECK (
        sumber_angka IS NULL OR sumber_angka IN ('klien_hitung', 'dari_margin_kotor', 'estimasi_am')),
    -- I3: estimasi tanpa dasar tertulis DITOLAK di DB.
    CONSTRAINT ck_answer_estimasi_basis CHECK (
        sumber_angka IS DISTINCT FROM 'estimasi_am'
        OR (dasar_estimasi IS NOT NULL AND length(btrim(dasar_estimasi)) > 0)),
    -- Field skor TIDAK PERNAH boleh wajib_kosong (cermin SCORED_FIELD_KEYS di
    -- packages/core). Estimasi/turunan memenuhi field; blank tidak pernah.
    CONSTRAINT ck_answer_scored_not_blank CHECK (
        NOT (wajib_kosong AND field_key IN (
            'B1-4','B1-5','B2-3','B2-7','B2-8','B2-9','B2-10','B2-11','B2-13',
            'B3-3','B4-9','B6-3','B6-5','B7-3','B7-6')))
);
CREATE INDEX idx_answer_interview ON interview_answer (interview_id);

-- ===========================================================================
-- 7. interview_kualifikasi — output Blok C (1:1). Kolom yang Hans minta.
-- ===========================================================================
CREATE TABLE interview_kualifikasi (
    interview_id          varchar(32)  NOT NULL PRIMARY KEY,
    skor_kualifikasi      integer      NOT NULL,
    skor_per_blok         jsonb        NOT NULL,             -- {A,B,C,D,E}
    verdict_kualifikasi   varchar(24)  NOT NULL,
    hambatan_mendasar     jsonb        NOT NULL DEFAULT '[]',-- [{kode, nilai}]
    prasyarat_status      varchar(16)  NOT NULL DEFAULT 'belum',

    margin_bersih         numeric(6,2) NULL,
    margin_bersih_basis   varchar(24)  NOT NULL,
    margin_kotor          numeric(6,2) NULL,
    margin_dasar_estimasi text         NULL,
    margin_derivasi_input jsonb        NULL,

    kualitas_data         varchar(24)  NOT NULL,
    sumber_angka_per_field jsonb       NOT NULL DEFAULT '{}',
    bep_roas              numeric(6,2) NULL,                 -- computed, never writable by app roles
    daya_tahan_budget_bulan varchar(32) NULL,
    rasio_target          numeric(8,2) NULL,

    config_snapshot       jsonb        NOT NULL,             -- I15
    catatan_sanggahan     jsonb        NOT NULL DEFAULT '[]',-- append-only; never affects verdict

    dihitung_pada         timestamptz  NOT NULL DEFAULT now(),
    dihitung_oleh         varchar(64)  NOT NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_kualifikasi_interview FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE,
    CONSTRAINT ck_kualifikasi_skor CHECK (skor_kualifikasi BETWEEN 0 AND 100),
    CONSTRAINT ck_kualifikasi_verdict CHECK (
        verdict_kualifikasi IN ('growth_ready', 'bersyarat', 'risiko_tinggi', 'tidak_siap')),
    CONSTRAINT ck_kualifikasi_basis CHECK (
        margin_bersih_basis IN ('bersih_klien', 'diturunkan_dari_kotor', 'estimasi_am')),
    CONSTRAINT ck_kualifikasi_kualitas CHECK (
        kualitas_data IN ('terverifikasi', 'sebagian_estimasi', 'mayoritas_estimasi')),
    CONSTRAINT ck_kualifikasi_prasyarat CHECK (
        prasyarat_status IN ('belum', 'jalan', 'selesai')),
    -- I14 — deal-breaker mengalahkan skor, ABSOLUT. Tidak ada override.
    CONSTRAINT ck_kualifikasi_dealbreaker CHECK (
        jsonb_array_length(coalesce(hambatan_mendasar, '[]'::jsonb)) = 0
        OR verdict_kualifikasi = 'tidak_siap'),
    -- I21 — margin turunan wajib reproducible.
    CONSTRAINT ck_kualifikasi_derivasi CHECK (
        margin_bersih_basis <> 'diturunkan_dari_kotor'
        OR (margin_derivasi_input IS NOT NULL AND margin_kotor IS NOT NULL)),
    -- Estimasi margin wajib berdasar.
    CONSTRAINT ck_kualifikasi_estimasi CHECK (
        margin_bersih_basis <> 'estimasi_am'
        OR (margin_dasar_estimasi IS NOT NULL AND length(btrim(margin_dasar_estimasi)) > 0))
);

-- catatan_sanggahan APPEND-ONLY: tumbuh saja, elemen lama tak boleh berubah,
-- dan menambah sanggahan TIDAK boleh mengubah skor/verdict (pressure-release
-- valve — satu-satunya cara mengubah verdict adalah mengoreksi input & recompute).
CREATE OR REPLACE FUNCTION interview_kualifikasi_sanggahan_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_old_len int := jsonb_array_length(coalesce(OLD.catatan_sanggahan, '[]'::jsonb));
    v_new_len int := jsonb_array_length(coalesce(NEW.catatan_sanggahan, '[]'::jsonb));
BEGIN
    IF v_new_len < v_old_len THEN
        RAISE EXCEPTION 'interview_kualifikasi: catatan_sanggahan append-only — tidak bisa dikurangi';
    END IF;
    -- Prefiks lama harus dipertahankan.
    IF v_old_len > 0 AND (OLD.catatan_sanggahan <> (
        SELECT jsonb_agg(e) FROM jsonb_array_elements(NEW.catatan_sanggahan) WITH ORDINALITY t(e, ord)
        WHERE ord <= v_old_len)) THEN
        RAISE EXCEPTION 'interview_kualifikasi: catatan_sanggahan append-only — elemen lama tak boleh diubah';
    END IF;
    -- Menambah sanggahan saja tidak mengubah verdict/skor.
    IF v_new_len > v_old_len AND (
        NEW.skor_kualifikasi <> OLD.skor_kualifikasi
        OR NEW.verdict_kualifikasi <> OLD.verdict_kualifikasi) THEN
        RAISE EXCEPTION 'interview_kualifikasi: sanggahan tidak boleh mengubah skor/verdict (koreksi input lalu recompute)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kualifikasi_sanggahan_guard
    BEFORE UPDATE ON interview_kualifikasi
    FOR EACH ROW EXECUTE FUNCTION interview_kualifikasi_sanggahan_guard();

-- ===========================================================================
-- 8. interview_kategori_blok — Blok B9 config-driven (I10). Account bisa
--    memperluas tanpa deploy. Seed HANYA enam set yang diminta.
-- ===========================================================================
CREATE TABLE interview_kategori_blok (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kategori      varchar(64)  NOT NULL,
    sub_kategori  varchar(64)  NULL,
    field_key     varchar(32)  NOT NULL,
    label         text         NOT NULL,
    tipe          varchar(24)  NOT NULL,
    wajib         boolean      NOT NULL DEFAULT true,
    urutan        integer      NOT NULL DEFAULT 0,
    aktif         boolean      NOT NULL DEFAULT true,
    UNIQUE (kategori, field_key)
);

INSERT INTO interview_kategori_blok (kategori, field_key, label, tipe, urutan) VALUES
    ('Fashion',   'B9F-1', 'Size chart',                          'teks',   1),
    ('Fashion',   'B9F-2', 'Variasi warna',                       'teks',   2),
    ('Fashion',   'B9F-3', 'Ketersediaan per size',               'teks',   3),
    ('Fashion',   'B9F-4', 'Retur karena ukuran (%)',             'angka',  4),
    ('Fashion',   'B9F-5', 'Musim / koleksi',                     'teks',   5),
    ('Fashion',   'B9F-6', 'Bahan',                               'teks',   6),
    ('Beauty',    'B9B-1', 'Nomor BPOM per SKU',                  'teks',   1),
    ('Beauty',    'B9B-2', 'Expiry & batch',                      'teks',   2),
    ('Beauty',    'B9B-3', 'Klaim yang diizinkan BPOM',           'teks',   3),
    ('Beauty',    'B9B-4', 'Ingredient sensitif',                 'teks',   4),
    ('Beauty',    'B9B-5', 'Aturan sampling',                     'teks',   5),
    ('Food',      'B9M-1', 'Izin edar / PIRT / BPOM',             'teks',   1),
    ('Food',      'B9M-2', 'Halal',                               'teks',   2),
    ('Food',      'B9M-3', 'Shelf life',                          'teks',   3),
    ('Food',      'B9M-4', 'Penanganan kirim (frozen/kering)',    'teks',   4),
    ('Food',      'B9M-5', 'Jangkauan pengiriman',                'teks',   5),
    ('Home Living','B9H-1','Dimensi & berat volumetrik',          'teks',   1),
    ('Home Living','B9H-2','Ongkir sebagai penghambat',           'teks',   2),
    ('Home Living','B9H-3','Perakitan',                           'teks',   3),
    ('Home Living','B9H-4','Garansi',                             'teks',   4),
    ('Home Living','B9H-5','Kerusakan pengiriman (%)',            'angka',  5),
    ('Elektronik','B9E-1', 'Garansi resmi/distributor',           'teks',   1),
    ('Elektronik','B9E-2', 'Purna jual',                          'teks',   2),
    ('Elektronik','B9E-3', 'Keaslian',                            'teks',   3),
    ('Elektronik','B9E-4', 'Aturan platform kategori',            'teks',   4),
    ('Health',    'B9S-1', 'Izin edar',                           'teks',   1),
    ('Health',    'B9S-2', 'Klaim kesehatan yang dilarang',       'teks',   2),
    ('Health',    'B9S-3', 'Batasan iklan platform',              'teks',   3);

-- ===========================================================================
-- 9. interview_flag — red flag, SLA breach, reschedule count, bep_di_atas_target,
--    klien_mode_penyelamatan, margin_zona_abu_abu, dst. Append-only.
-- ===========================================================================
CREATE TABLE interview_flag (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id  varchar(32)  NOT NULL,
    kode          varchar(48)  NOT NULL,
    detail        jsonb        NOT NULL DEFAULT '{}',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT fk_flag_interview FOREIGN KEY (interview_id) REFERENCES interview (id) ON DELETE CASCADE
);
CREATE INDEX idx_flag_interview ON interview_flag (interview_id);

-- ===========================================================================
-- 10. interview_outcome — akurasi verdict (I18). Ditulis di akhir kontrak.
-- ===========================================================================
CREATE TABLE interview_outcome (
    interview_id  varchar(32)  NOT NULL PRIMARY KEY,
    kontrak_id    varchar(32)  NULL,
    hasil         varchar(32)  NOT NULL,
    bulan_bertahan integer     NULL,
    dicatat_pada  timestamptz  NOT NULL DEFAULT now(),
    dicatat_oleh  varchar(64)  NOT NULL,
    CONSTRAINT fk_outcome_interview FOREIGN KEY (interview_id) REFERENCES interview (id),
    CONSTRAINT ck_outcome_hasil CHECK (
        hasil IN ('perpanjang', 'selesai_tidak_perpanjang', 'berhenti_di_tengah'))
);

-- ===========================================================================
-- 11. interview_version — snapshot per versi (I9). Append-only, immutable read.
-- ===========================================================================
CREATE TABLE interview_version (
    interview_id  varchar(32)  NOT NULL,
    versi_no      integer      NOT NULL,
    snapshot      jsonb        NOT NULL,
    dibuat_pada   timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh   varchar(64)  NOT NULL,
    PRIMARY KEY (interview_id, versi_no),
    CONSTRAINT fk_version_interview FOREIGN KEY (interview_id) REFERENCES interview (id)
);

-- History append-only: interview_jadwal_riwayat / interview_version / interview_flag
-- / interview_outcome tidak boleh di-UPDATE/DELETE (immutable, house rule #3).
CREATE OR REPLACE FUNCTION interview_history_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'interview: % adalah riwayat immutable (append-only)', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER trg_jadwal_riwayat_frozen BEFORE UPDATE OR DELETE ON interview_jadwal_riwayat
    FOR EACH ROW EXECUTE FUNCTION interview_history_frozen();
CREATE TRIGGER trg_version_frozen BEFORE UPDATE OR DELETE ON interview_version
    FOR EACH ROW EXECUTE FUNCTION interview_history_frozen();
CREATE TRIGGER trg_flag_frozen BEFORE UPDATE OR DELETE ON interview_flag
    FOR EACH ROW EXECUTE FUNCTION interview_history_frozen();

-- ===========================================================================
-- 12. State machine `interview` (mesin #19 — data, bukan kode). sm_transition
--     satu-satunya penulis kolom status.
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state) VALUES
    ('interview', 'Belum Dijadwalkan');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('interview', 'Selesai'),
    ('interview', 'Selesai Dengan Catatan'),
    ('interview', 'Dibatalkan');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('interview', 'Belum Dijadwalkan',      'Terjadwal',              false),
    ('interview', 'Terjadwal',              'Sedang Berlangsung',     false),
    ('interview', 'Terjadwal',              'Dijadwalkan Ulang',      false),
    ('interview', 'Dijadwalkan Ulang',      'Terjadwal',              false),
    ('interview', 'Sedang Berlangsung',     'Draft Isian',            false),
    ('interview', 'Draft Isian',            'Diajukan',               false),
    ('interview', 'Draft Isian',            'Butuh Data Klien',       false),
    ('interview', 'Butuh Data Klien',       'Draft Isian',            false),
    -- Reviewer (SPV/Head of Account): Selesai Dengan Catatan & Dikembalikan gate lead.
    -- Selesai bersih tidak butuh lead (penyelesaian tanpa kekosongan).
    ('interview', 'Diajukan',               'Selesai',                false),
    ('interview', 'Diajukan',               'Selesai Dengan Catatan', true),
    ('interview', 'Diajukan',               'Dikembalikan',           true),
    ('interview', 'Dikembalikan',           'Draft Isian',            false),
    -- any (non-terminal) -> Dibatalkan (reason required, via CHECK di atas).
    ('interview', 'Belum Dijadwalkan',      'Dibatalkan',             true),
    ('interview', 'Terjadwal',              'Dibatalkan',             true),
    ('interview', 'Dijadwalkan Ulang',      'Dibatalkan',             true),
    ('interview', 'Sedang Berlangsung',     'Dibatalkan',             true),
    ('interview', 'Draft Isian',            'Dibatalkan',             true),
    ('interview', 'Butuh Data Klien',       'Dibatalkan',             true),
    ('interview', 'Diajukan',               'Dibatalkan',             true);

-- ===========================================================================
-- 13. RLS — cermin predikat permission.ts. Model tulis = default-deny untuk
--     authenticated (tulis via RPC/service-role). Blok C & Blok B (sensitif)
--     TIDAK pernah terlihat Sales: dipakai scope Account-only (assigned AM /
--     Account lead / OD / Director) — Sales default-deny total di sini. Grant
--     verdict-only untuk Sales adalah view aditif terpisah (step 6), bukan
--     pelonggaran RLS tabel ini.
-- ===========================================================================

-- Kepemilikan assigned-AM saja (BUKAN sales_pic) untuk sebuah client_id.
-- SECURITY DEFINER supaya subquery clients tidak ikut ter-filter RLS. Arm
-- lead/divisi TIDAK di sini — ia di-INLINE di tiap policy supaya detektor
-- sintaktik O48 (rls_checks.sql §42) melihatnya langsung (pola strategi_select).
CREATE OR REPLACE FUNCTION public.jwt_owns_client_am(p_client_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = p_client_id
       AND public.jwt_employee_id() = c.assigned_am_id)
$$;

-- Sama, diturunkan dari interview_id (untuk tabel anak). SECURITY DEFINER supaya
-- join interview/clients tidak ter-filter RLS induk.
CREATE OR REPLACE FUNCTION public.jwt_owns_interview_am(p_interview_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.interview i JOIN public.clients c ON c.id = i.client_id
     WHERE i.id = p_interview_id
       AND public.jwt_employee_id() = c.assigned_am_id)
$$;

-- Grant hygiene + RLS enable untuk semua tabel modul.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'interview','interview_jadwal','interview_jadwal_riwayat','interview_answer',
    'interview_kualifikasi','interview_flag','interview_outcome','interview_version',
    'kualifikasi_config','margin_deduksi_config','interview_kategori_blok']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- SELECT (Account-scope). authenticated diberi SELECT lalu difilter policy.
GRANT SELECT ON public.interview, public.interview_jadwal, public.interview_jadwal_riwayat,
      public.interview_answer, public.interview_kualifikasi, public.interview_flag,
      public.interview_outcome, public.interview_version TO authenticated;

-- Arm lead/divisi DI-INLINE di setiap policy (bukan disembunyikan di helper),
-- supaya detektor O48 melihatnya dan tabel-tabel ini tidak perlu masuk ledger.
CREATE POLICY interview_sel ON public.interview FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(client_id));
CREATE POLICY interview_jadwal_sel ON public.interview_jadwal FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_jadwal_riwayat_sel ON public.interview_jadwal_riwayat FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_answer_sel ON public.interview_answer FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_kualifikasi_sel ON public.interview_kualifikasi FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_flag_sel ON public.interview_flag FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_outcome_sel ON public.interview_outcome FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));
CREATE POLICY interview_version_sel ON public.interview_version FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_interview_am(interview_id));

-- interview_kategori_blok, kualifikasi_config, margin_deduksi_config: NOL policy
-- (default-deny), seperti entity_prefix/notif_events. Dibaca hanya lewat
-- RPC/service-role (route handler menyajikan Blok B9 & ambang ke form). Ini
-- SENGAJA tidak memberi authenticated SELECT: (a) ambang & deduksi sensitif —
-- reverse-engineering band menghancurkan satu-satunya sinyal modul (spesifikasi
-- §Permissions), dan (b) menghindari menambah baris ke ledger O48 (rls_checks.sql
-- §42) untuk tabel config yang tidak butuh baca-klien langsung.
