# HRIS — Module 7: Creative

> **Position in the journey:** the **execution-side detail** for every Brief that Module 6 dispatched to the Creative division. Module 6 defined the Brief's handoff contract and its division-level Kanban (`[To Do]` → … → `[Approved]`/`[Revision Requested]`); this module defines what actually happens **inside** that Kanban for Creative — output types, the per-unit **Asset** breakdown (because "12 Product Videos" is one Brief but twelve separate things to shoot, submit, and review), time-tracking, auto-logged daily output, and the KPIs (speed, quantity, GMV impact) that feed Team Performance later.

## Contents
1. Background & Objective
2. Core concept: Brief → Asset (the actual unit of work)
3. Feature: Creative queue & roles
4. Feature: Asset creation, submission & output types
5. Feature: Time-tracking
6. Feature: Revision loop (asset-level)
7. Feature: Daily Output (auto-logged, no double entry)
8. Feature: Creative KPIs — speed, quantity, GMV impact
9. System Requirements (Roles + Features + field specs)
10. Open Assumptions (Module 7)

---

## 1. Background & Objective

A Creative Brief rarely asks for one thing — "12 Product Videos" or "30 Product Photos" (the kind of quantity seen on real Briefs) is a single Brief but **twelve separate outputs**, each shot/edited by possibly different people, submitted on different days, and reviewed independently. If Module 6's Brief stayed the only unit of record, AM would have to approve or reject all twelve at once — which doesn't match reality (2 might need rework while 10 are fine, as already shown in Module 6's worked example).

This module introduces the **Asset** as Creative's actual unit of work — one row per individual output — so review, revision, time-tracking, and (eventually) GMV attribution can happen at the granularity that's actually true to the job. It also kills the old per-role tracking sheets (*Daily Output Social Media Creative*, *New Daily Output Graphic Design*, *New Daily Output Copywriter*, *Daily Output Videographer-Editor*) by auto-logging output straight from Asset status changes — Creative staff should never have to enter the same thing twice.

Expected result: every individual creative output is traceable, revisions don't block unrelated assets in the same Brief, daily output rolls up automatically for Team Performance, and (once Ads feeds attribution back) MEA can finally see **which specific video or design actually drove GMV** — not just "Creative produced 12 videos this month."

---

## 2. Core concept: Brief → Asset (the actual unit of work)

- An **Asset** (`AST-…`) is a child of a Brief — one Asset per individual unit toward the Brief's **Quantity/Target** field (Module 6 §9.4). A Brief for "12 Product Videos" generates up to 12 Asset rows over its life (they don't all have to be created at once — PIC can create them as work starts, see §4).
- **Asset Type** is inherited read-only from the Brief's Deliverable Type, narrowed to one of Creative's recognized output kinds: **Video, Gambar (image/product photo), Desain (graphic design — banners, creatives, layouts), SKU Setup (listing/catalog asset), Copy (written copy)**.
- **Asset status is independent per row** — one Asset can be `[Revision Requested]` while its eleven siblings are `[Approved]`. The parent Brief's status (Module 6) is a roll-up:
  - Brief = `[Submitted]` once **every** expected Asset has reached at least `[Submitted]`.
  - Brief = `[Approved]` only when **every** Asset is `[Approved]`.
  - Brief stays `[In Review]` as long as any Asset is still mid-review or in revision.
- This doesn't change anything in Module 6 — it's the detail living underneath a Creative Brief's existing status field.

---

## 3. Feature: Creative queue & roles

### Rules
1. Creative roles: **Videographer, Editor, Graphic Designer, Copywriter, Social Media Officer**, plus a **Team Leader (Video)** and **Team Leader (Graphic)** who oversee their respective sub-teams.
2. Each Creative staff member sees a personal queue: all Assets assigned to them, across all Briefs/clients, sorted by due date.
3. **Team Leader can reassign PIC** on any Asset within their sub-team (logged) but cannot delete history (house convention).
4. A Brief lands in the general Creative queue (unassigned) until its Assets are auto-assigned by current availability/workload across the sub-team (Team Leader can override any auto-assignment) — assignment happens per-Asset, not necessarily all at once for the whole Brief (useful when a 12-video Brief is split between two Videographers, M7-OA-1 resolved).

### Flow
1. Brief arrives from Module 6, visible to the Creative Team Leader(s).
2. Assets auto-assign to staff by current availability/workload; Team Leader overrides when needed (M7-OA-1).
3. Each staff member works their personal Asset queue independently of how the rest of the Brief is progressing.

---

## 4. Feature: Asset creation, submission & output types

### Rules
1. Assets can be created **incrementally** — a PIC doesn't have to pre-create all 12 rows before starting; creating Asset #1 and starting work is enough. System tracks Assets Created vs Brief's Quantity/Target so AM can see progress (e.g. "5 of 12 created").
2. Each Asset moves through the same state machine inherited from Module 6's Brief Kanban, but **per row**: `[To Do]` → `[In Progress]` → `[Submitted]` (output link mandatory) → `[In Review]` → `[Approved]` / `[Revision Requested]` / `[Blocked]` (pauses on an external dependency, resumes to `[In Progress]` — Module 12 §2 Rule 7).
3. Submission requires an **output link** appropriate to the Asset Type (video file/drive link, image link, design file link, copy text/doc link) — mandatory, system blocks submission without it: `[link output wajib diisi sebelum submit]`.
4. Every Asset is tagged `Client ID + Brief ID + Asset ID + PIC` for full traceability (extends the existing Client/Brief tagging from Module 6).

### Flow
1. PIC opens an assigned (or self-claimed) Asset → `[In Progress]`.
2. PIC finishes, attaches output link → `[Submitted]`.
3. AM reviews (Module 6 §6 Rule 3 — AM as client's proxy) → `[Approved]` or `[Revision Requested]` (§6 below).
4. Once submitted/approved, the Brief-level rollup (§2) updates automatically.

### Example
Brief #1 (Alpha Digital, 12 Product Videos) is assigned by Team Leader Video to **Editor Rian** for 8 of them and another Videographer for 4. Rian creates `AST-202606-0031` for Video #1, moves it `[In Progress]` on 6 June, submits a Drive link the same day. Sinta (AM) reviews — approves 6 of Rian's 8, requests revision on 2 (weak hook, per Module 6's example), and his last is still `[In Progress]`. Brief #1 stays `[In Review]` overall since not every Asset has reached `[Approved]`.

---

## 5. Feature: Time-tracking

### Rules
1. **Turnaround time** is auto-calculated per Asset (read-only): timestamp of `[Submitted]` minus timestamp of `[In Progress]`. This is the default, low-friction signal for the Speed KPI (§8) — no manual entry required.
2. PIC may optionally log **Hours Logged** (manual, self-reported) on an Asset for more precise effort tracking — useful since "in progress for 2 days" doesn't mean 2 days of focused work. This is supplementary, not required, and not used to penalize anyone by default (see M7-OA-2).
3. Time spent in `[Revision Requested]` → back to `[In Progress]` → resubmission counts toward a **separate** Revision Turnaround metric, kept apart from the original Speed KPI so rework time doesn't quietly inflate "how fast Creative works."

### Flow
1. Status timestamps are captured automatically on every transition (house convention — immutable history).
2. Turnaround Time and Revision Turnaround are computed read-only fields, visible to PIC, Team Leader, and AM.
3. PIC can add Hours Logged at any point before or after submission (editable until end-of-day lock, per the Daily Output convention in §7).

---

## 6. Feature: Revision loop (asset-level)

### Rules
1. AM requests revision **per Asset**, not per Brief — feedback is mandatory text, tied to that specific Asset.
2. Revision sends the Asset back to `[In Progress]`, increments its **Revision Count** (read-only), and does **not** affect sibling Assets in the same Brief.
3. Asset Revision Counts roll up to the Brief's Revision Count (sum), which rolls up further to Service/Client (Module 6 §7 Rule 3) for Health Score.
4. A single Asset crossing **3 revisions** flags Team Leader visibility (mirrors Module 6's Brief-level flag, applied one level deeper) — same non-blocking, visibility-only behavior.
5. **Revision SLA (✅ resolved, M7-OA-3):** each revision round carries its own target — **24–48 hours** depending on Asset Type/complexity, set alongside the original Due Date at Brief-breakdown time. This feeds Module 12's `revision_speed_score` (Revision Turnaround ÷ Revision SLA Target), tracked diagnostically next to the original Speed Score — not blended into it.

### Flow
1. AM marks an Asset `[Revision Requested]` with feedback.
2. PIC sees it in their queue, reworks, resubmits → `[In Review]` again.
3. Cycle repeats until `[Approved]`; only this Asset loops — the rest of the Brief keeps moving.

### Example
Continuing §4's example: Rian's 2 flagged videos go back to `[In Progress]` with Sinta's note "hook 3 detik pertama kurang kuat." Rian resubmits both the next day; Sinta approves both. Revision Count = 1 for each of those two Assets, 0 for the other 10 — Brief #1's total Revision Count = 2.

---

## 7. Feature: Daily Output (auto-logged, no double entry)

### Rules
1. Every Asset status transition **auto-creates** a Daily Output record for the PIC — no separate manual sheet, no double entry. This replaces the four legacy per-role tracking sheets entirely.
2. **Output unit per role:** Videographer/Editor → videos shot/edited; Graphic Designer → designs produced; Copywriter → copies written; Social Media Officer → posts scheduled/published.
3. Daily Output **locks at end-of-day (23:59 local)** — past entries become immutable; corrections after lock require Team Leader approval and are logged (house convention applied here).
4. Daily Output is the **sole feed** into Creative's contribution to Team Performance (Module 13) — no parallel manual reporting needed.

### Flow
1. PIC works through their Asset queue; each transition silently logs a Daily Output entry (type, client, Brief/Asset reference, timestamp).
2. At end of day, PIC's dashboard shows today's auto-logged items — nothing to add manually unless correcting a prior entry (which requires Team Leader sign-off post-lock).
3. Daily totals roll up into weekly/monthly views for Team Leader and Team Performance.

### Example
By end of day 6 June, Rian's dashboard already shows 1 auto-logged video output (Asset `AST-202606-0031`, Alpha Digital) — nothing for him to type into a separate sheet.

---

## 8. Feature: Creative KPIs — speed, quantity, GMV impact

### Rules
1. **Speed KPI** = average Turnaround Time (§5) per Asset Type, per PIC, compared against the Brief's Due Date (SLA) — surfaces who's consistently fast vs. who's running into SLA breaches.
2. **Output Quantity KPI** = count of `[Approved]` Assets per PIC per period, pulled straight from Daily Output (§7) — never double-counted, never separately reported.
3. **GMV Impact KPI** = **Attributed GMV** per Asset — a read-only field populated by feedback from Ads/Reporting (Module 8 onward) once a specific video/design is confirmed to have driven measurable sales (e.g. the exact video used in a winning ad campaign, or a product photo tied to a spike in organic conversion). This is the "which video drove sales" signal flagged as a priority in the original brief. **Resolved (M7-OA-4):** tagging stays manual (no UTM/link-tracking automation yet), but figures go through a **monthly review-and-lock** before being treated as final for that period's KPI reporting — ad-hoc tags during the month are provisional until that lock.
4. Revision Count (§6) is tracked alongside these three but is a **quality** signal, not folded into the Speed/Quantity numbers — keeps "fast and high-volume but sloppy" visible rather than hidden inside an averaged score.

### Flow
1. Speed and Quantity compute automatically from existing Asset/Daily Output data — no extra step.
2. GMV Impact starts empty on every Asset; it's only filled in when Ads (Module 8) or Reporting tags an Asset as the one used in a specific campaign/result, and that campaign's GMV becomes attributable.
3. Creative's KPI dashboard shows all four signals (Speed, Quantity, GMV Impact where available, Revision Count) per PIC — Team Leader and SPV view all; PIC sees own.

### Example
Two months in, Ads reports that the exact product video Rian shot for Alpha Digital (`AST-202606-0031`) was the creative used in the TikTok ad campaign that produced the client's best week. Reporting tags that Asset's Attributed GMV accordingly — Rian's KPI dashboard now shows not just "12 videos this month" but "1 of them tied to Rp X GMV."

---

## 9. System Requirements

### 9.1 Roles

| Role | Capabilities in Module 7 |
|---|---|
| **Videographer / Editor / Graphic Designer / Copywriter / Social Media Officer** | Own Asset queue; create/submit Assets; optional Hours Logged; see own Daily Output + KPIs. |
| **Team Leader (Video / Graphic)** | Reassign PICs within sub-team (logged); view sub-team's Assets, Daily Output, KPIs; approve post-lock corrections. |
| **Account Manager (AM)** | Reviews submitted Assets (`[In Review]` → `[Approved]`/`[Revision Requested]`) — same AM role as Module 6, exercised here at Asset granularity. |
| **SPV / Head Account** | Visibility on 3+ revision flags at Asset level; sees Creative KPIs across all clients. |
| **Ads / Reporting** | Writes Attributed GMV back onto specific Assets (feedback loop, detailed further in Module 8). |
| **Org Development (OD)** | Read-only on all Assets, Daily Output, KPIs, audit logs. |
| **Director** | Full view. |

### 9.2 Features
1. Asset sub-entity under Brief (per-unit granularity).
2. Asset creation/submission with output-type-specific link requirement.
3. Time-tracking (auto turnaround + optional manual hours).
4. Asset-level revision loop, rolling up to Brief/Service/Client.
5. Daily Output auto-logging (replaces legacy per-role sheets), end-of-day lock.
6. Creative KPIs: Speed, Output Quantity, GMV Impact (attribution feedback), Revision Count tracked separately.

### 9.3 Field specs — Asset (`AST-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Asset ID | system | auto | `AST-YYYYMM-NNNN`. |
| Brief ID | reference | auto | Parent Brief. |
| Asset Type | system | auto | Inherited from Brief's Deliverable Type (Video/Gambar/Desain/SKU Setup/Copy). |
| Sequence # | number | **mandatory** | Position within the Brief's Quantity/Target (e.g. 3 of 12). |
| Assigned PIC | reference (user) | **mandatory** | Set by Team Leader or self-claimed. |
| Output Link | link | **mandatory** before `[Submitted]` | Type-appropriate (video/image/design/copy). |
| Status | system (state machine) | auto | `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]`/`[Revision Requested]`/`[Blocked]` (added per cross-module consistency pass — Module 12's Task engine requires every canonical Task to support pausing). |
| Revision Count | system | auto | Per-Asset, rolls up to Brief. |
| Revision Feedback | text | conditional | Required on `[Revision Requested]`. |
| Turnaround Time | system | auto | `[Submitted] timestamp − [In Progress] timestamp`. Read-only. |
| Revision SLA Target | number (hours) | auto | 24–48h default by Asset Type/complexity, set at Brief-breakdown time (M7-OA-3). |
| Revision Turnaround / `revision_speed_score` | system | auto | Revision Turnaround (Module 12 §2 Rule 6) ÷ Revision SLA Target — diagnostic only, shown alongside Speed Score, never blended into it. |
| Hours Logged | number | optional | Self-reported by PIC. |
| Attributed GMV | number (Rp) | system (feedback) | Read-only; populated by Ads/Reporting (Module 8+). Null until attributed. |

### 9.4 Field specs — Daily Output (auto-logged)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Output ID | system | auto | Auto-generated per transition. |
| PIC | reference (user) | auto | |
| Output Unit Type | system | auto | Per role mapping (§7 Rule 2). |
| Linked Asset/Brief/Client | reference | auto | Traceability. |
| Timestamp | system | auto | |
| Locked? | boolean | auto | True after 23:59; post-lock edits require Team Leader approval (logged). |

---

## 10. Resolved Decisions (Module 7)

- **M7-OA-1 (Asset assignment model) — ✅ Resolved.** Assets are **auto-assigned based on current availability/workload** across the sub-team; Team Leader can override any auto-assignment when needed (e.g. matching a specific Videographer's strength to a tricky shoot) — supersedes the original "Team Leader assigns / self-claim" framing with a third, confirmed model.
- **M7-OA-2 (Hours Logged usage) — ✅ Resolved.** Stays optional and non-punitive (never feeds Speed/Quantity KPI scoring), but the system now sends an **automatic end-of-day reminder** if nothing's been logged — nudges completion without making it mandatory.
- **M7-OA-3 (Revision SLA) — ✅ Resolved.** A **separate, shorter SLA applies to revision rounds** specifically (distinct from the Asset's original Due Date) — default **24–48 hours** depending on Asset Type/complexity, set at Brief-breakdown time alongside the original SLA. Feeds a parallel `revision_speed_score` (Module 12 §5.1 addition) so "how fast was the fix" is measured against its own yardstick, not folded into the original turnaround target.
- **M7-OA-4 (GMV attribution mechanism) — ✅ Resolved.** Stays **manual tagging** by Ads/Reporting for now (UTM/link-tracking automation not yet built) — **with one addition:** a **monthly review-and-lock cadence** before that period's Attributed GMV figures are treated as final for KPI purposes, rather than treating every ad-hoc tag as immediately locked-in.
- **M7-OA-5 (Post-lock correction approval) — ✅ Confirmed as proposed.** Team Leader approval (a Lead-tier role, consistent with the system-wide minimum-SPV/Lead escalation rule) — no separate SPV gate needed on top.
- **M7-OA-6 (Asset pre-creation) — ✅ Confirmed as proposed.** PIC creates Assets incrementally as work starts, not all 12 (or however many) slots pre-created upfront.

### Cross-module fix applied here
- **Asset's status enum now explicitly includes `[Blocked]`**, closing a gap flagged during the final cross-module consistency pass — Module 12's Task Execution engine assumes every canonical Task (including Asset) can pause via `[Blocked]`, and Asset's documented state list previously omitted it (see §9.3).

---

**Next:** Module 8 — Ads (Brief intake from Module 6, Campaign record creation, ROAS/spend/GMV metrics, time-tracking, and the attribution feedback that writes Attributed GMV back onto Creative's Assets — closing the loop opened in this module's §8).
