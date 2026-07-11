# CDPS — Module 6: Account & Service

> **Position in the journey:** the **translation layer** between "client bought a Service" (Module 4) and "execution teams have work to do" (Modules 7–10). Account receives the client the moment Finance verifies first payment (Module 5 §5), assigns an Account Manager (AM), decides — **per Service, not per client** — whether that Service needs a Strategy & Plan first or can be broken down straight into Briefs, then dispatches Briefs to Creative / Ads / KOL / Live Stream. Account is also the **primary complaint door** in practice.

## Contents
1. Background & Objective
2. Core concept: per-Service execution path (Plan-gated vs Direct)
3. Feature: Client intake & AM assignment (manual, SPV/Head Account)
4. Feature: Strategy & Plan (for plan-gated services)
5. Feature: Service → Brief breakdown (multi-division)
6. Feature: Brief dispatch & status — including the Live Stream exception
7. Feature: Revision routing
8. Feature: Complaint door #2 (AM via WhatsApp)
9. System Requirements (Roles + Features + field specs)
10. Open Assumptions (Module 6)

---

## 1. Background & Objective

A client doesn't buy one uniform "thing" — the Service List on a Client Record (Module 4) can mix a full-package service that genuinely needs a strategy (channel mix, target KPI, timeline) with a narrow one-off service that doesn't need anything more than "assign it and go." Treating every Service the same way either over-processes simple work (slowing delivery) or under-plans complex work (hurting GMV growth and Health Score). Yohan confirmed this directly: **the gate depends on which service the client bought, not a single rule for the whole client.**

This module gives Account a clean intake (one AM owns the whole client relationship, assigned manually by SPV/Head Account — not auto-distributed), a **per-Service branch** (Plan-gated vs Direct), and a breakdown mechanism where **one Service can fan out into several Briefs across different execution divisions at once** (also confirmed). It also formalizes Account's role as the **primary complaint door** (Phase 0 OA-7) since in practice that's WhatsApp-to-AM, not the Client Portal.

Expected result: every Service has a clear, auditable path from "bought" to "being executed," the right amount of planning rigor per service type, full traceability from Service → Strategy (if any) → Brief → division, and complaints land somewhere even before the Client Portal (Module 15) exists.

---

## 2. Core concept: per-Service execution path (Plan-gated vs Direct)

- Every Service Type in the **Service Catalog** (maintained by SPV/OD — house convention, consistent with Marketing/Campaign catalogs in earlier modules) carries a flag: **Requires Strategy Plan** (`Yes`/`No`), set when the catalog entry is defined. Examples: "TikTok Shop Full Management" → `Yes`; "Single KOL Booking" → `No`.
- When a Service is created at closing (Module 4), it **inherits** this flag (read-only) and gets an **Execution Path**:
  - **Plan-gated path:** `[Awaiting Onboarding]` → `[Strategy Drafting]` → `[Strategy Submitted for Approval]` → `[Strategy Approved]` → `[Briefed]` → `[In Execution]`.
  - **Direct path:** `[Awaiting Onboarding]` → `[Direct Breakdown]` → `[Briefed]` → `[In Execution]`.
- **A single Client Record can have Services on both paths simultaneously** — e.g. Alpha Digital's "TikTok Shop Full Management" runs Plan-gated while their "Single KOL Booking" add-on runs Direct, in parallel, under the same AM.
- This status lives **on the Service**, not on the Client — the Client Record itself has no single "onboarding status"; its state is the sum of its Services' states.

---

## 3. Feature: Client intake & AM assignment (manual, SPV/Head Account)

### Rules
1. A Client Record enters Account's **Unassigned Intake Queue** the instant it's released by Finance (Module 5 §5) — visible only to **SPV/Head Account** at this stage, not to individual AMs.
2. **AM assignment is manual** — SPV/Head Account picks the AM (confirmed: not auto round-robin, not AM self-claim). One AM owns the **entire client relationship** (all Services, all divisions touching that client) — there is no per-Service AM split.
3. Assignment is logged (immutable): who assigned, to whom, when. Reassignment follows the same rule and is logged with reason.
4. Once assigned, the client and all its Services move from the Unassigned queue into that AM's personal queue; every Service still starts at `[Awaiting Onboarding]` regardless of path.
5. SPV/Head Account dashboard shows each AM's **active-client count** (read-only counter) to inform assignment decisions — not a hard capacity cap, just visibility.

### Flow
1. Finance verifies first payment → Client Record appears in SPV's Unassigned Intake Queue.
2. SPV reviews (client profile, services bought, AM workload) and assigns an AM.
3. System notifies the AM; all Services on the client move to their starting state per §2.
4. AM begins per-Service triage: Plan-gated services go to §4, Direct services go straight to §5.

### Example
Alpha Digital (closed by Budi, Termin scheme) is released to Account after Installment 1 verification (Module 5 §5 example). SPV assigns AM **Sinta**. Alpha Digital's Service List: "TikTok Shop Full Management" (`Requires Strategy Plan = Yes`) and "Single KOL Booking — Launch Push" (`Requires Strategy Plan = No`). Both land in Sinta's queue at `[Awaiting Onboarding]`.

---

## 4. Feature: Strategy & Plan (for plan-gated services)

### Rules
1. A **Strategy & Plan record** (`STR-…`) is created by the AM for each Service whose catalog flag is `Yes`. One Strategy per Service (1:1).
2. Plan contents: Objective, Target KPI (e.g. Target GMV growth %, channel-specific targets), Divisions Involved (multi-select — which of Creative/Ads/KOL/Live Stream this service will need), a **Planned Brief Outline** (rough list of what Briefs will be created and roughly when — not the Briefs themselves yet), and Timeline.
3. Plan moves `[Strategy Drafting]` → `[Strategy Submitted for Approval]` when AM submits.
4. **SPV/Head Account approves or requests revision** — `[Strategy Approved]` or back to `[Strategy Drafting]` (loop) with feedback notes (logged, mirrors the revision-loop pattern used everywhere else in the system).
5. Only on `[Strategy Approved]` can the AM proceed to generate actual Briefs (§5) for that Service — Briefs cannot be created against a Plan still in draft or under review.
6. Direct-path Services skip this feature entirely — no Strategy record exists for them.

### Flow
1. AM drafts the Plan for a `Yes`-flagged Service.
2. AM submits → SPV reviews against the client's baseline GMV/target (Module 4 fields) and the agreed Service scope.
3. Approved → Service status flips to `[Strategy Approved]`, unlocking Brief creation (§5).
4. Revision requested → AM redrafts, resubmits (counter tracked, same revision-counting principle as Module 4 OA-3 insight).

### Example
Sinta drafts a Plan for Alpha Digital's "TikTok Shop Full Management": Objective = "grow GMV 30% in 60 days," Divisions Involved = Creative + Ads, Planned Brief Outline = "12 product videos, 2 ad campaigns, weekly content cadence." SPV approves on first pass → Service moves to `[Strategy Approved]`.

---

## 5. Feature: Service → Brief breakdown (multi-division)

### Rules
1. A **Brief** (`BRF-…`) is the unit of work actually sent to **one** execution division (Creative / Ads / KOL / Live Stream). **One Service can generate multiple Briefs across multiple divisions** (confirmed) — there is no 1:1 constraint between Service and Brief.
2. For Plan-gated Services, Briefs are created **from the approved Plan's outline** (§4) — each Brief should trace back to a line in that outline, though AM can add Briefs beyond the original outline if scope genuinely expands (logged as a Plan addendum, not a silent change).
3. For Direct-path Services, AM creates Brief(s) straight away — no Plan record exists to trace back to; the Brief itself documents its own justification.
4. Each Brief is independent once created — different divisions execute on different timelines, and one division finishing doesn't block another.
5. Briefs cannot be created while the parent Service's Execution Path is incomplete (Plan-gated: must be `[Strategy Approved]`; Direct: must have passed `[Direct Breakdown]`).
6. **Void Service cascade (new, closes a cross-module gap with Module 4 §8 M4-OA-5):** if a Service is Voided (Sales input error, not an upsell), any of its child Briefs that have **not yet reached `[Approved]`** auto-cancel to a terminal `[Cancelled — Service Voided]` state, logged. Briefs already `[Approved]` under that Service are left untouched since the work was already delivered.

### Flow
1. (Plan-gated) AM opens the approved Plan's outline and creates one Brief per planned item, choosing target division for each.
   (Direct) AM opens the Service directly and creates Brief(s) as needed.
2. On creation, each Brief is pushed into its target division's queue (§6) and the Service status advances to `[Briefed]`.
3. Once any Brief under a Service moves out of `[To Do]`, that Service's status advances to `[In Execution]`.

### Example
From Alpha Digital's approved Plan, Sinta creates: **Brief #1 — 12 Product Videos** → Creative; **Brief #2 — TikTok Ads Campaign** → Ads. Both reference Service "TikTok Shop Full Management." Separately, for the Direct-path "Single KOL Booking" service, Sinta creates **Brief #3 — Book 1 Launch KOL** → KOL, with no Strategy record behind it.

---

## 6. Feature: Brief dispatch & status — including the Live Stream exception

### Rules
1. **Standard execution divisions** (Creative, Ads, KOL) receive Briefs into an internal Kanban-style queue: `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` (AM) → `[Approved]` / `[Revision Requested]` (loop) / `[Blocked]`. Full division-specific detail lives in Modules 7–9; this module only defines the **handoff contract** (the Brief fields both sides rely on).
2. **Live Stream is the exception** (Phase 0 OA-1, confirmed): MEA outsources live streaming to a sister-company vendor. A Brief targeting Live Stream does **not** enter an internal Kanban — it routes to the **vendor-results tracker** (Module 10), which records what was requested of the vendor and what the vendor delivered, without an internal execution status machine.
3. AM acts as the **client's proxy for first-pass review** — Briefs move through `[In Review]` with the AM evaluating quality against the Brief's brief/instructions; the client does not approve individual Briefs in this module (client-facing visibility is a Reporting/Portal concern — Modules 12–14).
4. Every Brief carries a **revision counter** (read-only, auto-incremented each time AM sends it back from `[In Review]` to `[Revision Requested]`) — feeds Health Score and Team Performance later.

### Flow
1. Brief created (§5) → appears in the target division's queue at `[To Do]`.
2. Division PIC works it → `[In Progress]` → `[Submitted]` (asset/output link attached).
3. AM reviews → `[Approved]` (done) or `[Revision Requested]` (back to division, counter +1).
4. For Live Stream Briefs: AM logs the vendor request; vendor's actual delivered results are recorded in Module 10's tracker, referenced back to this Brief ID for traceability.

### Example
Brief #1 (12 Product Videos, Creative) reaches `[Submitted]`; Sinta reviews 12 videos, requests revision on 2 of them (counter → 1), approves the rest. Brief #3 (KOL Booking) goes `[To Do]` → `[In Progress]` → `[Submitted]` → `[Approved]` cleanly. If Alpha Digital had purchased a Live Stream add-on, that Brief would instead show up only as a vendor request in Module 10, not in this Kanban.

---

## 7. Feature: Revision routing

### Rules
1. Revisions are routed **back to the same division/PIC** that submitted the work — Account never reassigns a revision to a different division.
2. A revision request must include AM's written feedback (mandatory field) — no silent rejections.
3. Revision counts roll up to the **Service** (sum of its Briefs' revision counts) and to the **Client** (sum across all Services) for Health Score input (Module 4/Phase 0 OA-3 insight: high revision count = quality risk signal).
4. There is no hard cap enforced automatically, but a Brief crossing **3 revisions** is flagged for SPV visibility (does not block work, just surfaces it — see M6-OA-3).

### Flow
1. AM marks a Submitted Brief as `[Revision Requested]` with feedback.
2. Division PIC sees the feedback in their queue, reworks, resubmits.
3. Cycle repeats until `[Approved]`; each loop increments the counter (§6 Rule 4).

---

## 8. Feature: Complaint door #2 (AM via WhatsApp)

### Rules
1. Confirmed (Phase 0 OA-7): in practice, **the Account Manager via WhatsApp is the primary complaint channel** — the Client Portal (Module 15) is the secondary, formal door, built later.
2. Since WhatsApp itself isn't part of this system, the AM **manually logs** a Complaint record (`CPL-…`) after receiving one — there is no auto-capture from WhatsApp in this module's scope.
3. A Complaint can optionally reference a specific Service/Brief (e.g. "video quality") or stay client-level (e.g. "GMV not growing," "communication too slow").
4. Complaint routing: if tied to a specific Brief, it's visible to that division too (read-only, context); resolution ownership stays with the **AM** regardless — divisions don't close complaints, only contribute to resolving them.
5. Complaint status: `[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]` (AM confirms client is satisfied before closing — distinct from Resolved, which just means action was taken).
6. Open complaint count feeds Health Score directly (Phase 0 OA-3).

### Flow
1. Client messages AM on WhatsApp with a complaint.
2. AM opens the Client Record, logs a new Complaint (description, severity, optional Service/Brief link).
3. AM resolves directly or coordinates with the relevant division (e.g. asks Creative to fix flagged footage) → updates status as it progresses.
4. AM follows up with the client, then marks `[Closed]`.

### Example
Alpha Digital's client messages Sinta complaining 2 of the product videos look rushed. Sinta logs `CPL-202606-0009`, links it to Brief #1, severity Medium. She coordinates with Creative for a fix (which also shows as a revision on Brief #1), then closes the complaint once the client confirms satisfaction.

---

## 9. System Requirements

### 9.1 Roles

| Role | Capabilities in Module 6 |
|---|---|
| **Account Manager (AM)** | Owns assigned clients end-to-end: drafts/submits Strategy Plans, creates Briefs (plan-gated or direct), reviews submissions, requests revisions, logs/resolves complaints. Sees only own clients. |
| **SPV / Head Account** | Manual AM assignment + reassignment (logged); approves/rejects Strategy Plans; sees all clients, all AMs' workload; visibility on 3+ revision flags; resolves escalated complaints. |
| **Creative / Ads / KOL (Staff)** | Own division's Brief queue; submit work; receive revision feedback. (Full detail: Modules 7–9.) |
| **Live Stream (vendor)** | No direct system access — represented via Module 10's vendor-results tracker, referenced from Briefs created here. |
| **Org Development (OD)** | Read-only across all clients, Strategies, Briefs, Complaints + audit logs. |
| **Director** | Full view; final escalation authority on disputed complaints. |

### 9.2 Features
1. Client intake queue + manual AM assignment.
2. Per-Service Execution Path (Plan-gated vs Direct), branching at the catalog flag.
3. Strategy & Plan creation, submission, and SPV approval/revision loop.
4. Service → Brief breakdown (multi-division fan-out).
5. Brief dispatch + status handoff to execution divisions, with Live Stream routed to vendor-tracker mode.
6. Revision routing + counter (rolls up to Service/Client for Health Score).
7. Complaint logging (AM/WhatsApp door) + status + Health Score feed.

### 9.3 Field specs — Strategy & Plan (`STR-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Strategy ID | system | auto | `STR-YYYYMM-NNNN`. |
| Service ID | reference | auto | Parent Service; 1:1. |
| Objective | text | **mandatory** | Free text goal statement. |
| Target KPI | text/number | **mandatory** | e.g. target GMV growth %. |
| Divisions Involved | multiple choice | **mandatory** | Creative / Ads / KOL / Live Stream — informs which queues will receive Briefs. |
| Planned Brief Outline | text (list) | **mandatory** | Rough list of intended Briefs; traced when Briefs are actually created. |
| Timeline | date range | **mandatory** | Plan horizon. |
| Status | system (state machine) | auto | `[Strategy Drafting]` / `[Strategy Submitted for Approval]` / `[Strategy Approved]`. |
| Approved By | reference (user) | auto | SPV/Head Account. |
| Revision Notes | text | conditional | Required when sent back to Drafting. |

### 9.4 Field specs — Brief (`BRF-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Brief ID | system | auto | `BRF-YYYYMM-NNNN`. |
| Service ID | reference | auto | Parent Service. |
| Strategy ID | reference | optional | Null if Direct-path. |
| Assigned Division | single choice | **mandatory** | Creative / Ads / KOL / Live Stream. |
| Assigned PIC | reference (user) | optional | Division lead can assign later. |
| Deliverable Type | catalog select | **mandatory** | e.g. Product Video, Ad Campaign, KOL Booking. |
| Quantity / Target | number | **mandatory** | |
| Due Date (SLA) | date | **mandatory** | |
| Priority | single choice | **mandatory** | Low / Medium / High. |
| Recurring? | toggle | optional | If yes: frequency, count, end date. |
| Instructions / Notes | text | optional | |
| Reference Attachments | link | optional | |
| Status | system (state machine) | auto | `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]`/`[Revision Requested]`/`[Blocked]`/`[Cancelled — Service Voided]`. (Live Stream Briefs skip this — see Module 10. `[Cancelled — Service Voided]` is terminal, set only via the Void Service cascade, §5 Rule 6.) |
| Revision Count | system | auto | Increments on each `[Revision Requested]`. |

### 9.5 Field specs — Complaint (`CPL-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Complaint ID | system | auto | `CPL-YYYYMM-NNNN`. |
| Client ID | reference | auto | |
| Related Service/Brief | reference | optional | |
| Source | single choice | auto | `WhatsApp (AM-logged)` / `Client Portal` (Module 15) / `Sales` (Phase 0 §2.9 — Sales can also log a complaint for a client they own, per Module 4 §6 Rule 1; resolves Phase 0 OA-7 as three effective doors). |
| Description | text | **mandatory** | |
| Severity | single choice | **mandatory** | Low / Medium / High. |
| Status | system (state machine) | auto | `[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]`. |
| Assigned To | reference (user) | auto | Defaults to owning AM. |
| Resolution Notes | text | conditional | Required before `[Resolved]`. |

---

## 10. Resolved Decisions (Module 6)

- **M6-OA-1 (Plan-flag override) — ✅ Confirmed as proposed.** An AM/SPV can override the catalog's `Requires Strategy Plan` flag per-engagement, with a logged reason.
- **M6-OA-2 (AM workload visibility) — ✅ Confirmed as proposed.** No hard cap — SPV monitors each AM's active-client count as a soft signal only.
- **M6-OA-3 (Revision escalation) — ✅ Confirmed as proposed**, and consistent with Module 12's Task-level auto-flag (Revision Count ≥3): 3+ revisions on one Brief surfaces SPV visibility, doesn't block or auto-escalate further on its own.
- **M6-OA-4 (Severity definition) — ✅ Resolved.** Using the existing `Low / Medium / High` field (§9.5), criteria + Health Score penalty (Module 13) are now explicit:
  - **Low** — minor/cosmetic, doesn't materially affect the deliverable or GMV, no churn signal. Health Score penalty: **−5**.
  - **Medium** — noticeably affects the work product or client experience but is recoverable, no churn signal. Penalty: **−15**.
  - **High** — GMV-impacting, or the client explicitly signals dissatisfaction / possible churn. Penalty: **−30**.
- **M6-OA-5 (Plan addendum vs. full re-approval) — ✅ Confirmed as proposed.** Light addendum — SPV approves quickly, no full restart from `[Strategy Drafting]` required for scope additions within the approved Plan's spirit.
- **M6-OA-6 (Client-level AM exclusivity) — ✅ Confirmed as proposed.** Exactly one AM per client at all times — no structural co-AM model. When the primary AM is unavailable (leave, departure), SPV uses the **existing reassignment mechanism** (§3 Rule 3) to assign temporary or permanent coverage; no separate "backup AM" field is pre-set per client.
- **M6-OA-7 (Client-facing approval) — ✅ Confirmed as proposed.** AM approves Briefs and sends results to the Client directly once internal status is `[Approved]` — no mandatory SPV sign-off gate before client-facing delivery.

---

**Next:** Module 7 — Creative (Brief intake from this module's queue, asset output, time-tracking, KPI by speed/output/GMV impact, revision loop execution side, and which video links drove sales — feedback to this module and to Ads).
