# CDPS — Build Plan (v1)

**Date:** 9 July 2026 · **Owner:** Nerissa (COO) · **Dev:** internal team (head 10+ yrs)
**Scale basis:** >100 employees, >500 clients · **Stack:** Golang + React/Next + MySQL (same as existing HRIS)
**Architecture (confirmed):** CDPS is a **standalone application**, integrated with the existing HRIS via the thin contract in Phase 0 v2 §8 (employee sync only — auth is local to CDPS, see `docs/DECISIONS.md` 2026-07-19). Not built inside the HRIS codebase.

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
| 6D | `CDPS_Module6D_Rekap_Hasil_Mingguan.md` | **New — added 2026-08-12** (Weekly Result Update: AM/CRO consolidates per-division production + view/GMV/CTR/CVR/ROAS weekly, rolls up into M6B P-E). Owner request, `docs/DECISIONS.md` 2026-08-12. |
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
4. **HRIS side-work (parallel, small):** `GET /employees` only — no auth/token endpoint (CDPS auth is local). This is the only external blocker for Sprint 0 — schedule it with the HRIS maintainer first.

---

## 3. Sprint 0 — Foundation (Epic P0)

**Goal:** a running skeleton where a synced HRIS employee can log in, has a mapped CDPS role, and every core engine works on a dummy entity.

1. Repo, CI/CD, environments (dev/staging/prod), seed script with the Alpha Digital worked-example data (Phase 0 OA-14) as permanent test fixtures.
2. HRIS integration: employee sync + role-mapping admin UI + deactivation propagation (Phase 0 v2 §8); local auth (login, change-password, admin password reset) built in CDPS.
3. Core engines (§2.3 above), each with unit tests: illegal-transition blocking, history immutability, permission denial, ID-after-validation.
4. Master Service List admin (Phase 0 v2 §10) — needed before Module 0 can compute anything.
5. Notification center shell + event registration API.

**Exit criteria:** login via local CDPS credentials works; deactivating a test employee in HRIS kills CDPS access; a dummy entity demonstrates blocked transitions with BI messages and a complete audit trail.

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

### Wave 2 — Delivery engine (Epics: M6, M7, M8, M9, M10, M12)
- **M6 Account & Service:** AM assignment (manual SPV), Strategy & Plan gate, Service→Brief fan-out, Brief Kanban, complaint door (AM/WhatsApp + Sales source), revision routing.
- **M6D Rekap Hasil Mingguan (Weekly Result Update)** — built **at the end of this wave, after M7/M8/M9/M10 expose their metrics** (same dependency shape as M6B P-E auto metrics). Auto-generated weekly per active client; consolidates per-division production (Creative # video, KOL # creator, Live Stream # live) and movement metrics (total view, GMV, CTR, CVR, ROAS) from the owning modules, manual fallback where the system owns nothing. Rolls up into the monthly M6B P-E realisasi — never replaces it (single-source GMV guardrail). Covers **all active clients incl. Direct/`Tanpa Plan`**, closing the gap that non-plan services have no periodic results record. State machine #18; catalog v3 (+3 events). Owner request, `docs/DECISIONS.md` 2026-08-12.
- **M12 Task Execution** built **early in this wave**, not last — M7/M8/M9 all plug into its canonical machine, turnaround/speed/revision computation, `[Blocked]` SPV-only permission, block-request queue.
- **M7 Creative** (Asset fan-out, revision loop, Daily Output), **M8 Ads** (Ad Campaign/Metric Entry/Optimization Log, Creative-asset launch guardrail, attribution feedback), **M9 KOL** (Booking lifecycle, QC/escalation, Creator Payment Request → Finance), **M10 Live Stream** (vendor tracker, reconciliation, GMV confidence tier).

**Exit criteria:** Alpha-Digital-style client runs a full delivery cycle: Service → Briefs across ≥2 divisions → Tasks with live Speed Scores → one revision loop → one blocked interval excluded from turnaround → live-stream session reconciled.

### Wave 3 — Attribution, visibility & scoring (Epics: M2, M3, M11, M13, M14, M15)
- **M2 Marketing + M3 Campaign:** performance records, CPL/CPRL/ROAS/Collected-ROAS, campaign lifecycle, last-touch vs origin attribution.
- **M11 Unified Board:** universal-column mapping, Dependency entity (circular check), My Tasks.
- **M13 Client Health:** monthly snapshot job, weight redistribution, ROAS toggle, band-drop flags.
- **M14 Team Performance:** KPI profiles per role (admin-configurable weights), Client-Outcome Modifier, monthly snapshots.
- **M15 Portals:** Team Portal (aggregation + block-approval queue + Management Dashboard) and **Client Portal last** — after the detailed security spec (Phase 0 v2 §11) and the `mea-client-reporting` embeddability check are done.

**Exit criteria:** management can open one dashboard and see every client's Health band; a staff member sees their monthly score with full breakdown; one pilot client logs into the Portal.

---

## 5. Cross-cutting Definition of Done (every epic)

1. All validation **server-side**; every blocked action shows its specified BI `[...]` message.
2. Permission matrix tests per role per endpoint (incl. layered OD/Director roles).
3. History immutability proven by test (no update/delete path on transition logs).
4. Derived fields recomputable from the timestamp log (Module 12 §5.2 principle applies system-wide).
5. Seed/worked-example data (Alpha Digital et al.) passes as an automated end-to-end fixture.
6. Notification events registered per the Phase 0 v2 §9 catalog.
7. IDR formatting `Rp. X.XXX.XXX,00`; IDs `PREFIX-YYYYMM-NNNN`.

---

## 6. Risks & dependencies

| # | Risk / dependency | Mitigation |
|---|---|---|
| R1 | **HRIS endpoint not ready** → Sprint 0 blocked | Schedule the endpoint with the HRIS maintainer **this week**; it's small (read-only employees). Fallback: temporary CSV employee import behind the same sync interface, swapped later without touching consumers. |
| R2 | `mea-client-reporting` not embeddable | Check before Wave 3 starts (one afternoon). Fallback: Module 15 renders a link-out for v1 — the PRD's embed decision degrades gracefully. |
| R3 | Master Service List data quality (prices/commission rules) | Sales Head compiles & validates the list during Sprint 0 — it's a data task, not a dev task; commission correctness in Wave 1 UAT depends on it. |
| R4 | Spreadsheet data migration messier than expected | Write the migration spec during Wave 1 (owner: 1 dev + 1 ops PIC per division); everything imports through M1's dedup engine — never direct DB inserts. |
| R5 | Scope creep across 16 epics | Wave gates: no Wave-2 tickets started before Wave-1 exit criteria pass UAT. Changes to confirmed PRD decisions go through Nerissa + decision log only. |
| R6 | Benchmark/target data (ROAS targets, period targets for M14) missing at Wave 3 | Operational data entry (Phase 0 OA-5) — assign to SPV Ads + OD during Wave 2 so Wave 3 scoring lands with real targets, not placeholders. |

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

1. **Nerissa → HRIS maintainer:** request the endpoint (Phase 0 v2 §8) — this is the critical path.
2. **Nerissa → head dev:** hand over this package (manifest §1); ask for (a) validation of the modular-monolith recommendation, (b) dev headcount for CDPS → converts §7 sizing into a dated timeline.
3. **Sales Head:** start compiling the Master Service List (name, standard price, commission rule) — deadline: end of Sprint 0.
4. **Head dev:** ticket Phase 0 + Module 0 first (System Requirements → data-model tickets; Rules → validation tickets; Flow → UI/workflow tickets).
