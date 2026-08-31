-- ============================================================================
-- M15-C2 Client Portal — account lifecycle: admin provisioning, deactivate/
-- reactivate, admin password reset, and the self-service "clear force-change"
-- companion. Mirrors the LT-61 vendor admin-UI migration
-- (20260904010000_lt61_vendor_account_admin_ui.sql) plus the employee realm's
-- admin_set_employee_password / clear_must_change_password pair
-- (20260729104209 / 20260724161750) — this is the first realm that needs
-- BOTH provisioning-with-force-change AND a working admin-reset AND a working
-- self-service change, all three, from its first migration (vendor never
-- built force-change or reset; employee built the two password functions in
-- separate migrations weeks apart). ZERO new tables.
--
-- WHY SQL SECURITY DEFINER, not the GoTrue Admin API: `apps/api` has no
-- SUPABASE_SERVICE_ROLE_KEY (only anon key + JWT secret + DATABASE_URL — see
-- 20260729104209_admin_set_password.sql's header, same constraint every other
-- realm has). This is the only path available.
--
--   1. list_client_contacts() — client_contacts joined to auth.users.email and
--      clients (for the admin screen's "which Client" column). Privileged
--      read: client_contacts is default-deny internal data, same class as
--      vendor_accounts/role_mappings.
--   2. provision_client_contact(client_id, nama, email, bcrypt_hash, actor) —
--      mints a GoTrue auth.users + auth.identities row and links it via
--      client_contacts, for ONE invited contact. Same INSERT shape as
--      provision_vendor_account/import_employee_credentials, INCLUDING the
--      email_change = '' fix (20260902040000) from the very first version —
--      not retrofitted after the fact this time.
--   3. set_client_contact_status(auth_user_id, status_aktif) — deactivate/
--      reactivate, mirroring set_vendor_account_status exactly.
--   4. admin_reset_client_contact_password(auth_user_id, bcrypt_hash, actor)
--      — admin/AM sets a new temporary password for an existing contact
--      (spec §3.3 jalur 1: always available, no email dependency). Mirrors
--      admin_set_employee_password's GoTrue-side steps (3/4: overwrite
--      encrypted_password, revoke refresh tokens) but writes directly to
--      client_contacts (single source of truth here — unlike the employee
--      realm there is no separate legacy `_credentials` transit table to
--      dual-write, so this is simpler than its employee-realm counterpart).
--   5. clear_client_contact_must_change_password(auth_user_id) — the
--      self-service-success companion to #4, mirrors clear_must_change_password.
--      Called by the change-password AND the self-service email-reset-
--      completion route, both AFTER GoTrue has already accepted the new
--      password (never before — a failed GoTrue call must not clear the gate).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. list_client_contacts() — privileged read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_client_contacts()
RETURNS TABLE (
  auth_user_id         uuid,
  client_id            varchar(32),
  nama_klien           varchar(191),
  assigned_am_id       varchar(64),
  nama                 varchar(191),
  email                text,
  status_aktif         boolean,
  must_change_password boolean,
  created_at           timestamptz,
  created_by           varchar(64)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN QUERY
      SELECT cc.auth_user_id, cc.client_id, cl.toko, cl.assigned_am_id, cc.nama, NULL::text,
             cc.status_aktif, cc.must_change_password, cc.created_at, cc.created_by
      FROM public.client_contacts cc
      JOIN public.clients cl ON cl.id = cc.client_id;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT cc.auth_user_id, cc.client_id, cl.toko, cl.assigned_am_id, cc.nama, u.email::text,
           cc.status_aktif, cc.must_change_password, cc.created_at, cc.created_by
    FROM public.client_contacts cc
    JOIN public.clients cl ON cl.id = cc.client_id
    JOIN auth.users u ON u.id = cc.auth_user_id
  $q$;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_client_contacts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_contacts() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. provision_client_contact — mints exactly one GoTrue user + identity,
--    then links it. Caller (packages/domain/src/client-portal-auth.ts
--    provisionClientContact) has already: gated the actor (AM own-Client /
--    Account lead / Director, spec §3.2), validated input, and confirmed the
--    Client exists. Raises on a plain-Postgres stack (CI/local) rather than
--    silently no-op'ing — this runs from one explicit admin click and must
--    not report false success.
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

  -- email_change: see 20260902040000_fix_import_employee_credentials_email_change.sql
  -- — no table-level DEFAULT '' on auth.users, so it MUST be set explicitly or
  -- every login 500s. Included from this function's first version.
  EXECUTE $q$
    INSERT INTO auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       email_change,
       created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, $3, now(),
       jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
       '{}'::jsonb,
       '',
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

-- ---------------------------------------------------------------------------
-- 3. set_client_contact_status — mirrors set_vendor_account_status exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_client_contact_status(p_auth_user_id uuid, p_status_aktif boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  UPDATE public.client_contacts SET status_aktif = p_status_aktif WHERE auth_user_id = p_auth_user_id;
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'UPDATE auth.users SET banned_until = $1 WHERE id = $2'
    USING (CASE WHEN p_status_aktif THEN NULL ELSE 'infinity'::timestamptz END), p_auth_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_client_contact_status(uuid, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_contact_status(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. admin_reset_client_contact_password — admin/AM sets a new temp password
--    (spec §3.3 jalur 1). Returns true if the contact exists, false otherwise
--    (caller maps false to `[kontak tidak ditemukan]`). Hash generated in the
--    application (bcryptjs, cost 10 — same as every other provisioning path),
--    never in SQL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_client_contact_password(
  p_auth_user_id uuid,
  p_bcrypt_hash  text,
  p_actor        text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_exists boolean;
BEGIN
  SELECT true INTO v_exists FROM public.client_contacts WHERE auth_user_id = p_auth_user_id;
  IF v_exists IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.client_contacts
     SET must_change_password = true
   WHERE auth_user_id = p_auth_user_id;

  IF to_regclass('auth.users') IS NULL THEN
    RETURN true;
  END IF;

  EXECUTE 'UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2'
    USING p_bcrypt_hash, p_auth_user_id;

  -- Old sessions must die: without this, a stolen refresh token survives an
  -- admin-forced reset (identical reasoning to admin_set_employee_password §4).
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING p_auth_user_id::text;
  END IF;

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_reset_client_contact_password(uuid, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_client_contact_password(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. clear_client_contact_must_change_password — mirrors
--    clear_must_change_password. Called after a SUCCESSFUL GoTrue password
--    change (self-service change-password, or self-service email-reset
--    completion) — never before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_client_contact_must_change_password(p_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  UPDATE public.client_contacts
     SET must_change_password = false,
         password_changed_at  = now()
   WHERE auth_user_id = p_auth_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_client_contact_must_change_password(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_client_contact_must_change_password(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. client_contact_auth_user_by_email — privileged lookup used ONLY by the
--    self-service "lupa password" request route (spec §3.3 jalur 2) to decide
--    whether to actually call GoTrue's recover endpoint. Returns the
--    auth_user_id for an ACTIVE client_contacts row matching the email
--    (case-insensitive), or NULL. Deliberately does NOT distinguish "no such
--    email" from "email belongs to an employee/vendor, not a client contact"
--    — both cases return NULL, so a non-portal email never triggers GoTrue's
--    recover call, which is what keeps this realm boundary from leaking a
--    reset email to an employee/vendor account (spec §5.3 non-disclosure:
--    the HTTP response is identical either way, only this function's return
--    value decides whether an email actually goes out).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_contact_auth_user_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_uid uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE $q$
    SELECT cc.auth_user_id
    FROM public.client_contacts cc
    JOIN auth.users u ON u.id = cc.auth_user_id
    WHERE cc.status_aktif AND lower(u.email) = lower($1)
    LIMIT 1
  $q$
  INTO v_uid
  USING p_email;
  RETURN v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.client_contact_auth_user_by_email(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_contact_auth_user_by_email(text) TO service_role;
