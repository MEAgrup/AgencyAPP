# supabase/tests — DB invariant checks

Plain-SQL assertion scripts run by CI (`.github/workflows/ci-supabase.yml`, job
`db`) against a stock **Postgres 17** container after all `supabase/migrations`
are applied. Each script runs with `psql -v ON_ERROR_STOP=1`; a failed `ASSERT`
raises and fails the job.

| Script | House rule | What it proves |
|---|---|---|
| `ident_checks.sql` | #1 IDs `PREFIX-YYYYMM-NNNN` | `ident_next` is gap-free per `(prefix, WIB period)`; `wib_period` buckets in WIB (incl. month rollover) |
| `immutability_checks.sql` | #3 immutable history | `forbid_mutation()` blocks UPDATE/DELETE on `audit_log`; blocks DELETE on `notifications` while allowing the `read_at` mark; snapshot guards installed |

## Why plain SQL and not pgTAP (yet)

At Fase 0 the migrations are pure Postgres — no RLS, no auth roles, no
Supabase-only objects — so a stock Postgres container is enough to verify them,
and plain `psql` assertions avoid coupling CI to a `config.toml` / Supabase CLI
version.

When **Fase 1** introduces RLS + Supabase Auth, CI's `db` job should graduate to
`supabase start` + **pgTAP** via `supabase test db` (so RLS policies and JWT
claims are exercised against the real local stack), and gain the Alpha Digital
end-to-end suite. See `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §G.

## Running locally

```sh
# against any reachable Postgres 17 with the migrations already applied:
psql -v ON_ERROR_STOP=1 -f supabase/tests/ident_checks.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/immutability_checks.sql
```
