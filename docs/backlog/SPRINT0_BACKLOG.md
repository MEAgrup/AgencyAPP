# CDPS — Sprint 0 Backlog (Foundation)

> First executable ticket set. Order matters — each ticket lists its blockers. Acceptance criteria (AC) are testable. DoD from CLAUDE.md applies on top of every ticket.

## S0-01 · Repo & scaffolding
Monorepo: `backend/` (Go modular monolith), `web-internal/`, `web-client-portal/` (empty shell for now), `docs/` (this folder + `docs/prd/` with the 18 PRD files). CI: lint + test on PR. Environments: dev/staging.
**AC:** `make test` green on empty skeleton; PRD files browsable in-repo.

## S0-02 · DB & migration tooling
MySQL schema + migration tool wired. Conventions: snake_case, `created_at/created_by` everywhere, no ON DELETE CASCADE for audited entities.
**AC:** migration up/down works in CI.

## S0-03 · ID generator (blocker: S0-02)
`PREFIX-YYYYMM-NNNN`; sequence per prefix per month; issued only inside the create-transaction after validation passes; concurrency-safe.
**AC:** parallel creation test produces no gaps/duplicates; failed validation never consumes a sequence number.

## S0-04 · Audit log engine (blocker: S0-02)
Append-only table(s): entity ref, actor, action, before→after (JSON), timestamp. No update/delete code path. Read API with filtering.
**AC:** attempt to mutate a log row fails at the storage layer; every write requires an actor.

## S0-05 · Status-machine engine (blockers: S0-03, S0-04)
Declarative transition config (from `docs/STATE_MACHINES.md`), generic `Transition(entity, from, to, actor)` API: validates against config, blocks invalid with configured BI message, writes audit row, emits event for recompute/notifications. Support for parallel flags (`[Jatuh Tempo]`, `[Bermasalah]`) distinct from statuses, and role-restricted transitions (`[Blocked]` = SPV/Lead only).
**AC:** table-driven tests per machine in STATE_MACHINES.md — every allowed transition passes, every unlisted transition returns its BI message and changes nothing.

## S0-06 · HRIS integration — employee sync (external blocker: HRIS `GET /employees`)
Sync job (scheduled + manual trigger) behind an `EmployeeSource` interface; CSV-import fallback implementation for local/dev and as contingency (Build Plan R1). Deactivation propagation revokes CDPS sessions/access.
**AC:** sync idempotent; deactivating a fixture employee blocks their next request; swap CSV↔HTTP source with zero consumer changes.

## S0-07 · HRIS integration — auth (external blocker: HRIS token endpoint)
Login delegates to HRIS credentials; CDPS issues its own session bound to the synced employee record. No CDPS password store.
**AC:** valid HRIS credentials → CDPS session; unknown/inactive employee → rejected.

## S0-08 · Role-mapping table + permission layer (blockers: S0-06, S0-07)
Admin UI: HRIS jabatan/divisi → CDPS role (Staff / Lead-SPV per division) + layered OD/Director. Middleware enforcing Phase 0 §4 matrix (own-data vs division-wide vs read-all).
**AC:** permission test suite: each role × representative endpoint (allow/deny) incl. layered roles; mapping change takes effect without redeploy.

## S0-09 · Master Service List admin (blockers: S0-04, S0-08; data blocker: Sales Head compiles list — Build Plan R3)
CRUD for entries (name, standard price, standard commission rule, active flag) restricted to Sales Head/SPV; every change versioned; lookup API "version effective at date X".
**AC:** editing as a plain salesperson denied; price change creates a new version; a deal-date lookup returns the historical version.

## S0-10 · In-app notification center (blockers: S0-04, S0-05)
Event registration API (catalog: Phase 0 v2 §9), per-user inbox, unread badge, deep-link payload, mark-as-read only (no delete).
**AC:** emitting a cataloged event creates notifications for the right recipients; delete path does not exist.

## S0-11 · Seed & fixtures
Alpha Digital worked-example dataset (Phase 0 OA-14) as an automated end-to-end fixture skeleton, extended each wave.
**AC:** `make seed` produces the fixture; CI runs a smoke test over it.

## S0-12 · Sprint 0 exit review
Demo: HRIS-synced login → role-mapped workspace → dummy entity walks a state machine with a blocked transition + BI message + full audit trail → notification lands in-app.
**AC:** all above in staging, witnessed by head dev + Nerissa; go/no-go for Wave 1 logged in `docs/DECISIONS.md`.

---

## Parallel non-dev tasks (owners outside the dev team)
- **HRIS maintainer:** 2 endpoints (spec: Phase 0 v2 §8) — critical path for S0-06/07.
- **Sales Head:** compile & validate Master Service List — blocks S0-09 data + Wave 1 UAT.
- **Nerissa/ops:** name the migration PIC per division (Wave 1, Build Plan R4).
