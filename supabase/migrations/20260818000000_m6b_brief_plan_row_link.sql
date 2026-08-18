-- CDPS — Riset Awal Baseline / M6B RAB-16: tautan Brief ← plan_row.
--
-- Menutup "satu klik, warisi semua" (keputusan pemilik 3, HANDOFF_M6ABC_SESI31
-- §1): saat sebuah periode Plan aktif, setiap baris kerja (`plan_row`) menurunkan
-- SATU Brief ke divisi PIC-nya, dan AM hanya mengisi jatuh tempo + prioritas.
--
-- ===========================================================================
-- Kenapa kolom `briefs.plan_row_id`, dan kenapa ia berbeda dari `strategy_id`
-- ===========================================================================
-- COMMENT `plan_row` (20260810000000_m6b_plan.sql:373) SUDAH menamai kolom ini
-- sebagai bentuk yang dituju: *"Tabel yang Brief dibuat darinya (briefs.
-- plan_row_id, jejak empat tingkat §8)"*. Migrasi ini hanya memenuhinya.
--
-- `briefs.strategy_id` menunjuk `strategy_plans` (STR-, entitas M6A lama). Jalur
-- pewarisan M6B hidup di dunia `strategi` (STRG-) + `plan`, yang TIDAK menulis
-- baris `strategy_plans` — jadi Brief warisan Plan tidak bisa (dan tidak boleh)
-- mengisi `strategy_id`. Tautannya ke rencana adalah kolom BARU ini. Dua kolom,
-- dua dunia: STR- lewat `strategy_id`, M6B lewat `plan_row_id`. Sebuah Brief
-- lahir manual (jalur STR-, RAB-17 tetap dilayani) punya `plan_row_id` NULL —
-- karena itu kolomnya nullable, dan keempat Brief yang sudah ada tak tersentuh.
--
-- UNIQUE parsial memikul idempotensi "satu klik": sebuah `plan_row` menurunkan
-- PALING BANYAK satu Brief. Klik kedua (atau baris yang sudah diwarisi periode
-- sebelumnya) ditolak DB, bukan hanya dijaga di TS — persis pola gate rumah
-- (row lock + CHECK backstop). Baris manual (`plan_row_id` NULL) dikecualikan.
--
-- ON DELETE SET NULL: kalau baris rencananya dibersihkan (hanya di test — di prod
-- baris transisi status, tak dihapus), Brief-nya kehilangan tautan asalnya, bukan
-- ikut terhapus (sebuah Brief yang sudah masuk antrean eksekusi divisi tidak
-- boleh lenyap karena baris rencananya dihapus). Sejajar `fk_plan_row_asal`.
--
-- Gerbang tabel TIDAK berubah (kolom, bukan tabel baru): tabel public tetap 118.
-- Nol mesin/prefix/event baru. Dicatat docs/DECISIONS.md 2026-08-18 (RAB-16).

ALTER TABLE briefs
    ADD COLUMN plan_row_id bigint NULL;

ALTER TABLE briefs
    ADD CONSTRAINT fk_briefs_plan_row FOREIGN KEY (plan_row_id)
        REFERENCES plan_row (id) ON DELETE SET NULL;

-- Satu baris rencana ⇒ paling banyak satu Brief (idempotensi warisi-semua).
-- Baris manual (NULL) tak masuk hitungan.
CREATE UNIQUE INDEX uq_briefs_plan_row ON briefs (plan_row_id)
    WHERE plan_row_id IS NOT NULL;

COMMENT ON COLUMN briefs.plan_row_id IS
  'RAB-16 — baris rencana (plan_row) asal Brief ini, saat diwarisi satu-klik dari '
  'periode Plan aktif (M6B). NULL untuk Brief manual (jalur STR-). Dunia M6B '
  'memakai kolom ini; dunia STR- memakai strategy_id. UNIQUE parsial menjamin '
  'satu baris menurunkan paling banyak satu Brief.';
