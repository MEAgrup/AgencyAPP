# CDPS — Build Plan (v2)

**Date:** 9 July 2026 · **v2 QC pass:** 12 July 2026 (Wave 2+ restructure — see DECISIONS.md §Wave 2 Plan QC; ticket detail in `docs/backlog/WAVE2_BACKLOG.md` / `WAVE3_BACKLOG.md`) · **Owner:** Nerissa (COO) · **Dev:** internal team (head 10+ yrs)
**Scale basis:** >100 employees, >500 clients · **Stack:** Golang + React/Next + MySQL (same as existing HRIS)
**Architecture (confirmed):** CDPS is a **standalone application**, integrated with the existing HRIS via the thin contract in Phase 0 v2 §8 (employee sync + auth). Not built inside the HRIS codebase.

---

## 1. Package manifest — the complete PRD set (18 documents)

| # | Document | Version status |
|---|---|---|
| P0 | `CDPS_Phase0_Foundation_v2.md` | **v2 — updated** (adds §8 Integration Contract, §9 Notification Spec in-app, §10 Master Service List, §11 Portal security) |
| 0 | `CDPS_Module0_Sales.md` | **Final — all decisions confirmed** (OD-1/2/3 resolved 9 Jul 2026) |
| 1 | `CDPS_Module1_Leads_Database.md` | Final, unchanged |
| 2 | `CDPS_Module2_Marketing.md` | Final, unchanged — *use your existing copy* |
| 3 | `CDPS_Module3_Campaign.md` | Final, unchanged — *use your existing copy* |
| 4 | `CDPS_Module4_Client_Record_v2.md` | **v2 — updated** (adds Commission & Payment PIC + Sales Allocation per OD-1; module-number refs fixed). Supersedes the v1 file. |
| 5 | `CDPS_Module5_Admin_Finance.md` | Final, unchanged |
| 6 | `CDPS_Module6_Account_Service.md` | Final, unchanged |
| 7 | `CDPS_Module7_Creative.md` | Final, unchanged |
| 8 | `CDPS_Module8_Ads.md` | Final, unchanged |
| 9 | `CDPS_Module9_KOL.md` | Final, unchanged |
| 10 | `CDPS_Module10_Live_Stream.md` | Final, unchanged — *use your existing copy* |
| 11 | `CDPS_Module11_PM_Kanban.md` | Final, unchanged — *use your existing copy* |
| 12 | `CDPS_Module12_Task_Execution.md` | Final, unchanged — *use your existing copy* |
| 13 | `CDPS_Module13_Client_Health_Report.md` | Final, unchanged — *use your existing copy* |
| 14 | `CDPS_Module14_Team_Performance.md` | Final, unchanged — *use your existing copy* |
| 15 | `CDPS_Module15_Client_Team_Portal.md` | Final, unchanged — *use your existing copy* |
| — | `CDPS_Build_Plan.md` (this file) | New |

*"Use your existing copy" = the file from the original batch is already final; no content changed, so no regenerated version is issued (avoids accidental drift). This manifest supersedes README v2's file list.*

**Remaining open items (do not block ticketing):** Phase 0 OA-6 CSAT capture (Phase 2); Module 12 Task-SLA-vs-Brief-SLA validation + revision-threshold retuning (post-live-data); Ads benchmark numbers (operational data entry, Phase 0 OA-5); detailed Portal security spec (write before Wave 3, minimums already in Phase 0 v2 §11); `mea-client-reporting` embeddability check (before Wave 3); data-migration spec (write during Wave 1, §6 risk R4).

---

## 2. Technical shape (recommendation to validate with head dev)

1. **Modular monolith, one Golang service** — module boundaries as Go packages mirroring the PRD modules, one MySQL schema. With 100+ internal users and 500+ clients, microservices add operational cost with zero benefit at this scale. Split later only if a hotspot proves it.
2. **Two frontends, one design system:** internal app (React/Next — workspaces, boards, dashboards) and the external Client Portal (separate Next app or isolated route-group with its **own auth realm** — never shares session infrastructure with internal, per Phase 0 v2 §11).
3. **Core engines built once in Sprint 0, reused by every module** (this is where the PRD's consistency pays off):
   - **Status-machine engine** — declarative transition tables per entity, server-side blocking, BI `[...]` messages, actor+timestamp on every transition.
   - **Immutable audit log** — append-only (before→after, actor, timestamp); notifications derive from it.
   - **ID generator** — `PREFIX-YYYYMM-NNNN`, issued only after mandatory-field validation passes.
   - **Permission layer** — Phase 0 Role Matrix + role-mapping table from HRIS sync.
   - **In-app notification center** — event catalog per Phase 0 v2 §9.
   - **Derived-field recompute** — event-driven (on transition/entity change) for rollups; cron only for monthly snapshots (M13/M14) and reminder schedules.
4. **HRIS side-work (parallel, small):** `GET /employees` + auth/token endpoint. This is the only external blocker for Sprint 0 — schedule it with the HRIS maintainer first.

---

## 3. Sprint 0 — Foundation (Epic P0)

**Goal:** a running skeleton where a synced HRIS employee can log in, has a mapped CDPS role, and every core engine works on a dummy entity.

1. Repo, CI/CD, environments (dev/staging/prod), seed script with the Alpha Digital worked-example data (Phase 0 OA-14) as permanent test fixtures.
2. HRIS integration: employee sync + auth + role-mapping admin UI + deactivation propagation (Phase 0 v2 §8).
3. Core engines (§2.3 above), each with unit tests: illegal-transition blocking, history immutability, permission denial, ID-after-validation.
4. Master Service List admin (Phase 0 v2 §10) — needed before Module 0 can compute anything.
5. Notification center shell + event registration API.

**Exit criteria:** login via HRIS credentials works; deactivating a test employee in HRIS kills CDPS access; a dummy entity demonstrates blocked transitions with BI messages and a complete audit trail.

---

## 4. Delivery waves

### Wave 1 — Money path (Epics: M0, M1, M4, M5)
Lead → close → payment gate. Everything downstream depends on this.

- **M0 Sales:** registration/dedup, Qualified form (incl. the 5 new fields), auto Estimasi Nilai & Komisi from Master Service List, negotiation + superior approval + versioning, closing (allocation ≤5, Σ=100%, Commission & Payment PIC), Client/Transaction/Service ID generation.
- **M1 Leads Database:** central LEAD registry, bulk import, dedup decision table, Pool vs Scouted, competitive claim + win resolution, Last-Touch Campaign field, bad-lead evaluation.
- **M4 Client Record (v2):** provenance inheritance, lock matrix server-side, Void Service + cascade, payment-intent handoff, new OD-1 fields.
- **M5 Admin & Finance:** Transaction + `INST-…` schedule, 4 schemes, verification, routing gate (first confirmed payment releases to Account), reminder dashboard + dual-audience reminders (OD-3), contract 7-day flag.
- **Migration:** import existing leads/clients from spreadsheets through M1's dedup engine (spec written during this wave — see R4).

**Exit criteria (UAT with Sales + Finance pilot):** one real deal runs end-to-end — registered → qualified → negotiated (with a real superior approval) → closed → IDs generated → Termin schedule created → Finance verifies → client routes to Account queue; commission math independently spot-checked against the Master Service List.

### Wave 2 — Delivery engine (Epics: M6, M12, M7, M8, M9, M10 **+ M3, M2 pulled forward**) — v2 structure

Ticket detail: `docs/backlog/WAVE2_BACKLOG.md`. Order inside the wave:

1. **Blockers first (§0 of the backlog):** timezone decision O20 (Daily-Output EOD lock, SLA math, month boundaries all depend on it), **notification catalog v2 as ONE coordinated ticket** (closes the W1-13/W1-16 deferrals + all new M6/M8/M9 events — no per-team ad-hoc catalog edits), STATE_MACHINES.md completed for Service/`STR-` **before** config.go, and the M1 collaborative-dedup redesign handoff.
2. **Foundation (sequential, one owner):** Wave-2 schema migrations (briefs stub → full contract, frozen like 0002), **M12 Task Execution engine as a core package** (M6 Briefs, M7 Assets, M9 Bookings, M8 Brief-as-task all run on it from day one — one implementation, not four), and the Brief↔sub-entity **rollup engine** (denormalized event-driven columns, recomputable from log — boards never compute worst-case rollups per render).
3. **Three execution streams in parallel** (disjoint file ownership + migration ranges, same anti-conflict rules as `WAVE1_PARALLEL_PLAN.md`): **A = M6**, **B = M7+M8** (the attribution loop stays with one owner), **C = M9+M10**.
4. **Stream D in parallel: M3 Campaign + M2 Marketing — moved up from Wave 3.** They depend only on Wave-1 data (leads, closings, Amount Verified), and building M3 now retires the W1-02 campaign stub early; attribution history is then complete well before Wave-3 scoring reads it.

**Exit criteria:** Alpha-Digital-style client runs a full delivery cycle: Service → Briefs across ≥2 divisions → Tasks with live Speed Scores → one revision loop → one blocked interval excluded from turnaround → live-stream session reconciled → Ads metrics produce Attributed GMV on a Creative Asset → one acquisition campaign shows ROAS/Collected-ROAS. **Plus the scale gate:** p95 latency budget on queue/board/dashboard endpoints against the seeded load fixture (500 clients / 100+ employees / ≥50k tasks — backlog W2-29).

### Wave 3 — Visibility & scoring (Epics: M11, M13, M14, M15) — v2 structure

Ticket detail: `docs/backlog/WAVE3_BACKLOG.md`. With M2/M3 moved to Wave 2, this wave is a pure dependency chain — **M11 → M13 → M14 → M15** — each module reads the previous one's output; M11 can start the day the Wave-2 gate passes.

- **M11 Unified Board:** universal-column mapping (reads the Wave-2 rollup columns), Dependency entity (circular check), My Tasks.
- **M13 Client Health:** monthly snapshot job, weight redistribution, ROAS toggle, band-drop flags.
- **M14 Team Performance:** KPI profiles per role (admin-configurable weights), Client-Outcome Modifier, monthly snapshots. Needs the period targets entered during Wave 2 (risk R6/O9).
- **M15 Portals:** Team Portal (aggregation + block-approval queue + Management Dashboard) and **Client Portal last** — after the detailed security spec (Phase 0 v2 §11 / O5) and the `mea-client-reporting` embeddability check (O4) are done.

**Exit criteria:** management can open one dashboard and see every client's Health band; a staff member sees their monthly score with full breakdown; one pilot client logs into the Portal; cross-client isolation tests on every portal endpoint pass.

---

## 5. Cross-cutting Definition of Done (every epic)

1. All validation **server-side**; every blocked action shows its specified BI `[...]` message.
2. Permission matrix tests per role per endpoint (incl. layered OD/Director roles).
3. History immutability proven by test (no update/delete path on transition logs).
4. Derived fields recomputable from the timestamp log (Module 12 §5.2 principle applies system-wide).
5. Seed/worked-example data (Alpha Digital et al.) passes as an automated end-to-end fixture.
6. Notification events registered per the Phase 0 v2 §9 catalog.
7. IDR formatting `Rp. X.XXX.XXX,00`; IDs `PREFIX-YYYYMM-NNNN`.
8. **Scale NFRs (v2 — the app must hold at >100 employees / >500 clients with heavy data):** every list/queue endpoint paginated (no unbounded selects); composite indexes matching the access pattern (personal queue, per-client board, audit, notifications); board/dashboard views read denormalized event-driven rollup columns (always recomputable from the log), never N+1 per card; monthly batch jobs chunked, idempotent, resumable; Wave-2 exit includes a load-fixture p95 gate (backlog W2-29).

---

## 6. Risks & dependencies

| # | Risk / dependency | Mitigation |
|---|---|---|
| R1 | **HRIS endpoints not ready** → Sprint 0 blocked | Schedule the 2 endpoints with the HRIS maintainer **this week**; they're small (read-only employees + token). Fallback: temporary CSV employee import behind the same sync interface, swapped later without touching consumers. |
| R2 | `mea-client-reporting` not embeddable | Check before Wave 3 starts (one afternoon). Fallback: Module 15 renders a link-out for v1 — the PRD's embed decision degrades gracefully. |
| R3 | Master Service List data quality (prices/commission rules) | Sales Head compiles & validates the list during Sprint 0 — it's a data task, not a dev task; commission correctness in Wave 1 UAT depends on it. |
| R4 | Spreadsheet data migration messier than expected | Write the migration spec during Wave 1 (owner: 1 dev + 1 ops PIC per division); everything imports through M1's dedup engine — never direct DB inserts. |
| R5 | Scope creep across 16 epics | Wave gates: no Wave-2 tickets started before Wave-1 exit criteria pass UAT. Changes to confirmed PRD decisions go through Nerissa + decision log only. |
| R6 | Benchmark/target data (ROAS targets, period targets for M14) missing at Wave 3 | Operational data entry (Phase 0 OA-5) — assign to SPV Ads + OD during Wave 2 so Wave 3 scoring lands with real targets, not placeholders. |
| R7 | **Timezone bucketing (O20) undecided** → M7 EOD lock, M12 SLA math, M13/M14 month boundaries all inherit the UTC-vs-WIB skew | Decide once before any Wave-2 execution ticket (backlog W2-01); applied project-wide in one pass — after go-live it becomes a painful migration. |
| R8 | Notification-catalog drift — Wave 1 already deferred 2 events because the frozen catalog couldn't be edited per-team | One coordinated catalog-v2 ticket at wave start (backlog W2-02), single core owner; teams never extend the catalog unilaterally. |
| R9 | DB/hosting question raised 12 Jul 2026 (Supabase/Postgres + Vercel, Singapore region) vs. the logged MySQL decision | Logged as **O27**. If a switch is ever approved, it must land **before** the W1-19 production import — after real data lands, migration cost multiplies. Until decided, MySQL stands. |

---

## 7. Estimation & governance — needs one input from you

Durations are deliberately **not** attached to waves yet, because they depend on one number I don't have: **how many devs (BE/FE) are allocated, and are they full-time on CDPS?** Relative sizing for planning:

- Sprint 0 ≈ the foundation of everything — do not compress it.
- Wave 1 ≈ comparable effort to Sprint 0 + Wave 1 being the two largest blocks (state machines + money correctness).
- Wave 2 ≈ largest ticket count, but highly repetitive once M12's engine exists (M7/M8/M9 are variations on one pattern).
- Wave 3 ≈ mostly read/aggregate layers + two batch jobs; Client Portal is the only genuinely new surface.

**Governance:** weekly build review (Nerissa + head dev): wave burndown, blockers, any PRD-decision change requests → decision log. UAT sign-off per wave by the pilot division's Lead + Nerissa.

---

## 8. Immediate next steps (this week)

1. **Nerissa → HRIS maintainer:** request the 2 endpoints (Phase 0 v2 §8) — this is the critical path.
2. **Nerissa → head dev:** hand over this package (manifest §1); ask for (a) validation of the modular-monolith recommendation, (b) dev headcount for CDPS → converts §7 sizing into a dated timeline.
3. **Sales Head:** start compiling the Master Service List (name, standard price, commission rule) — deadline: end of Sprint 0.
4. **Head dev:** ticket Phase 0 + Module 0 first (System Requirements → data-model tickets; Rules → validation tickets; Flow → UI/workflow tickets).
