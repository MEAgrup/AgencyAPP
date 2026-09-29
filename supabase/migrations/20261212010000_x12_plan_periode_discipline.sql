-- CDPS M16 — X-12 DIPUTUSKAN (pemilik, 2026-09-29: "jalankan rekomendasi").
-- Komponen skor AM baru `plan_periode_discipline`: keterlambatan menutup
-- periode Plan (Rule 15/B-09 force-close) sekarang punya konsekuensi KPI,
-- persis rekomendasi Claude 2026-09-05 (docs/DECISIONS.md baris X-12).
--
-- Nol tabel/mesin/prefix/event baru — satu fungsi SQL `private` + re-seed
-- `perf_kpi_weights`. Gate TETAP (nol notif_events baru).
--
-- ---------------------------------------------------------------------------
-- 1. KENAPA NOL FLAG PERMANEN BARU (beda dari D-14)
-- ---------------------------------------------------------------------------
-- D-14 (`weekly_result_recap`) butuh `pernah_ditutup_otomatis` karena status
-- itu QUASI-terminal: `sm_edges` punya edge balik `Ditutup Otomatis →
-- Terbuka` (Head buka-kembali, RM-5) — status saat ini bisa "lupa" bahwa
-- periode itu PERNAH force-close.
--
-- `plan` (mesin #16, `20260810000000_m6b_plan.sql`) TIDAK begitu:
--   ('plan', 'Aktif', 'Ditutup',          false),
--   ('plan', 'Aktif', 'Ditutup Otomatis', false)
-- adalah SATU-SATUNYA dua edge yang masuk ke salah satu status itu, dan nol
-- edge keluar dari keduanya ada di `sm_edges` (`plan` terdaftar TERMINAL utk
-- `Ditutup` MAUPUN `Ditutup Otomatis`, `sm_terminal_states`). Begitu sebuah
-- periode mencapai salah satunya, ia TIDAK PERNAH pindah lagi — `status`
-- kolom itu sendiri SUDAH permanen. Nol ALTER TABLE `plan` diperlukan.
--
-- ---------------------------------------------------------------------------
-- 2. Fungsi SQL — mirror PERSIS `private.am_recap_discipline` (D-14)
-- ---------------------------------------------------------------------------
-- Atribusi periode: `tanggal_akhir` periode Plan jatuh dalam rentang skoring
-- (mirror `w.minggu_mulai` milik rekap mingguan) — tanggal itulah yang
-- menentukan bulan mana B-09 akan menagihnya kalau AM tidak menutup duluan.
CREATE OR REPLACE FUNCTION private.am_periode_discipline(p_staff text, p_start date, p_end date)
RETURNS TABLE(total bigint, ontime bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE p.status = 'Ditutup')::bigint
    FROM public.plan p
    JOIN public.clients c ON c.id = p.client_id
   WHERE c.assigned_am_id = p_staff
     AND p.status IN ('Ditutup', 'Ditutup Otomatis')
     AND p.tanggal_akhir >= p_start AND p.tanggal_akhir <= p_end
$$;
REVOKE EXECUTE ON FUNCTION private.am_periode_discipline(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.am_periode_discipline(text, date, date) TO authenticated;
COMMENT ON FUNCTION private.am_periode_discipline(text, date, date) IS
  'X-12 (M16) — (total periode Plan AM yang tanggal_akhir jatuh pada rentang '
  'DAN sudah terminal [Ditutup/Ditutup Otomatis], yang ditutup AM sendiri '
  '[Ditutup]). Beda dari am_recap_discipline: plan.status sudah permanen '
  'begitu terminal (nol edge keluar Ditutup/Ditutup Otomatis di sm_edges), '
  'jadi nol flag tambahan diperlukan. SECURITY DEFINER: batch & preview '
  'menghitung identik lintas-RLS; hanya hitungan agregat.';

-- ---------------------------------------------------------------------------
-- 3. Re-seed profil AM — carve proporsional ×0,90 (pola D-14/LT-1, RM-9a)
-- ---------------------------------------------------------------------------
-- SEBELUM (20260901010000_lt1_am_review_weight.sql):
--   chr_average 40,5 / complaint_resolution_speed 20,25 /
--   revision_escalation_rate 20,25 / recap_discipline 9 /
--   kecepatan_review_am 10                                    (Σ100)
-- SESUDAH (×0,90 seluruh LIMA komponen lama + plan_periode_discipline 10):
--   chr_average 36,45 / complaint_resolution_speed 18,225 /
--   revision_escalation_rate 18,225 / recap_discipline 8,1 /
--   kecepatan_review_am 9 / plan_periode_discipline 10         (Σ100)
--
-- Carve dari SELURUH profil (bukan hanya dari kecepatan_review_am) — X-12
-- sendiri melarang mengambil dari situ ("itu milik LT-1 dan mengambilnya
-- mendahului keputusan yang belum dibuat"). Invariant Rule 6 yang sama:
-- AM tanpa periode Plan jatuh-tempo bulan itu ⇒ plan_periode_discipline
-- dikecualikan, sisa dinormalisasi ulang mengembalikan PERSIS proporsi
-- 40,5/20,25/20,25/9/10 sebelum migrasi ini — diuji performance.test.ts
-- ("X-12: proportional carve").
DELETE FROM perf_kpi_weights WHERE role_type = 'AM';

INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    ('AM', 'chr_average',                36.45,  'SYSTEM'),
    ('AM', 'complaint_resolution_speed',  18.225, 'SYSTEM'),
    ('AM', 'revision_escalation_rate',    18.225, 'SYSTEM'),
    ('AM', 'recap_discipline',             8.1,   'SYSTEM'),
    ('AM', 'kecepatan_review_am',          9,     'SYSTEM'),
    ('AM', 'plan_periode_discipline',     10,     'SYSTEM');
