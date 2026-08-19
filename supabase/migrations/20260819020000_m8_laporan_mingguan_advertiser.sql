-- CDPS — Module 8 (Ads): LAPORAN MINGGUAN Advertiser per Brief-as-task.
--
-- Follow-up PR #172 (keputusan pemilik 2026-08-19, DECISIONS.md). Laporan pemilik
-- dari /tasks/BRF-202608-0002: *"adv bertugas meningkatkan performa dan memberikan
-- saran perbaikan setiap minggunya"*. Advertiser (PIC brief) tak punya tempat
-- melaporkan performa + saran perbaikan tiap minggu — ini tempatnya.
--
-- ---------------------------------------------------------------------------
-- LINGKUP: HANYA laporan mingguan (bukan #172 utuh)
-- ---------------------------------------------------------------------------
-- PR #172 menggabung TIGA hal: (1) target metrik per-brief (`ads_brief_targets`),
-- (2) laporan mingguan, (3) kartu disiplin /ads. Bagian (1) DITUTUP pemilik sbg
-- double-feature — target kini hidup di `strategy_plans`/`m6_strategy_kpi_tasks`
-- (keputusan 2026-08-12). Maka migrasi ini membangun HANYA (2), dan sengaja
-- **realisasi-saja** (keputusan pemilik 2026-08-19): laporan menyimpan narasi
-- Advertiser; angka realisasi mingguan dihitung ulang saat baca dari
-- `metric_entries`. TIDAK ada tabel target per-brief yang dihidupkan lagi.
--
-- ---------------------------------------------------------------------------
-- MENGAPA LAPORAN MINGGUAN TIDAK MENYIMPAN SATU ANGKA PUN
-- ---------------------------------------------------------------------------
-- Aturan rumah #3/#4: angka turunan tak pernah disimpan sebagai kolom yang bisa
-- diedit. Realisasi mingguan (spend/GMV/ROAS/view/CTR/CVR) SUDAH dimiliki
-- `metric_entries` (M8 §5, cadence mingguan M8-OA-2) — jadi baris laporan hanya
-- memuat apa yang HANYA bisa datang dari kepala Advertiser: analisa performa
-- minggu itu dan saran perbaikan minggu depan. Angkanya dihitung ulang saat baca
-- (`ads.listWeeklyReports`), selalu rekonsiliabel dengan metric entry, dan tak
-- pernah menjadi ledger kedua — disiplin yang sama yang dipakai M6D §3 untuk
-- menjaga GMV tetap single-source.
--
-- Hubungan dengan M6D RM-D6 (Catatan Divisi): BEDA LAPIS, bukan duplikat. RM-D6
-- adalah satu catatan per KLIEN per minggu yang ditulis LEAD divisi ke rekap
-- AM. Ini adalah laporan per BRIEF per minggu yang ditulis ADVERTISER (PIC) atas
-- pekerjaannya sendiri — bahan mentah yang dirangkum lead ke RM-D6, bukan
-- penggantinya. Nol perubahan pada wrr_* di migrasi ini.
--
-- ---------------------------------------------------------------------------
-- GATE
-- ---------------------------------------------------------------------------
-- +1 tabel (121 → 122). NOL prefix baru (35 TETAP — laporan ber-PK
-- (brief_id, iso_year, iso_week), preseden `interview_riset_awal` yang beranak
-- tanpa ID sendiri), NOL mesin baru (23 TETAP — tak ada status di sini;
-- lifecycle tetap `brief_task`), NOL event notifikasi baru (58 TETAP — kewajiban
-- laporan disurfacekan sebagai baris "belum diisi"/`terlambat` saat baca, bukan
-- sebagai event katalog; katalog notifikasi adalah invariant beku).
-- Angka gate hidup di DUA berkas: scripts/db-rebuild.sh DAN
-- .github/workflows/ci.yml — keduanya dinaikkan di commit yang sama.
--
-- Migrasi lewat supabase/migrations/** + apply_migration — JANGAN `psql -f`
-- (O38). DB lokal dibangun ulang HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- ads_weekly_reports — laporan mingguan Advertiser per brief per minggu ISO.
-- ===========================================================================
-- Kunci minggu ISO DISIMPAN EKSPLISIT (iso_year, iso_week) dengan batas WIB
-- Sen–Min — pola identik `weekly_result_recap` (D-01), supaya identitas minggu
-- stabil lintas aritmetika zona waktu dan tak pernah diturunkan ulang saat baca.
--
-- Append-only (aturan rumah #3): tak ada jalur UPDATE/DELETE. Laporan yang
-- keliru diperbaiki dengan laporan minggu berikutnya yang menjelaskannya, bukan
-- dengan menulis ulang minggu lalu — sama seperti optimization_logs dan
-- wrr_catatan_divisi.
CREATE TABLE ads_weekly_reports (
    brief_id      varchar(32)  NOT NULL,
    iso_year      integer      NOT NULL,
    iso_week      integer      NOT NULL,   -- 1..53

    minggu_mulai  date         NOT NULL,   -- Senin WIB
    minggu_akhir  date         NOT NULL,   -- Minggu WIB

    -- Dua kolom inilah alasan tabel ini ada: yang tak bisa dihitung dari
    -- metric_entries. "adv bertugas meningkatkan performa dan memberikan saran
    -- perbaikan setiap minggunya" (pemilik 2026-08-19).
    analisa       text         NOT NULL,   -- evaluasi performa minggu ini
    saran         text         NOT NULL,   -- saran perbaikan untuk minggu depan
    kendala       text         NULL,       -- hambatan (opsional)

    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,

    PRIMARY KEY (brief_id, iso_year, iso_week),
    CONSTRAINT fk_awr_brief FOREIGN KEY (brief_id) REFERENCES briefs (id),

    CONSTRAINT ck_awr_iso_week CHECK (iso_week BETWEEN 1 AND 53),
    CONSTRAINT ck_awr_iso_year CHECK (iso_year BETWEEN 2000 AND 2100),
    CONSTRAINT ck_awr_jendela  CHECK (minggu_akhir > minggu_mulai),
    -- Laporan kosong = laporan yang tidak pernah ditulis. Cermin TS
    -- MSG_LAPORAN_NARASI_WAJIB (belt & braces).
    CONSTRAINT ck_awr_narasi   CHECK (btrim(analisa) <> '' AND btrim(saran) <> '')
);

CREATE INDEX idx_awr_brief ON ads_weekly_reports (brief_id, minggu_mulai DESC);

-- Append-only guard (aturan rumah #3) — pola wrr_catatan_divisi (D-05).
-- supabase/tests/immutability_checks.sql menuntut KEDUA trigger ini ada.
CREATE TRIGGER ads_weekly_reports_no_update BEFORE UPDATE ON ads_weekly_reports
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ads_weekly_reports_no_delete BEFORE DELETE ON ads_weekly_reports
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===========================================================================
-- RLS — dinding kedua di belakang gerbang TS.
-- ===========================================================================
-- Jalur yang DITEGAKKAN untuk baca/tulis adalah TS: route memakai db()
-- (service-role, bypass RLS) dan memanggil gerbang domain (canViewCampaign /
-- canFileWeeklyReport). Kebijakan di bawah adalah LANTAI kedua untuk jalur
-- readAsActor + uji withClaims.
--
-- Lingkup baca = TEPAT lingkup baca brief induknya (briefs_select,
-- 20260723064438): OD/Direktur, PIC/pembuat, dan lead divisi brief. Diambil
-- lewat helper SECURITY DEFINER supaya kebijakan anak tak perlu menyalin
-- predikat induk (pola private.jwt_can_read_recap, D-09).
CREATE OR REPLACE FUNCTION private.jwt_can_read_brief(p_brief_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.briefs b
     WHERE b.id = p_brief_id
       AND (public.jwt_can_read_all()
            OR public.jwt_employee_id() IN (b.assigned_pic, b.created_by)
            OR (public.jwt_is_lead() AND b.assigned_division = public.jwt_division())))
$$;

-- Idiom hardening (20260819010000): migrasi ini duduk SESUDAH sapuan, jadi
-- fungsi baru harus mencabut PUBLIC/anon dan menyebut role sah eksplisit sendiri
-- (helper predikat RLS → authenticated + service_role). Tanpa ini, default
-- privileges Supabase akan meninggalkannya anon-executable dan memunculkan lagi
-- kelas cacat yang ditutup PR #171.
REVOKE EXECUTE ON FUNCTION private.jwt_can_read_brief(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.jwt_can_read_brief(text) TO authenticated, service_role;

ALTER TABLE ads_weekly_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ads_weekly_reports TO authenticated;
CREATE POLICY ads_weekly_reports_select ON public.ads_weekly_reports FOR SELECT TO authenticated
    USING (private.jwt_can_read_brief(brief_id));

-- Tulis laporan: PIC brief itu (yang mengerjakan = yang melapor), lead divisi
-- Ads, atau Direktur. INSERT saja — guard append-only di atas menolak sisanya.
-- Cermin TS `canFileWeeklyReport`.
GRANT INSERT ON public.ads_weekly_reports TO authenticated;
CREATE POLICY ads_weekly_reports_insert ON public.ads_weekly_reports FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.briefs b
         WHERE b.id = ads_weekly_reports.brief_id
           AND b.assigned_division = 'Ads'
           AND (public.jwt_is_director()
                OR public.jwt_employee_id() = b.assigned_pic
                OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'))));
