# @cdps/core

Shared TypeScript core engines for CDPS, ported from Go `backend/internal/core/`
(SUPABASE_MIGRATION_TECH_APPENDIX §B). The mapping principle: **pure
computation/format/validation** lives here as TypeScript; anything that must be
**atomic with a single row/transaction** (ID allocation, status transition write,
immutability, `updated_at`) is a Postgres function/trigger in `supabase/migrations/`
that this layer's decisions feed into — it is not reimplemented in TypeScript.

## Engines (Fase 0, ported)

| Engine | Ported (pure, here) | Atomic part (SQL, elsewhere) |
| --- | --- | --- |
| `money` | minor-unit `bigint` math, `parse`/`decimal`/`format` (`Rp. X.XXX.XXX,00`), `percentOf`/`mul` (round-half-up, int64 overflow guard) | — |
| `tz` | WIB (`+07:00`, no DST) `date`/`dateString`/`period`/`daysBetween` | `wib_date`/`wib_period` in migrations |
| `permission` | role matrix predicates (`isLead`, `canWrite`, `canReadDivision`, …) | RLS policies re-check the same predicates from the JWT claim |
| `biMessages` | single source of Bahasa Indonesia `[...]` messages | — |
| `statemachine` | machine config (14 machines) + `evaluate` allow/block/role decision | `sm_transition` (lock + UPDATE + audit + emit) |
| `notification` | frozen 15-event catalog + recipient de-dup/actor-exclusion | resolvers (`leadsOfDivision`) + `INSERT` inside `sm_transition` |
| `ident` | `PREFIX-YYYYMM-NNNN` `formatId`/`parseId` + WIB period | `ident_next()` (gap-free upsert allocation) |
| `audit` | append-only entry builder + mandatory-actor + no-secret guard | `forbid_mutation()` triggers + `REVOKE UPDATE/DELETE` |

`importer` is not yet ported (Fase 1, §F.1).

## House rules preserved

Status is only ever set through the transition path; IDs issue only after
validation passes; derived fields are computed and recomputable; every BI `[...]`
message comes from `bi-messages.ts` (no duplicated string that can diverge).

## Develop

```sh
npm install
npm test         # vitest — mirrors the Go *_test.go suites
npm run typecheck
```

The vitest suites are the TypeScript mirror of the Go engine tests. In CI (§G) the
DB-backed halves (`sm_transition`, `ident_next`, immutability triggers, RLS) are
verified separately by pgTAP against a real `supabase start` Postgres.

See `docs/SUPABASE_MIGRATION_PLAN.md` §3 for house-rule mappings and
`docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §B for the per-engine port checklist.
