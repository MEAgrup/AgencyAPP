-- ============================================================================
-- M15-C2 (Client Portal) — CDPS's THIRD non-HRIS Supabase Auth realm, after the
-- employee-local realm and the LT-61 vendor realm. Spec:
-- docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md (RESOLVED 2026-08-31 — O4/O5 closed,
-- DECISIONS.md same date). §3 of that spec explicitly says: revise the auth
-- design to mirror LT-61 (supabase/migrations/20260903010000_lt61_vendor_auth.sql)
-- rather than the retired `backend/internal/auth/local.go`. This migration is
-- that mirror.
--
-- DESIGN (identical shape to LT-61, §3.1/§4.1 of the spec resolves the one real
-- difference — see below):
--   - A client-contact Actor reuses the SAME `permission.Actor` shape as an
--     employee/vendor, with `employeeId = client_contacts.auth_user_id` (the
--     uuid, stringified — client contacts have no ID-prefix registry entry per
--     the spec §3.1, unlike vendors' `VND-` prefix; a uuid is still non-empty,
--     unique per contact, and guaranteed disjoint from HRIS ids, which is all
--     sm_transition/audit_log require of an actor id) and an all-empty `role`.
--     Every gate keyed on `role.division`/`role.director`/`role.od`/`isLead`
--     therefore evaluates false automatically, same as a vendor Actor.
--   - UNLIKE vendor_accounts (one login per `vendors` row, enforced by a
--     partial unique index), `client_contacts` is deliberately MULTI-ROW per
--     Client — M15 Rule 1 confirms multi-contact access, and the spec's OQ-1
--     resolution (§3.1) fixes the OTHER direction: one contact belongs to
--     exactly one Client, `client_id` a plain FK, never a junction table. So
--     no per-Client uniqueness constraint is added here.
--   - UNLIKE vendor_accounts, `client_contacts` gets `must_change_password`
--     (spec §3.2/§3.6 mirrors the employee force-change gate) — vendor
--     accounts never had this, and it is added properly here rather than
--     copied from a realm that lacks it.
--   - Session TTL: spec §3.5 resolves a CUSTOM 4-hour idle timeout for this
--     realm (unlike vendor's "same as employee, GoTrue project default all
--     day") — that is enforced at the `web-client-portal` app layer (activity
--     tracking), NOT here; nothing in this migration changes GoTrue's project-
--     wide token TTL, which would also shorten the employee/vendor realms.
--
-- WHAT'S BUILT
--   1. client_contacts — links one Supabase Auth user to one Client, with its
--      own force-change gate. "Internal murni" (RLS on, zero policy, zero
--      grant beyond SECURITY DEFINER functions) — same lock-down class as
--      employee_credentials/vendor_accounts.
--   2. client_contact_claims(uuid) + a THIRD branch in
--      custom_access_token_hook — mirrors employee_claims/vendor_claims
--      exactly in shape (fresh SQL read at token-mint time, nothing baked into
--      raw_app_meta_data at provision time), resolving against client_contacts
--      and injecting ONLY `client_contact_id`/`client_id` (never
--      employee_id/vendor_id/division/level/od/director). The employee AND
--      vendor branches are untouched — same body, same order, both tried
--      first, regression-safe by construction.
--   3. jwt_client_contact_id() / jwt_client_id() RLS helpers (mirrors
--      jwt_vendor_id() shape) — foundation for the per-Client isolation RLS
--      policies the NEXT cluster (Service Progress / Health / complaint-form
--      read-models) will add. No policy references them yet: this migration
--      is the auth realm only, not a data surface.
--
-- Account lockout: DELIBERATELY NOT reimplemented here, matching the existing,
-- explicit house decision for the employee realm (packages/domain/src/auth.ts
-- header comment: "Lockout is deliberately NOT ported ... GoTrue owns login,
-- so it owns rate limiting ... a second, weaker lockout would only give a
-- false sense of coverage"). The Client Portal security spec's OQ-10 (§3.4)
-- was drafted before this was verified against the CURRENT stack and says
-- "reuse persis realm karyawan" — reused literally, that means GoTrue's own
-- login rate limiting, not a bespoke `failed_attempts`/`locked_until` pair
-- (which the employee realm does NOT have live in this stack either; the
-- `employee_credentials` columns of the same name are legacy pre-GoTrue
-- transit-table fields, unused for login since the Supabase Auth migration).
-- Corrected in DECISIONS.md alongside this migration. Defense-in-depth against
-- distributed credential stuffing is the app-level per-IP rate limit (spec
-- §5.2, OQ-5) — a different axis, built at the API route layer, not here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. client_contacts. Internal murni (§5 rls_baseline pattern, mirrors
--    vendor_accounts 20260903010000 §1): RLS on, no policy, no grant beyond
--    SECURITY DEFINER reads — direct SELECT/INSERT by `authenticated`/`anon`
--    is never needed or wanted.
-- ---------------------------------------------------------------------------
CREATE TABLE client_contacts (
    auth_user_id         uuid         NOT NULL PRIMARY KEY,
    client_id            varchar(32)  NOT NULL,
    nama                 varchar(191) NOT NULL,
    email                varchar(191) NOT NULL,
    status_aktif         boolean      NOT NULL DEFAULT true,
    must_change_password boolean      NOT NULL DEFAULT true,
    password_changed_at  timestamptz  NULL,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    created_by           varchar(64)  NOT NULL,
    CONSTRAINT fk_clientcontact_client FOREIGN KEY (client_id) REFERENCES clients (id)
);
CREATE INDEX idx_client_contacts_client ON client_contacts (client_id);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_contacts FROM anon, authenticated;

-- FK to auth.users only where the schema exists (Supabase) — portable to a
-- bare-Postgres CI stack, same guard as vendor_accounts.auth_user_id.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_contacts_auth_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE public.client_contacts
             ADD CONSTRAINT client_contacts_auth_user_id_fkey
             FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. client_contact_claims resolver (mirrors vendor_claims, 20260903010000
--    §3) + custom_access_token_hook THIRD branch (employee branch and vendor
--    branch untouched — same body, same order, both tried first).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_contact_claims(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT jsonb_build_object('client_contact_id', cc.auth_user_id::text, 'client_id', cc.client_id)
  FROM public.client_contacts cc
  WHERE cc.auth_user_id = p_auth_user_id AND cc.status_aktif;
$$;
REVOKE EXECUTE ON FUNCTION public.client_contact_claims(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  claims jsonb;
  meta jsonb;
  v_employee_id text;
  v_vendor_claims jsonb;
  v_client_claims jsonb;
BEGIN
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb);

  v_employee_id := meta ->> 'employee_id';
  IF v_employee_id IS NULL THEN
    SELECT e.employee_id INTO v_employee_id
    FROM public.employees e
    WHERE e.auth_user_id = (event ->> 'user_id')::uuid;
  END IF;

  IF v_employee_id IS NOT NULL THEN
    -- Merge klaim CDPS di ATAS app_metadata bawaan (provider/providers terjaga).
    meta   := meta || public.employee_claims(v_employee_id);
    claims := jsonb_set(claims, '{app_metadata}', meta);
    event  := jsonb_set(event, '{claims}', claims);
  ELSE
    -- LT-61: not an HRIS employee — try the vendor realm. vendor_claims returns
    -- NULL for an unmatched/inactive account, so an unresolved user gets no
    -- claims injected at all (same as before this branch existed).
    v_vendor_claims := public.vendor_claims((event ->> 'user_id')::uuid);
    IF v_vendor_claims IS NOT NULL THEN
      meta   := meta || v_vendor_claims;
      claims := jsonb_set(claims, '{app_metadata}', meta);
      event  := jsonb_set(event, '{claims}', claims);
    ELSE
      -- M15-C2: not a vendor either — try the client-contact realm (third and
      -- last). Same NULL-means-unresolved contract as the vendor branch.
      v_client_claims := public.client_contact_claims((event ->> 'user_id')::uuid);
      IF v_client_claims IS NOT NULL THEN
        meta   := meta || v_client_claims;
        claims := jsonb_set(claims, '{app_metadata}', meta);
        event  := jsonb_set(event, '{claims}', claims);
      END IF;
    END IF;
  END IF;

  RETURN event;
END;
$$;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. jwt_client_contact_id() / jwt_client_id() RLS helpers (mirror
--    jwt_vendor_id() shape, 20260903010000 §4). No policy references them
--    yet — this migration is the auth realm only; the Service Progress /
--    Health / complaint-form read-model cluster is the one that adds RLS
--    policies scoped by `jwt_client_id()`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_client_contact_id() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT auth.jwt() -> 'app_metadata' ->> 'client_contact_id' $$;

CREATE OR REPLACE FUNCTION public.jwt_client_id() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT auth.jwt() -> 'app_metadata' ->> 'client_id' $$;
