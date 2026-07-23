-- ============================================================================
-- Wave 1 EXIT — PILOT SEED (staging/UAT only). NOT auto-run by `supabase db reset`.
-- ============================================================================
-- Provisions the 8 pilot login accounts the Wave 1 exit UAT needs (one per role in
-- WAVE1_EXIT_UAT_RUNBOOK.md), on top of supabase/seed.sql (Alpha Digital fixture).
-- It:
--   1. adds the 3 pilot employees the base fixture lacks (Account Lead, Finance
--      Head, OD) — the other 5 roles already exist as EMP-0001/0002/0006/0007/0008;
--   2. layers the OD role;
--   3. writes employee_credentials (bcrypt via pgcrypto) for all 8 pilots;
--   4. calls import_employee_credentials() → creates the GoTrue auth.users +
--      auth.identities and links employees.auth_user_id (Supabase only; skipped on a
--      plain Postgres so this file still validates locally).
--
-- Idempotent (upserts / ON CONFLICT / import skips already-provisioned rows).
--
-- ⚠ SECRET: the shared pilot password is supplied at RUN TIME, never committed:
--     psql "$STAGING_DATABASE_URL" -v pilot_pw="$PILOT_PW" -f supabase/uat/pilot_seed.sql
--   Use a throwaway staging password. Real credentials never live in this repo.
--   Prereq: run supabase/migrations/*.sql then supabase/seed.sql first.
-- ============================================================================

\set ON_ERROR_STOP on

-- Fail fast if the password var was not passed (psql client-side var).
\if :{?pilot_pw}
\else
  \warn 'pilot_pw not set — run with: psql ... -v pilot_pw="<password>" -f pilot_seed.sql'
  \quit
\endif

-- pgcrypto provides crypt()/gen_salt('bf') → bcrypt, the hash GoTrue expects.
-- Supabase pre-enables it (schema `extensions`); this is a no-op there.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) Pilot employees missing from the base fixture (Account Lead, Finance Head, OD).
--    (jabatan values match existing role_mappings in seed.sql: Account Lead→Account/
--    lead, Finance Head→Finance/lead. OD carries no mapping — od is read-all.)
-- ----------------------------------------------------------------------------
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
    ('EMP-0011', 'Pilot Finance Head', 'financehead@mea.co.id', 'Finance',    'Finance Head',             true, 'SYSTEM'),
    ('EMP-0012', 'Pilot Account Lead', 'accountlead@mea.co.id',  'Account',    'Account Lead',             true, 'SYSTEM'),
    ('EMP-0013', 'Pilot OD',           'od@mea.co.id',           'Management', 'Organizational Development', true, 'SYSTEM')
ON CONFLICT (employee_id) DO UPDATE SET
    nama = EXCLUDED.nama, email = EXCLUDED.email, divisi = EXCLUDED.divisi,
    jabatan = EXCLUDED.jabatan, status_aktif = EXCLUDED.status_aktif;

-- 2) Layer the OD role (read-only everywhere).
INSERT INTO employee_layered_roles (employee_id, role, enabled, created_by) VALUES
    ('EMP-0013', 'od', true, 'SYSTEM')
ON CONFLICT (employee_id, role) DO UPDATE SET enabled = true;

-- ----------------------------------------------------------------------------
-- 3) Credentials for all 8 pilots. password_hash = bcrypt(:pilot_pw). GoTrue reuses
--    this same hash as auth.users.encrypted_password (import step). must_change_password
--    = false so pilots are not forced through a reset during UAT.
-- ----------------------------------------------------------------------------
INSERT INTO employee_credentials (employee_id, password_hash, must_change_password, created_by)
SELECT eid, crypt(:'pilot_pw', gen_salt('bf')), false, 'SYSTEM'
FROM (VALUES
    ('EMP-0001'),  -- Sales Staff   (Budi)
    ('EMP-0006'),  -- Sales Head    (Dewi)
    ('EMP-0002'),  -- Account Staff (Sinta)
    ('EMP-0012'),  -- Account Lead  (pilot)
    ('EMP-0007'),  -- Finance Staff (Fajar)
    ('EMP-0011'),  -- Finance Head  (pilot)
    ('EMP-0013'),  -- OD            (pilot)
    ('EMP-0008')   -- Director      (Yohan)
) AS t(eid)
ON CONFLICT (employee_id) DO UPDATE SET
    password_hash = EXCLUDED.password_hash, must_change_password = false;

-- ----------------------------------------------------------------------------
-- 4) Provision GoTrue logins (Supabase only). On a plain Postgres (no auth.users)
--    this is skipped so the file still applies cleanly for local validation.
-- ----------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users absent — skipping GoTrue provisioning (plain Postgres).';
  ELSE
    n := public.import_employee_credentials();
    RAISE NOTICE 'import_employee_credentials(): % new GoTrue user(s) provisioned.', n;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Report: the pilot roster (employee → resolved CDPS claims).
-- ----------------------------------------------------------------------------
SELECT e.employee_id, e.email, e.divisi, e.jabatan,
       public.employee_claims(e.employee_id) AS cdps_claims,
       (c.employee_id IS NOT NULL) AS has_credential
FROM employees e
LEFT JOIN employee_credentials c ON c.employee_id = e.employee_id
WHERE e.employee_id IN ('EMP-0001','EMP-0006','EMP-0002','EMP-0012','EMP-0007','EMP-0011','EMP-0013','EMP-0008')
ORDER BY e.employee_id;
