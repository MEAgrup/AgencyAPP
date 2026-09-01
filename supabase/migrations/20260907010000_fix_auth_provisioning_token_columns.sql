-- ============================================================================
-- Fix (round 2) — three GoTrue account-provisioning functions were STILL
-- missing three `auth.users` columns without a table-level DEFAULT
-- (`confirmation_token`, `recovery_token`, `email_change_token_new`),
-- reproducing the exact same "NULL scans into a non-nullable Go string ⇒
-- login 500s" bug class as `email_change` — for every account they mint,
-- going forward.
--
-- HOW THIS HAPPENED (documented so the next session does not repeat it):
-- an earlier, never-committed fix (applied directly to CDPS SG, version
-- 20260831015158, reconstructed as
-- `20260831015158_fix_import_credentials_null_tokens.sql` in this same
-- commit) added these three columns to `import_employee_credentials()` —
-- but a LATER migration in this repo,
-- `20260902040000_fix_import_employee_credentials_email_change.sql`, did a
-- fresh `CREATE OR REPLACE FUNCTION` that only knew about `email_change`
-- (that earlier fix was never a file, so it was invisible when this one was
-- written) — silently REVERTING the token-columns fix on its way to fixing a
-- different column. Two follow-up functions written after that
-- (`provision_vendor_account`, `provision_client_contact`, both LT-61/M15-C2)
-- then copied the now-incomplete shape verbatim, carrying the same gap into
-- both. Verified directly against `information_schema.columns` on CDPS SG
-- (2026-09-01): `confirmation_token`/`recovery_token`/`email_change_token_new`
-- all have `column_default IS NULL` — the "these default to '' like the
-- others" comment left in two of these functions was wrong.
--
-- FIX: all three functions now set all FOUR token-shaped columns explicitly
-- (`email_change` + the three above) — nothing else in the bodies changes.
-- Plus a backfill for any row that is currently NULL (none were, checked live
-- before writing this, but the guard costs nothing and matches the pattern
-- already used for `email_change`).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE auth.users
         SET confirmation_token     = coalesce(confirmation_token, ''),
             recovery_token         = coalesce(recovery_token, ''),
             email_change_token_new = coalesce(email_change_token_new, ''),
             email_change           = coalesce(email_change, '')
       WHERE confirmation_token IS NULL
          OR recovery_token IS NULL
          OR email_change_token_new IS NULL
          OR email_change IS NULL
    $q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. import_employee_credentials() — HRIS employee sync.
-- ---------------------------------------------------------------------------
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
         confirmation_token, recovery_token, email_change_token_new, email_change,
         created_at, updated_at)
      VALUES
        ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, $3, now(),
         jsonb_build_object('provider','email','providers', jsonb_build_array('email'))
           || $4,
         '{}'::jsonb, '', '', '', '', now(), now())
      ON CONFLICT (id) DO NOTHING
    $q$
    USING v_uid, r.email, r.password_hash,
          public.employee_claims(r.employee_id);

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

-- ---------------------------------------------------------------------------
-- 2. provision_vendor_account() — LT-61 vendor admin UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_vendor_account(
  p_vendor_id   text,
  p_email       text,
  p_bcrypt_hash text,
  p_actor       text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_uid uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'auth.users tidak ada — provisioning hanya di stack Supabase/GoTrue';
  END IF;

  v_uid := gen_random_uuid();

  EXECUTE $q$
    INSERT INTO auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change_token_new, email_change,
       created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, $3, now(),
       jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
       '{}'::jsonb,
       '', '', '', '',
       now(), now())
  $q$
  USING v_uid, p_email, p_bcrypt_hash;

  EXECUTE $q$
    INSERT INTO auth.identities
      (provider_id, user_id, identity_data, provider, last_sign_in_at,
       created_at, updated_at)
    VALUES
      ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2),
       'email', now(), now(), now())
  $q$
  USING v_uid, p_email;

  INSERT INTO public.vendor_accounts (auth_user_id, vendor_id, status_aktif, created_by)
  VALUES (v_uid, p_vendor_id, true, p_actor);

  RETURN v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_vendor_account(text, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_vendor_account(text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. provision_client_contact() — M15-C2 Client Portal admin UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_client_contact(
  p_client_id   text,
  p_nama        text,
  p_email       text,
  p_bcrypt_hash text,
  p_actor       text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_uid uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'auth.users tidak ada — provisioning hanya di stack Supabase/GoTrue';
  END IF;

  v_uid := gen_random_uuid();

  EXECUTE $q$
    INSERT INTO auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change_token_new, email_change,
       created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, $3, now(),
       jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
       '{}'::jsonb,
       '', '', '', '',
       now(), now())
  $q$
  USING v_uid, p_email, p_bcrypt_hash;

  EXECUTE $q$
    INSERT INTO auth.identities
      (provider_id, user_id, identity_data, provider, last_sign_in_at,
       created_at, updated_at)
    VALUES
      ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2),
       'email', now(), now(), now())
  $q$
  USING v_uid, p_email;

  INSERT INTO public.client_contacts
    (auth_user_id, client_id, nama, email, status_aktif, must_change_password, created_by)
  VALUES
    (v_uid, p_client_id, p_nama, p_email, true, true, p_actor);

  RETURN v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_client_contact(text, text, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_client_contact(text, text, text, text, text) TO service_role;
