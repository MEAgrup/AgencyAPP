-- CDPS — Module 14 D-14: Amandemen Disiplin Rekap Mingguan (RM-9a, 2026-08-13).
--
-- Menambah dua komponen KPI baru ke profil peran M14, sesuai keputusan pemilik
-- 2026-08-13 (RM-9a, docs/DECISIONS.md):
--
--   • COMP_WEEKLY_RECAP_DISCIPLINE ('weekly_recap_discipline') → profil AM.
--     = % klien aktif AM yang rekap mingguannya ditutup AM tepat waktu dan
--       TIDAK pernah force-closed (pernah_ditutup_otomatis = false).
--     Bobot: 10 (carve proporsional dari 50/25/25 → 45/22.5/22.5/10).
--
--   • COMP_WEEKLY_NOTE_COMPLIANCE ('weekly_note_compliance') → profil divisi
--     Creative/Ads/KOL.
--     = % klien yang disentuh divisi pada periode yang mempunyai catatan divisi
--       mingguan (wrr_catatan_divisi, RM-D6/RM-8).
--     Bobot: 5 per divisi (carve proporsional → Creative 28.5/23.75/23.75/19/5,
--     Ads 23.75/28.5/23.75/19/5, KOL 28.5/23.75/19/23.75/5).
--
-- Live-stream adalah vendor, bukan peran M14 yang dinilai (M14 §9) → tidak ada
-- baris untuk Live Stream. D-14 hanya menyuplai sinyal mentah dari M6D; M14 yang
-- menghitung grade (pola yang sama dengan M6B PE-3 ↔ plan.ts).
--
-- Komponen baru ini sudah-0..100-persen (bukan Actual ÷ Target) → tidak perlu
-- baris baru di perf_period_targets (Rule 2, RM-9a: "capped at 100, no
-- target-ratio needed").
--
-- Semua update profil dilakukan dalam satu transaksi idempoten (re-run aman via
-- ON CONFLICT). Baris lama di-update; baris baru di-insert.

-- ---------------------------------------------------------------------------
-- 1. Update bobot lama ke nilai RM-9a (proporsional carve)
-- ---------------------------------------------------------------------------

-- AM: 50/25/25 → 45/22.5/22.5
UPDATE perf_kpi_weights SET weight = 45,   updated_by = 'SYSTEM-D14'
WHERE role_type = 'AM'  AND component = 'chr_average';

UPDATE perf_kpi_weights SET weight = 22.5, updated_by = 'SYSTEM-D14'
WHERE role_type = 'AM'  AND component = 'complaint_resolution_speed';

UPDATE perf_kpi_weights SET weight = 22.5, updated_by = 'SYSTEM-D14'
WHERE role_type = 'AM'  AND component = 'revision_escalation_rate';

-- Creative: 30/25/25/20 → 28.5/23.75/23.75/19
UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM-D14'
WHERE role_type = 'Creative' AND component = 'speed_score';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'Creative' AND component = 'output_quantity';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'Creative' AND component = 'gmv_impact';

UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM-D14'
WHERE role_type = 'Creative' AND component = 'revision_count';

-- Ads: 25/30/25/20 → 23.75/28.5/23.75/19
UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'Ads' AND component = 'speed_score';

UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM-D14'
WHERE role_type = 'Ads' AND component = 'roas_attainment';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'Ads' AND component = 'gmv_impact';

UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM-D14'
WHERE role_type = 'Ads' AND component = 'optimization_activity';

-- KOL: 30/25/20/25 → 28.5/23.75/19/23.75
UPDATE perf_kpi_weights SET weight = 28.5,  updated_by = 'SYSTEM-D14'
WHERE role_type = 'KOL' AND component = 'creator_count';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'KOL' AND component = 'qc_pass_rate';

UPDATE perf_kpi_weights SET weight = 19,    updated_by = 'SYSTEM-D14'
WHERE role_type = 'KOL' AND component = 'speed_score';

UPDATE perf_kpi_weights SET weight = 23.75, updated_by = 'SYSTEM-D14'
WHERE role_type = 'KOL' AND component = 'escalation_rate';

-- ---------------------------------------------------------------------------
-- 2. Insert komponen baru (ON CONFLICT idempoten — safe re-run)
-- ---------------------------------------------------------------------------

INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    ('AM',       'weekly_recap_discipline', 10, 'SYSTEM-D14'),
    ('Creative', 'weekly_note_compliance',   5, 'SYSTEM-D14'),
    ('Ads',      'weekly_note_compliance',   5, 'SYSTEM-D14'),
    ('KOL',      'weekly_note_compliance',   5, 'SYSTEM-D14')
ON CONFLICT (role_type, component) DO UPDATE
    SET weight = excluded.weight, updated_by = excluded.updated_by;

-- Sanity check: setiap profil harus tepat = 100. Kueri validasi (gagal bila
-- ada profil yang out-of-spec setelah migrasi).
DO $$
DECLARE
    bad text;
BEGIN
    SELECT string_agg(role_type || ' = ' || total::text, ', ')
    INTO   bad
    FROM   (
        SELECT role_type, sum(weight) AS total
        FROM   perf_kpi_weights
        GROUP  BY role_type
        HAVING abs(sum(weight) - 100) > 0.001
    ) t;

    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'D-14 gagal: profil KPI tidak berjumlah 100 → %', bad;
    END IF;
END $$;
