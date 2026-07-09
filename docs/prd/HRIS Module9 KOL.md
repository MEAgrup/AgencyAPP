# HRIS — Module 9: KOL

> **Position in the journey:** the **execution-side detail** for every Brief that Module 6 dispatched to KOL. This is **MEA Agency's KOL booking service for its own clients** — distinct from MCN MEA's creator-affiliate economy (GO Ladder, Deal Activation Rate, GMV-leakage tracking) covered elsewhere; KOL here means "secure creator(s) to produce content for Client X's campaign," not "manage MEA's affiliate creator roster." The unit of work is the **Creator Booking** — closer in spirit to Creative's Asset (fan-out per unit) but with an extra wrinkle Creative and Ads don't have: **the creator is an external party MEA doesn't fully control**, so the lifecycle needs room for sourcing, negotiation, and the possibility a creator simply doesn't deliver.

## Contents
1. Background & Objective
2. Core concept: Brief → Creator Booking (and why externality matters)
3. Feature: KOL queue & roles
4. Feature: Creator Booking — sourcing through content delivery
5. Feature: QC & the revision/escalation path
6. Feature: Compiled Creator List output
7. Feature: Time-tracking
8. Feature: Creator Payment Request (KOL → Finance)
9. Feature: Monthly KOL Report
10. System Requirements (Roles + Features + field specs)
11. Open Assumptions (Module 9)

---

## 1. Background & Objective

Booking a creator for a client campaign looks like Creative or Ads work on the surface — a Brief comes in, something gets produced, AM reviews it. But a creator isn't an internal staff member: they can be slow to confirm, miss a deadline, deliver content that doesn't follow the brief (missing brand mention, wrong hashtag, no required disclosure), or simply go unresponsive. None of the other execution modules need to model "the person doing the work might not show up" — KOL does.

This module treats each individual creator engagement as a **Creator Booking**, gives it a lifecycle that includes sourcing and negotiation (not just "in progress → submitted"), defines what **QC** actually checks before a booking counts as fulfilled, and gives KOL an explicit **escalation path** for when a creator can't be salvaged — something Creative/Ads don't need because their PICs are internal staff who can always be reassigned or pushed.

Expected result: every creator engagement is tracked individually even when a Brief covers several creators at once, QC has a real checklist instead of a vague "looks fine," stalled bookings surface to AM instead of quietly sitting unresolved, and the client-facing output (a clean creator list with content links) is easy to compile and share.

---

## 2. Core concept: Brief → Creator Booking (and why externality matters)

- A **Creator Booking** (`BKG-…`) is a child of a KOL Brief — one row per creator, same fan-out principle as Module 7's Asset and Module 8's Ad Campaign. A Brief for "Book 5 Micro KOLs" generates up to 5 Booking rows.
- Unlike Creative's Asset (internal staff, predictable lifecycle) or Ads' Campaign (a system MEA fully controls), a Booking's early stages depend on an **external party agreeing to terms** — so its lifecycle starts earlier (sourcing/negotiation) and includes a real possibility of failure that has to route somewhere (§5), not just loop indefinitely like an internal revision.
- **Brief status** (Module 6's universal Kanban) rolls up the same way Creative's does: `[Submitted]` once every expected Booking has at least delivered content; `[Approved]` only when every Booking has passed QC (or been formally dropped/replaced — see §5).

---

## 3. Feature: KOL queue & roles

### Rules
1. KOL roles: **KOL Coordinator** (sources, negotiates, manages relationships) and a **KOL Team Leader** overseeing the team.
2. Each Coordinator sees a personal queue of assigned Bookings across all clients, sorted by due date and current lifecycle stage (a stalled `[Sourcing]` booking near its deadline is more urgent than a `[Content Submitted]` one waiting on QC).
3. Team Leader can reassign a Booking to a different Coordinator (logged) — useful if a Coordinator's creator relationship isn't working out.

### Flow
1. Brief arrives from Module 6 in the KOL queue.
2. Team Leader assigns Booking(s) to Coordinator(s) — one Coordinator can own multiple Bookings under the same Brief, or they can be split across Coordinators.
3. Each Coordinator works their Bookings through §4–§5 independently.

---

## 4. Feature: Creator Booking — sourcing through content delivery

### Rules
1. Booking lifecycle: `[Sourcing]` (identifying/negotiating with a creator) → `[Booked]` (terms agreed — rate, deliverable, deadline) → `[Content In Progress]` → `[Content Submitted]` (content link attached, mandatory) → `[QC Review]` (§5).
2. **Sourcing priority (confirmed):** Coordinators try **MCN MEA's creator roster first** → fall back to **KOL's own established External Creator Pool** (a pool of vetted, previously-worked-with creators outside MCN MEA that the KOL team maintains directly) → only source a **fresh, ad-hoc** creator as the last resort if neither pool has a fit. Each Booking captures: Creator Name/Handle, Platform, Niche/Category, **Agreed Rate** (Rp), **Source Pool** (MCN MEA Roster / KOL External Pool / Ad-hoc New), and an optional reference into whichever pool was used.
3. Submission requires a content link (post URL, Drive link, or platform link) — system blocks `[Content Submitted]` without it.
4. A Booking that sits in `[Sourcing]` past a reasonable window (default: half the Brief's remaining time to due date) flags Coordinator/Team Leader visibility — early warning before it becomes a deadline problem.

### Flow
1. Coordinator identifies and negotiates with a creator → `[Booked]` once terms are agreed.
2. Creator produces content; Coordinator tracks progress → `[Content In Progress]`.
3. Creator delivers; Coordinator attaches the link → `[Content Submitted]`, moves to QC (§5).

### Example
Brief #3 ("Book 1 Launch KOL," Alpha Digital, from Module 6's example) is assigned to **KOL Coordinator Putri**. She creates `BKG-202606-0005`: Creator = a TikTok micro-creator outside MCN MEA's roster, Platform = TikTok, Agreed Rate = Rp 1.500.000. Negotiation closes same day → `[Booked]`. Content delivered 3 days later, Putri attaches the post link → `[Content Submitted]`.

---

## 5. Feature: QC & the revision/escalation path

### Rules
1. QC checks the submitted content against the Brief's requirements: brand/product mention present, required hashtag/tag used, **disclosure/FTC-style transparency** where applicable, content quality acceptable, on-brand tone.
2. QC outcome: `[QC Passed]` (Booking fulfilled) or `[QC Failed - Revision Requested]` (specific, written feedback; sent back to the creator outside the system — via WhatsApp/contract terms — then re-submitted).
3. **Revision allowance is capped** (default: 1 revision round per booking, matching typical creator-contract terms) — confirm exact cap (M9-OA-2). A Booking exceeding the cap, or where the creator goes unresponsive, moves to `[Escalated - Creator Unresponsive]`.
4. `[Escalated]` is visible to AM/Team Leader for a decision: extend patience, drop the creator and re-source (new Booking row, original marked `[Dropped]`, logged with reason), or accept content as-is with noted compromises.
5. QC Revision Count (per Booking) rolls up to the Brief, same convention as other divisions — feeds Health Score same as everywhere else.

### Flow
1. Coordinator (or Team Leader) reviews submitted content against the checklist (§5 Rule 1).
2. Pass → `[QC Passed]`. Fail → feedback sent to creator, `[QC Failed - Revision Requested]`, counter +1.
3. If cap exceeded or creator unresponsive → `[Escalated]` → AM/Team Leader decides next step; if they disagree, SPV/Head Account makes the final call (M9-OA-6).

### Example
Putri reviews `BKG-202606-0005`'s content — missing the required product-link sticker. She requests revision (1 round allowed); creator fixes it within a day; Putri approves → `[QC Passed]`. Revision Count = 1.

---

## 6. Feature: Compiled Creator List output

### Rules
1. The Brief's client/AM-facing deliverable is a **Creator List** — a single Drive document compiling every `[QC Passed]` Booking under that Brief: creator name/handle, platform, content link, and (if available) basic reach/engagement numbers.
2. The eligibility logic is **auto-compiled** from Booking data (no separate manual sheet to maintain in parallel) — but generating/refreshing the actual Drive document is a **manual, Coordinator-triggered** one-click action (✅ resolved, M9-OA-3), not continuously live.
3. Bookings still `[Escalated]` or `[Dropped]` don't appear in the compiled list until resolved (either fixed or formally excluded) — the list always reflects only confirmed, passed deliverables.

### Flow
1. As Bookings reach `[QC Passed]`, they become eligible for the compiled list.
2. AM/Coordinator generates or refreshes the Creator List doc when ready to share — system always knows which Bookings qualify, removing guesswork about what's "actually done."

### Example
Once `BKG-202606-0005` passes QC, it's the sole entry compiled into Alpha Digital's Creator List for Brief #3 — one row, one link, ready to share.

---

## 7. Feature: Time-tracking

### Rules
1. **Sourcing-to-Booked time** and **Booked-to-Content-Submitted time** are tracked separately (read-only, auto) — they measure different things: how hard a creator was to land vs. how reliably they deliver once committed.
2. Same supplementary, non-punitive **Hours Logged** option as Creative (Module 7 §5), for Coordinator effort tracking if desired.

### Flow
Status timestamps are captured automatically on every Booking transition; the two turnaround metrics compute from them without extra entry.

---

## 8. Feature: Creator Payment Request (KOL → Finance)

### Rules
1. **Confirmed split:** KOL **requests** creator payment; **Admin & Finance (Module 5) actually executes** it. KOL never pays a creator directly out of its own process — this keeps all outgoing money, client or vendor, inside Finance's existing verification discipline.
2. A **Creator Payment Request** (`CPR-…`) is created by the Coordinator once a Booking reaches `[QC Passed]` (no point requesting payment for content that hasn't passed) — references the Booking, Agreed Rate, and creator's payment details (bank/e-wallet info).
3. Request status: `[Requested]` → `[Received by Finance]` → `[Paid]` (Finance confirms disbursement, mirrors the verification discipline used for client payments in Module 5, just in the outgoing direction) — or `[Rejected]` (Finance flags an issue, e.g. mismatched rate or missing details; sent back to KOL with a reason).
4. Booking's payment status is read-only, reflecting the linked Creator Payment Request's status — Coordinators can see whether their creator has actually been paid without having to ask Finance directly.

### Flow
1. Coordinator submits a Creator Payment Request once QC passes.
2. Finance receives it in their queue (alongside client-payment verification work from Module 5), confirms details, disburses, marks `[Paid]`.
3. Booking reflects `[Paid]` automatically — closes the loop on that creator engagement.

### Example
Once `BKG-202606-0005` passes QC, Putri submits `CPR-202606-0003` for Rp 1.500.000. Finance verifies the creator's bank details and the rate matches the Booking, disburses, marks `[Paid]` — Putri sees the Booking reflect payment without following up over WhatsApp.

---

## 9. Feature: Monthly KOL Report

### Rules
1. A **Monthly KOL Report** (auto-compiled, read-only) rolls up across all of a Coordinator's/the team's Bookings for the month: total Bookings, QC pass rate, average sourcing time, total spend (sum of Agreed Rates), and Escalation count.
2. This is KOL's equivalent of Creative's Daily Output → KPI pipeline, just at monthly cadence (matching how KOL work is naturally paced — booking cycles run longer than a single day's task).
3. Report feeds Team Performance (Module 13/14) the same way Creative's and Ads' KPI data does.

### Example
Putri's Monthly Report for June: 6 Bookings, 5 QC-passed on first submission, 1 revision round used, 0 escalations, total creator spend Rp 9.200.000 — a clean month, visible to the KOL Team Leader and SPV without anyone compiling it by hand.

---

## 10. System Requirements

### 10.1 Roles

| Role | Capabilities in Module 9 |
|---|---|
| **KOL Coordinator** | Own Booking queue; source/negotiate, track content, run QC, request creator revisions, escalate when needed; see own Monthly Report. |
| **KOL Team Leader** | Reassign Bookings (logged); view team's Bookings/Reports; decide on escalated Bookings. |
| **Account Manager (AM)** | Reviews overall Brief (rolls up from Bookings); weighs in on `[Escalated]` decisions; receives compiled Creator List. |
| **SPV / Head Account** | Visibility on escalations and QC pass-rate trends across all clients. |
| **Org Development (OD)** | Read-only on all Bookings, Monthly Reports, audit logs. |
| **Director** | Full view. |

### 10.2 Features
1. Creator Booking sub-entity (fan-out per creator, mirrors Asset/Ad Campaign pattern).
2. Sourcing-through-delivery lifecycle, accounting for external-party uncertainty, with confirmed sourcing priority (MCN MEA Roster → KOL External Pool → Ad-hoc).
3. QC checklist + capped revision loop + escalation path for unresponsive/failing creators.
4. Auto-compiled Creator List output (Drive-based deliverable).
5. Time-tracking (sourcing speed + delivery reliability, tracked separately).
6. Creator Payment Request — KOL requests, Finance (Module 5) executes.
7. Monthly KOL Report (team/Coordinator roll-up).

### 10.3 Field specs — Creator Booking (`BKG-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Booking ID | system | auto | `BKG-YYYYMM-NNNN`. |
| Brief ID | reference | auto | Parent Brief. |
| Creator Name / Handle | text | **mandatory** | |
| Platform | single choice | **mandatory** | TikTok / Instagram / YouTube / etc. |
| Niche/Category | text | optional | |
| Source Pool | single choice | **mandatory** | `MCN MEA Roster` / `KOL External Pool` / `Ad-hoc New` — reflects confirmed sourcing priority. |
| Pool Reference | reference | conditional | Link into MCN MEA roster or KOL's own External Pool, if applicable. |
| Agreed Rate | number (Rp) | **mandatory** | |
| Status | system (state machine) | auto | `[Sourcing]` → `[Booked]` → `[Content In Progress]` → `[Content Submitted]` → `[QC Review]` → `[QC Passed]`/`[QC Failed - Revision Requested]`/`[Escalated - Creator Unresponsive]`/`[Dropped]`. |
| Content Link | link | **mandatory** before `[Content Submitted]` | |
| QC Notes | text | conditional | Required on fail/escalate. |
| QC Revision Count | system | auto | Capped per M9-OA-2 default. |
| Sourcing Turnaround | system | auto | `[Booked] timestamp − Booking created`. |
| Delivery Turnaround | system | auto | `[Content Submitted] timestamp − [Booked] timestamp`. |
| Hours Logged | number | optional | Self-reported. |
| Payment Status | system | auto | Read-only, reflects linked Creator Payment Request (§8). |
| Attributed GMV | number (Rp) | system (feedback) | ✅ New, M9-OA-4: read-only, populated via trackable affiliate link where the Booking's content includes one. Null if no trackable link exists — never estimated. |

### 10.4 Field specs — Creator Payment Request (`CPR-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Request ID | system | auto | `CPR-YYYYMM-NNNN`. |
| Booking ID | reference | auto | Parent Booking; created only once `[QC Passed]`. |
| Amount | number (Rp) | **mandatory** | Must match Agreed Rate. |
| Creator Payment Details | text | **mandatory** | Bank/e-wallet info. |
| Status | system (state machine) | auto | `[Requested]` → `[Received by Finance]` → `[Paid]` / `[Rejected]`. |
| Rejection Reason | text | conditional | Required if `[Rejected]`. |
| Requested By | reference (user) | auto | KOL Coordinator. |
| Paid By | reference (user) | auto | Finance PIC. |

### 10.5 Field specs — Creator List (compiled, Brief-level)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Creator List Link | link | auto/manual | Drive document; refreshed as Bookings pass QC. |
| Included Bookings | reference (multi) | auto | Only `[QC Passed]` Bookings. |
| Last Compiled | timestamp | auto | |

---

## 11. Resolved Decisions (Module 9)

- **M9-OA-1 — ✅ RESOLVED.** Sourcing cascade: MCN MEA Roster → KOL External Pool → ad-hoc, last resort.
- **M9-OA-2 (Revision cap) — ✅ Confirmed as proposed.** 1 revision round per Booking before escalation, matching typical creator-contract terms.
- **M9-OA-3 (Creator List generation) — ✅ Resolved.** The underlying qualification logic stays fully automatic (a Booking becomes list-eligible the instant it reaches `[QC Passed]`, no parallel manual tracking) — but the actual Drive document **generation/refresh is a manual, Coordinator-triggered action** (a one-click "Generate/Refresh Creator List" button), not continuously live. The Coordinator decides when to produce a shareable snapshot; the system never guesses.
- **M9-OA-4 (GMV attribution for KOL content) — ✅ Resolved.** KOL content **does** feed an Attributed GMV signal, mirroring Module 8's Ads↔Creative loop — via **trackable affiliate links** where the creator's content includes one (e.g. an affiliate/shop link unique to that Booking). Where no trackable link exists, Attributed GMV stays null for that Booking rather than being estimated.
- **M9-OA-5 — ✅ RESOLVED.** KOL requests, Finance executes (Creator Payment Request, §8).
- **M9-OA-6 (Escalation resolution authority) — ✅ Resolved.** AM and Team Leader jointly decide on `[Escalated]` Bookings as the default path (unchanged). **Tie-breaker (new):** if the two disagree, it escalates to **SPV/Head Account** for the final call, logged — consistent with the system-wide minimum-SPV-escalation pattern.

### Cross-module fix applied here

**Booking states mapped to Module 12's canonical Task machine** (closes a gap flagged during the final cross-module consistency pass — Booking's 8 native states are more granular than Module 12's 6-state machine and were never formally mapped for Speed Score purposes):

| Booking native status | Canonical Task equivalent |
|---|---|
| `[Sourcing]` + `[Booked]` | `[In Progress]` |
| `[Content In Progress]` | `[In Progress]` (continued) |
| `[Content Submitted]` | `[Submitted]` |
| `[QC Review]` | `[In Review]` |
| `[QC Passed]` | `[Approved]` |
| `[QC Failed - Revision Requested]` | `[Revision Requested]` |
| `[Escalated - Creator Unresponsive]` | `[Blocked]` |
| `[Dropped]` | **No equivalent — excluded entirely** from Speed Score calculations (not counted as 0% or 100%; simply omitted from the staff's average for that period). |

This mapping is what lets Sourcing Turnaround + Delivery Turnaround (§7) combine into one overall `turnaround_time`/`speed_score` per Booking for Module 12/14 purposes, while staying visible individually as diagnostic sub-metrics.

---

**Next:** Module 10 — Live Stream (the vendor-tracker exception flagged since Phase 0: not an internal execution team, so this module records what was requested of the sister-company vendor and what they actually delivered, referenced back to Briefs created in Module 6).
