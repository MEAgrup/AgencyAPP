# CDPS — Phase 0: Foundation Spec (v2)

> **v2 changes:** system renamed **CDPS** (Client Delivery & Performance System) — MEA's actual HRIS (employee/attendance/leave, Golang/React/MySQL) is a separate existing system CDPS integrates with. New sections added: §8 Integration Contract, §9 Notification Spec, §10 Master Service List, §11 Client Portal security minimums. Module 0 (Sales) is now an explicit file in the package (`CDPS_Module0_Sales.md`) rather than an external reference.

> **Purpose.** This is the shared foundation every module (Leads DB → Team Portal) must conform to. It locks the conventions, the entity/ID scheme, the role model, the global status rules, and the validated client journey — then lists the **Open Assumptions** that need Yohan's confirmation *before* the modules are written.
>
> **Reference standard:** `HRIS - Performance Management (Sales)` is the non-negotiable quality bar. Nothing here contradicts it; this document generalises its patterns so the rest of the system feels like one document.
>
> **Language convention:** PRD body in English. All user-facing labels, statuses, and validation messages in **Bahasa Indonesia inside square brackets**, e.g. `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.

## Contents
1. Scope & how to read this system
2. House Conventions (global shared spec)
3. Entity & ID Registry
4. Consolidated Role Matrix
5. Global Status Conventions
6. Validated Client Journey (the spine)
7. Open Assumptions / Questions — **confirmation gate**

---

## 1. Scope & how to read this system

MEA Agency's CDPS is a **cross-division project-management + performance system**. It does three jobs at once:

1. **Kanban tasks across divisions** — a service list closed by Sales becomes tasks that flow Account → Creative / Ads / KOL (and Live Stream — see OA-1), with dependencies and load monitoring.
2. **Cross-division performance evaluation** — each division is scored partly on the *outcomes felt by others* (e.g. Ads scored partly on client satisfaction, Account on number of complaints).
3. **Auto-generated team performance** — individual + team performance rolls up automatically from per-module objectives, governed by the OKR-management role.

Every module connects to the modules before and after it. The Sales module (already finished) is the entry point; this Phase 0 governs everything from the Leads Database onward.

---

## 2. House Conventions (global shared spec)

These patterns are extracted from the reference and apply to **every** module unless a module explicitly overrides them.

### 2.1 Unique IDs
- A unique ID is auto-generated **only after all mandatory fields for that entity are complete and validation passes** — never before.
- IDs are **system-generated, immutable, and never reused**.
- Every new entity introduced in this system gets its own ID scheme (see §3).
- Recommended human-readable format: `PREFIX-YYYYMM-NNNN` (e.g. `CMP-202603-0007`). Prefix per entity, monthly bucket, zero-padded sequence. *(Format is a proposal — see OA-13.)*

### 2.2 Status state machines
- Every entity with a lifecycle has **explicit statuses** and **explicit allowed transitions**.
- The system **blocks invalid transitions** (no skipping, no illegal jumps). A blocked transition shows a Bahasa Indonesia message and changes nothing.
- Each transition records who triggered it and when.

### 2.3 Immutable history + timestamps
- Every status change records a **timestamp** (date + time).
- History can **never be edited or deleted** by any user (including Directors).
- Every entity has a **full activity/audit log** (actor, action, before→after, timestamp).
- Timestamps are also the source for all duration metrics (prospecting duration, deal cycle, onboarding cycle, task duration, etc.).

### 2.4 Field specs
For **every** input field, the spec states:
- **Type** — one of: `text only` / `number only` / `multiple choice` / `link` / `date`.
- **Mandatory vs optional**.
- Validation rule(s) where relevant.

### 2.5 Validation
- Incomplete or invalid **mandatory** data → submission **blocked**, no ID generated, entity does not advance, plus a Bahasa Indonesia message in `[...]`.
- Reusable default message: `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.

### 2.6 Auto-calculated, read-only fields
- Any derived metric is **system-computed and read-only** — users can never type into it.
- Same rule the reference uses for *Estimasi Nilai Transaksi* and *Perhitungan Komisi*; we extend it to: Cost per Lead, ROAS, all conversion rates, task duration, revision counts, health scores, and every performance rollup.

### 2.7 Role model (reused from the reference)
- **Staff / Employee** — sees **own data only**.
- **Lead / Head / Supervisor** — has a **dashboard that monitors all staff** in the division.
- **Org Development (OD)** — **read-only** across operational activity + **manages OKR**.
- **Directors** — see reports and manage employees across divisions.
- **One account per employee.** Some employees hold an **additional role** (OD or Director) layered on top of their division account.

### 2.8 Section structure per feature
Every feature is written as: **Rules → Flow → Example** (with a realistic sample-data table), then folded into the module's **System Requirements** (Roles + Features + field specs). Sample data is **continuous** across modules (same client/staff names — see OA-14).

### 2.9 Recurring division-specific patterns
Apply wherever relevant:
- **Lead/Staff visibility split** — recurs in Marketing, Account & Service, Creative, Ads, KOL.
- **Assign feature** — a client/task can be assigned to every team that works on it (one client → many teams simultaneously).
- **Two complaint intake doors** — Sales *and* Account & Service can log complaints; both feed the Client Health Report (Client Portal intake — see OA-7).
- **Execution time-tracking** — opening a brief = **start timestamp**; submitting work = **end timestamp** → duration computed. Slow work hurts the team's KPI. Lead sees workload by **count of undone tasks**.
- **Brief delivery** — Google Docs link **OR** long-form text, plus a deadline/timeline.
- **Outputs as links** — image / SKU / video / gdrive creator-list links.
- **Revision loop** — client revision (text) routes back to the executing division to redo (see OA-9 for whether it reopens the same task or spawns a new one).
- **Cross-division feedback loops** — Ads records *which video link generated sales* → visible to Creative; Ads scored on ROAS vs MEA & industry standard + client satisfaction; Creative receives revision/Lead feedback.
- **Payment routing (Admin & Finance):** `lunas` → data moves to Account; `tidak lunas` → stays in Admin & Finance; `bayar sebagian` → moves to Account with a note that only partial work proceeds (note tension with diagram 2 — see OA-2).

---

## 3. Entity & ID Registry

Entities the reference already defines (do not redefine, only reference):

| Entity | ID | Owner module | Notes |
|---|---|---|---|
| Prospect / Lead (sales-owned) | **Prospect ID** | Sales (reference) | Generated at "New Lead". |
| Client | **Client ID** | Sales → Client Info | Generated at closing. Long-term tracking key for Health Report. |
| Transaction | **Transaction ID** | Sales / Finance | Financial tracking + commission audit. |
| Service | **Service ID** | Sales → Account | One per service line, drives execution. |

New entities this build introduces (proposed prefixes — confirm in OA-13):

| Entity | Proposed ID | Created in module | Created when |
|---|---|---|---|
| Lead record (central registry) | **LEAD-…** | Leads Database | First valid registration; shared key across Marketing & Sales. |
| Campaign | **CMP-…** | Campaign | First-class entity threading Marketing → Sales → Account → execution. |
| Brief | **BRF-…** | Account & Service | Account issues a brief to Creative / Ads / KOL / (Live Stream). |
| Task | **TSK-…** | Project Management / Task Execution | A service-list breakdown becomes one or more tasks. |
| Creative output | **OUT-…** | Creative | Image / Desk / SKU / Video link bundle. |
| Creator List | **CRL-…** | KOL | gdrive link to proposed creators, pre/post QC. |
| Ads weekly summary | **ADS-…** | Ads | Weekly ad summary record (source = auto vs manual — see OA-4). |
| Complaint | **CMPL-…** | Sales + Account (+ Portal) | Two/three intake doors; feeds Health Report. |
| Report (weekly/monthly) | **RPT-…** | Service Teams → Account | Structured report entity for the monthly client meeting (see OA-11). |
| Client Health Report | **CHR-…** | Client Health Report | Auto-generated; one rolling record per client. |
| Performance Record | **PERF-…** | Team Performance | Auto-generated individual + team rollups, tied to OKR role. |

*(If Live Stream is confirmed as a distinct division — OA-1 — it inherits Brief/Task/Output/Report IDs like the other execution teams.)*

### 3.1 Registry reconciliation (post-build — added once Modules 1–15 were complete)

This table was written before the modules were detailed; several prefixes evolved during the actual build. This is the **as-built** registry — treat this table as authoritative over the proposals above where they differ:

| Originally proposed | As actually implemented | Where |
|---|---|---|
| `TSK-…` (generic Task) | **No separate Task entity exists.** "Task" is a conceptual role played by division-specific sub-entities — Asset (`AST-…`, Creative), Creator Booking (`BKG-…`, KOL), or the Brief itself (`BRF-…`) for single-unit divisions like Ads. Module 12's Task Execution engine adds computed fields (`turnaround_time`, `speed_score`, `revision_count`, etc.) directly onto whichever of these applies, rather than introducing a redundant universal record. | Module 7, 9, 12 |
| `OUT-…` (Creative output) | Implemented as **Asset (`AST-…`)** — broader than "output," since it also carries time-tracking, revision loop, and GMV attribution per-row. | Module 7 |
| `ADS-…` (Ads weekly summary) | Superseded by **Ad Campaign (`ADC-…`)** + **Metric Entry (`MTR-…`)** + **Optimization Log (`OPT-…`)** — a more complete model than a flat weekly summary record. | Module 8 |
| `CRL-…` (Creator List, own ID) | Implemented as a **compiled field set at Brief level** (Creator List Link, Included Bookings, Last Compiled — §10.5 of Module 9), not a separately-ID'd entity. | Module 9 |
| `CMPL-…` (Complaint) | Implemented as **`CPL-…`** — same entity, shorter prefix. | Module 6 |
| `CHR-…` (Client Health Report) | Implemented exactly as proposed — Client Health Report Snapshot, one immutable record per Client per month. | Module 13 |
| `PERF-…` (Performance Record) | Implemented exactly as proposed — Performance Score, one record per staff per month. | Module 14 |
| `RPT-…` (Report) | **Not implemented as a CDPS entity.** Client-facing reporting is handled by the existing `mea-client-reporting` system outside CDPS; Module 15's Client Portal embeds that system's output rather than CDPS storing its own Report records. | Module 15 |
| — | `DEP-…` (Dependency), `HSC-…`→renamed to `CHR-…` mid-build (see above), `STR-…` (Strategy & Plan), `INST-…` (Installment) | New entities not anticipated at Phase 0 — introduced as the relevant modules were detailed. |

---

## 4. Consolidated Role Matrix

Columns: **Staff (own data)** · **Lead/Head (division dashboard)** · **OD (read-only + OKR)** · **Director**. Every division reuses the reference's role model; OD and Directors are cross-cutting layers, not separate accounts.

| Division | Staff role | Lead / Head role | OD | Director |
|---|---|---|---|---|
| **Marketing** | Sees own campaigns, budget, leads-by-dashboard, CPL, sales, ROAS. | Dashboard over all marketing staff output. | Read-only + sets Marketing OKR. | Full view + manage employees. |
| **Sales / BizDev** *(reference)* | Sees own leads only; logs own complaints. | Sales analytics + monthly achievement vs OKR. | Read-only + sets Sales OKR. | Full view. |
| **Admin & Finance** | Manages payment status + payment-reminder dashboard. | Dashboard over all finance staff + receivables health. | Read-only + sets Finance OKR. | Full view. |
| **Account & Service** | Sees own assigned clients; breaks down service lists; logs complaints (2nd door); routes revisions. | Dashboard over all account staff output + GMV growth + #complaints. | Read-only + sets Account OKR. | Full view. |
| **Creative** | Sees own briefs/tasks/outputs + own time-tracking; receives revision/Lead feedback; sees which video drove sales. | Dashboard: all creative output + workload by undone-task count. | Read-only + sets Creative OKR. | Full view. |
| **Ads** | Sees own briefs/tasks/campaigns + own time-tracking; records which video link generated sales. | Dashboard: all ads output + ROAS vs MEA/industry + workload. | Read-only + sets Ads OKR. | Full view. |
| **KOL** | Sees own briefs/creator lists + QC + monthly KOL report; own time-tracking. | Dashboard: all KOL output + workload. | Read-only + sets KOL OKR. | Full view. |
| **Live Stream** *(pending OA-1)* | Sees own plan/execute tasks + time-tracking. | Dashboard: all live-stream output + workload. | Read-only + sets Live OKR. | Full view. |

Cross-cutting:
- **OD** — read-only across **all** operational activity, views detailed activity logs and analytics, and **inputs/manages OKR** for teams and individuals system-wide.
- **Directors** (Yohan, Nerissa, Hans per the reference) — view all reports and manage employees. One employee account each; OD/Director is an additional layered role.

---

## 5. Global Status Conventions

Statuses defined in the reference (do not redefine — modules reference them):

- **Lead/Prospect:** Pending Validation → New Lead → Contacted → (Qualified | Not Qualified) → Negotiation → (Negotiation–Pending Approval | –Approved | –Auto Approved | –Revision Required | –Rejected) → (Closed–Success | Closed–Lost); plus **Blocked**, **Rejected**.

New entities will each declare their own explicit status set + allowed transitions in their module, following §2.2. Provisional skeletons (to be detailed per module):

| Entity | As-built status (was "provisional," now finalized per the relevant module) |
|---|---|
| Campaign | `[Draft]` → `[Active]` ↔ `[Paused]` → `[Closed]` → `[Archived]` (Module 3) |
| Payment (Finance) | `[Menunggu Verifikasi]` → `[Terverifikasi - Sebagian]` ↔ → `[Lunas]`, with `[Jatuh Tempo]`/`[Bermasalah]` as parallel flags (Module 5) |
| Brief | `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]`/`[Revision Requested]`/`[Blocked]`/`[Cancelled — Service Voided]` (Module 6) — note: simpler than the original Draft/Sent/Opened skeleton, since "opening" and "starting" collapsed into one transition. |
| Task (conceptual — see §3.1) | Same machine as Brief, applied per-unit to Asset/Booking/Brief-as-task: `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]`/`[Revision Requested]`/`[Blocked]` (Module 12) |
| Complaint | `[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]` (Module 6) — matches the original skeleton exactly |
| Client Health | Auto-recomputed monthly snapshot, no manual status, banded Healthy/Watch/At Risk (Module 13, resolves §7 OA-3) |

Each module must spell out every transition explicitly and which transitions the system blocks.

---

## 6. Validated Client Journey (the spine)

Confirmed against diagram 2 (end-to-end) and diagram 1 (ecosystem map). Reading left→right, top→bottom:

1. **Marketing** runs campaigns/events → generates **Leads (online/offline)** into the **Leads Database**.
2. **Sales** prospects → qualifies → negotiates → **closes** (reference module). Closing produces **Client ID + Transaction ID + Service ID(s)**.
3. **Admin & Finance** verifies payment: `lunas` → routes to Account; `tidak lunas` → stays; `bayar sebagian` → routes to Account with partial-work note. *(Diagram shows "Payment 100% Received → Account Assignment" — reconcile in OA-2.)*
4. **Account & Service** receives client info + service list → **Project Initiation & Planning**: Service Breakdown · Task Creation · Resource Allocation · Timeline Setting · Budget Allocation.
5. **Task Execution Pipeline** — parallel execution teams: **Creative** (SKU/Content/Video) · **Ads** (Setup/Optimize/Monitor) · **KOL** (Find Creators/Negotiate/QC) · **Live Stream** (Plan/Execute — OA-1).
6. **Monitoring & Reporting** — Progress Tracking · Performance Analytics · Client Reporting · Team KPIs. Each division sends **weekly + monthly reports** back to Account.
7. **Client Meeting** (monthly) → **Feedback & Improvement** (revisions route back to executing division) → **Continuous Optimization**.
8. Complaints (Sales door + Account door + Portal) and outcomes (GMV before/after, ROAS, satisfaction, payment timeliness, delivery speed, revision count) feed the **Client Health Report** and the **Team Performance** rollup, surfaced on the **Central Database & Dashboard**, **Client Portal**, and **Team Portal**.

Diagram 3 confirms the **Client Health Dashboard** fields to support: Health Score (x/100), Revenue/GMV Growth (% MoM), Tasks Completion (% and count), Satisfaction Level (★ 1–5), Alerts (issue count), per-platform Project Status (platform/service/progress/deadline), Performance Metrics (ROAS, CPC, Conversion, CPM), and Upcoming Milestones.

---

## 7. Resolved Decisions — confirmation gate (closed out)

*Originally a pre-build confirmation gate; now resolved retroactively against the completed Modules 1–15. Numbering preserved for traceability.*

- **OA-1 (Live Stream as a division) — ✅ Resolved.** Outsourced to a sister-company vendor — a vendor-results tracker (Module 10), not an internal execution team.
- **OA-2 (Payment gate: full vs. partial) — ✅ Resolved.** Client releases to Account on **first confirmed payment**, any scheme (Module 5, M5-OA-1) — diagram 2's "100% Received" framing does not govern; partial/Termin verification is sufficient.
- **OA-3 (Client Health Score formula & thresholds) — ✅ Resolved.** Full weighted formula, bands, and component definitions specified in Module 13.
- **OA-4 (Ads weekly summary: auto vs. manual) — ✅ Resolved.** Manual entry or file export, confirmed weekly cadence (Module 8, M8-OA-2) — no automated platform pull yet.
- **OA-5 (ROAS benchmarks) — ⏳ Partially resolved.** *Authority* to set Target KPI is resolved (Module 8, M8-OA-4: AM negotiates, SPV Ads approves). The actual **benchmark numbers** (MEA standard, industry standard, per category/platform) are an operational data-entry task, not a design gap — populate via the Target KPI field per Ad Campaign as real campaigns are set up; no separate settings table was built for this in Phase 1.
- **OA-6 (Satisfaction capture) — ⏳ Still genuinely open.** Module 13 confirms Satisfaction stays a placeholder (N/A) until a capture mechanism exists; Module 15's Client Portal does not currently include a CSAT/rating input (it only displays a Health Summary band and accepts complaints). **A satisfaction-capture feature is not yet designed** — flagged as the most concrete piece of unfinished scope for a Phase 2 follow-up.
- **OA-7 (Complaint doors) — ✅ Resolved, three doors.** Sales (own clients, Module 4 §6), Account/AM-via-WhatsApp (primary, Module 6 §8), Client Portal (secondary, Module 15) — all write to the same Complaint entity (`CPL-…`, Module 6 §9.5) with a `Source` field distinguishing them, not three separate queues.
- **OA-8 (CPL & ROAS calculation basis) — ✅ Resolved.** CPL = Budget ÷ Lead-by-Dashboard; Cost per Real Lead = Budget ÷ Lead-Real-by-Sales; Marketing ROAS = Attributed Sales ÷ Budget, where Attributed Sales now uses **last-touch** attribution (Module 2, M2-OA-1/M2-OA-2).
- **OA-9 (Revision loop mechanics) — ✅ Resolved.** Reopens the same Task/Asset/Booking (never spawns a new linked one); Turnaround Time keeps running through revision rounds (doesn't reset); Revision Count increments and auto-flags Quality review at ≥3 (Module 12).
- **OA-10 (Time-tracking edge cases) — ✅ Resolved.** (a) An explicit transition to `[In Progress]` starts the clock, not merely viewing. (b) Yes, pausable via `[Blocked]` (SPV/Lead-only, Module 12 §2 Rule 8) — paused time is excluded from Turnaround. (c) Reopening after submission (a revision round) resumes the **same** cumulative timer, not a fresh one.
- **OA-11 (Reports as a first-class entity) — ✅ Resolved, differently than proposed.** No separate `RPT-…` CDPS entity was built — client-facing reporting runs through the existing `mea-client-reporting` system outside CDPS, which Module 15's Client Portal embeds natively rather than CDPS storing its own report records.
- **OA-12 (GMV-impact attribution) — ✅ Resolved.** Creative: Ads/Reporting tags the specific Asset used in a result-producing campaign (Module 7 §8, Module 8 §7), monthly-locked (M7-OA-4). KOL: trackable affiliate links where available (Module 9, M9-OA-4).
- **OA-13 (ID format) — ✅ Confirmed and used throughout.** `PREFIX-YYYYMM-NNNN` for every entity (see §3.1 reconciliation above for the as-built prefix list); IDR formatted as `Rp. X.XXX.XXX,00` system-wide.
- **OA-14 (Sample-data continuity) — ✅ Adopted.** Alpha Digital + Budi/Sinta/Rian/Kenny/Putri used consistently as the worked example across all 15 modules.
- **OA-15 (Account assignment authority) — ✅ Resolved.** Manual assignment by SPV/Head Account, not auto round-robin (Module 6 §3) — confirmed, no override needed (M6-OA-6 keeps this exclusive, no co-AM model). Assign authority to execution teams (creating Briefs) sits with the assigned AM.

---

## 8. Integration Contract — CDPS ⇄ existing HRIS (v2 addition)

The existing HRIS (employee data, attendance, leave; Golang backend, React/Next frontend, MySQL, REST, email-password login) is the **single source of truth for people data**. CDPS never maintains its own employee master or password store.

**Required from the HRIS side (minimal additions):**
1. `GET /employees` — id, nama, email, divisi, jabatan/role, status aktif. Consumed by CDPS on a scheduled sync + manual refresh trigger.
2. Auth endpoint — token issuance/validation against HRIS credentials, so every employee has **one login** across both systems.

**Required on the CDPS side:**
3. **Role-mapping table** (admin-managed, never hardcoded): HRIS jabatan/divisi → CDPS role per §4 Role Matrix (Staff / Lead-SPV per division), plus layered OD/Director roles.
4. **Deactivation propagation:** employee inactive in HRIS → CDPS access revoked automatically on next sync. Mandatory at >100 employees.
5. *(Later, optional)* monthly export of Module 14 Performance Scores back to the HRIS for HR review workflows.

**Other external touchpoints:** `mea-client-reporting` (embedded in Module 15 Client Portal — embeddability to be verified before Wave 3), WhatsApp (manual logging only, no auto-capture anywhere), Live Stream vendor (no system access, AM-entered, Module 10).

---

## 9. Notification Spec — global (v2 addition; channel confirmed: in-app only)

1. **Channel: in-app workspace notification center only** (confirmed). No email/WhatsApp delivery in v1 — the mechanism is designed so channels can be added later without changing event producers.
2. Mechanics: bell icon + per-user notification inbox; unread badge; each notification carries event type, deep-link to the entity, actor, timestamp. Read/unread state per user; notifications are never deletable (consistent with §2.3), only markable as read.
3. A notification is **derived from** the audit log, never a substitute for it.
4. **Event catalog (v1):**

| Module | Event | Recipient |
|---|---|---|
| M0 | Negotiation `Pending Approval` submitted | Superior (Sales Head/SPV) |
| M0 | Negotiation decision (Approved / Revision Required / Rejected) | Salesperson |
| M0/M5 | Installment due (H-3) and overdue (`[Jatuh Tempo]`) | Sales PIC (collection) + Finance (verification) — per Module 0 OD-3 |
| M5 | Contract not received 7 days after Account routing | Finance + SPV |
| M6 | Complaint logged (any door) | AM + SPV Account |
| M9 | QC Failed / Booking `[Escalated]` | KOL Lead |
| M10 | Session `[Discrepancy Flagged]` | SPV Account — real-time (M10-OA-3) |
| M11 | Blocking Dependency Satisfied | Target Brief PIC |
| M12 | Block request submitted | SPV/Lead (approval queue, Module 15) |
| M12 | Block request approved/rejected | Requester |
| M12 | Revision Count ≥ 3 (Quality flag) | Team Leader/SPV |
| M13 | Client band drop (e.g. Healthy → Watch) | SPV |
| M14 | Monthly Performance Score published | Each staff member |

---

## 10. Master Service List — administration (v2 addition; resolves Module 0 OD-2)

The Master Service List (service name, standard price, standard commission rule, active flag) drives every auto-computed **Estimasi Nilai Transaksi** and **Perhitungan Komisi**.

1. **Ownership: Sales division.** Master entries are added/edited by **Sales Head/SPV** — not by individual salespeople. The closing salesperson **selects** from the list; any deviation from standard price/commission/terms for a specific deal goes through the **Negotiation flow with superior approval** (Module 0 §5), exactly as already designed.
2. Every master change is **versioned and logged**; a closed deal permanently references the price/commission version in effect at its closing date — historical commissions never shift when the master changes.
3. Guardrail rationale: house convention §2.6 exists so commission math can't be fudged. Edit rights therefore sit one approval level above the person whose commission depends on the numbers.

---

## 11. Client Portal — security minimums (v2 addition; forward requirement for Module 15)

Module 15's Client Portal is the only **external-facing** surface. Before it is built (Wave 3), a short security spec must cover, at minimum: a separate auth realm for client contacts (never mixed into the HRIS employee sync), per-Client data isolation enforced at the query layer (strict allow-list per Module 15 §6.1 — not permission-trimmed internal views), rate limiting on login and the complaint form, session expiry, and per-contact action audit. Internal Team Portal reuses the standard HRIS-backed auth (§8).
