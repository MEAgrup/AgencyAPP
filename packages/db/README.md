# @cdps/db

Postgres client + concrete `@cdps/core` executor implementations for CDPS, on
top of **postgres.js**. Drizzle-generated schema types will be added later.

## Exports

- **client** (`client.ts`) — `createClient(connectionString)` (Supabase pooler,
  `prepare:false`, port 6543) and `withTransaction(sql, fn)`. Build the executors
  from the transaction handle so ident/sm_transition/notify/audit share the entity
  write's atomicity (a rolled-back insert consumes no sequence number).
- **executors** (`executors.ts`) — `identExecutor` / `smExecutor` / `auditExecutor` /
  `notifyExecutor`, or `executors(sql)` for all four. Each calls its SQL function
  (`ident_next`, `sm_transition`, `notify_emit`) or the append-only `audit_log` insert.

## Tests

- `executors.test.ts` — unit tests with a fake tagged-template `sql` (no DB): verifies
  each executor calls the right function with the right values.
- `integration.test.ts` — real end-to-end against Postgres with the CDPS migrations
  applied. **Skipped unless `DATABASE_URL` is set.** Everything runs inside a
  transaction that is rolled back, so nothing persists.

```
npm install
npm test                              # unit only (integration skipped)
DATABASE_URL=postgres://... npm test  # + integration (needs migrated DB)
npm run typecheck
```

`@cdps/core` is resolved to its TS source via a vitest alias + tsconfig `paths`
(no repo-root workspace yet — deliberate, see `docs/handoff/HANDOFF_SUPABASE_FASE0.md` §3).

See `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §E.2 (pooler) and §B (engines).
