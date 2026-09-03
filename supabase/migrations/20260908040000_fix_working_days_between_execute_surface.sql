-- ===========================================================================
-- Tambal permukaan EXECUTE working_days_between
-- ===========================================================================
--
-- TEMUAN (dicatat, belum ditambal, di
-- `docs/handoff/HANDOFF_INSIGHT_EDITABLE_CLIENT_PORTAL_20260908.md` §5.1(b)):
-- advisor Supabase menandai `public.working_days_between(date, date)` sebagai
-- `SECURITY DEFINER` yang bisa dieksekusi `anon` lewat
-- `/rest/v1/rpc/working_days_between`.
--
-- SEBABNYA. `20260907020000_fix_working_days_between_security_definer.sql`
-- mengubah fungsi ini jadi SECURITY DEFINER supaya caller RLS-scoped
-- (`readAsActor`, mis. M16 Tahapan Produksi lead time) tetap bisa memanggilnya
-- walau `hari_libur` sendiri default-deny total untuk `authenticated`/`anon`.
-- Migrasi itu TIDAK menyertakan REVOKE apa pun — Postgres memberi EXECUTE ke
-- **PUBLIC** untuk setiap fungsi baru, dan `anon`/`authenticated` mewarisi
-- lewat PUBLIC. Kelas bug yang sama dengan `check_complaint_rate_limit`
-- (`20260908030000`): setiap `SECURITY DEFINER` baru wajib REVOKE eksplisit,
-- bukan hanya mengandalkan "tidak ada GRANT langsung".
--
-- KENAPA DAMPAKNYA LEBIH KECIL (dan kenapa tetap ditambal). Fungsi ini nol
-- tulis dan nol rahasia bocor — ia hanya mengembalikan JUMLAH hari kerja
-- antara dua tanggal, tidak pernah baris `hari_libur` itu sendiri. Jadi ini
-- bukan DoS atau kebocoran data seperti kasus komplain; ini tetap ditambal
-- karena kelasnya sama (SECURITY DEFINER + permukaan EXECUTE tak terkendali)
-- dan advisor sudah menandainya — membiarkannya berarti pola "REVOKE eksplisit
-- wajib" yang baru saja dipelajari tidak benar-benar konsisten di kode sendiri.
--
-- BEDA dari `check_complaint_rate_limit`: fungsi itu dikunci total ke
-- `service_role` karena tidak ada pemanggil sah selain domain lewat db().
-- Fungsi INI punya pemanggil sah lain: `authenticated` (readAsActor, alasan
-- migrasi ini dibuat SECURITY DEFINER) dan `service_role` (cron/job lewat
-- db(), mis. `interview_daily_tick`, `kelola_klien_sla`). Keduanya di-GRANT
-- balik; hanya `anon` dan PUBLIC yang dicabut.
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION
    public.working_days_between(date, date)
    FROM public, anon;

GRANT EXECUTE ON FUNCTION
    public.working_days_between(date, date)
    TO authenticated, service_role;
