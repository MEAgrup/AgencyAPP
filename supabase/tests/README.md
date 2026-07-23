# supabase/tests — DB invariant checks

Plain-SQL assertion scripts run by CI (`.github/workflows/ci.yml`, job
`db-and-migrations`) against a stock **Postgres 17** container after all
`supabase/migrations` are applied. Each script runs with `psql -v ON_ERROR_STOP=1`;
a failed `ASSERT`/`RAISE` fails the job.

| Script | House rule | What it proves |
|---|---|---|
| `ident_checks.sql` | #1 IDs `PREFIX-YYYYMM-NNNN` | `ident_next` is gap-free per `(prefix, WIB period)`; `wib_period` buckets in WIB (incl. month rollover) |
| `immutability_checks.sql` | #3 immutable history | `forbid_mutation()` blocks UPDATE/DELETE on `audit_log`; blocks DELETE on `notifications` while allowing the `read_at` mark; snapshot guards installed |
| `rls_checks.sql` | #6 permissions | RLS policies enforce the `permission.ts` predicate at the row level: owner/division/OD/Director read scope, default-deny on empty claims, and internal tables locked to `authenticated` |

## Why plain SQL and not pgTAP (yet)

These assertions run against a stock Postgres 17 container and avoid coupling CI
to a `config.toml` / Supabase CLI version. RLS is exercised without the full
Supabase stack via a **portability shim** in `20260102000003_rls_baseline.sql`:
on a plain Postgres it creates the `anon`/`authenticated`/`service_role` roles
and a compatible `auth.jwt()` (reading `request.jwt.claims`) only if absent, so
`rls_checks.sql` can `SET ROLE authenticated` + inject claims and see the exact
policies that run under Supabase Auth. On real Supabase every shim branch is a
no-op (the roles and `auth.jwt()` already exist).

A later graduation to `supabase start` + **pgTAP** via `supabase test db`, plus
the Alpha Digital end-to-end suite, is still worthwhile — see
`docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §G — but is no longer required to gate
RLS.

## Running locally

```sh
# against any reachable Postgres 17 with the migrations already applied:
psql -v ON_ERROR_STOP=1 -f supabase/tests/ident_checks.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/immutability_checks.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_checks.sql
```
