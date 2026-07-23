-- Fase-1 DB invariant check: Supabase Auth custom claims (plain psql; -v ON_ERROR_STOP=1).
--
-- Verifies that the Access Token Hook resolver (`employee_claims` +
-- `custom_access_token_hook`) produces app_metadata claims IDENTICAL to
-- backend/internal/auth/actor.go `ResolveActor` — the source that RLS
-- (20260102000003) reads via `auth.jwt()->'app_metadata'`. If this drifts, RLS
-- silently mis-scopes every request, so it is gated in CI.
--
-- Depends on the Alpha Digital seed (applied before this script in CI):
--   EMP-0001 Sales/staff · EMP-0006 Sales/lead · EMP-0007 Finance/staff ·
--   EMP-0008/0009/0010 layered Director (no division/level mapping).
--
-- Runs read-only (no writes) — no transaction/rollback needed.

-- 1. employee_claims mirrors ResolveActor for each role shape.
DO $$
DECLARE c jsonb;
BEGIN
  c := public.employee_claims('EMP-0001');
  ASSERT c->>'division' = 'Sales' AND c->>'level' = 'staff'
     AND (c->>'od')::boolean = false AND (c->>'director')::boolean = false,
     format('EMP-0001 (Sales/staff) claims wrong: %s', c);

  c := public.employee_claims('EMP-0006');
  ASSERT c->>'division' = 'Sales' AND c->>'level' = 'lead',
     format('EMP-0006 (Sales/lead) claims wrong: %s', c);

  c := public.employee_claims('EMP-0007');
  ASSERT c->>'division' = 'Finance' AND c->>'level' = 'staff',
     format('EMP-0007 (Finance/staff) claims wrong: %s', c);

  -- Pure Director: no role_mapping ⇒ empty division/level (mirror Go), director=true.
  c := public.employee_claims('EMP-0008');
  ASSERT c->>'division' = '' AND c->>'level' = '' AND (c->>'director')::boolean = true,
     format('EMP-0008 (Director) claims wrong: %s', c);
END $$;

-- 2. custom_access_token_hook injects those claims under app_metadata, keeping
--    pre-existing app_metadata keys (provider/providers) intact.
DO $$
DECLARE ev jsonb; meta jsonb;
BEGIN
  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object(
             'app_metadata', jsonb_build_object('provider','email','employee_id','EMP-0006'))));
  meta := ev -> 'claims' -> 'app_metadata';
  ASSERT meta->>'employee_id' = 'EMP-0006'
     AND meta->>'division' = 'Sales' AND meta->>'level' = 'lead'
     AND meta->>'provider' = 'email',  -- bawaan app_metadata terjaga
     format('hook did not inject lead claims correctly: %s', meta);

  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object(
             'app_metadata', jsonb_build_object('employee_id','EMP-0008'))));
  meta := ev -> 'claims' -> 'app_metadata';
  ASSERT (meta->>'director')::boolean = true AND meta->>'division' = '',
     format('hook did not inject director claims correctly: %s', meta);
END $$;

-- 3. Unknown / unlinked employee ⇒ event returned unchanged (no injection).
DO $$
DECLARE ev jsonb;
BEGIN
  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object('app_metadata', jsonb_build_object('employee_id','EMP-NOPE'))));
  ASSERT (ev -> 'claims' -> 'app_metadata' ->> 'division') IS NULL,
     'hook must not inject claims for an unknown employee_id';
END $$;

\echo 'auth_claims_checks: PASS'
