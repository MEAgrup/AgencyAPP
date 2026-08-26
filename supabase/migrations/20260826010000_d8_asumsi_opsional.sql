-- CDPS — M6A Section D, D-8/Rule 8/Rule 13(c): asumsi target tidak lagi wajib.
--
-- ## Kenapa (owner QA 2026-08-26, DECISIONS.md, STRG-202608-0001 lanjutan)
-- D-8 ("Asumsi di balik target") dulu menggerbang submit lewat dua syarat:
-- minimal 3 baris, dan Rule 8 ("tiap target GMV bulanan wajib terkait minimal
-- satu asumsi"). Pemilik meminta keduanya dilonggarkan: di hari-hari pertama
-- mengerjakan toko baru, AM belum cukup tahu untuk menulis asumsi yang bisa
-- diverifikasi secara jujur — memaksa ambang di titik itu hanya melahirkan
-- baris isian tempelan (pola yang sama dengan C-5 "min 3" lama, migrasi
-- 20260824-an sebelumnya). PRD (`docs/prd/CDPS_Module6A_Strategi.md` Rule 8,
-- Rule 13, §4 D-8) diamandemen; gerbang TS-nya (`checkCompleteness` di
-- `packages/domain/src/strategi.ts`) sudah tidak lagi mendorong kode `D-8`
-- atau `Rule 8`. Rule 13(c) — revisi wajib menyebut asumsi D-8 mana yang
-- gugur — tetap berlaku, TAPI dibebaskan kalau Strategi yang direvisi tidak
-- pernah punya satu pun baris `strategi_assumption`: tidak ada yang bisa
-- dikutip, dan menuntutnya akan membuat REVISI PERTAMA pada Strategi semacam
-- itu mustahil dibuka selamanya.
--
-- ## Yang diubah
-- Constraint lama `ck_strver_revisi_lengkap` mewajibkan
-- `jsonb_array_length(asumsi_gugur) > 0` tanpa syarat setiap kali
-- `peristiwa = 'revisi_dibuka'` — dan CHECK constraint di Postgres tidak bisa
-- membaca tabel lain (tidak boleh subquery), jadi "kosong hanya boleh kalau
-- strategi_assumption juga kosong" tidak bisa tetap jadi CHECK murni. Bagian
-- trigger (a) dan alasan (b) TETAP CHECK (tidak butuh tabel lain); bagian
-- asumsi (c) dipindah ke trigger BEFORE INSERT yang boleh menghitung baris
-- `strategi_assumption` milik `strategi_id` yang sama — pola yang sama dengan
-- `guard_siklus_terkunci()` di migrasi M6A awal.

ALTER TABLE strategi_version DROP CONSTRAINT IF EXISTS ck_strver_revisi_lengkap;

ALTER TABLE strategi_version ADD CONSTRAINT ck_strver_revisi_lengkap CHECK (
    peristiwa <> 'revisi_dibuka'
 OR (jsonb_array_length(trigger_revisi) > 0
     AND alasan_revisi IS NOT NULL AND btrim(alasan_revisi) <> ''));

CREATE OR REPLACE FUNCTION guard_strver_asumsi_gugur()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_ada_asumsi boolean;
BEGIN
    IF NEW.peristiwa <> 'revisi_dibuka' THEN
        RETURN NEW;
    END IF;
    -- Rule 13(c) dibebaskan hanya kalau Strategi ini tidak pernah punya satu
    -- pun baris D-8 — bukan kalau AM sekadar tidak memilih satu pun kali ini
    -- (itu tetap ditolak, TS `openRevision` sudah menegakkannya duluan).
    SELECT EXISTS (
        SELECT 1 FROM strategi_assumption WHERE strategi_id = NEW.strategi_id
    ) INTO v_ada_asumsi;

    IF v_ada_asumsi AND jsonb_array_length(NEW.asumsi_gugur) = 0 THEN
        RAISE EXCEPTION
          '[revisi wajib menyebutkan trigger, alasan, dan asumsi yang gugur]';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_strver_asumsi_gugur BEFORE INSERT ON strategi_version
    FOR EACH ROW EXECUTE FUNCTION guard_strver_asumsi_gugur();

COMMENT ON CONSTRAINT ck_strver_revisi_lengkap ON strategi_version IS
  'Rule 13(a)(b): membuka revisi wajib membawa trigger (dari H-2) + alasan. '
  'Syarat (c) — asumsi D-8 mana yang gugur — dipindah ke trigger '
  'trg_strver_asumsi_gugur karena butuh menghitung strategi_assumption, yang '
  'CHECK biasa tidak bisa lakukan (owner QA 2026-08-26, DECISIONS.md).';

COMMENT ON FUNCTION guard_strver_asumsi_gugur() IS
  'Rule 13(c): revisi_dibuka wajib menyebut asumsi D-8 yang gugur, KECUALI '
  'Strategi ini tidak pernah punya satu pun baris strategi_assumption — D-8 '
  'tidak lagi menggerbang submit sejak 2026-08-26 (DECISIONS.md), jadi tidak '
  'ada yang bisa dikutip.';
