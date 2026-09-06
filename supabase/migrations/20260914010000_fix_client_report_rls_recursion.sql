-- ============================================================================
-- PERBAIKAN BUG PRODUKSI — rekursi tak hingga di policy klaster laporan klien.
--
-- GEJALA DI PRODUKSI (log Vercel, 6 kejadian / 3 user, 2026-09-05 s/d
-- 2026-09-06): setiap baca `client_reports` / `client_report_insight` /
-- `client_report_publikasi` lewat `readAsActor` gagal dengan
--
--     ERROR 42P17: infinite recursion detected in policy for relation
--                  "client_reports"
--
-- Efeknya: Insight Editor dan daftar laporan klien 500 untuk SEMUA peran —
-- AM, Account lead, OD, Director, DAN kontak Client Portal. Diverifikasi satu
-- per satu di `CDPS SG` sebelum perbaikan ini ditulis; bukan kasus tepi.
--
-- ---------------------------------------------------------------------------
-- PENYEBAB — sepasang policy yang saling membaca tabel satu sama lain.
--
--   `client_reports_sel_portal`          (20260908010000) membaca
--       → `client_report_publikasi`, yang policy-nya
--   `client_report_publikasi_sel_portal` (20260908010000) membaca
--       → `client_reports`.
--
-- Postgres mengevaluasi policy tabel dalam saat subquery-nya dijalankan, jadi
-- pasangan ini menutup siklus dan planner menyerah dengan 42P17. Karena KEDUA
-- policy ber-`TO authenticated` dan policy SELECT di-OR, siklus itu ikut
-- dievaluasi bahkan untuk pembaca INTERNAL yang tidak punya klaim portal sama
-- sekali — itu sebabnya dampaknya bukan cuma di portal.
--
-- ---------------------------------------------------------------------------
-- PERBAIKAN — cabut SELURUH ketergantungan RLS-di-atas-RLS di klaster ini,
-- bukan cuma satu siklusnya.
--
-- Ada LIMA policy di klaster ini yang subquery-nya membaca tabel ber-RLS lain
-- (dipetakan langsung dari `pg_policy` di live, bukan dari ingatan):
--
--   client_reports_sel_portal          → client_report_publikasi
--   client_report_publikasi_sel_portal → client_reports
--   client_report_publikasi_sel        → client_reports
--   client_report_insight_sel          → client_reports
--   client_report_insight_sel_portal   → client_report_publikasi + client_reports
--   client_report_berkas_sel           → client_reports
--
-- Menambal HANYA pasangan yang bersiklus akan menghijaukan hari ini dan
-- meninggalkan empat sisi lain yang masih bisa membentuk siklus baru begitu
-- seseorang menambah satu arm. Jadi keenamnya dipindahkan ke helper
-- `private.*` ber-`SECURITY DEFINER`: fungsi DEFINER membaca tabel dengan hak
-- pemilik sehingga RLS tabel dalam tidak ikut dievaluasi, dan siklusnya putus
-- di akarnya.
--
-- Ini pola yang sudah dipakai repo ini, bukan mekanisme baru:
-- `private.jwt_owns_client_am` (20260807150000), `private.service_owner_am`,
-- dan terakhir `private.jwt_client_has_ads_brief` (20260913010000). Skema
-- `private` tidak diekspos PostgREST (relokasi 20260727072443), jadi nol jalur
-- `/rest/v1/rpc/` dan nol kewajiban mendaftar ke allow-list §44
-- `rls_checks.sql` yang hanya menyapu `public`.
--
-- ---------------------------------------------------------------------------
-- SEMANTIK TIDAK BERUBAH — ini perbaikan ketersediaan, BUKAN pelebaran akses.
-- Tiap policy di bawah menyatakan syarat yang sama persis dengan versi
-- 20260819000000/20260908010000, hanya bentuk pengambilannya yang berpindah ke
-- fungsi. Arm `jwt_is_lead()`/`jwt_division()` sengaja tetap DITULIS INLINE
-- supaya detektor sintaktik O48 (§42 `rls_checks.sql`) tetap melihatnya dan
-- tabel-tabel ini tetap tidak perlu masuk ledger — alasan yang sama yang
-- ditulis di header 20260819000000.
--
-- Nol tabel, nol kolom, nol prefix, nol mesin state, nol event notifikasi.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper — pemilik laporan.
--
--    Mengembalikan `client_id` laporan, atau NULL kalau laporannya tidak ada.
--    NULL sengaja dibiarkan merambat: `NULL = jwt_client_id()` bernilai NULL
--    yang diperlakukan FALSE oleh policy ⇒ default-deny untuk report_id yatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.report_client_id(p_report_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.client_id::text FROM public.client_reports r WHERE r.id = p_report_id
$$;

REVOKE EXECUTE ON FUNCTION private.report_client_id(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.report_client_id(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION private.report_client_id(bigint) IS
  'Klien pemilik sebuah laporan. Dipakai policy anak klaster laporan supaya '
  'mereka tidak perlu SELECT ke client_reports (yang ber-RLS) — itulah yang '
  'melahirkan rekursi 42P17 yang diperbaiki migrasi 20260914010000.';

-- ---------------------------------------------------------------------------
-- 2. Helper — laporan ini punya publikasi berstatus [Terbit]?
--
--    Gerbang portal: kontak klien hanya boleh melihat laporan yang SUDAH
--    diterbitkan, bukan draf yang masih disunting AM.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.report_terbit(p_report_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_report_publikasi p
     WHERE p.report_id = p_report_id AND p.status = '[Terbit]'
  )
$$;

REVOKE EXECUTE ON FUNCTION private.report_terbit(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.report_terbit(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION private.report_terbit(bigint) IS
  'Laporan ini punya publikasi [Terbit]? Gerbang portal klien, dipindah ke '
  'DEFINER oleh 20260914010000 untuk memutus rekursi policy 42P17.';

-- ---------------------------------------------------------------------------
-- 3. Helper — revisi insight YANG DIPAKU oleh publikasi terbit.
--
--    Lebih ketat daripada `report_terbit`: portal tidak boleh membaca revisi
--    insight mana pun selain yang dipaku publikasi yang terbit. Aturan itu ada
--    sejak 20260908010000 dan dipertahankan HURUF PER HURUF di sini —
--    melonggarkannya berarti klien membaca draf revisi yang belum disetujui.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.report_terbit_revisi(p_report_id bigint, p_revisi integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_report_publikasi p
     WHERE p.report_id = p_report_id
       AND p.status = '[Terbit]'
       AND p.insight_revisi = p_revisi
  )
$$;

REVOKE EXECUTE ON FUNCTION private.report_terbit_revisi(bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.report_terbit_revisi(bigint, integer) TO authenticated, service_role;

COMMENT ON FUNCTION private.report_terbit_revisi(bigint, integer) IS
  'Revisi insight ini yang DIPAKU publikasi [Terbit]? Gerbang portal yang '
  'lebih ketat dari report_terbit; dipindah ke DEFINER oleh 20260914010000.';

-- ---------------------------------------------------------------------------
-- 4. Enam policy ditulis ulang. Syaratnya identik; hanya subquery ke tabel
--    ber-RLS yang diganti panggilan helper di atas.
-- ---------------------------------------------------------------------------

-- 4a. client_reports — sisi portal. Sisi karyawan (`client_reports_sel`,
--     20260819000000) TIDAK disentuh: ia nol subquery, jadi bukan bagian
--     siklus dan tidak ada alasan menyalinnya ulang.
DROP POLICY IF EXISTS client_reports_sel_portal ON public.client_reports;
CREATE POLICY client_reports_sel_portal ON public.client_reports FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND client_id = public.jwt_client_id()
           AND private.report_terbit(client_reports.id));

-- 4b. client_report_berkas — sisi karyawan.
DROP POLICY IF EXISTS client_report_berkas_sel ON public.client_report_berkas;
CREATE POLICY client_report_berkas_sel ON public.client_report_berkas FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(private.report_client_id(client_report_berkas.report_id)));

-- 4c. client_report_insight — sisi karyawan.
DROP POLICY IF EXISTS client_report_insight_sel ON public.client_report_insight;
CREATE POLICY client_report_insight_sel ON public.client_report_insight FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(private.report_client_id(client_report_insight.report_id)));

-- 4d. client_report_publikasi — sisi karyawan.
DROP POLICY IF EXISTS client_report_publikasi_sel ON public.client_report_publikasi;
CREATE POLICY client_report_publikasi_sel ON public.client_report_publikasi FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(private.report_client_id(client_report_publikasi.report_id)));

-- 4e. client_report_publikasi — sisi portal.
DROP POLICY IF EXISTS client_report_publikasi_sel_portal ON public.client_report_publikasi;
CREATE POLICY client_report_publikasi_sel_portal ON public.client_report_publikasi FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND status = '[Terbit]'
           AND private.report_client_id(client_report_publikasi.report_id) = public.jwt_client_id());

-- 4f. client_report_insight — sisi portal. DUA syarat, dan keduanya wajib:
--     laporannya milik klien ini, DAN revisi baris ini yang dipaku publikasi
--     terbit. Menghapus salah satunya membuat klien membaca revisi draf.
DROP POLICY IF EXISTS client_report_insight_sel_portal ON public.client_report_insight;
CREATE POLICY client_report_insight_sel_portal ON public.client_report_insight FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND private.report_client_id(client_report_insight.report_id) = public.jwt_client_id()
           AND private.report_terbit_revisi(client_report_insight.report_id, client_report_insight.revisi));
