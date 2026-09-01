-- ============================================================================
-- M15-C2 follow-up — login rate limiting (spec §5.2, OQ-5: 10 attempts per
-- IP per 15 minutes). Owner decision 2026-08-31 (DECISIONS.md, closing O64):
-- applied UNIFORMLY to `POST /auth/login`, which is ONE shared endpoint
-- across all three CDPS auth realms (employee, LT-61 vendor, M15-C2
-- client-contact) — the spec's own number was written for the Client Portal
-- specifically, but the endpoint branches by resolved Actor only AFTER
-- GoTrue authenticates, too late to gate repeated bad-password attempts
-- per-realm. A uniform ceiling only ADDS protection for employee/vendor
-- logins (GoTrue's own baseline still applies underneath); it never
-- restricts a legitimate human logging in ten times in fifteen minutes.
--
-- DB-backed, not in-memory: `apps/api` runs as Vercel serverless functions,
-- where an in-process counter would not reliably survive between
-- invocations (each request can land on a different execution context).
--
-- WHAT'S BUILT — one table, one SECURITY DEFINER function, zero change to
-- existing tables:
--   1. login_rate_limit_attempts — one row per checked login attempt, per IP.
--      "Internal murni" (RLS on, zero policy, zero grant beyond the function
--      below) — same lock-down class as employee_credentials/vendor_accounts.
--   2. check_login_rate_limit(ip, max_attempts, window_minutes) — atomically
--      (a) deletes that IP's rows older than the window (bounds table growth
--      without a separate cron job — cheap since it's scoped to one IP),
--      (b) counts the IP's remaining rows, (c) if under the ceiling, records
--      this attempt and returns true; otherwise returns false WITHOUT
--      recording (a blocked attempt doesn't itself consume budget, so the
--      window clears on schedule rather than being extended by the very
--      requests it's blocking).
--
-- RECONCILIATION NOTE (2026-09-01): this file did not exist in the repo even
-- though the table+function were already live on CDPS SG (applied directly,
-- version 20260831180358) — reconstructed verbatim from
-- `supabase_migrations.schema_migrations.statements` so `db-rebuild.sh` and
-- any future `supabase db push` stay honest against production. NOT wired
-- into `apps/api` yet: `POST /auth/login` does not call
-- `check_login_rate_limit` — the DB half shipped, the TS half did not. See
-- docs/DECISIONS.md for the open item.
-- ============================================================================

CREATE TABLE login_rate_limit_attempts (
    id           bigserial    PRIMARY KEY,
    ip_address   text         NOT NULL,
    attempted_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_rate_limit_ip_time ON login_rate_limit_attempts (ip_address, attempted_at);

ALTER TABLE login_rate_limit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON login_rate_limit_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_login_rate_limit(
  p_ip_address      text,
  p_max_attempts    int,
  p_window_minutes  int
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_count int;
BEGIN
  DELETE FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address
     AND attempted_at < now() - make_interval(mins => p_window_minutes);

  SELECT count(*) INTO v_count
    FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address;

  IF v_count >= p_max_attempts THEN
    RETURN false;
  END IF;

  INSERT INTO public.login_rate_limit_attempts (ip_address) VALUES (p_ip_address);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_login_rate_limit(text, int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit(text, int, int) TO service_role;
