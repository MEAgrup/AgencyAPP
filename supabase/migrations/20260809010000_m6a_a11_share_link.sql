-- CDPS — Module 6A A-11: tautan klien read-only `/s/{token}` (§7 D20, RA-3, RA-7).
--
-- Strategi adalah dokumen yang menghadap klien, dan §7 mengirimkannya BUKAN
-- sebagai berkas melainkan sebagai halaman server-rendered di `/s/{token}`. Dua
-- tabel di sini adalah separuh-DB dari fitur itu:
--
--   strategi_share_token       — kredensialnya (32-byte acak, DISIMPAN TER-HASH).
--   strategi_share_access_log  — bukti "klien benar-benar membukanya, versi mana".
--
-- Gerbang jumlah tabel: **82 → 84.**
--
-- ⚠️ Gerbang itu hidup di DUA berkas — `.github/workflows/ci.yml` **dan**
-- `scripts/db-rebuild.sh`. Menaikkan satu saja membuat seluruh test hijau
-- sementara CI merah (komentar di ci.yml mencatat sesi tempat itu betul terjadi).
--
-- ===========================================================================
-- KENAPA TOKEN DIIKAT KE CONTRACT, BUKAN KE SATU BARIS `strategi`
-- ===========================================================================
-- Versi Strategi adalah BARIS (Rule 13): revisi melahirkan baris baru, dan yang
-- `Aktif` berpindah saat revisi disetujui. §7 menuntut tautannya "version-pinned
-- by default: always renders the current APPROVED ACTIVE version" — jadi ia tidak
-- boleh dipaku ke satu `strategi.id`, atau ia akan membeku di versi lama begitu
-- ada revisi. Contract adalah pengenal yang stabil lintas revisi (Rule 2: tepat
-- satu Strategi aktif per Contract), jadi token diikat ke `contract_id` dan
-- resolusinya SELALU mencari baris berstatus `Aktif` pada kontrak itu.
--
-- ===========================================================================
-- KENAPA HANYA HASH YANG DISIMPAN, DAN KENAPA `anon` TIDAK PUNYA GRANT
-- ===========================================================================
-- §7: "stored hashed". Token plaintext hanya pernah ada sekali — di respons saat
-- ia dibuat — dan tidak pernah bisa dibaca ulang dari DB; kalau hilang, AM
-- me-regenerate (yang lama langsung mati). Resolusi `/s/{token}` mencari lewat
-- hash SHA-256, bukan lewat nilai mentah.
--
-- Halaman publik dirender server-side dengan filter visibilitas §7 diterapkan
-- SEBELUM serialisasi (`shareableFieldIds()` — pintu tunggal), MEMAKAI koneksi
-- service-role. Ia TIDAK membuka tabel ini ke `anon`: token-hash adalah rahasia,
-- dan access log adalah data internal. Kedua tabel karena itu dikunci penuh dari
-- `authenticated` juga — baca internalnya (status tautan di halaman Strategi)
-- lewat domain service-role yang menegakkan permission di TS, pola yang sama
-- dengan tabel internal murni lain (O51).

-- ---------------------------------------------------------------------------
-- 1. strategi_share_token — satu baris per token; paling banyak satu Aktif/kontrak
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategi_share_token (
    id                  uuid            NOT NULL DEFAULT gen_random_uuid(),
    -- Diikat ke kontrak, bukan ke satu versi Strategi — lihat blok komentar.
    contract_id         varchar(32)     NOT NULL,
    -- SHA-256 hex dari rahasia 32-byte. Rahasianya sendiri tidak pernah disimpan.
    token_hash          varchar(64)     NOT NULL,
    -- `Aktif` → bisa membuka; `Dicabut` → halaman "tautan tidak aktif" (§7).
    status              varchar(16)     NOT NULL DEFAULT 'Aktif',
    -- Kedaluwarsa opsional (§7 default = akhir kontrak + 30 hari, diisi domain).
    -- NULL = tidak pernah kedaluwarsa sampai dicabut.
    tanggal_kedaluwarsa date            NULL,

    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    created_by          varchar(64)     NOT NULL,
    -- Terisi hanya saat status `Dicabut` — siapa mencabut, kapan.
    dicabut_oleh        varchar(64)     NULL,
    dicabut_pada        timestamptz     NULL,

    CONSTRAINT pk_shtok PRIMARY KEY (id),
    CONSTRAINT fk_shtok_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE,

    -- Hash unik: dua token tidak boleh berbagi rahasia (dan hash yang bertabrakan
    -- akan membuat resolusi ambigu).
    CONSTRAINT uq_shtok_hash UNIQUE (token_hash),

    CONSTRAINT ck_shtok_status CHECK (status IN ('Aktif', 'Dicabut')),
    CONSTRAINT ck_shtok_hash CHECK (char_length(btrim(token_hash)) = 64),

    -- Dicabut punya aktor DAN waktu, atau bukan pencabutan sama sekali.
    CONSTRAINT ck_shtok_dicabut_utuh CHECK ((dicabut_oleh IS NULL) = (dicabut_pada IS NULL)),
    -- Metadata pencabutan hanya sah pada baris `Dicabut`; sebaliknya `Aktif` tanpa
    -- metadata pencabutan. Ini yang membuat "dicabut" dan "aktif" tidak bisa
    -- berbohong satu sama lain.
    CONSTRAINT ck_shtok_dicabut_status CHECK (
        (status = 'Dicabut') = (dicabut_oleh IS NOT NULL))
);

-- §7 "One active token per Strategi; regenerating invalidates the old one":
-- paling banyak SATU baris `Aktif` per kontrak. Token dicabut tidak dibatasi —
-- riwayatnya tetap ada untuk access log yang menunjuknya.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shtok_satu_aktif
    ON strategi_share_token (contract_id) WHERE status = 'Aktif';

-- Jalur baca resolusi publik: lookup lewat hash (dijamin unik oleh uq_shtok_hash,
-- jadi tidak perlu indeks tambahan).

DROP TRIGGER IF EXISTS trg_strategi_share_token_updated_at ON strategi_share_token;
CREATE TRIGGER trg_strategi_share_token_updated_at
    BEFORE UPDATE ON strategi_share_token
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_share_token IS
  'M6A §7 D20 — kredensial tautan klien read-only /s/{token}. Diikat ke '
  'contract_id (stabil lintas revisi; resolusi selalu ke versi Aktif). Hanya '
  'SHA-256 dari rahasia 32-byte yang disimpan; plaintext hanya ada sekali saat '
  'dibuat. Paling banyak satu baris Aktif per kontrak (uq_shtok_satu_aktif).';
COMMENT ON COLUMN strategi_share_token.token_hash IS
  'SHA-256 hex (64 char) dari rahasia 32-byte. Rahasia tidak pernah disimpan; '
  'resolusi /s/{token} mencari lewat hash ini.';

-- ---------------------------------------------------------------------------
-- 2. strategi_share_access_log — append-only; "did the client open it, which version"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategi_share_access_log (
    id            bigint          GENERATED ALWAYS AS IDENTITY,
    token_id      uuid            NOT NULL,
    -- Baris `strategi` yang BENAR-BENAR dirender (versi Aktif saat dibuka), plus
    -- nomor versinya — itulah yang menjawab "versi mana yang klien lihat".
    strategi_id   varchar(32)     NOT NULL,
    versi_no      integer         NOT NULL,
    ip            varchar(64)     NULL,
    user_agent    text            NULL,
    viewed_at     timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT pk_shlog PRIMARY KEY (id),
    CONSTRAINT fk_shlog_token FOREIGN KEY (token_id)
        REFERENCES strategi_share_token (id) ON DELETE CASCADE,
    CONSTRAINT fk_shlog_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_shlog_versi CHECK (versi_no >= 1)
);

CREATE INDEX IF NOT EXISTS ix_shlog_token ON strategi_share_access_log (token_id, viewed_at);

-- House rule #3 — riwayat immutable: nol jalur UPDATE/DELETE. Access log adalah
-- bukti sengketa; sebuah baris yang bisa diedit tidak lagi jadi bukti.
DROP TRIGGER IF EXISTS trg_shlog_no_update ON strategi_share_access_log;
CREATE TRIGGER trg_shlog_no_update
    BEFORE UPDATE ON strategi_share_access_log
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trg_shlog_no_delete ON strategi_share_access_log;
CREATE TRIGGER trg_shlog_no_delete
    BEFORE DELETE ON strategi_share_access_log
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE strategi_share_access_log IS
  'M6A §7 — satu baris per pembukaan /s/{token}: (token, strategi versi yang '
  'dirender, ip, user_agent, viewed_at). Append-only (forbid_mutation). Inilah '
  'kenapa tautan mengalahkan PDF: ia menjawab "klien membukanya, versi mana" '
  'saat sengketa.';

-- ---------------------------------------------------------------------------
-- RLS — kedua tabel internal murni: nol grant untuk anon DAN authenticated.
-- ---------------------------------------------------------------------------
-- Publik `/s/{token}` dirender service-role dengan filter §7 diterapkan di
-- domain SEBELUM serialisasi; internal membaca status tautan lewat domain
-- service-role yang menegakkan permission. Tidak ada pihak yang menyentuh tabel
-- ini sebagai `anon`/`authenticated` langsung — jadi keduanya dikunci penuh dan
-- masuk daftar-terkunci `rls_checks.sql` §9 (pola O51).
REVOKE ALL ON public.strategi_share_token FROM anon;
REVOKE ALL ON public.strategi_share_token FROM authenticated;
ALTER TABLE public.strategi_share_token ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.strategi_share_access_log FROM anon;
REVOKE ALL ON public.strategi_share_access_log FROM authenticated;
ALTER TABLE public.strategi_share_access_log ENABLE ROW LEVEL SECURITY;
