# HANDOFF — Wave 3 Port: M14 Team Performance

**Branch:** `claude/port-m14-team-performance-pks0kq` (off `main` = 806a91c, independent — not stacked).
**Status:** ported, typechecked, tested (domain 305/305, api 80/80 against a fresh DB), committed, pushed.

## What was ported

Go `backend/internal/module14_performance/*` (8 files, ~2.8k LoC) → `packages/domain/src/performance.ts`
(one module, mirroring the health.ts M13 layout) + wire mappers + API routes.

### Pure scoring core (`profile.go`)
- `transformSpeed` (OA-1: 100 at/under SLA, else 200−x floored 0), `clamp01to100` (OA-2 cap),
  `scoreProfile` (weighted KPI Profile with missing-component proportional redistribution, Rule 6),
  `clampModifier` (OA-3: clamp((avg−80)/2, ±10)), `boundFinal` (Rule 4, 0..100), diagnostic rows
  (KOL Sourcing Turnaround — reported, unweighted, never redistributed). All-excluded → `profileOk=false`
  → score renders "—".

### Per-role KPI gatherers (`compute.go`) — recompute-from-log (house rule 4)
- **Creative** (staff = `assets.assigned_pic`): Speed, Output Quantity (norm), GMV Impact (Σ attributed_gmv, norm), Revision Count (inverse).
- **Ads** (staff = setup `briefs.assigned_pic`): Speed, ROAS Attainment (mean managed-campaign periodROAS÷target×100), GMV Impact (norm), Optimization Activity (`optimization_logs.actor`, norm).
- **KOL** (staff = `creator_bookings.assigned_coordinator`): Creator Count (norm), QC Pass Rate, Speed, Escalation Rate (inverse), Sourcing Turnaround (diagnostic). Reuses `kol.computeBookingMetrics`.
- **AM** (staff = `clients.assigned_am_id`): CHR Average (M13 `final_health_score` over portfolio, same period), Complaint Resolution Speed (OA-1 vs SLA target), Revision Escalation Rate (inverse, ≥3-revision-flagged fraction).
- Reuses `task.computeMetrics` (asset/brief) and `ads.parseRoasTarget` — no duplicated math.

### Client-Outcome Modifier (`modifier.go`, §5.3 / Rule 3)
- Creative→revision_burden, Ads→roas_attainment, KOL→task_completion; AM none. Averages the M13 CHR
  sub-score (`capped`) over the staff's PIC-touched clients that have a same-period CHR snapshot, then clamps.
  No source data ⇒ absent (effective 0, recorded), never a fabricated 0-from-80.

### Config (`config.go`, O9 configurable + placeholder)
- `perf_kpi_weights` (per role, Σ=100 validated on write, Director-gate, audited before→after) and
  `perf_period_targets` (exact-period-first, else `0001-01-01` sentinel; `is_placeholder` flag surfaced on the
  snapshot as `targets_placeholder` so an unconfirmed O9 target is never mistaken for real). `setTarget` upsert
  via Postgres `ON CONFLICT`.

### Snapshot (`snapshot.go`)
- Monthly sweep over active role-mapped **staff-level** (Creative/Ads/KOL/AM) for the last CLOSED WIB month,
  1 immutable `PERF-` per staff (fire-once, UNIQUE + re-check + `FOR UPDATE`), emits **EvPerformancePublished**
  (explicit → the scored staff) in the same tx. `getSnapshot` / `trend` / `previewCurrent` (running month, never
  stored, no emission — for M15) / `teamRollup` (simple average, derived on read). Visibility (Rule 7): own /
  division-lead / OD / Director; scan + config gates Director-only.

## API routes (mirror Go `routes_perf.go`)
`POST /performance/snapshots/scan`, `GET /staff/{id}/performance[?period]`, `GET /staff/{id}/performance/trend`,
`GET /performance/teams/{division}[?period]`, `GET|PUT /performance/config/weights`, `GET|PUT /performance/config/targets`.
Wire mappers (`apps/api/src/lib/wire.ts`) + error mapping (`http.ts`: forbidden/scan/config→403, not-found→404, weights/role-type→400).

## Verification (fresh local Postgres 16, all 0001–0037 + statemachine/RLS migrations applied)
- Domain: 305/305 (17 new — 9 pure + 8 DB-backed incl. Kenny §4 e2e 86.4/+2/88.4, fire-once emission,
  immutability, AM CHR average, placeholder flag, visibility+scan gate, team rollup, config Σ=100/Director gate).
- API: 80/80. Typecheck clean (env note: TS 5.9 flags the pre-existing `baseUrl` tsconfig deprecation; verified
  with `ignoreDeprecations: "5.0"` → 0 real errors).

## Gotchas
- `performance_snapshots` (+ `client_health_snapshots`, `notifications`) are append-only with hard FKs. Test
  cleanup runs inside `session_replication_role='replica'` (same pattern as M13). The fixed `ZZ-` staff ids are
  reused across tests, so **notifications must be cleared per-test** or the fire-once count accumulates.
- Money columns (`metric_entries.spend/gmv`, `assets.attributed_gmv`) are numeric rupiah → `Number(...)`; the
  Go `money.Parse ÷100` cents round-trips to the same rupiah value (ratios cancel).
- `previewCurrent` is exported but intentionally has **no HTTP route** (matches Go httpapi) — it's M15's Team
  Portal input.

## Next task
**M15 Portal** — Team Portal first (consumes `previewCurrent` + `trend` + `teamRollup`); Client Portal LAST
(separate auth realm, strict allow-list, blocked on O5/O4 security spec).
