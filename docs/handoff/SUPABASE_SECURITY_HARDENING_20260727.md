# 🔒 Supabase security advisor remediation — CDPS SG (2026-07-27)

_Project: **CDPS SG** (`egddxfcnrtecheiykhlf`). Applied live via MCP
`apply_migration`; recorded in the remote migration history as version
**`20260727072443_harden_secdef_helpers_to_private_schema`**._

## What was flagged (before)

`get_advisors(security)` reported, at **WARN**:

- **4× `authenticated_security_definer_function_executable` (lint 0029):**
  `public.employee_display_name`, `public.jwt_owns_client`,
  `public.jwt_owns_lead`, `public.jwt_owns_transaction` were `SECURITY DEFINER`
  **and** callable by the `authenticated` role via `/rest/v1/rpc/<fn>`.
- **1× `auth_leaked_password_protection`** — HaveIBeenPwned check disabled.

At **INFO**: 9× `rls_enabled_no_policy` (see §"Left as-is").

## Fix applied (the 4 SECURITY DEFINER functions)

These four are **legitimate RLS helpers**: `jwt_owns_{client,lead,transaction}`
are referenced by **12 `authenticated` SELECT policies** (ad_campaigns,
client_health_snapshots, client_platforms, client_sales_allocations, complaints,
dependencies, installments, leads, prospect_attempts, qualified_forms, services,
transactions); they are `SECURITY DEFINER` on purpose (they read tables the
caller can't). So revoking EXECUTE would break RLS.

Chosen remediation = advisor option **"move it out of your exposed API schema"**.
`apps/api` connects as a privileged/service role via the pooler (RLS is a read
safety-net; it does **not** use the `authenticated` PostgREST path), so this is
transparent to the app.

```sql
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- SET SCHEMA preserves each function OID → the 12 RLS policies follow
-- automatically, no policy rewrite needed.
alter function public.employee_display_name(text) set schema private;
alter function public.jwt_owns_client(text)       set schema private;
alter function public.jwt_owns_lead(text)         set schema private;
alter function public.jwt_owns_transaction(text)  set schema private;

-- jwt_owns_transaction's body called public.jwt_owns_client explicitly → repoint
-- to the relocated fn (CREATE OR REPLACE keeps the OID, policies stay bound).
create or replace function private.jwt_owns_transaction(p_txn_id text)
returns boolean language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select exists (
    select 1 from public.transactions t
    where t.id = p_txn_id
      and (t.created_by = public.jwt_employee_id() or private.jwt_owns_client(t.client_id))
  )
$$;

revoke execute on function
  private.employee_display_name(text), private.jwt_owns_client(text),
  private.jwt_owns_lead(text), private.jwt_owns_transaction(text)
from anon;
```

`private` is **not** in PostgREST's exposed-schema list, so there is no longer a
`/rest/v1/rpc/*` path to these functions. The claim-reader helpers
(`jwt_employee_id`, `jwt_can_read_all`, `jwt_is_lead`, `jwt_division`) are
`SECURITY INVOKER` and were **not** flagged — they stay in `public`.

## Verification (post-apply)

- `get_advisors(security)` → the **4 WARN are gone**. Only the auth toggle WARN +
  9 INFO remain.
- Functions confirmed relocated to `private`; **12** policies still reference the
  (now-private) helpers.
- RLS smoke as `SET LOCAL ROLE authenticated` (rolled back): `private.jwt_owns_lead()`
  is callable and `SELECT … FROM public.leads` evaluates its policy **without
  error** → RLS behaviour intact.

## Left as-is (intentional)

- **9× `rls_enabled_no_policy` (INFO)** — `employee_credentials`,
  `employee_layered_roles`, `id_sequences`, `notif_events`, `role_mappings`,
  `sessions`, `sm_edges`, `sm_machines`, `sm_terminal_states`. RLS ON + no policy
  = **deny-all** to `anon`/`authenticated`. That is the desired fail-closed
  posture: these are service-role-only tables reached exclusively through
  `apps/api`'s privileged connection. No permissive policy should be added.

## Still open — needs a dashboard toggle (not doable via SQL/MCP)

- **`auth_leaked_password_protection` (WARN)** — enable in
  **Dashboard → Authentication → Policies / Password protection** ("Leaked
  password protection" / HaveIBeenPwned). Recommended ON before QA of the auth
  flow. Ref: https://supabase.com/docs/guides/auth/password-security

## ⚠️ Repo ↔ remote migration drift (pre-existing, for the team)

`supabase/migrations/` in the repo ends at `20260102000004_supabase_auth.sql`,
but the **remote** has 4 further migrations that were never committed:
`rls_harden_execute_surface`, `fk_covering_indexes`, `employee_display_name`,
`change_password` — **plus** this hardening. The SQL above was therefore **not**
added as a standalone repo migration (it would fail a fresh `db reset`, since the
functions it moves are created by the un-committed `employee_display_name` /
`rls_baseline` migrations). Action for the team: backfill those 4 remote
migrations into the repo, then append this hardening as the 5th so the repo chain
matches remote again.
