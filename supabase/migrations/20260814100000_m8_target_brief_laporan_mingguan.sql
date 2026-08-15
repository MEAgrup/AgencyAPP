-- CDPS — Module 8 (Ads) + Module 12 (Task Execution): TARGET METRIK per Brief-as-task
-- + LAPORAN MINGGUAN Advertiser.
--
-- Keputusan pemilik 2026-08-14 (DECISIONS.md, "M8 target metrik brief Ads +
-- laporan mingguan Advertiser"). Laporan pemilik dari halaman
-- /tasks/BRF-202608-0002: *"ketika akan memilih team, tidak ada satupun metrik
-- target yang dipilih: ads spent, gmv target, roas, view, ctr, cvr — perlu dibuat
-- target dari brief, termasuk weekly report setelah pengerjaan, dimana adv
-- bertugas meningkatkan performa dan memberikan saran perbaikan setiap
-- minggunya."*
--
-- ---------------------------------------------------------------------------
-- MENGAPA DI BRIEF, BUKAN DI AD CAMPAIGN
-- ---------------------------------------------------------------------------
-- `ad_campaigns.target_kpi` (M8 §9.3) sudah ada, tapi ia SATU teks bebas per
-- kampanye ("ROAS ≥ 4x") dan baru lahir SESUDAH brief [In Progress] (§4 Rule 1).
-- Yang hilang adalah yang ditanyakan pemilik: enam angka target yang menempel
-- pada BRIEF — kontrak kerja yang diberikan SPV/Lead Ads BERSAMAAN dengan
-- penetapan PIC, sebelum ada kampanye apa pun. Karena itu barisnya anak `briefs`
-- (PK brief_id), bukan kolom baru di `ad_campaigns`, dan `target_kpi` kampanye
-- TIDAK disentuh — ia tetap milik kampanye (M8-OA-4: AM merundingkan, SPV Ads
-- menandatangani; keduanya peran yang sama yang menulis baris di sini).
--
-- Sumber angkanya sudah ada di sistem dan TIDAK disalin ke sini sebagai default
-- diam-diam: `strategy_plans.target_gmv/roas/ctr/cvr` (20260812090000) dan
-- `briefs.quantity_target` (deliverable "Ads spent (Rp)", TASK_CATALOG M6B).
-- Domain `ads.suggestBriefTargets` MENAMPILKAN keduanya sebagai saran; SPV/Lead
-- tetap harus menekan simpan, jadi tak pernah ada target yang "muncul sendiri"
-- tanpa aktor yang bertanggung jawab (M8-OA-4 melarang target tanpa persetujuan).
--
-- `target_view` tidak punya sumber Strategy — M6 tak memodelkannya. Ia terisi
-- manual, dan realisasinya dibaca dari `metric_entries.impressions` (T-3,
-- 20260814040000) — persis sumber yang dipakai RM-C3 "Total View".
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
-- +2 tabel (113 → 115). NOL prefix baru (34 TETAP — laporan ber-PK
-- (brief_id, iso_year, iso_week), preseden `interview_riset_awal` yang beranak
-- interview tanpa ID sendiri), NOL mesin baru (22 TETAP — tak ada status di sini;
-- lifecycle tetap `brief_task`), NOL event notifikasi baru (52 TETAP — kewajiban
-- laporan disurfacekan sebagai baris "belum diisi" saat baca, bukan sebagai event
-- katalog; katalog notifikasi adalah invariant beku).
-- Angka gate hidup di DUA berkas: scripts/db-rebuild.sh DAN
-- .github/workflows/ci.yml — keduanya dinaikkan di commit yang sama.
--
-- Migrasi lewat supabase/migrations/** + apply_migration — JANGAN `psql -f`
-- (O38). DB lokal dibangun ulang HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. ads_brief_targets — enam target metrik per Brief-as-task divisi Ads.
-- ===========================================================================
-- Satu baris per brief (PK = brief_id): target adalah kontrak kerja brief itu,
-- bukan riwayat. Perubahannya BUKAN hilang — setiap tulis mencatat baris
-- audit_log before→after di domain (aturan rumah #3), jadi "siapa menurunkan
-- target ROAS dari 4 ke 3" tetap terjawab tanpa tabel versi kedua.
--
-- Semua kolom target NULLable: sebuah brief boleh ditargetkan hanya pada
-- sebagian metrik (mis. hanya spend + ROAS). Yang dilarang adalah baris KOSONG
-- (ck_abt_min_satu) — baris tanpa satu pun target tidak menyatakan apa-apa dan
-- akan terbaca sebagai "target sudah ditetapkan" di UI.
CREATE TABLE ads_brief_targets (
    brief_id      varchar(32)   NOT NULL PRIMARY KEY,

    target_spend  numeric(20,2) NULL,   -- Ads spent (Rp) — sumber saran: briefs.quantity_target
    target_gmv    numeric(20,2) NULL,   -- GMV target (Rp) — sumber saran: strategy_plans.target_gmv
    target_roas   numeric(8,2)  NULL,   -- ROAS (x)       — sumber saran: strategy_plans.target_roas
    target_view   bigint        NULL,   -- view/impressions — tanpa sumber Strategy (manual)
    target_ctr    numeric(6,3)  NULL,   -- CTR (%)        — sumber saran: strategy_plans.target_ctr
    target_cvr    numeric(6,3)  NULL,   -- CVR (%)        — sumber saran: strategy_plans.target_cvr

    catatan       text          NULL,   -- konteks target (mis. "spend ditahan sampai listing beres")

    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    created_by    varchar(64)   NOT NULL,
    updated_by    varchar(64)   NOT NULL,

    CONSTRAINT fk_abt_brief FOREIGN KEY (brief_id) REFERENCES briefs (id),

    -- Angka target tak pernah negatif; ROAS/CTR/CVR/view juga tidak.
    CONSTRAINT ck_abt_nonneg CHECK (
        coalesce(target_spend, 0) >= 0 AND coalesce(target_gmv, 0) >= 0 AND
        coalesce(target_roas, 0)  >= 0 AND coalesce(target_view, 0) >= 0 AND
        coalesce(target_ctr, 0)   >= 0 AND coalesce(target_cvr, 0)  >= 0),
    -- CTR/CVR adalah persen: >100% adalah salah-input, bukan prestasi.
    CONSTRAINT ck_abt_persen CHECK (
        (target_ctr IS NULL OR target_ctr <= 100) AND
        (target_cvr IS NULL OR target_cvr <= 100)),
    -- Baris target harus menyatakan setidaknya satu angka.
    CONSTRAINT ck_abt_min_satu CHECK (
        target_spend IS NOT NULL OR target_gmv IS NOT NULL OR target_roas IS NOT NULL OR
        target_view  IS NOT NULL OR target_ctr IS NOT NULL OR target_cvr  IS NOT NULL)
);

CREATE TRIGGER trg_ads_brief_targets_updated_at BEFORE UPDATE ON ads_brief_targets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 2. ads_weekly_reports — laporan mingguan Advertiser per brief per minggu ISO.
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
    -- perbaikan setiap minggunya" (pemilik 2026-08-14).
    analisa       text         NOT NULL,   -- evaluasi performa minggu ini vs target
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
-- 3. RLS — dinding kedua di belakang gerbang TS.
-- ===========================================================================
-- Jalur yang DITEGAKKAN untuk baca/tulis adalah TS: route memakai db()
-- (service-role, bypass RLS) dan memanggil gerbang domain (canViewCampaign /
-- canSetBriefTargets / canFileWeeklyReport). Kebijakan di bawah adalah LANTAI
-- kedua untuk jalur readAsActor + uji withClaims.
--
-- Lingkup baca kedua tabel = TEPAT lingkup baca brief induknya (briefs_select,
-- 20260723064438): OD/Direktur, PIC/pembuat, dan lead divisi brief. Diambil
-- lewat helper SECURITY DEFINER supaya kebijakan anak tak perlu menyalin
-- predikat induk (pola private.jwt_can_read_recap, D-09).
--
-- Catatan jujur soal "TS ≡ RLS": gerbang TS (canViewCampaign, §9.1) LEBIH LEBAR
-- dari briefs_select — ia juga mengizinkan AM pemilik klien, lead Account, dan
-- seluruh staf Ads. Kebijakan di sini SENGAJA tidak ikut melebar: anak tak boleh
-- lebih terbuka dari induknya, dan melebarkan baca per-tabel adalah keputusan
-- visibilitas kelas O48 yang butuh entri DECISIONS tersendiri (D-01 memakai
-- disiplin yang sama: "mulai sempit, lebarkan saat fitur membutuhkannya"). Yang
-- dilarang divergen adalah arah sebaliknya — RLS TIDAK PERNAH lebih longgar
-- dari gerbang TS, dan tulisan di bawah adalah cermin persis gerbang tulisnya.
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

ALTER TABLE ads_brief_targets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_weekly_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ads_brief_targets  TO authenticated;
GRANT SELECT ON public.ads_weekly_reports TO authenticated;

CREATE POLICY ads_brief_targets_select ON public.ads_brief_targets FOR SELECT TO authenticated
    USING (private.jwt_can_read_brief(brief_id));
CREATE POLICY ads_weekly_reports_select ON public.ads_weekly_reports FOR SELECT TO authenticated
    USING (private.jwt_can_read_brief(brief_id));

-- Tulis target: SPV/Lead divisi Ads atau Direktur (M8-OA-4 — Advertiser tak
-- pernah menetapkan targetnya sendiri). Cermin TS `canSetBriefTargets`.
GRANT INSERT, UPDATE ON public.ads_brief_targets TO authenticated;
CREATE POLICY ads_brief_targets_insert ON public.ads_brief_targets FOR INSERT TO authenticated
    WITH CHECK (public.jwt_is_director()
                OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));
CREATE POLICY ads_brief_targets_update ON public.ads_brief_targets FOR UPDATE TO authenticated
    USING (public.jwt_is_director()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'))
    WITH CHECK (public.jwt_is_director()
                OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));

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
