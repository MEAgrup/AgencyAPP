# CDPS PRD — Developer Handoff Package (v2)

**Status: Phase 1 complete + Module 0 (Sales) merged. 17 files. Ready for backlog ticketing once the 3 Open Decisions in Module 0 §9 are confirmed.**

This package is the full Client Delivery & Performance System (CDPS) specification for MEA Agency — Phase 0 foundation, the Sales reference module (Module 0), and all 15 modules, covering the complete client lifecycle from lead intake through delivery, scoring, and client/team-facing portals.

> **Naming note:** earlier files were prefixed "HRIS" for historical reasons. This system is **CDPS**, not an HRIS — MEA's actual HRIS (employee data, attendance, leave) is a separate existing internal system that CDPS integrates with (see §3). New/updated files use the CDPS prefix.

---

## 1. What's in this package (17 files)

| # | File | Covers |
|---|---|---|
| P0 | `HRIS_Phase0_Foundation.md` | House conventions, entity/ID registry (with as-built reconciliation), role matrix, global status conventions, validated client journey |
| **0** | **`CDPS_Module0_Sales.md`** ⭐ new | **Sales reference module, merged & reconciled: lead registration, qualified form (extended per Module 4), negotiation + approval, closing (Client/Transaction/Service ID generation). 3 Open Decisions in §9.** |
| 1 | `HRIS_Module1_Leads_Database.md` | Lead intake (Marketing + Sales), dedup, competitive claim, lead quality |
| 2 | `HRIS_Module2_Marketing.md` | Campaign performance record, CPL/ROAS/Collected-ROAS, lead-quality dashboard |
| 3 | `HRIS_Module3_Campaign.md` | Campaign as acquisition thread, lifecycle, end-to-end traceability |
| 4 | `HRIS_Module4_Client_Record.md` | Client Record, field provenance/lock matrix, Void Service, payment-intent handoff |
| 5 | `HRIS_Module5_Admin_Finance.md` | Payment verification, 4 schemes, routing gate, reminder dashboard, contract gate |
| 6 | `HRIS_Module6_Account_Service.md` | AM assignment, Strategy & Plan, Service→Brief breakdown, complaint doors |
| 7 | `HRIS_Module7_Creative.md` | Asset sub-entity, time-tracking, revision loop, Creative KPIs |
| 8 | `HRIS_Module8_Ads.md` | Ad Campaign vs. Brief, periodic metrics/ROAS, Optimization Log, attribution feedback |
| 9 | `HRIS_Module9_KOL.md` | Creator Booking, QC/escalation, Creator List, Creator Payment Request |
| 10 | `HRIS_Module10_Live_Stream.md` | Vendor-results tracker (outsourced, not internal execution) |
| 11 | `HRIS_Module11_PM_Kanban.md` | Cross-division Unified Board, Dependency mechanism |
| 12 | `HRIS_Module12_Task_Execution.md` | Canonical Task engine — Turnaround, Speed Score, Revision Count |
| 13 | `HRIS_Module13_Client_Health_Report.md` | Client Health Score (0–100), monthly snapshot, bands |
| 14 | `HRIS_Module14_Team_Performance.md` | Per-staff KPI Profile + Client-Outcome Modifier, monthly Performance Score |
| 15 | `HRIS_Module15_Client_Team_Portal.md` | Client Portal, Team Portal, Management Dashboard |

Module 0 changes previously applied cross-module context: the Qualified Lead Form now explicitly carries the 5 fields Module 4 expects at the Qualified stage (Nama PIC, Platform List, GMV saat ini 3-month avg, Target GMV, Marketing Budget); terminal statuses standardized to `Closed-Success` / `Closed-Lost`; scouted-vs-pool ownership split with Module 1 made explicit.

---

## 2. Architecture decision (confirmed)

- **CDPS is a standalone application** — Golang backend, React/Next frontend, MySQL — same stack as MEA's existing internal HRIS, maintained by the internal dev team.
- **CDPS does NOT live inside the HRIS codebase.** It integrates with the HRIS through a thin, explicit contract (§3). Rationale: CDPS is a large, fast-evolving delivery domain (~25+ entities); the HRIS runs critical HR functions that must not share a release train with it.
- Scale basis: >100 employees, >500 clients — well within a single MySQL deployment; no exotic infrastructure required for v1.

---

## 3. Integration Contract — CDPS ⇄ existing HRIS

The existing HRIS (employee data, attendance, leave; Golang/React/MySQL/REST, email-password login) is the **single source of truth for people data**. CDPS never maintains its own employee master.

Required from the HRIS side (minimal additions):

1. **`GET /employees`** — id, nama, email, divisi, jabatan/role, status aktif. Consumed by CDPS on a scheduled sync + manual refresh trigger.
2. **Auth endpoint** — CDPS authenticates users against HRIS credentials (token issuance/validation), so employees have one login. No separate CDPS password store.

Required on the CDPS side:

3. **Role-mapping table (admin-managed, not hardcoded):** HRIS jabatan/divisi → CDPS role per the Phase 0 Role Matrix (Staff / Lead-SPV per division), plus the layered OD/Director roles. Job titles change; the mapping must be editable without redeploy.
4. **Deactivation propagation:** an employee marked inactive in the HRIS automatically loses CDPS access on the next sync — mandatory at >100 employees, never manual.
5. **(Later, optional)** Monthly export of Module 14 Performance Scores back to the HRIS for HR review/coaching workflows.

Other external touchpoints (unchanged from Phase 1): `mea-client-reporting` (embedded in Module 15's Client Portal — embeddability still to be confirmed), WhatsApp (manual logging only, no auto-capture), Live Stream vendor (no system access, AM-entered).

---

## 4. What the final pass did (Phase 1 history)

Every module originally shipped with its own "Open Assumptions" list. The final pass converted each into a **Resolved Decision**, edited directly into the relevant file ("✅" markers). Key cross-module fixes: entity prefix reconciliation (`HSC-…`→`CHR-…`, `PRF-…`→`PERF-…`); severity labels aligned (Low/Medium/High, −5/−15/−30); Asset gains `[Blocked]`; KOL Booking ↔ canonical Task mapping; revision SLA wired into Module 12; Void Service cascade to child Briefs; payment-gate/contract parallelism clarified; Ads recurring-strategy reuses the same Ad Campaign; three complaint doors, one `CPL-…` entity; last-touch vs origin-campaign attribution documented as intentional divergence.

---

## 5. Items still genuinely open

1. **Phase 0 OA-6 — Satisfaction capture.** Health Score's Satisfaction slot stays N/A (weight redistributed) until a CSAT mechanism is designed — Phase 2 follow-up, does not block this handoff.
2. **Module 0 §9 — three Open Decisions** (Sales-PIC mapping to Module 4, Master Service List ownership, payment-reminder split). Proposed defaults are written in; need Nerissa/Yohan sign-off before ticketing Modules 0/4/5.
3. **Notification Spec (global).** Many modules require notifications (superior approval, SPV real-time flags, PIC payment reminders, band-drop alerts) but no channel is specified (in-app / email / WhatsApp). One short cross-cutting spec should be written before ticketing.
4. **Security & non-functional spec for the Client Portal** (Module 15) — external-facing logins require an explicit auth/rate-limit/data-isolation section before that module is built.
5. **Data migration plan** — existing leads/clients currently in spreadsheets need an import/backfill spec (owner, format, dedup handling via Module 1's engine).
6. Minor carried-over items: Task-SLA vs Brief-SLA validation (Module 12), Revision Count threshold retuning per division.

---

## 6. Suggested ticketing approach

- **One epic per module** (17 epics: Phase 0 + Module 0 + Modules 1–15), in build order. Phase 0 first (conventions/ID/roles + HRIS integration contract), then Module 0 (Sales — everything downstream depends on closing), then Modules 1–10, then 11–15.
- Within each epic: **field specs → data-model tickets; Rules → validation/business-logic tickets; Flow → UI/workflow tickets.**
- Recommended delivery waves (do not build all 15 at once):
  - **Wave 1 (core money path):** Phase 0 + Integration Contract + Module 0 + Modules 1, 4, 5 — lead → close → payment gate.
  - **Wave 2 (delivery):** Modules 6, 7, 8, 9, 10, 12 — brief breakdown + execution + task engine.
  - **Wave 3 (visibility & scoring):** Modules 2, 3, 11, 13, 14, 15 — attribution, boards, health, performance, portals.
