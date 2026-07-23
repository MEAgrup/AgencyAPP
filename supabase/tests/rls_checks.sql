-- Fase-1 DB invariant check: Row Level Security (plain psql; run with -v ON_ERROR_STOP=1).
--
-- Verifies that the RLS policies in 20260102000003_rls_baseline.sql enforce the
-- SAME predicate as packages/core/src/permission.ts (the two implementations must
-- never diverge — Tech Appendix §B.4/§D). Exercised by switching to the real
-- `authenticated` Postgres role and injecting JWT claims via the GUC that the
-- portable `auth.jwt()` shim reads (`request.jwt.claims`), so the policies run
-- exactly as they will under Supabase Auth.
--
-- Runs in a transaction and ROLLBACKs — leaves no rows behind. Seed-independent
-- (inserts its own fixture with a unique id, isolated by `WHERE id = ...`).
--
-- See ident_checks.sql for why these are plain-SQL (not pgTAP) at this stage.

BEGIN;

-- Fixture inserted as the owning superuser (RLS does not apply here): one demo
-- task owned by EMP-RLS-OWNER in division 'Sales'.
INSERT INTO demo_tasks (id, title, division, status, created_at, created_by)
VALUES ('RLS-TEST-0001', 'rls fixture', 'Sales', 'To Do', now(), 'EMP-RLS-OWNER');

-- Drop to the RLS-bearing role for the remainder of the transaction.
SET LOCAL ROLE authenticated;

-- Helper: assert how many fixture rows are visible under a given claim set.
-- (Inline DO blocks run as `authenticated` → RLS applies; auth.jwt() reads the
--  claims GUC set immediately before each.)

-- 1. Owner staff sees own row.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OWNER","division":"Sales","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: owner staff must see own row'; END IF;
END $$;

-- 2. A different staff (not owner, different division) sees nothing.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OTHER","division":"Ops","level":"staff"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: unrelated staff must see nothing'; END IF;
END $$;

-- 3. Lead of the row's division sees it (division-wide read).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-LEAD","division":"Sales","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: same-division lead must see the row'; END IF;
END $$;

-- 4. Lead of a DIFFERENT division does not.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-LEAD2","division":"Ops","level":"lead"}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: other-division lead must NOT see the row'; END IF;
END $$;

-- 5. Director reads everything (layered full-access).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: director must read all'; END IF;
END $$;

-- 6. OD reads everything (read-only-everywhere).
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-OD","od":true}}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 1
  THEN RAISE EXCEPTION 'RLS demo_tasks: OD must read all'; END IF;
END $$;

-- 7. No/empty claims → default deny.
SELECT set_config('request.jwt.claims', '{}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM demo_tasks WHERE id='RLS-TEST-0001') <> 0
  THEN RAISE EXCEPTION 'RLS demo_tasks: empty claims must see nothing'; END IF;
END $$;

-- 8. Master Service List is a shared catalogue — any authenticated user reads it
--    (policy USING (true)); assert the policy path is reachable without error.
DO $$ BEGIN
  PERFORM count(*) FROM master_services;
END $$;

-- 9. Internal tables are locked to `authenticated` entirely (no grant, no policy):
--    even a director claim cannot read sessions / employee_credentials.
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"EMP-RLS-DIR","director":true}}', true);
DO $$
DECLARE t text; denied boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','employee_credentials','id_sequences','sm_edges'] LOOP
    denied := false;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'internal table % must be denied to authenticated', t;
    END IF;
  END LOOP;
END $$;

RESET ROLE;
ROLLBACK;

\echo 'rls_checks: PASS'
