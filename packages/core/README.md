# @cdps/core

Shared TypeScript core engines for CDPS (ported 1:1 from Go `backend/internal/core/`).
Each engine mirrors its Go counterpart's behaviour and test cases (vitest ports of the
Go `*_test.go` files) so the two stacks never diverge during the strangler migration.

## Ported ✅ (pure engines — no DB, unit-tested)

- **money** (`money.ts`) — IDR money type as `bigint` minor units; `parse`/`decimal`/`format`
  (`Rp. X.XXX.XXX,00`) + exact round-half-up `percentOf`/`mul`. No float ever. 40 tests.
- **tz** (`tz.ts`) — WIB (fixed UTC+7, no DST) calendar bucketing: `date`/`dateString`/
  `period`/`daysBetween`. Offset defined once (`WIB_OFFSET_HOURS`), must match SQL
  `wib_date`/`wib_period`. 6 tests.
- **permission** (`permission.ts`) — role matrix predicates (`isLead`/`canWrite`/
  `canManageAdmin`/`canReadDivision`/`canReadAll`) incl. layered OD/Director. 7 tests.

## Pending (need DB / SQL side)

- **statemachine** — SQL `sm_transition` (migration) + thin TS wrapper.
- **ident** — SQL `ident_next` (migration) + thin TS wrapper.
- **audit** — append-only writer (trigger `forbid_mutation` in migration) + TS insert helper.
- **notification** — 15 FROZEN events + recipient resolvers.
- **bi** — Bahasa Indonesia `[...]` message catalog (collect from DECISIONS + Go).

## Run tests

```
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Implements house rules per CLAUDE.md. See `docs/SUPABASE_MIGRATION_PLAN.md` §3 for
house-rule mappings and `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §B for the engine checklist.
