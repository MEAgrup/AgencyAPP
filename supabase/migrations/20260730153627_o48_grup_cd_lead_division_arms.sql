-- ============================================================================
-- O48 GRUP C + D — arm "Lead/SPV = division-wide" untuk 6 policy SELECT.
--
-- Keputusan pemilik 2026-07-30 (lihat `docs/DECISIONS.md`), atas analisis
-- `docs/handoff/O48_ANALISIS_KEPUTUSAN.md`. Ini BUKAN sapuan 32 policy — hanya
-- dua grup yang dasarnya paling kuat. Grup A/B/E TIDAK disentuh.
--
-- ----------------------------------------------------------------------------
-- GRUP D (3 policy) — DB lebih sempit daripada entri DECIDED, bukan cuma dari PRD
--
-- Entri Decided W3-M14-C1 (2026-07-18) menuliskan verbatim: "config weights+
-- targets TULIS = Director saja … BACA = semua aktor ber-scope", dan M14 Rule 7
-- memisahkan "Leader/SPV: team" sebagai viewer. DB tidak menegakkan itu, dan
-- akibatnya BUKAN halaman kosong melainkan angka yang salah:
--
--   route (semuanya lewat readAsActor ⇒ RLS BERLAKU)   gate TS  →  RLS  →  akibat
--   GET /performance/config/weights    canScope (semua)   0 baris   daftar kosong
--   GET /performance/config/targets    canScope (semua)   0 baris   daftar kosong
--   GET /performance/teams/{division}  lead divisinya     1 baris   🔴 rata-rata
--                                                                    TIM dihitung
--                                                                    dari 1 orang
--   GET /staff/{id}/performance        Leader/SPV (R7)    1 baris   tak bisa lihat
--
-- Baris ketiga adalah alasan sebenarnya migrasi ini mendesak: `teamRollup`
-- (`packages/domain/src/performance.ts:1535`) menghitung rata-rata dari baris
-- yang LOLOS RLS, lalu merendernya sebagai rata-rata tim. Itu bukan data yang
-- hilang, itu **angka yang salah dan terlihat benar** — kelas O46 dengan angka.
--
-- `perf_kpi_weights` / `perf_period_targets` dibuka mengikuti `canScope`
-- (`performance.ts:147`) PERSIS, supaya TS dan SQL tidak bisa menyimpang —
-- pelajaran O46: dua sisi perbandingan harus berasal dari satu definisi.
-- Keduanya memuat `role_type, component, weight/target` saja: nol PII, nol data
-- klien. TULIS tetap Director-only (tidak disentuh migrasi ini).
--
-- ----------------------------------------------------------------------------
-- GRUP C (3 policy) — DORMAN hari ini; dikerjakan atas keputusan eksplisit
--
-- Dinyatakan apa adanya supaya tidak ada yang salah baca nanti: ketiga arm ini
-- **tidak bisa dibuktikan bekerja lewat aplikasi hari ini**, karena nol route di
-- `apps/api` membaca tabel `*_block_requests` lewat `readAsActor`. Route
-- approve/reject memakai `db()` (service role, RLS DI-BYPASS) dan FE menurunkan
-- status pending dari heuristik audit-trail. `pendingBlockRequests`
-- (`packages/domain/src/task.ts:684`) ada dan ber-test, tapi belum ter-porting
-- jadi route.
--
-- Arahnya memperluas baca ⇒ nol kebocoran, dan check 24-29 di bawah membuktikan
-- arm-nya benar di lapisan DB. Yang TIDAK dibuktikan migrasi ini adalah jalur
-- aplikasinya — itu tertutup saat `pendingBlockRequests` di-porting.
--
-- ----------------------------------------------------------------------------
-- 🔴 KENAPA HELPER SECURITY DEFINER, BUKAN `EXISTS` INLINE — bagian terpenting
--
-- Subquery di dalam ekspresi policy dievaluasi sebagai role PEMANGGIL, jadi RLS
-- tabel yang dirujuknya IKUT BERLAKU. `asset_block_requests` perlu menyeberang
-- ke `assets` → `briefs`, dan **`assets_select` belum punya arm lead** (itu O48
-- Grup B, sengaja di luar cakupan). `EXISTS (SELECT 1 FROM assets …)` karena itu
-- akan selalu false untuk seorang lead ⇒ arm mati sambil terlihat benar —
-- **persis kelas cacat O46**.
--
-- Preseden yang menyesatkan: `lead_delete_requests_select` memakai EXISTS inline
-- ke `leads` dan itu berfungsi — tapi hanya karena `leads_select` KEBETULAN
-- punya arm lead. Ia benar karena tetangganya benar, bukan karena polanya benar.
--
-- Ketiga helper di bawah karena itu SECURITY DEFINER di skema `private`
-- (mengikuti 20260727072443: nol permukaan RPC publik baru), dan check 27
-- membuktikan justru kasus yang membedakannya: seorang lead melihat block
-- request-nya **walau ia tidak bisa melihat baris `assets`-nya sendiri**.
--
-- SIFAT PERUBAHAN: 3 CREATE FUNCTION + 6 ALTER POLICY. Nol tabel, nol kolom,
-- nol event, nol perubahan jalur TULIS. Arahnya memperluas BACA di keenamnya.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper Grup C — resolusi divisi lewat induk, kebal RLS (lihat catatan di atas)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.jwt_division_owns_brief(p_brief_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.jwt_division() <> ''
     AND EXISTS (
       SELECT 1 FROM public.briefs b
        WHERE (b.id)::text = p_brief_id
          AND (b.assigned_division)::text = public.jwt_division())
$$;

COMMENT ON FUNCTION private.jwt_division_owns_brief(text) IS
  'O48 Grup C: true bila Brief p_brief_id ber-assigned_division sama dengan divisi CDPS aktor JWT. SECURITY DEFINER supaya tidak ikut disaring RLS briefs_select. Fail-closed pada divisi kosong (Director/OD lewat jwt_can_read_all).';

CREATE OR REPLACE FUNCTION private.jwt_division_owns_asset(p_asset_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.jwt_division() <> ''
     AND EXISTS (
       SELECT 1 FROM public.assets a
         JOIN public.briefs b ON (b.id)::text = (a.brief_id)::text
        WHERE (a.id)::text = p_asset_id
          AND (b.assigned_division)::text = public.jwt_division())
$$;

COMMENT ON FUNCTION private.jwt_division_owns_asset(text) IS
  'O48 Grup C: true bila Asset p_asset_id bernaung di Brief yang assigned_division-nya sama dengan divisi CDPS aktor JWT. SECURITY DEFINER WAJIB di sini: assets_select belum punya arm lead (O48 Grup B), jadi EXISTS inline akan selalu false untuk seorang lead — arm mati sambil terlihat benar (kelas O46).';

CREATE OR REPLACE FUNCTION private.jwt_division_owns_demo_task(p_task_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.jwt_division() <> ''
     AND EXISTS (
       SELECT 1 FROM public.demo_tasks t
        WHERE (t.id)::text = p_task_id
          AND (t.division)::text = public.jwt_division())
$$;

COMMENT ON FUNCTION private.jwt_division_owns_demo_task(text) IS
  'O48 Grup C: true bila demo task p_task_id ber-division sama dengan divisi CDPS aktor JWT. SECURITY DEFINER untuk konsistensi dengan dua helper sepasangnya.';

-- ---------------------------------------------------------------------------
-- GRUP C — 3 antrean block request (M12 §5.3a / M15 "Block-approval queue: SPV/Lead")
-- ---------------------------------------------------------------------------

ALTER POLICY brief_block_requests_select ON public.brief_block_requests
  USING (
    public.jwt_can_read_all()
    OR public.jwt_employee_id() = (requested_by)::text
    OR public.jwt_employee_id() = (resolved_by)::text
    OR public.jwt_employee_id() = (created_by)::text
    OR (public.jwt_is_lead() AND private.jwt_division_owns_brief((brief_id)::text))
  );

ALTER POLICY asset_block_requests_select ON public.asset_block_requests
  USING (
    public.jwt_can_read_all()
    OR public.jwt_employee_id() = (requested_by)::text
    OR public.jwt_employee_id() = (resolved_by)::text
    OR public.jwt_employee_id() = (created_by)::text
    OR (public.jwt_is_lead() AND private.jwt_division_owns_asset((asset_id)::text))
  );

ALTER POLICY demo_task_block_requests_select ON public.demo_task_block_requests
  USING (
    public.jwt_can_read_all()
    OR public.jwt_employee_id() = (requested_by)::text
    OR public.jwt_employee_id() = (resolved_by)::text
    OR public.jwt_employee_id() = (created_by)::text
    OR (public.jwt_is_lead() AND private.jwt_division_owns_demo_task((task_id)::text))
  );

-- ---------------------------------------------------------------------------
-- GRUP D — M14 Performance (menegakkan entri Decided W3-M14-C1)
-- ---------------------------------------------------------------------------

-- Cermin PERSIS `performance.canScope()` (performance.ts:147):
--   director OR od OR division <> '' OR employeeId <> ''
-- Klaim yang hilang menghasilkan NULL ⇒ USING falsy ⇒ fail-closed (kontrol
-- "klaim kosong = 0" tetap berlaku, lihat check 30).
ALTER POLICY perf_kpi_weights_select ON public.perf_kpi_weights
  USING (
    public.jwt_can_read_all()
    OR public.jwt_division() <> ''
    OR public.jwt_employee_id() <> ''
  );

ALTER POLICY perf_period_targets_select ON public.perf_period_targets
  USING (
    public.jwt_can_read_all()
    OR public.jwt_division() <> ''
    OR public.jwt_employee_id() <> ''
  );

-- M14 Rule 7 "Leader/SPV: team". Memakai private.jwt_same_division — helper yang
-- SUDAH live dan sudah lolos probe O46 8-skenario — sehingga divisi diresolusi
-- lewat public.employee_claims() dan bukan lewat pemetaan role_type↔divisi yang
-- akan jadi sumber kebenaran kedua.
ALTER POLICY performance_snapshots_select ON public.performance_snapshots
  USING (
    public.jwt_can_read_all()
    OR (staff_id)::text = public.jwt_employee_id()
    OR (public.jwt_is_lead() AND private.jwt_same_division((staff_id)::text))
  );
