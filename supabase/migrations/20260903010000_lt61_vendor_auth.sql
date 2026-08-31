-- ============================================================================
-- LT-61 (M16 §Fase 5b) — Live Stream vendor self-login: CDPS's first non-HRIS
-- auth realm. Spec: docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md
-- (owner decisions 2026-08-30, DECISIONS.md O63 resolved same date).
--
-- DESIGN: a vendor Actor reuses the SAME `permission.Actor` shape as an
-- employee (packages/core/src/permission.ts), with `employeeId = vendors.id`
-- (e.g. "VND-202608-0001" — non-empty, human-legible, guaranteed disjoint from
-- HRIS employee ids by prefix, satisfies sm_transition/audit_log's non-empty
-- actor requirement with ZERO schema change to audit_log) and an all-empty
-- `role`. Every existing gate keyed on `role.division`/`role.director`/
-- `role.od`/`jwt_division()`/etc. therefore evaluates false for a vendor token
-- automatically — this migration opens NOTHING beyond:
--   (a) the two narrow write edges a vendor Actor may now reach directly
--       (createSession, confirmByVendor, logResults —
--       packages/domain/src/livestream.ts; reconcile/flagDiscrepancy stay
--       AM/Director-only, unreachable by construction), and
--   (b) the matching read policy below (a vendor sees only its own Sessions).
--
-- WHAT'S BUILT
--   1. vendor_accounts — links one Supabase Auth user to one `vendors` row.
--      "Internal murni" table (RLS on, zero policy, zero grant beyond
--      SECURITY DEFINER functions) — same lock-down class as
--      employee_credentials/role_mappings. Provisioned by manual insert
--      (spec §7 Q4: an admin UI is out of scope — vendor count is tiny).
--   2. live_stream_sessions.vendor_id — stamped ONCE at Session creation
--      (packages/domain/src/livestream.ts resolveLiveVendorId: the client's
--      Aktif Strategi's `live` pillar vendor), never written by any UPDATE
--      path. A client is assumed to have at most one live-stream vendor at a
--      time — documented, known limitation (spec §2), not solved here.
--   3. vendor_claims(uuid) + a second branch in custom_access_token_hook —
--      mirrors employee_claims/the employee branch exactly in shape, but
--      resolves against vendor_accounts and injects ONLY `vendor_id` (never
--      employee_id/division/level/od/director). The employee branch is
--      untouched — same body, same order, still tried first.
--   4. jwt_vendor_id() RLS helper + live_stream_sessions_select amended
--      (read-side RLS; writes still go through db() service-role + the TS
--      gate per DECISIONS O37, unchanged).
--
-- Session expiry: same GoTrue project default as employees — owner decision
-- 2026-08-30 ("vendor stays logged in all day, same as a normal workday
-- session"). No new mechanism, no per-realm TTL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. vendor_accounts. Internal murni (§5 rls_baseline pattern): RLS on, no
--    policy, no grant beyond SECURITY DEFINER reads — direct SELECT/INSERT by
--    `authenticated`/`anon` is never needed or wanted.
-- ---------------------------------------------------------------------------
CREATE TABLE vendor_accounts (
    auth_user_id uuid         NOT NULL PRIMARY KEY,
    vendor_id    varchar(32)  NOT NULL,
    status_aktif boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,
    CONSTRAINT fk_vendoracc_vendor FOREIGN KEY (vendor_id) REFERENCES vendors (id)
);
CREATE INDEX idx_vendor_accounts_vendor ON vendor_accounts (vendor_id);

ALTER TABLE vendor_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vendor_accounts FROM anon, authenticated;

-- FK to auth.users only where the schema exists (Supabase) — portable to a
-- bare-Postgres CI stack, same guard as employees.auth_user_id (20260723071013).
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_accounts_auth_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE public.vendor_accounts
             ADD CONSTRAINT vendor_accounts_auth_user_id_fkey
             FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. live_stream_sessions.vendor_id — stamped once at creation, never updated.
-- ---------------------------------------------------------------------------
ALTER TABLE live_stream_sessions ADD COLUMN vendor_id varchar(32) NULL
  REFERENCES vendors (id);
CREATE INDEX idx_lss_vendor ON live_stream_sessions (vendor_id) WHERE vendor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. vendor_claims resolver (mirrors employee_claims, 20260723071013 §2) +
--    custom_access_token_hook vendor branch (mirrors §3 exactly; the employee
--    branch's body/order is untouched — regression-safe by construction).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_claims(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT jsonb_build_object('vendor_id', va.vendor_id)
  FROM public.vendor_accounts va
  WHERE va.auth_user_id = p_auth_user_id AND va.status_aktif;
$$;
REVOKE EXECUTE ON FUNCTION public.vendor_claims(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  claims jsonb;
  meta jsonb;
  v_employee_id text;
  v_vendor_claims jsonb;
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
    END IF;
  END IF;

  RETURN event;
END;
$$;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. jwt_vendor_id() RLS helper (mirrors jwt_division() shape,
--    20260723064438 §1) + live_stream_sessions_select amended (§7 pattern:
--    DROP + CREATE POLICY, same as 20260807160000_o48_grup_b_assets_lead_arm).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_vendor_id() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT auth.jwt() -> 'app_metadata' ->> 'vendor_id' $$;

DROP POLICY IF EXISTS live_stream_sessions_select ON public.live_stream_sessions;
CREATE POLICY live_stream_sessions_select ON public.live_stream_sessions FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id()
       OR (vendor_id IS NOT NULL AND vendor_id = jwt_vendor_id()));
