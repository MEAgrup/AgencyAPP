-- CDPS — M6A langkah 8: handoff Interview ("Kelola Klien") → Strategi.
--
-- ---------------------------------------------------------------------------
-- APA YANG DITUTUP
-- ---------------------------------------------------------------------------
-- Modul Interview (langkah 1–7) sudah lengkap: skoring, verdict, prasyarat.
-- Yang belum ada adalah JEMBATANNYA ke Strategi. `packages/core/src/interview.ts`
-- sudah memegang logikanya sebagai fungsi murni yang teruji tapi MATI:
--
--   * PREFILL_MAPPING        — kolom Interview → field Section A Strategi.
--   * handoffKeStrategi(v)   — verdict → flag Blok D + copyPrasyaratKeC7 + wajib
--                              catatan mitigasi. TIDAK ada verdict yang memblokir
--                              pembuatan Strategi (keputusan v5, advisory).
--   * STRATEGI_FLAG          — tiga flag lemah Blok D.
--
-- Sampai migrasi ini `strategi` tidak punya satu pun kolom untuk MEREKAM dari
-- Interview mana ia lahir, versi berapa, atau flag apa yang dibawanya. Route
-- `POST /services/{id}/strategi` menerima body tapi membuang `interview_id`
-- diam-diam. Empat kolom di bawah adalah tempat handoff itu mendarat.
--
-- ---------------------------------------------------------------------------
-- KENAPA DI BARIS `strategi`, BUKAN TABEL KEDUA
-- ---------------------------------------------------------------------------
-- Linkage ini adalah PROPERTI dari satu Strategi (dari Interview mana ia lahir),
-- kardinalitas 1:1, dibaca setiap kali header form dimuat untuk badge advisory.
-- Tabel kedua berarti join wajib untuk setiap read Strategi demi satu FK + satu
-- daftar flag. Preseden: kolom denormalisasi header (`diajukan_pada`, dst) hidup
-- di baris `strategi` juga.
--
-- Immutable? TIDAK di DB — sebuah revisi (openRevision) MENYALIN nilai ini apa
-- adanya, jadi seluruh rantai versi menunjuk Interview yang sama; itu ditegakkan
-- di domain (salin di INSERT versi), bukan trigger. Nol jalur UPDATE menyentuh
-- keempat kolom setelah create.

-- ---------------------------------------------------------------------------
-- 1. Empat kolom di `strategi`
-- ---------------------------------------------------------------------------
ALTER TABLE strategi
    ADD COLUMN sumber            varchar(16) NOT NULL DEFAULT 'manual',
    ADD COLUMN interview_id      varchar(32) NULL,
    ADD COLUMN interview_version integer     NULL,
    ADD COLUMN blok_d_flags      jsonb       NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN strategi.sumber IS
    'Asal-usul Strategi: manual (AM buka dari Service) atau interview (handoff dari Kelola Klien). Dasar badge advisory.';
COMMENT ON COLUMN strategi.interview_id IS
    'M6A langkah 8: Interview asal handoff. NULL untuk Strategi manual. FK ke interview(id).';
COMMENT ON COLUMN strategi.interview_version IS
    'versi_no Interview pada saat handoff (snapshot; Interview bisa di-re-interview belakangan).';
COMMENT ON COLUMN strategi.blok_d_flags IS
    'Flag lemah Blok D yang dibawa dari verdict Interview (handoffKeStrategi): sasaran_konservatif / hambatan_mendasar_tercatat / risiko_tinggi. ADVISORY — tak pernah memblokir. Kosong untuk sumber=manual.';

ALTER TABLE strategi
    ADD CONSTRAINT fk_strategi_interview
        FOREIGN KEY (interview_id) REFERENCES interview (id);

-- sumber dan linkage harus konsisten: 'interview' WAJIB punya id+versi, 'manual'
-- WAJIB tidak punya keduanya. Tanpa ini sebuah Strategi bisa mengklaim lahir dari
-- Interview tanpa menunjuk satu pun, atau sebaliknya.
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_sumber CHECK (sumber IN ('manual', 'interview')),
    ADD CONSTRAINT ck_strategi_sumber_linkage CHECK (
        (sumber = 'interview' AND interview_id IS NOT NULL AND interview_version IS NOT NULL)
     OR (sumber = 'manual'    AND interview_id IS NULL     AND interview_version IS NULL)
    ),
    -- Flag Blok D hanya boleh ada kalau Strategi memang lahir dari Interview.
    ADD CONSTRAINT ck_strategi_blok_d_manual CHECK (
        sumber = 'interview' OR jsonb_array_length(COALESCE(blok_d_flags, '[]'::jsonb)) = 0
    ),
    ADD CONSTRAINT ck_strategi_blok_d_array CHECK (
        jsonb_typeof(blok_d_flags) = 'array'
    ),
    -- Kosakata flag terkunci ke tiga kode STRATEGI_FLAG (core). Nilai lain =
    -- flag yang tak ada penanganannya hilir → tolak di DB, bukan diam-diam.
    ADD CONSTRAINT ck_strategi_blok_d_vocab CHECK (
        blok_d_flags <@ '["sasaran_konservatif","hambatan_mendasar_tercatat","risiko_tinggi"]'::jsonb
    );

-- Badge advisory di daftar Strategi mem-filter "yang lahir dari Interview";
-- indeks parsial menjaga read itu murah tanpa membebani baris manual.
CREATE INDEX idx_strategi_interview ON strategi (interview_id)
    WHERE interview_id IS NOT NULL;
