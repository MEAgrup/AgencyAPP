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
- **bi** (`bi.ts`) — house-wide BI core constants (`INCOMPLETE_DATA`,
  `TRANSITION_NOT_ALLOWED`, `TRANSITION_ROLE_DENIED`) + `[...]` invariant helpers
  (`isBracketed`/`bracket`). Module-specific strings port with their module, not here. 13 tests.
- **ident** (`ident.ts`) — prefix registry (`PREFIXES`, single TS source) +
  pure `format`/`parse`/`isValid` ID helpers + `nextId` wrapper over the atomic
  SQL `ident_next`. Sequence allocation stays in Postgres (gap-free/rollback-safe). 13 tests.
- **statemachine** (`statemachine.ts`) — `transition` wrapper over the SQL
  `sm_transition` (14 machines seeded in migration `…_statemachine.sql`). Derives the
  role booleans from a `permission.Actor` exactly as Go; returns the structured
  `{ok,code,message}` result. Enforcement (lock/edge/role/UPDATE/audit) is in SQL. 5 tests.
- **audit** (`audit.ts`) — append-only `write` (NoActorError guard) over an executor;
  immutability enforced by the `forbid_mutation` triggers. `hasSecretKey` helper for the
  "no password/hash in payload" rule. 6 tests.
- **notification** (`notification.ts`) — the 15 FROZEN events (`EVENTS`/`CATALOG`) +
  `emit` wrapper over the SQL `notify_emit`. 8 tests.

## Companion SQL

The atomic/concurrency-sensitive parts live in Postgres, called by the wrappers above:
`ident_next` (migration `…_ident_next.sql`), `sm_transition` + `notify_emit` +
`sm_machines`/`sm_edges`/`notif_events` seed (migration `…_statemachine.sql`). Concrete
executors that call them are in `@cdps/db`.

## Run tests

```
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Implements house rules per CLAUDE.md. See `docs/SUPABASE_MIGRATION_PLAN.md` §3 for
house-rule mappings and `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §B for the engine checklist.
