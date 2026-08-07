-- CDPS — Module 6A A-07: Section C — Diagnosa & Akar Masalah
--
-- Empat tabel baru; nol tabel lama diubah bentuknya.
--
-- Rule 6 (§4): setiap diagnosa per channel WAJIB mereferensi ≥1 field-ID
-- baseline. Field-ID yang sah terdefinisi sebagai konstanta di domain
-- (`VALID_BASELINE_FIELD_IDS`) — set tertutup tidak bisa ditulis sebagai
-- CHECK Postgres (CHECK tidak boleh mengandung subquery, dan array literal
-- yang cukup panjang membuat ALTER tidak terbaca). Validasi Rule 6 hidup di
-- `saveDiagnosa` (domain), bukan di DB. Yang DB perjaga: bentuk array jsonb
-- (bukan objek), bottleneck enum tertutup, dan check isi non-kosong.
--
-- Kenapa EMPAT tabel terpisah, bukan kolom-kolom di `strategi`:
-- C-5 (quick win), C-6 (risiko struktural), C-7 (prasyarat klien) semuanya
-- REPEATABLE — setiap AM bisa mengisi nol, tiga, atau dua belas baris.
-- Menyimpan daftar tak terbatas sebagai kolom jsonb di `strategi` melanggar
-- aturan rumah #3 (immutability) kalau kita perlu melacak kapan setiap baris
-- ditambah/dihapus. Tabel anak + `created_by` + `created_at` memberikan audit
-- gratis yang sama dengan semua child entity lainnya.
--
-- Diagnosa (C-1..C-4) menjadi tabel tersendiri — bukan kolom di
-- `strategi_channel` — karena Rule 6 membutuhkan FK konseptual dari
-- `field_ids` array ke field-ID baseline yang ada di Strategi yang sama, dan
-- menempatkannya di `strategi_diagnosa` membuat scope per-strategi yang benar.
-- ===========================================================================

-- ===========================================================================
-- 1. `strategi_diagnosa` — C-1, C-2, C-3, C-4 (satu baris per channel)
-- ===========================================================================
CREATE TABLE strategi_diagnosa (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,
    channel         text            NOT NULL,

    -- C-1: bottleneck utama per channel. Enum ditutup di DB.
    bottleneck      text            NOT NULL,

    -- C-2: field-ID references (Rule 6). Disimpan sebagai jsonb array
    -- of text ("B-2.2", "A-5", dsb.), minimal 1 elemen dipastikan domain.
    -- DB hanya memastikan ini adalah jsonb array, bukan scalar/object.
    field_ids       jsonb           NOT NULL DEFAULT '[]'::jsonb,

    -- C-3: akar masalah (bukan gejala). NULLable karena autosave;
    -- kehadiran wajib diperiksa di gerbang submit checkCompleteness.
    akar_masalah    text,

    -- C-4: gap vs kompetitor yang paling menentukan.
    gap_kompetitor  text,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strdiag_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,

    -- Satu diagnosa per channel per Strategi. Dua channel tidak bisa punya
    -- bottleneck berbeda di baris terpisah — itu adalah dua baris diagnosa
    -- untuk channel yang sama, bukan dua channel.
    CONSTRAINT uq_strdiag_channel UNIQUE (strategi_id, channel),

    CONSTRAINT ck_strdiag_bottleneck CHECK (bottleneck IN (
        'trafik', 'konversi', 'aov', 'repeat_order', 'margin',
        'operasional', 'konten', 'harga', 'listing'
    )),
    CONSTRAINT ck_strdiag_field_ids_array CHECK (
        jsonb_typeof(field_ids) = 'array'
    )
);

CREATE INDEX idx_strdiag_strategi ON strategi_diagnosa (strategi_id);
CREATE TRIGGER trg_strategi_diagnosa_updated_at
    BEFORE UPDATE ON strategi_diagnosa
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_diagnosa IS
  'A-07 — Section C per channel: C-1 bottleneck, C-2 field-ID evidence '
  '(Rule 6 requires ≥1 valid baseline field-ID per row, validated domain-side), '
  'C-3 root cause, C-4 competitor gap.';

COMMENT ON COLUMN strategi_diagnosa.field_ids IS
  'Rule 6: array of baseline field-ID strings ("B-2.2", "A-5", …). '
  'Valid set is VALID_BASELINE_FIELD_IDS constant in packages/domain/src/strategi.ts. '
  'DB enforces array shape; domain validates the set membership.';

-- ===========================================================================
-- 2. `strategi_quick_win` — C-5 (repeatable struct, min 3 total per Strategi)
-- ===========================================================================
CREATE TABLE strategi_quick_win (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    -- Aksi yang dilakukan, channel yang ditarget, PIC divisi, dampak diharapkan.
    -- Semua NOT NULL karena baris hanya dibuat saat AM mengisi seluruh struct.
    aksi            text            NOT NULL,
    channel         text            NOT NULL,  -- channel yang ditarget aksi ini
    pic_divisi      text            NOT NULL,  -- divisi internal yang menjalankan
    dampak_diharapkan text          NOT NULL,

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strqw_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strqw_isi CHECK (
        btrim(aksi) <> '' AND btrim(pic_divisi) <> '' AND
        btrim(dampak_diharapkan) <> '' AND btrim(channel) <> ''
    )
);

CREATE INDEX idx_strqw_strategi ON strategi_quick_win (strategi_id);
CREATE TRIGGER trg_strategi_quick_win_updated_at
    BEFORE UPDATE ON strategi_quick_win
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_quick_win IS
  'A-07 — Section C-5: quick wins 14 hari pertama. '
  'Min 3 baris per Strategi, diperiksa di checkCompleteness.';

-- ===========================================================================
-- 3. `strategi_risiko_struktural` — C-6 (repeatable text)
-- ===========================================================================
CREATE TABLE strategi_risiko_struktural (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    risiko          text            NOT NULL,  -- teks risiko struktural

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strriskstr_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strriskstr_isi CHECK (btrim(risiko) <> '')
);

CREATE INDEX idx_strriskstr_strategi ON strategi_risiko_struktural (strategi_id);
CREATE TRIGGER trg_strategi_risiko_struktural_updated_at
    BEFORE UPDATE ON strategi_risiko_struktural
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_risiko_struktural IS
  'A-07 — Section C-6: risiko struktural yang tak bisa dihilangkan. '
  'Min 1 baris per Strategi (W), diperiksa di checkCompleteness.';

-- ===========================================================================
-- 4. `strategi_prasyarat_klien` — C-7 (repeatable struct)
-- ===========================================================================
CREATE TABLE strategi_prasyarat_klien (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    item            text            NOT NULL,  -- hal yang harus dibereskan klien
    pic_klien       text            NOT NULL,  -- PIC di sisi klien
    deadline        date,                       -- NULLable: bisa belum ditentukan

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strpreq_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strpreq_isi CHECK (btrim(item) <> '' AND btrim(pic_klien) <> '')
);

CREATE INDEX idx_strpreq_strategi ON strategi_prasyarat_klien (strategi_id);
CREATE TRIGGER trg_strategi_prasyarat_klien_updated_at
    BEFORE UPDATE ON strategi_prasyarat_klien
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_prasyarat_klien IS
  'A-07 — Section C-7: hal yang harus dibereskan klien sebelum eksekusi. '
  'Min 1 baris per Strategi (W), diperiksa di checkCompleteness.';

-- ===========================================================================
-- RLS — empat tabel baru mengikuti pola jwt_can_read_strategi yang sama
-- dengan tabel anak Strategi lainnya.
-- ===========================================================================

-- strategi_diagnosa
REVOKE ALL ON public.strategi_diagnosa FROM anon;
REVOKE ALL ON public.strategi_diagnosa FROM authenticated;
GRANT SELECT ON public.strategi_diagnosa TO authenticated;
ALTER TABLE public.strategi_diagnosa ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_diagnosa_select ON public.strategi_diagnosa
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_quick_win
REVOKE ALL ON public.strategi_quick_win FROM anon;
REVOKE ALL ON public.strategi_quick_win FROM authenticated;
GRANT SELECT ON public.strategi_quick_win TO authenticated;
ALTER TABLE public.strategi_quick_win ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_quick_win_select ON public.strategi_quick_win
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_risiko_struktural
REVOKE ALL ON public.strategi_risiko_struktural FROM anon;
REVOKE ALL ON public.strategi_risiko_struktural FROM authenticated;
GRANT SELECT ON public.strategi_risiko_struktural TO authenticated;
ALTER TABLE public.strategi_risiko_struktural ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_risiko_struktural_select ON public.strategi_risiko_struktural
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_prasyarat_klien
REVOKE ALL ON public.strategi_prasyarat_klien FROM anon;
REVOKE ALL ON public.strategi_prasyarat_klien FROM authenticated;
GRANT SELECT ON public.strategi_prasyarat_klien TO authenticated;
ALTER TABLE public.strategi_prasyarat_klien ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_prasyarat_klien_select ON public.strategi_prasyarat_klien
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));
