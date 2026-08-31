-- ============================================================================
-- FIX PRODUKSI — `import_employee_credentials()` melahirkan baris `auth.users`
-- dengan `email_change = NULL`, menyebabkan Supabase Auth (GoTrue) menjawab
-- 500 Internal Server Error saat login (GoTrue men-scan kolom itu ke string
-- Go non-nullable).
--
-- DITEMUKAN 2026-08-31 saat memprovisikan akun trial produksi baru
-- (`trial.renewal@mea.co.id`, employee_id 9900000099): akun baru login →
-- "internal server error". Diagnosis: fungsi `import_employee_credentials()`
-- (20260723071013_supabase_auth.sql) meng-INSERT `auth.users` TANPA menyebut
-- kolom `email_change` secara eksplisit. Kolom-kolom sejenis
-- (`confirmation_token`/`recovery_token`/`email_change_token_new`/dst) semua
-- punya DEFAULT `''` di level tabel `auth.users` (bawaan Supabase), TAPI
-- `email_change` TIDAK — defaultnya NULL. Baris yang lahir dari fungsi ini pun
-- ikut NULL, dan GoTrue menolaknya di setiap permintaan yang membaca baris itu
-- (termasuk login).
--
-- DAMPAK LEBIH LUAS DARI SEKADAR AKUN BARU INI. Diverifikasi langsung ke live:
-- SATU karyawan RIIL (`2504240539`, `arisandhyyy@gmail.com`) sudah punya baris
-- `auth.users` dengan `email_change IS NULL` yang sama — kemungkinan besar
-- inilah sumber "banyak masalah login produksi" yang pemilik sebutkan
-- (bukan rotasi kredensial database seperti dugaan awal). Baris NULL yang
-- sudah ada (akun trial + karyawan riil ini) DIPERBAIKI LANGSUNG di live
-- lewat `UPDATE auth.users SET email_change = '' WHERE email_change IS NULL`
-- (data fix, dijalankan manual sebelum migrasi ini, BUKAN bagian file ini —
-- migrasi ini murni memperbaiki FUNGSINYA supaya bug yang sama tidak lahir
-- lagi untuk setiap akun BARU yang diprovisikan lewat sync HRIS berikutnya).
--
-- PERBAIKAN: satu kolom ditambahkan ke daftar INSERT (`email_change`, nilai
-- `''`), tidak ada lagi yang berubah — sengaja bukan `CREATE OR REPLACE`
-- yang menulis ulang seluruh fungsi dari nol, supaya diff-nya persis
-- menunjukkan SATU baris yang berubah.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_employee_credentials()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  r record;
  v_uid uuid;
  n integer := 0;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'auth.users tidak ada — import hanya di stack Supabase/GoTrue';
  END IF;

  FOR r IN
    SELECT c.employee_id, c.password_hash, c.must_change_password,
           e.email
    FROM public.employee_credentials c
    JOIN public.employees e ON e.employee_id = c.employee_id
    WHERE e.status_aktif
      AND e.auth_user_id IS NULL
      AND e.email IS NOT NULL
  LOOP
    v_uid := gen_random_uuid();

    EXECUTE $q$
      INSERT INTO auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         email_change,
         created_at, updated_at)
      VALUES
        ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, $3, now(),
         jsonb_build_object('provider','email','providers', jsonb_build_array('email'))
           || $4,
         '{}'::jsonb,
         '',
         now(), now())
      ON CONFLICT (id) DO NOTHING
    $q$
    USING v_uid, r.email, r.password_hash,
          public.employee_claims(r.employee_id);

    -- Identity email (login password). provider_id = user id (konvensi GoTrue).
    EXECUTE $q$
      INSERT INTO auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at,
         created_at, updated_at)
      VALUES
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2),
         'email', now(), now(), now())
      ON CONFLICT DO NOTHING
    $q$
    USING v_uid, r.email;

    UPDATE public.employees
       SET auth_user_id = v_uid,
           must_change_password = coalesce(r.must_change_password, false)
     WHERE employee_id = r.employee_id;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_employee_credentials() FROM public, anon, authenticated;

-- Backstop: kalau ada baris lama lain di stack ini yang lolos dari verifikasi
-- manual sesi ini (mis. sengaja dibuat langsung tanpa lewat fungsi ini),
-- tetap disapu bersih supaya invariant "nol email_change NULL" tegak untuk
-- SEMUA baris, bukan hanya yang sempat ditemukan manual. Portabilitas: SQL
-- dinamis + guard `to_regclass`, sama seperti pola migrasi asalnya — pada
-- stack polos (CI/lokal) tanpa `auth.users` ini menjadi no-op.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'UPDATE auth.users SET email_change = '''' WHERE email_change IS NULL';
  END IF;
END $$;
