# @cdps/core

Shared TypeScript core engines for CDPS (ported from Go `internal/core/`). Exports the following:

- **statemachine** — entity lifecycle transitions
- **ident** — `PREFIX-YYYYMM-NNNN` ID generation
- **money** — commission, allocation, ROAS math
- **audit** — append-only immutable audit log
- **notification** — event notification producer
- **permission** — role matrix enforcement
- **tz** — timezone utilities
- **importer** — bulk import with SAVEPOINT safety

No external dependencies. Implements house rules per CLAUDE.md.

See `docs/SUPABASE_MIGRATION_PLAN.md` §3 for house-rule mappings and Lampiran Teknis §B for engine checklist.
