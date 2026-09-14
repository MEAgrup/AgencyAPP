-- ============================================================================
-- HOTFIX — insiden login production 2026-09-14 (docs/DECISIONS.md). Production
-- login mulai gagal 500 pukul 09:42 UTC: `main` masih memanggil
-- `check_login_rate_limit(text,int,int)`, tapi migrasi F-2 (berkas
-- `20261023005000_feedback_lapangan_20260914.sql` di atas — sudah live di
-- prod sejak 09:36 UTC lewat versi 20260914093619, diterapkan langsung dari
-- branch claude/stoic-mendel-8aguxu SEBELUM kode/migrasinya pernah masuk
-- `main`) sudah menghapusnya demi `login_rate_limit_check` /
-- `login_rate_limit_record_failure`. Setiap percobaan login di production
-- gagal sampai shim ini diterapkan (langsung ke live DB via apply_migration,
-- sebagai tindakan darurat, MENDAHULUI commit ini).
--
-- Ini SHIM KOMPATIBILITAS, bukan desain baru: mengembalikan signature/
-- perilaku LAMA (bucket per-IP murni, mencatat SETIAP percobaan yang dicek
-- terlepas dari berhasil/gagal) dengan mendelegasikan ke tabel
-- `login_rate_limit_attempts` yang sama (sudah punya kolom `email` sejak F-2),
-- memakai string kosong sebagai bucket "legacy/IP-only" supaya tidak
-- bercampur dengan baris per-email asli begitu kode F-2
-- (`assertLoginNotRateLimited`/`recordFailedLoginAttempt`, sudah di-port ke
-- `main` di commit yang sama dengan berkas ini) benar-benar berjalan.
--
-- HAPUS berkas/fungsi ini (DROP FUNCTION public.check_login_rate_limit)
-- setelah dikonfirmasi tidak ada lagi pemanggil `check_login_rate_limit` di
-- `main` yang sudah di-deploy — pada titik itu tidak ada yang memanggil nama
-- lama ini lagi dan shim menjadi mati.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_login_rate_limit(
  p_ip_address      text,
  p_max_attempts    int,
  p_window_minutes  int
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_count int;
BEGIN
  DELETE FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address
     AND email = ''
     AND attempted_at < now() - make_interval(mins => p_window_minutes);

  SELECT count(*) INTO v_count
    FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address
     AND email = '';

  IF v_count >= p_max_attempts THEN
    RETURN false;
  END IF;

  INSERT INTO public.login_rate_limit_attempts (ip_address, email) VALUES (p_ip_address, '');
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_login_rate_limit(text, int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit(text, int, int) TO service_role;
