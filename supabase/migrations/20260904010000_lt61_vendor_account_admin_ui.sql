-- ============================================================================
-- LT-61 follow-up — admin UI for vendor account provisioning.
--
-- Reverses one call from `docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md`
-- §7/§8 ("Provisioning: manual insert into vendor_accounts, no admin UI — vendor
-- count is tiny... revisit only if that stops being true"). The owner asked for
-- the screen now (vendor count grew) — see DECISIONS.md for the entry dated the
-- same day as this migration.
--
-- WHAT'S ADDED — three SECURITY DEFINER functions, ZERO new tables (134/37/30/67
-- all TETAP; `vendor_accounts` already exists, 20260903010000):
--
--   1. list_vendor_accounts() — vendor_accounts joined to auth.users.email, so
--      the admin screen can show WHICH login (if any) each vendor has. Mirrors
--      why `role_mappings`/`employee_layered_roles` reads go privileged
--      (admin.ts): this is default-deny internal data, not RLS-scoped.
--   2. provision_vendor_account(vendor_id, email, bcrypt_hash, actor) — mints a
--      GoTrue auth.users + auth.identities row and links it via vendor_accounts,
--      for ONE vendor on demand from the admin screen. Same INSERT shape as
--      import_employee_credentials() (20260723071013 §OQ-3), minus the
--      role_mappings-derived claims (a vendor's token carries only `vendor_id`,
--      resolved fresh at token-mint time by vendor_claims() — nothing about the
--      vendor's authority is baked into raw_app_meta_data at creation).
--   3. set_vendor_account_status(auth_user_id, status_aktif) — deactivate/
--      reactivate, mirroring set_employee_banned() exactly (flips
--      vendor_accounts.status_aktif unconditionally, then bans/unbans in GoTrue
--      when auth.users exists — a no-op on plain Postgres, same guard shape).
--
-- Why apps/api cannot just call the GoTrue Admin API instead: it has no
-- SUPABASE_SERVICE_ROLE_KEY (only anon key + JWT secret + DATABASE_URL — see
-- 20260729104209_admin_set_password.sql's header, same constraint). This is the
-- only path available, and it is the one the codebase already uses everywhere
-- else it needs to touch `auth.*`.
--
-- One active account per vendor at a time (uq_vendor_accounts_active_vendor):
-- an admin who wants to rotate a vendor's login deactivates the old row first
-- (set_vendor_account_status(false)), which frees the vendor_id for a fresh
-- provision — the deactivated row stays for audit/history, never deleted.
-- ============================================================================

CREATE UNIQUE INDEX uq_vendor_accounts_active_vendor
  ON public.vendor_accounts (vendor_id) WHERE status_aktif;

-- ---------------------------------------------------------------------------
-- 1. list_vendor_accounts() — privileged read (vendor_accounts is "internal
--    murni": RLS on, no policy, SELECT revoked from authenticated/anon —
--    20260903010000 §1). Email comes from auth.users; NULL on a plain Postgres
--    stack (CI/local) where that schema does not exist, same guard shape as
--    import_employee_credentials()/linkAuthUsers().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_vendor_accounts()
RETURNS TABLE (
  vendor_id    varchar(32),
  auth_user_id uuid,
  email        text,
  status_aktif boolean,
  created_at   timestamptz,
  created_by   varchar(64)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN QUERY
      SELECT va.vendor_id, va.auth_user_id, NULL::text, va.status_aktif, va.created_at, va.created_by
      FROM public.vendor_accounts va;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT va.vendor_id, va.auth_user_id, u.email::text, va.status_aktif, va.created_at, va.created_by
    FROM public.vendor_accounts va
    JOIN auth.users u ON u.id = va.auth_user_id
  $q$;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_vendor_accounts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_vendor_accounts() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. provision_vendor_account — mints exactly one GoTrue user + identity, then
--    links it. Caller (packages/domain/src/vendor.ts provisionVendorAccount)
--    has already: gated the actor, validated input, locked+confirmed the
--    vendor exists, and checked no ACTIVE account exists for it. This function
--    still RAISEs on a plain-Postgres stack — unlike linkAuthUsers's silent
--    no-op (that one runs unconditionally on every employee sync, including in
--    CI), this runs only from one explicit admin click and an admin needs to
--    know it did not happen, not see a false success.
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
       created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, $3, now(),
       jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
       '{}'::jsonb, now(), now())
  $q$
  USING v_uid, p_email, p_bcrypt_hash;

  -- Identity email (login password). provider_id = user id (konvensi GoTrue,
  -- sama persis dengan import_employee_credentials).
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
-- 3. set_vendor_account_status — mirrors set_employee_banned exactly. Updates
--    vendor_accounts UNCONDITIONALLY (so the deactivate/reactivate toggle is
--    fully testable on plain Postgres), then bans/unbans in GoTrue only where
--    auth.users exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_vendor_account_status(p_auth_user_id uuid, p_status_aktif boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  UPDATE public.vendor_accounts SET status_aktif = p_status_aktif WHERE auth_user_id = p_auth_user_id;
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'UPDATE auth.users SET banned_until = $1 WHERE id = $2'
    USING (CASE WHEN p_status_aktif THEN NULL ELSE 'infinity'::timestamptz END), p_auth_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_vendor_account_status(uuid, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_vendor_account_status(uuid, boolean) TO service_role;
