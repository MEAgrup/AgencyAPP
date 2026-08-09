-- CDPS — Module 6A A-10 (bagian 2): `STRG_FIELD_VISIBILITY`
--
-- Rule 16 memberi setiap field Strategi sebuah `visibilitas` ∈ `Bagikan ke
-- Klien` / `Internal Saja`, dan §4.1 memberi setiap field sebuah DEFAULT.
-- Bagian 1 (`packages/core/src/visibility.ts`) mendaratkan peta default itu
-- sebagai konstanta TOTAL. Migrasi ini mendaratkan separuh sisanya: tempat
-- KEPUTUSAN AM disimpan, dan tembok yang menolak keputusan yang tidak boleh
-- diambil.
--
-- Gerbang jumlah tabel: **81 → 82.**
--
-- ⚠️ Gerbang itu hidup di DUA berkas — `.github/workflows/ci.yml` **dan**
-- `scripts/db-rebuild.sh`. Menaikkan satu saja membuat seluruh test hijau
-- sementara CI merah; komentar di ci.yml mencatat sesi tempat itu betul terjadi.
--
-- ===========================================================================
-- KENAPA TABEL OVERLAY, DAN BUKAN KOLOM `visibilitas` DI SETIAP TABEL
-- ===========================================================================
-- §7 menyebut bentuknya sendiri: `STRG_FIELD_VISIBILITY` (`strategi_id`,
-- `field_id`, `visibilitas`, `diubah_oleh`, `diubah_pada`). Alasannya terlihat
-- begitu alternatifnya ditulis: `A-10 riwayat agensi` adalah SATU pertanyaan
-- yang hidup di kolom `strategi.riwayat_agensi`, tapi `B-3.3` adalah satu sel di
-- tabel anak per-channel, dan `D-2` adalah sebuah MATRIKS baris di
-- `strategi_target`. Kolom `visibilitas` per tabel akan berarti tiga bentuk
-- penyimpanan berbeda untuk satu aturan yang sama — dan untuk D-2, sebuah
-- pertanyaan yang tak punya jawaban: visibilitas dari baris ke-tujuh belas?
--
-- Tier itu per FIELD ID §4, bukan per kolom. Klien melihat jawabannya, atau
-- tidak melihatnya.
--
-- ===========================================================================
-- KENAPA BARISNYA DISEMAI PENUH SAAT `createStrategi`, BUKAN DITULIS SAAT
-- AM MENYENTUH TOMBOLNYA
-- ===========================================================================
-- §7: "seeded from the §4.1 defaults". Overlay yang jarang (hanya baris yang
-- menyimpang) akan lebih hemat dan tetap benar di jalur baca — `visibilitas`
-- selalu dibaca sebagai `overlay[id] ?? defaultVisibility(id)`. Yang hilang
-- adalah sifat yang justru dibeli dengan menyemai: dokumen jadi TERPAKU.
--
-- Kalau kelak default §4.1 untuk sebuah field diubah, Strategi yang sudah
-- disetujui — dan sudah dibaca klien lewat `/s/{token}` — tidak diam-diam
-- berubah isinya karena sebuah konstanta di-edit. Baris yang disemai adalah
-- keadaan dokumen pada saat ia dibuat; konstanta adalah keadaan aturan hari ini.
-- Untuk dokumen yang tidak bisa di-*un-publish*, keduanya harus dipisah.
--
-- Konsekuensi yang diterima sadar: ~116 baris per Strategi, dan sebuah field
-- yang lahir SETELAH sebuah Strategi dibuat tidak punya baris di sana. Yang
-- kedua tidak berbahaya justru karena jalur bacanya tetap `?? default` — field
-- baru jatuh ke default §4.1-nya sampai AM menyentuhnya.
--
-- ===========================================================================
-- `ck_strfv_hard_internal` — invariant beku §7, dan kenapa isinya DELAPAN
-- ===========================================================================
-- §7: "Hard-internal field IDs live in a constant list in `packages/core` and
-- are rejected at both the TS predicate and the DB check — the two must not
-- diverge (frozen invariant)."
--
-- Predikat TS-nya adalah `isHardInternal()`, dan ia menolak DELAPAN field, bukan
-- tujuh: ketujuh yang §4.1 sebut, **plus I-4**, yang X-16 tinggalkan sebagai
-- hard-internal sementara (§4.1 tidak pernah mengklasifikasikannya, dan I-4
-- adalah catatan untuk divisi eksekusi kita sendiri tentang "hal yang mudah
-- salah dipahami" — dibaca klien, itu daftar kesalahan yang tim kita berulang
-- di akun mereka).
--
-- Jadi CHECK ini dibangun dari `hardInternalFieldIds()`, BUKAN dari
-- `STRATEGI_HARD_INTERNAL`. CHECK berisi tujuh anggota §4.1 akan membiarkan I-4
-- diterbitkan lewat tulis langsung ke DB sementara TypeScript bilang tidak —
-- persis divergensi yang §7 larang. Test `A-10 hard-internal set does not drift`
-- di `packages/domain/src/strategi.test.ts` membandingkan ISI constraint ini
-- dengan keluaran fungsi itu, dua arah.
--
-- Kalau X-16 kelak memindahkan I-4 keluar dari hard-internal, biayanya satu
-- `DROP/ADD CONSTRAINT` **di commit yang sama** dengan perubahan TS-nya.
--
-- ===========================================================================
-- NOL TRIGGER IMMUTABILITY — dan itu bukan kelalaian
-- ===========================================================================
-- Tabel ini memang BERUBAH: itulah arti sebuah toggle. Yang append-only adalah
-- riwayatnya, dan riwayat itu `audit_log` (house rule #3), tempat
-- `setFieldVisibility` menulis satu baris before→after per toggle — yang juga
-- yang Rule 16(b) minta ("the toggle is audit-logged").
-- ===========================================================================

CREATE TABLE IF NOT EXISTS strategi_field_visibility (
    strategi_id     varchar(32)     NOT NULL,
    -- ID field §4 ('A-10', 'B-3.3', 'G-0'), BUKAN nama kolom. Lihat catatan di
    -- atas: satu field ID bisa memetakan ke nol, satu, atau n kolom.
    field_id        varchar(16)     NOT NULL,
    visibilitas     varchar(24)     NOT NULL,

    -- NULL selama baris masih berupa semaian §4.1 yang belum disentuh siapa pun.
    -- Itu perbedaan yang bisa dibaca: "default kami" vs "AM memutuskan begini".
    diubah_oleh     varchar(64)     NULL,
    diubah_pada     timestamptz     NULL,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    -- Kunci komposit, bukan identity + unique: satu field punya tepat satu
    -- visibilitas per Strategi, dan itu justru yang PK ini nyatakan. Baris kedua
    -- untuk field yang sama adalah dua jawaban atas satu pertanyaan.
    CONSTRAINT pk_strfv PRIMARY KEY (strategi_id, field_id),
    CONSTRAINT fk_strfv_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,

    CONSTRAINT ck_strfv_field_id CHECK (btrim(field_id) <> ''),

    -- Set tertutup, identik dengan `VISIBILITIES` di packages/core.
    CONSTRAINT ck_strfv_visibilitas CHECK (
        visibilitas IN ('Bagikan ke Klien', 'Internal Saja')),

    -- Rule 16(a) — invariant beku §7. Lihat blok komentar di atas untuk kenapa
    -- daftarnya delapan dan bukan tujuh.
    CONSTRAINT ck_strfv_hard_internal CHECK (
        visibilitas = 'Internal Saja'
     OR field_id NOT IN ('A-10', 'D-7', 'F-5', 'F-7', 'H-4', 'I-4', 'J-2', 'J-3')),

    -- Sebuah toggle punya aktor DAN waktu, atau bukan toggle sama sekali. Baris
    -- dengan `diubah_oleh` tanpa `diubah_pada` adalah keputusan tanpa tanggal —
    -- tidak bisa diurutkan terhadap tanggal setujui, jadi tidak bisa menjawab
    -- "apa yang klien lihat waktu itu".
    CONSTRAINT ck_strfv_diubah_utuh CHECK ((diubah_oleh IS NULL) = (diubah_pada IS NULL))
);

-- Jalur baca yang sebenarnya: seluruh overlay satu Strategi sekaligus (halaman
-- editor, dan kelak renderer `/s/{token}`). PK sudah berawalan `strategi_id`,
-- jadi tidak ada indeks tambahan yang perlu dibuat.

DROP TRIGGER IF EXISTS trg_strategi_field_visibility_updated_at
    ON strategi_field_visibility;
CREATE TRIGGER trg_strategi_field_visibility_updated_at
    BEFORE UPDATE ON strategi_field_visibility
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_field_visibility IS
  'M6A §7 STRG_FIELD_VISIBILITY — overlay visibilitas per field ID (Rule 16). '
  'Disemai penuh dari default §4.1 saat createStrategi dan ikut terbawa '
  'copyChildren saat revisi. `ck_strfv_hard_internal` adalah separuh DB dari '
  'invariant beku §7; separuh TS-nya adalah hardInternalFieldIds() di '
  'packages/core, dan keduanya dilarang menyimpang.';
COMMENT ON COLUMN strategi_field_visibility.field_id IS
  'ID field §4 (A-10, B-3.3, G-0) — bukan nama kolom. Satu field ID bisa '
  'memetakan ke nol kolom (field turunan), satu kolom, atau n baris tabel anak.';
COMMENT ON COLUMN strategi_field_visibility.diubah_oleh IS
  'NULL selama baris masih semaian §4.1 yang belum disentuh. Terisi hanya oleh '
  'toggle AM (Rule 16(b)), berpasangan dengan diubah_pada (ck_strfv_diubah_utuh).';

-- ===========================================================================
-- RLS — pola `jwt_can_read_strategi` yang sama dengan tabel anak Strategi lain
-- ===========================================================================
-- Baca-saja untuk `authenticated`; seluruh tulis lewat service-role di domain,
-- tempat Rule 16(a) dan permission AM-pemilik ditegakkan. Tidak ada grant untuk
-- `anon`: tautan klien A-11 belum ada, dan saat ia ada ia dirender server-side
-- dengan filter visibilitas diterapkan SEBELUM serialisasi (§7) — bukan dengan
-- membuka tabel ini ke publik.
REVOKE ALL ON public.strategi_field_visibility FROM anon;
REVOKE ALL ON public.strategi_field_visibility FROM authenticated;
GRANT SELECT ON public.strategi_field_visibility TO authenticated;
ALTER TABLE public.strategi_field_visibility ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_field_visibility_select ON public.strategi_field_visibility;
CREATE POLICY strategi_field_visibility_select ON public.strategi_field_visibility
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));
