-- Modul Interview langkah 8 — Blok D handoff ke Strategi.
--
-- Ketika sebuah Strategi dibuka dari Interview yang sudah dikualifikasi, tiga
-- fakta provenance dan satu daftar flag lemah menempel pada baris Strategi:
--
--   * `sumber`             — `manual` (default) atau `interview`.
--   * `interview_id`       — Interview yang menurunkan Strategi ini.
--   * `interview_version`  — versi Interview saat handoff (Rule 13: versi = baris,
--                            jadi angka ini beku pada apa yang dibaca saat create).
--   * `blok_d_flags`       — flag konservatif dari `handoffKeStrategi(verdict)`
--                            (`packages/core/src/interview.ts`). ADVISORY: tidak
--                            memblokir apa pun (keputusan v5, DECISIONS 2026-08-11:
--                            "Verdict ADVISORY, non-blocking"). `tidak_siap` tetap
--                            membuka Strategi — flag hanya MEREKAM, bukan gerbang.
--
-- Kolom prefill NILAI Section A (via `PREFILL_MAPPING`) TIDAK ditulis di sini:
-- pemetaan itu murni di core dan dipakai form untuk mengisi Draft (AM meninjau,
-- autosave 20s). Yang DB simpan adalah TAUTAN + FLAG-nya. `PREFILL_MAPPING` tidak
-- pernah menargetkan baseline numerik Section B (dijaga tes core + domain).

ALTER TABLE strategi
    ADD COLUMN IF NOT EXISTS sumber            varchar(16) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS interview_id      varchar(32) NULL,
    ADD COLUMN IF NOT EXISTS interview_version integer     NULL,
    ADD COLUMN IF NOT EXISTS blok_d_flags      jsonb       NOT NULL DEFAULT '[]'::jsonb;

-- Interview tidak pernah di-DELETE di produksi; RESTRICT (default) menolak
-- penghapusan Interview yang masih ditunjuk sebuah Strategi — jejak provenance
-- tidak boleh menggantung. (Teardown TEST menghapus Strategi lebih dulu.)
ALTER TABLE strategi
    DROP CONSTRAINT IF EXISTS fk_strategi_interview;
ALTER TABLE strategi
    ADD CONSTRAINT fk_strategi_interview
        FOREIGN KEY (interview_id) REFERENCES interview (id);

-- `sumber` tertutup pada dua nilai.
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_sumber;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_sumber CHECK (sumber IN ('manual', 'interview'));

-- Provenance konsisten: `sumber='interview'` PERSIS ketika `interview_id` ada,
-- dan versi ikut ada persis saat tautannya ada. Tanpa ini sebuah Strategi bisa
-- mengklaim berasal dari Interview tanpa menunjuk yang mana (atau sebaliknya).
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_interview_konsisten;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_interview_konsisten CHECK (
        (sumber = 'interview') = (interview_id IS NOT NULL)
    AND (interview_id IS NOT NULL) = (interview_version IS NOT NULL));

-- Flag lemah = subset tertutup tiga nilai (preseden `<@` atas jsonb, sama seperti
-- `ck_strategi_aset_taksonomi` / `ck_strategi_leading_indicator`). Bukan tabel
-- lookup: himpunannya kecil, beku, dan lahir di core (`STRATEGI_FLAG`).
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_blok_d_flags;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_blok_d_flags CHECK (
        jsonb_typeof(blok_d_flags) = 'array'
    AND blok_d_flags <@ '["sasaran_konservatif","hambatan_mendasar_tercatat","risiko_tinggi"]'::jsonb);

CREATE INDEX IF NOT EXISTS idx_strategi_interview ON strategi (interview_id)
    WHERE interview_id IS NOT NULL;

COMMENT ON COLUMN strategi.sumber IS
    'M6A/Interview langkah 8 — asal Strategi: manual atau interview (Blok D handoff).';
COMMENT ON COLUMN strategi.interview_id IS
    'Interview yang menurunkan Strategi ini (Blok D). NULL bila sumber=manual.';
COMMENT ON COLUMN strategi.interview_version IS
    'Versi Interview saat handoff — beku (Rule 13: versi = baris).';
COMMENT ON COLUMN strategi.blok_d_flags IS
    'Flag konservatif advisory dari handoffKeStrategi(verdict). Tidak memblokir apa pun.';
