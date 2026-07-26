# 🔖 Handoff — CDPS Go→TypeScript port: **M14 + M15 done → the Go→TS port is COMPLETE**

_Last updated: 2026-07-26 (session that ported M14 + M15, **then merged the entire Wave-3 chain to `main`**)._

---

## ✅ UPDATE 2026-07-26 (reconciliation session) — Wave-3 fully MERGED

The whole Wave-3 port chain is now **merged to `main`** and the duplicate PRs are reconciled. `main` typechecks clean (`packages/domain` + `apps/api`).

| Merged PR | Module | Duplicate closed |
|-----------|--------|------------------|
| #46 | M3 Campaign | — |
| #47 | M2 Marketing (base retargeted → `main`) | — |
| #43 | M10 Live Stream | — |
| #44 | M7 Daily Output + reminder | — |
| #50 | M11 Board | #45 (closed) |
| #51 | M13 Client Health | #48 (closed) |
| #53 | M14 Team Performance | #49 (closed) |
| #52 | M15 Team Portal (diff reduced to M15-only after deps landed) | — |

**Conflict method used:** each branch was brought up to date by merging `main` in and resolving the
shared-registry append regions (`packages/domain/src/index.ts`, `apps/api/src/lib/{http,wire}.ts`) as
unions — re-stitching the `||` seams in `http.ts` and rebuilding the trailing mapper blocks in
`wire.ts` (ours + main's appended block + unioned import). Merged as merge-commits (no force-push).

**What genuinely remains** (see §6): M15-C2 external Client Portal (blocked, net-new), and
**frontend deploy** — `web-internal` (at repo root, outside the npm workspace) already has pages +
`src/lib` clients for every module incl. Wave-3; it proxies `/api/v1/*` → `BACKEND_URL` (apps/api).
DB schema is live on Supabase **CDPS SG** (`egddxfcnrtecheiykhlf`, 35 migrations through M14). Vercel
team **MEA** has 0 projects yet. Recommended pre-deploy step: FE↔API contract smoke on the 5 Wave-3
modules (their FE pages predate this merge).

---

## 0. TL;DR — where we are

**Every backend Go module (`module0`…`module15`) now has a TypeScript port.** The Go→TS
domain+API migration is **functionally complete**. The only backend thing left un-built is
**M15-C2 (the external Client Portal)**, which has **no Go source** — it is a deliberately
blocked track (needs the security spec + separate auth realm) and is therefore net-new
feature work, not a port.

This session shipped the last two ports and opened their PRs:

| Module | Branch | PR | Tests | State |
|--------|--------|----|-------|-------|
| **M14 Team Performance** | `claude/port-m14-team-performance-lvmfdb` | **#53** | 17 green | pushed + PR open |
| **M15 Team Portal** | `claude/port-m15-portal` | **#52** | 6 green | pushed + PR open |

Working tree clean; both branches match their remotes.

---

## 1. Full port inventory (Go module → TS file → PR)

| Go module | TS domain file | Where it lives | PR |
|-----------|----------------|----------------|----|
| module0_sales | `sales.ts` | **on `main`** (PR #42) | merged |
| module1_leads | `leads.ts` | on `main` | merged |
| module2_marketing | `marketing.ts` | branch `claude/port-m2-marketing` (stacked on M3) | **#47** |
| module3_campaign | `campaign.ts` | branch `claude/port-m3-campaign` | **#46** |
| module4_client | `client.ts` | on `main` | merged |
| module5_finance | `finance.ts` | on `main` | merged |
| module6_account | `account.ts` | on `main` | merged |
| module7_creative | `creative.ts` (+ daily-output/reminder) | on `main` (+ PR #44) | merged / #44 |
| module8_ads | `ads.ts` | on `main` | merged |
| module9_kol | `kol.ts` | on `main` | merged |
| module10_livestream | `livestream.ts` | branch `claude/port-m10-livestream-q7zz7p` | **#43** |
| module11_board | `board.ts` | branch `claude/port-m11-board-dependencies` | **#50** _(dup: #45 from `…pm-kanban-dep-vt8ty8`, file `dependency.ts`)_ |
| module12_task | `task.ts` | on `main` | merged |
| module13_health | `health.ts` | branch `claude/port-m13-client-health` | **#51** _(dup: #48 from `…port-m13-health`)_ |
| module14_performance | `performance.ts` | branch `claude/port-m14-team-performance-lvmfdb` | **#53** _(dup: #49 from `…pks0kq`)_ |
| module15_portal | `portal.ts` | branch `claude/port-m15-portal` | **#52** |

### ⚠️ Duplicate PRs to reconcile (parallel sessions raced several modules)
- **M11**: #50 (`board.ts`) **and** #45 (`dependency.ts`) — same module, different file name + branch. Merge one.
- **M13**: #51 (`…client-health`) **and** #48 (`…port-m13-health`) — same module. Merge one.
- **M14**: #53 (`…lvmfdb`, this session) **and** #49 (`…pks0kq`). Same file `performance.ts` → will conflict. **Merge exactly one.** #52 (M15) is stacked on `…lvmfdb`, so if #49 is chosen instead, rebase #52's M14 dependency onto it (the two are functionally equivalent).

Each of these adds `packages/domain/src/<name>.ts` + edits `index.ts` / `http.ts` / `wire.ts`, so
**whichever merges first, the others need a trivial rebase** (the shared-file edits are append-only
union — see §4).

---

## 2. Recommended merge order (so nothing breaks)

The shared files (`packages/domain/src/index.ts`, `apps/api/src/lib/http.ts`,
`apps/api/src/lib/wire.ts`) are touched by **every** Wave-3 PR (each appends its own
namespace/mapper/error). Merges are conflict-light but not conflict-free — expect
append-region conflicts, resolved by **keeping both sides** (union).

Dependency-driven order:

```
M3 (#46) ──► M2 (#47, imports M3)
M11 (#50 or #45) ─┐
M13 (#51 or #48) ─┼─► M14 (#53 or #49) ─► M15 (#52)   ← M15 delegates to M11/M13/M14/M12
M10 (#43), M7 (#44) — independent, any time
```

- **M2 (#47)** is stacked on **M3 (#46)** — its PR base is `claude/port-m3-campaign`; retarget to `main` after #46 merges.
- **M15 (#52)** is stacked on **M11 + M13 + M14** — its diff currently includes `board.ts` / `health.ts` / `performance.ts`. After those land on `main`, rebase #52 so its diff reduces to the **M15-only** files (see §3).

---

## 3. M15-only files (what #52 reduces to after its deps merge)

- `packages/domain/src/portal.ts` (new, ~450 LoC)
- `packages/domain/src/portal.test.ts` (new, 6 integration tests)
- `apps/api/src/app/api/v1/portal/me/route.ts`
- `apps/api/src/app/api/v1/portal/team/route.ts`
- `apps/api/src/app/api/v1/portal/management/route.ts`
- append-only additions to `packages/domain/src/index.ts` (`export * as portal`), `apps/api/src/lib/http.ts` (`portal.ForbiddenError → 403`), `apps/api/src/lib/wire.ts` (`staffLandingToWire` / `teamPortalToWire` / `managementDashboardToWire`)

**Routes:** `GET /api/v1/portal/{me,team,management}` (mirror `backend/internal/httpapi/routes_portal.go`).

M15 is a pure read/delegation layer — no new entity, no migration, no state machine, no
notification (§3 Rule 8). It calls `board.myTasks`, `performance.previewCurrent/trend/teamRollup`,
`task.pendingBlockRequests`, and reads `client_health_snapshots` directly for the management scan.

---

## 4. Conventions & gotchas proven across this whole port (save time)

- **One Go package = one TS namespace** in `packages/domain/src/<name>.ts`; register with
  `export * as <name> from './<name>'` in `index.ts`.
- **Domain stays camelCase; the API route is the snake_case boundary** via `apps/api/src/lib/wire.ts`
  mappers. Register each module's error classes in `apps/api/src/lib/http.ts` `mapError`.
- **Error→HTTP convention (differs from Go's 422):** `ValidationError`/`IncompleteError`→400,
  `ForbiddenError`→403, `NotFoundError`→404, `ConflictError`→409.
- **`jsonb` reads back as a STRING** from postgres.js in this setup → `JSON.parse` on read
  (helper `parseJsonb` in `performance.ts` / `portal.ts`).
- **Append-only tables can't be `DELETE`d** (no-delete triggers: `audit_log`, `notifications`,
  `client_health_snapshots`, `performance_snapshots`). In tests, **`TRUNCATE`** the module's own
  append-only tables; never truncate the shared `audit_log`/`notifications`. Use **unique entity
  ids per test** and assert **per-entity** (global sweeps score every row).
- **`clients ⇄ transactions` is a FK cycle** — in test cleanup, `update clients set transaction_id = null`
  first, then delete both (see `campaign.test.ts`).
- **`fileParallelism: false`** in `packages/domain/vitest.config.ts` → test **files run serially**, so
  broad `delete … where created_by like 'ZZ-%'` cleanup is safe.
- **id_sequences persists** on the shared dev DB — don't assert a sequence is globally 0; assert it
  didn't *advance* across a failed create (see `campaign.test.ts`).
- **WIB civil-date math**: `tz.dateString` / a `+7h` offset for month bucketing (`period` helper in
  `performance.ts`).
- **A gate that must `reject` (not throw synchronously)** in a Promise-returning fn must be `async`
  (M14 `runScan` bug fixed this way).
- **Name collisions in `wire.ts`**: M3's `campaignToWire` collided with M8 Ads' — renamed to
  `marketingCampaignToWire`. Check for an existing symbol before adding.

---

## 5. Dev environment (⚠️ ephemeral — Postgres dies between/within sessions)

Fresh container has no DB and no `node_modules`. To rebuild:

```bash
# 1. workspace deps (needed for the apps/api typecheck + tests)
cd /home/user/AgencyAPP && npm install

# 2. Postgres 16 (start if the data dir survived; else initdb first)
export PATH="/usr/lib/postgresql/16/bin:$PATH"
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cdps_pgdata -o "-p 5433 -k /tmp" -l /tmp/pg_run.log start
# if no cluster:
#   sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /tmp/cdps_pgdata
#   (start it) ; sudo -u postgres psql -p 5433 -h /tmp -c "create database cdps"
#   for f in supabase/migrations/*.sql; do sudo -u postgres psql -p 5433 -h /tmp -d cdps -f "$f" || break; done
```

- **DB URL:** `postgres://postgres@localhost:5433/cdps` (trust auth). All 16 modules' migrations
  (incl. `0034_dependencies`, `0035_client_health`, `0036_team_performance`) are applied on the M15
  branch. On a bare `main` branch only the merged modules' migrations exist.
- **Run tests:** `DATABASE_URL="postgres://postgres@localhost:5433/cdps" npx vitest run <name> --root packages/domain`
- **Typecheck (no DB):** `npx tsc -p packages/domain/tsconfig.json --noEmit` and `-p apps/api/tsconfig.json`.
  Ignore the single pre-existing `baseUrl … TS5101` deprecation — it's a config warning, not a code error.
- **Known pre-existing failure to ignore:** `finance.test.ts › scanReminders … idempotent` fails on an
  accumulated DB (its global overdue-installment scan accumulates across its own tests). Fails on `main`,
  independent of all recent work. Passes on a fresh DB.

---

## 6. What actually remains (no more straightforward ports)

1. **Reconcile the duplicate PRs** (M11 #50/#45, M13 #51/#48, M14 #53/#49) — merge one of each, rebase the rest.
2. **Merge the Wave-3 chain** in the §2 order.
3. **M15-C2 — external Client Portal** (net-new, blocked): no Go source; needs the security spec /
   separate auth realm / strict allow-list data layer (CLAUDE.md: "web-client-portal … separate auth
   realm, never a permission-trimmed internal view"). This is a fresh build, not a port.
4. **Frontend wiring** (`web-internal`) for the newly-ported modules — appears to be handled by separate
   FE branches (e.g. `claude/fe-m2-m3-marketing-campaign-iacc5y`).
5. **Pre-existing infra blockers (not this work):** `apps/api` `next build` turbopack resolver (see PR
   #40's handoff `HANDOFF_FASE1_SESI13_EXIT_UAT_AUTH.md`); org CI runners unprovisioned (red CI is infra).

---

## 7. To resume in a new chat, paste:

> _"Continue the CDPS Go→TS port. Per `docs/handoff/HANDOFF_WAVE3_PORT_M14_M15.md`, all 16 modules are
> ported; M14 is PR #53 and M15 is PR #52. Help me reconcile the duplicate Wave-3 PRs and merge them in
> the recommended order — or start scoping M15-C2 (external Client Portal) if the security spec is ready."_

The new session starts from a fresh clone; all Go source paths (`backend/internal/module*/`) and every
branch above are reachable from the remote.
