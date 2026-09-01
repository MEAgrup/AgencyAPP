-- Backfill baris yang sudah telanjur NULL → '' (kolom token GoTrue tanpa DEFAULT).
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE auth.users
         SET confirmation_token     = coalesce(confirmation_token, ''),
             recovery_token         = coalesce(recovery_token, ''),
             email_change_token_new = coalesce(email_change_token_new, '')
       WHERE confirmation_token IS NULL
          OR recovery_token IS NULL
          OR email_change_token_new IS NULL
    $q$;
  END IF;
END $$;

-- Cegah berulang: sertakan ketiga kolom token secara eksplisit di INSERT.
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
         confirmation_token, recovery_token, email_change_token_new,
         created_at, updated_at)
      VALUES
        ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, $3, now(),
         jsonb_build_object('provider','email','providers', jsonb_build_array('email'))
           || $4,
         '{}'::jsonb, '', '', '', now(), now())
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
