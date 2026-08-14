-- CDPS — Module 14 (Team Performance) — D-14: amandemen bobot RM-9/RM-9a.
--
-- Menambahkan dua komponen KPI yang bersumber M6D (Rekap Hasil Mingguan) ke
-- profil peran M14, dan me-re-weight profil yang terpengaruh SESUAI tanda tangan
-- pemilik 2026-08-13 (RM-9a). PRD: docs/prd/CDPS_Module14_Team_Performance.md §9;
-- backlog: docs/backlog/M6D_BACKLOG.md D-14; keputusan: docs/DECISIONS.md 2026-08-13.
--
-- ---------------------------------------------------------------------------
-- APA yang diubah + KENAPA (RM-9a — carve PROPORSIONAL, tiap profil tetap Σ=100)
-- ---------------------------------------------------------------------------
--  * AM — komponen baru `weekly_recap_discipline` (M6D RM-9): % klien aktif AM
--    yang rekap minggu-berjalan-nya ditutup AM tepat waktu DAN tak pernah
--    force-close (`pernah_ditutup_otomatis = false`). Carve 10% proporsional dari
--    50/25/25 → 45/22.5/22.5 + 10 (M13 §8: CHR tetap komponen terbesar AM).
--  * Divisi (Creative/Ads/KOL) — komponen baru `weekly_note_compliance`
--    (M6D RM-8): % klien yang divisi sentuh minggu itu yang catatan wajibnya
--    diisi. Carve 5% proporsional (×0.95) dari tiap profil + 5.
--    Live Stream = vendor, BUKAN peran ber-skor M14 — tak ada baris di sini.
--
--  Carve proporsional dipilih pemilik justru supaya redistribusi Rule 6
--  (komponen absen → bobotnya dibagi ke sisa) MENGEMBALIKAN proporsi lama saat
--  sinyal M6D tak ada (mis. bulan sebelum M6D live): profil lama tetap identik
--  bit-for-bit. Itu sebabnya §4 worked example (Kenny 86.4) tetap lulus.
--
--  Bobot = living config (perf_kpi_weights, admin-editable, §5.2/OA-5). Migrasi ini
--  me-re-baseline default developer; edit admin per-baris tetap menang. UPDATE
--  baris lama + INSERT baris baru; hanya trigger set_updated_at yang menyentuhnya
--  (tak ada audit DB — jejak audit ada di jalur domain setWeights, bukan seed).
--
-- Migrasi lewat supabase/migrations/** + apply_migration — JANGAN `psql -f` (O38).

-- ===========================================================================
-- 1. AM — carve 10% proporsional (÷ ×0.90) + weekly_recap_discipline 10.
-- ===========================================================================
UPDATE perf_kpi_weights SET weight = 45,   updated_by = 'SYSTEM'
  WHERE role_type = 'AM' AND component = 'chr_average';
UPDATE perf_kpi_weights SET weight = 22.5, updated_by = 'SYSTEM'
  WHERE role_type = 'AM' AND component = 'complaint_resolution_speed';
UPDATE perf_kpi_weights SET weight = 22.5, updated_by = 'SYSTEM'
  WHERE role_type = 'AM' AND component = 'revision_escalation_rate';
INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
  ('AM', 'weekly_recap_discipline', 10, 'SYSTEM');

-- ===========================================================================
-- 2. Divisi — carve 5% proporsional (×0.95) + weekly_note_compliance 5.
--    Creative 30/25/25/20 → 28.5/23.75/23.75/19 + 5
--    Ads      25/30/25/20 → 23.75/28.5/23.75/19 + 5
--    KOL      30/25/20/25 → 28.5/23.75/19/23.75 + 5
-- ===========================================================================
UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM'
  WHERE role_type = 'Creative' AND component = 'speed_score';
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'Creative' AND component = 'output_quantity';
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'Creative' AND component = 'gmv_impact';
UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM'
  WHERE role_type = 'Creative' AND component = 'revision_count';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'Ads' AND component = 'speed_score';
UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM'
  WHERE role_type = 'Ads' AND component = 'roas_attainment';
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'Ads' AND component = 'gmv_impact';
UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM'
  WHERE role_type = 'Ads' AND component = 'optimization_activity';

UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM'
  WHERE role_type = 'KOL' AND component = 'creator_count';
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'KOL' AND component = 'qc_pass_rate';
UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM'
  WHERE role_type = 'KOL' AND component = 'speed_score';
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM'
  WHERE role_type = 'KOL' AND component = 'escalation_rate';

INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
  ('Creative', 'weekly_note_compliance', 5, 'SYSTEM'),
  ('Ads',      'weekly_note_compliance', 5, 'SYSTEM'),
  ('KOL',      'weekly_note_compliance', 5, 'SYSTEM');

-- ===========================================================================
-- 3. Sanity — tiap profil WAJIB tetap Σ=100 (invariant setWeights domain).
-- ===========================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT role_type, sum(weight) AS s FROM perf_kpi_weights GROUP BY role_type
  LOOP
    IF abs(r.s - 100) > 1e-6 THEN
      RAISE EXCEPTION 'D-14: profil % Σ bobot = % (harus 100)', r.role_type, r.s;
    END IF;
  END LOOP;
END $$;

-- weekly_recap_discipline (AM) & weekly_note_compliance (divisi) = persentase
-- 0..100 yang me-normalisasi diri (Rule 2) → TAK ada baris perf_period_targets
-- (seperti chr_average/qc_pass_rate). M6D memasok sinyal mentah (status tutup +
-- pernah_ditutup_otomatis + ada/tidak catatan divisi); M14 yang menghitung grade.
