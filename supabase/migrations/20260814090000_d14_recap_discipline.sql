-- D-14 (M6D RM-9 / RM-9a, M14 §9) — komponen skor "Disiplin Rekap Mingguan" (AM)
-- + "Kepatuhan Catatan Mingguan" (divisi Creative/Ads/KOL).
--
-- Bobot DITANDATANGANI PEMILIK 2026-08-13 (DECISIONS.md, RM-9a): profil AM
-- terkonfirmasi di-re-weight PROPORSIONAL 50/25/25 → 45/22.5/22.5/10 (10% baru =
-- Disiplin Rekap Mingguan), dan tiap profil divisi di-carve 5% PROPORSIONAL untuk
-- Kepatuhan Catatan Mingguan. Tiap profil tetap Σ=100. Live-stream = vendor (bukan
-- peran ber-skor M14) — sinyal catatannya dicatat M6D, nol bobot M14.
--
-- ---------------------------------------------------------------------------
-- MENGAPA CARVE PROPORSIONAL AMAN ATAS SKOR LAMA
-- ---------------------------------------------------------------------------
-- Komponen baru dinormalisasi sebagai persentase 0..100 langsung (bukan
-- Actual÷Target) — TAK ADA baris perf_period_targets untuk keduanya. Bila komponen
-- baru DIKECUALIKAN (AM/divisi tanpa rekap pada periode → Rule 6 redistribusi),
-- bobot tersisa dinormalisasi ulang ke Σ=100 dan — karena carve-nya proporsional —
-- MENGEMBALIKAN persis proporsi lama (mis. Ads 23.75/28.5/23.75/19 ÷ 0.95 =
-- 25/30/25/20). Jadi skor periode tanpa data rekap identik dengan sebelum D-14.
--
-- M6D memasok SINYAL MENTAH; M14 menghitung skor (single-source, DECISIONS 2026-08-13):
--   * Disiplin Rekap (AM) = % rekap klien-aktif AM pada periode yang berstatus
--     'Ditutup' DAN pernah_ditutup_otomatis=false (ditutup AM, tak pernah
--     force-close). MENGHITUNG FLAG PERMANEN, bukan status akhir: rekap yang
--     di-force-close lalu dibuka-kembali Head tetap pernah_ditutup_otomatis=true →
--     tetap dihitung merugikan AM (M14 §9; belas kasih Head menyelamatkan DATA,
--     bukan CATATAN). Denominator = rekap yang ADA; rekap HANYA dibuka untuk klien
--     aktif (wrr_monday_job, kini meng-exclude '[On Hold]' — RM-2) ⇒ filter aktif
--     terwarisi otomatis, klien all-hold tak mengotori denominator.
--   * Kepatuhan Catatan (divisi) = % rekap yang divisinya SENTUH minggu itu (punya
--     baris wrr_divisi) yang JUGA punya catatan divisi (wrr_catatan_divisi) —
--     definisi "berutang catatan" identik dengan job (c) wrr_monday_job (RM-8).
--     Sinyal per-DIVISI (bukan per-staff — wrr_divisi/_catatan_divisi ber-key
--     divisi, bukan individu), jadi tiap staf divisi berbagi skor kepatuhan divisi.
--
-- Periode M14 = satu bulan kalender WIB (per.startDate..per.endDate). Rekap =
-- mingguan ISO; sebuah rekap "milik" bulan yang memuat SENIN-nya (minggu_mulai
-- BETWEEN start AND end) ⇒ tiap minggu ISO dihitung tepat di satu bulan, tanpa
-- ganda/celah. (Interpretasi agregasi periode dicatat di DECISIONS.md 2026-08-14.)
--
-- ---------------------------------------------------------------------------
-- RLS / KONTEKS BACA
-- ---------------------------------------------------------------------------
-- Batch runSnapshotJob jalan lewat db() (bypass RLS). previewCurrent (portal M15)
-- jalan di bawah RLS aktor: divisi Creative/Ads/KOL TAK punya lingkup baca rekap
-- (kebijakan wrr_* = read_all / owns_client_am / Account-lead), jadi query langsung
-- akan UNDER-COUNT di preview. Maka agregatnya diekspos sebagai fungsi private.*
-- SECURITY DEFINER (pola O51 private.employee_role): batch & preview menghitung
-- identik, tanpa 42501, tanpa kebocoran baris (hanya mengembalikan hitungan
-- agregat ter-scope staf/divisi+periode, bukan isi rekap). Skema `private` tak
-- diekspos PostgREST ⇒ tak bisa dipanggil klien langsung.
--
-- Nol tabel/prefix/mesin/notif baru → gate 113/34/22/52 TETAP (hanya baris config
-- perf_kpi_weights + dua fungsi private). Migrasi lewat supabase/migrations/** +
-- apply_migration — JANGAN `psql -f` (O38). DB lokal rebuild HANYA scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. Re-seed perf_kpi_weights ke bobot RM-9a (ditandatangani pemilik 2026-08-13).
--    DELETE+INSERT keempat role_type = set kanonik; komponen baru dua-baris.
--    updated_by 'SYSTEM' (developer default, seperti seed asal; edit admin
--    lewat setWeights menggantikan per-role, tetap Σ=100 di kode).
-- ===========================================================================
DELETE FROM perf_kpi_weights WHERE role_type IN ('Creative', 'Ads', 'KOL', 'AM');

INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    -- Creative: 30/25/25/20 ×0.95 + note_compliance 5.
    ('Creative', 'speed_score',              28.5,  'SYSTEM'),
    ('Creative', 'output_quantity',          23.75, 'SYSTEM'),
    ('Creative', 'gmv_impact',               23.75, 'SYSTEM'),
    ('Creative', 'revision_count',           19,    'SYSTEM'),
    ('Creative', 'note_compliance',          5,     'SYSTEM'),
    -- Ads: 25/30/25/20 ×0.95 + note_compliance 5.
    ('Ads',      'speed_score',              23.75, 'SYSTEM'),
    ('Ads',      'roas_attainment',          28.5,  'SYSTEM'),
    ('Ads',      'gmv_impact',               23.75, 'SYSTEM'),
    ('Ads',      'optimization_activity',    19,    'SYSTEM'),
    ('Ads',      'note_compliance',          5,     'SYSTEM'),
    -- KOL: 30/25/20/25 ×0.95 + note_compliance 5.
    ('KOL',      'creator_count',            28.5,  'SYSTEM'),
    ('KOL',      'qc_pass_rate',             23.75, 'SYSTEM'),
    ('KOL',      'speed_score',              19,    'SYSTEM'),
    ('KOL',      'escalation_rate',          23.75, 'SYSTEM'),
    ('KOL',      'note_compliance',          5,     'SYSTEM'),
    -- AM: 50/25/25 re-weight proporsional → 45/22.5/22.5 + recap_discipline 10.
    ('AM',       'chr_average',              45,    'SYSTEM'),
    ('AM',       'complaint_resolution_speed', 22.5, 'SYSTEM'),
    ('AM',       'revision_escalation_rate', 22.5,  'SYSTEM'),
    ('AM',       'recap_discipline',         10,    'SYSTEM');

-- ===========================================================================
-- 2. Agregat sinyal rekap — SECURITY DEFINER (baca lintas-RLS, hanya hitungan).
--    Keduanya STABLE, ter-scope ketat, mengembalikan hitungan agregat saja.
-- ===========================================================================

-- Disiplin Rekap AM: (total rekap klien-aktif AM, yang ditutup AM tepat waktu).
-- ontime = status 'Ditutup' DAN pernah_ditutup_otomatis=false (flag permanen).
CREATE OR REPLACE FUNCTION private.am_recap_discipline(p_staff text, p_start date, p_end date)
RETURNS TABLE(total bigint, ontime bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT count(*)::bigint,
         count(*) FILTER (
           WHERE w.status = 'Ditutup' AND w.pernah_ditutup_otomatis = false)::bigint
    FROM public.weekly_result_recap w
    JOIN public.clients c ON c.id = w.client_id
   WHERE c.assigned_am_id = p_staff
     AND w.minggu_mulai >= p_start AND w.minggu_mulai <= p_end
$$;
REVOKE EXECUTE ON FUNCTION private.am_recap_discipline(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.am_recap_discipline(text, date, date) TO authenticated;
COMMENT ON FUNCTION private.am_recap_discipline(text, date, date) IS
  'M14 §9 / M6D RM-9 (D-14) — (total rekap klien-aktif AM pada periode, yang '
  'ditutup AM & tak pernah force-close). Denominator mewarisi filter klien aktif '
  'karena rekap hanya dibuka untuk klien aktif (wrr_monday_job). SECURITY DEFINER: '
  'batch & preview menghitung identik lintas-RLS; hanya hitungan agregat.';

-- Kepatuhan Catatan divisi: (total rekap yang divisi sentuh, yang punya catatan).
-- "Sentuh" = ada baris wrr_divisi (identik definisi "berutang" job (c) RM-8).
CREATE OR REPLACE FUNCTION private.division_note_compliance(p_divisi text, p_start date, p_end date)
RETURNS TABLE(total bigint, filed bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.wrr_catatan_divisi cd
            WHERE cd.recap_id = d.recap_id AND cd.divisi = d.divisi))::bigint
    FROM public.wrr_divisi d
    JOIN public.weekly_result_recap w ON w.id = d.recap_id
   WHERE d.divisi = p_divisi
     AND w.minggu_mulai >= p_start AND w.minggu_mulai <= p_end
$$;
REVOKE EXECUTE ON FUNCTION private.division_note_compliance(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.division_note_compliance(text, date, date) TO authenticated;
COMMENT ON FUNCTION private.division_note_compliance(text, date, date) IS
  'M14 §9 / M6D RM-8/RM-9 (D-14) — (total rekap divisi sentuh pada periode, yang '
  'punya catatan divisi). Sinyal per-DIVISI (wrr_divisi/_catatan_divisi ber-key '
  'divisi). SECURITY DEFINER: batch & preview identik lintas-RLS; hanya hitungan.';
