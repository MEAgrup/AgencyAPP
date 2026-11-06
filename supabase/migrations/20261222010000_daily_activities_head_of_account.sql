-- ============================================================================
-- F-6c (feedback lapangan 2026-10-30, Yulianti — Head of Account) — Head of
-- Account melihat Aktivitas Harian seluruh tim di bawahnya.
--
-- GEJALA. `daily_activities_select` (20261021010000) hanya punya lengan lead
-- SE-DIVISI: `jwt_is_lead() AND jwt_division() = divisi`. `divisi` dicap dari
-- role pelaku saat mencatat (dailyactivity.ts `log`), jadi aktivitas Advertiser
-- ber-`divisi = 'Ads'` hanya terlihat lead Ads, KOL Specialist hanya lead KOL,
-- AI Optimizer hanya lead AI Optimizer, dan Store Operation (nol lead) tidak
-- terlihat siapa pun selain pelakunya. Head of Account hanya mendapat
-- `divisi = 'Account'` (AM + CRO).
--
-- KEPUTUSAN PEMILIK (Yohan, 2026-11-06 / t87u): divisi di bawah Head of Account
-- = Account (AM + CRO), CRO, Advertiser, KOL Specialist, AI Optimizer, Store
-- Operation. CRO bukan divisi CDPS tersendiri — jabatan CRO dipetakan ke
-- `Account` di `role_mappings` (seed role_mappings_riil.csv), jadi sudah
-- tercakup lengan se-divisi. Advertiser = `Ads`, KOL Specialist = `KOL`.
-- Dicatat di docs/decisions/2026-11-06-aktivitas-head-of-account.md.
--
-- "HEAD OF ACCOUNT" = lead divisi `Account`. Bukan konsep baru: itulah arti
-- yang sudah dipakai di seluruh basis kode (`recap.canReopenRecap`:
-- "`isLead(_, 'Account')` is exactly Account lead/Head OR Director", plus
-- belasan policy `jwt_is_lead() AND jwt_division() = 'Account'`). Klaim JWT
-- tidak membawa jabatan, dan menambah level klaim baru untuk satu tabel log
-- adalah perubahan kontrak auth — di luar cakupan perbaikan ini.
--
-- YANG TIDAK BERUBAH: lengan staff (milik sendiri), lengan lead se-divisi (lead
-- Ads/KOL/AI Optimizer tetap melihat divisinya, dan TIDAK melebar), lengan
-- OD/Director. Tabel tetap append-only; nol kolom baru.
-- ============================================================================

DROP POLICY IF EXISTS daily_activities_select ON public.daily_activities;
CREATE POLICY daily_activities_select ON public.daily_activities FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR employee_id = public.jwt_employee_id()
       OR (public.jwt_is_lead() AND public.jwt_division() = divisi)
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account'
           AND divisi IN ('Ads', 'KOL', 'AI Optimizer', 'Store Operation')));

COMMENT ON POLICY daily_activities_select ON public.daily_activities IS
  'F-6 — staff hanya miliknya (employee_id), Lead/SPV se-divisi (divisi '
  'didenormalisasi, pola internal_tasks.assignee_division), OD/Director penuh '
  'lewat jwt_can_read_all(). F-6c (2026-11-06) — Head of Account (lead Account) '
  'juga melihat divisi bawahannya: Ads, KOL, AI Optimizer, Store Operation.';
