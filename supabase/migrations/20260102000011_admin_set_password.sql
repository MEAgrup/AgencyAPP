-- ============================================================================
-- O44(c) / B1 — admin reset password (jalur pemulihan tanpa email).
--
-- Latar: di stack ini password TINGGAL DI GoTrue (`auth.users.encrypted_password`);
-- `employee_credentials` hanya tempat transit saat impor (OQ-3). Karena itu
-- `import_employee_credentials()` TIDAK bisa dipakai untuk reset — ia sengaja
-- dijaga `auth_user_id IS NULL`, jadi hanya mem-provision user BARU.
--
-- Fungsi di bawah melengkapi pasangan yang sudah ada:
--   clear_must_change_password()  — dipakai SETELAH user ganti password sendiri
--   admin_set_employee_password() — dipakai saat ADMIN menyetel password sementara
--
-- Kenapa lewat SQL SECURITY DEFINER dan bukan GoTrue Admin API: `apps/api` tidak
-- punya `SUPABASE_SERVICE_ROLE_KEY` (hanya anon key + JWT secret + DATABASE_URL),
-- dan menambah secret baru adalah aksi infra pemilik. Jalur ini memakai koneksi
-- privileged yang SUDAH ada, dan mengikuti pola tulis yang memang dianut stack
-- ini ("writes go through SECURITY DEFINER RPCs" — apps/api/src/lib/db.ts).
--
-- Otorisasi TIDAK ada di sini: gate Director/Lead ditegakkan di domain layer
-- (`auth.setPassword`), sama seperti `set_employee_banned` mempercayai pemanggil.
-- Fungsi ini service-role-only, jadi tak terekspos ke `authenticated`/PostgREST.
-- ============================================================================

-- admin_set_employee_password(id, bcrypt_hash) — setel password sementara:
--   1. upsert `employee_credentials` (hash baru, WAJIB ganti, lockout direset)
--   2. nyalakan `employees.must_change_password`
--   3. tulis hash ke `auth.users.encrypted_password` (otoritas login sebenarnya)
--   4. hapus refresh token GoTrue supaya sesi lama mati, bukan hidup terus
--
-- Hash di-generate di aplikasi (bcryptjs, cost 10 — sama dengan importer), bukan
-- di sini, supaya DB tidak perlu ekstensi crypto dan biaya bcrypt tidak membebani
-- koneksi pooler.
--
-- Mengembalikan true bila karyawan ada, false bila tidak — pemanggil memetakan
-- false ke `[karyawan tidak ditemukan]`.
CREATE OR REPLACE FUNCTION public.admin_set_employee_password(
  p_employee_id text,
  p_bcrypt_hash text,
  p_actor        text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_uid    uuid;
  v_exists boolean;
BEGIN
  SELECT true, auth_user_id INTO v_exists, v_uid
    FROM public.employees
   WHERE employee_id = p_employee_id;

  IF v_exists IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Kredensial CDPS: hash baru + paksa ganti + buka kunci percobaan gagal.
  INSERT INTO public.employee_credentials
    (employee_id, password_hash, must_change_password, failed_attempts, locked_until, created_by)
  VALUES
    (p_employee_id, p_bcrypt_hash, true, 0, NULL, p_actor)
  ON CONFLICT (employee_id) DO UPDATE
     SET password_hash        = EXCLUDED.password_hash,
         must_change_password = true,
         failed_attempts      = 0,
         locked_until         = NULL;

  -- 2. Cermin flag di `employees` (dipakai gate login).
  UPDATE public.employees
     SET must_change_password = true
   WHERE employee_id = p_employee_id;

  -- 3/4. Sisi GoTrue. No-op di stack tanpa GoTrue (CI/lokal) — sama seperti
  --      set_employee_banned, supaya migrasi & test tetap jalan di Postgres biasa.
  IF to_regclass('auth.users') IS NULL OR v_uid IS NULL THEN
    RETURN true;
  END IF;

  EXECUTE 'UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2'
    USING p_bcrypt_hash, v_uid;

  -- Sesi lama harus mati: tanpa ini pemegang refresh token tetap bisa
  -- memperpanjang akses memakai password lama yang baru saja dibatalkan.
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING v_uid::text;
  END IF;

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_employee_password(text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_password(text, text, text) TO service_role;
