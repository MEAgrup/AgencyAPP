# CDPS — Module 12: Task Execution

**Status:** Draft awaiting Yohan's confirmation before developer ticketing
**Worked example:** Alpha Digital, Editor Rian, Asset AST-202606-0045
**Depends on:** Module 6 (Brief), Module 7 (Asset), Module 9 (Creator Booking), Module 8 (Ads Brief-as-task), Module 11 (Dependency / Blocked linkage)

---

## 1. Background

Every division already has its own execution unit — Asset (Creative), Creator Booking (KOL), and Brief-as-task for Ads (no further breakdown). Each one references a "Speed" KPI, but no module has actually defined **how duration converts into a Speed score**, how revision rounds affect that score, or how a `[Blocked]` interval should be treated. Module 12 closes that gap with one canonical **Task Execution Engine** that every division's individual unit of work plugs into.

Note on naming: the original roadmap used `[Open]` as the first state. This PRD keeps the already-established label `[To Do]` (used since Module 6/7) as the canonical name — `[Open]` is treated as a synonym, not a separate status, to avoid contradicting existing modules.

Expected outcome: one shared, auditable definition of "how fast was this task, really" — usable by Creative, KOL, and Ads alike, feeding cleanly into Module 14 (Team Performance).

---

## 2. Rules

1. **Canonical Task** = any entity where a single staff member is personally accountable for one deliverable: an Asset row, a Creator Booking row, or the Brief itself when the Brief has no sub-entity breakdown (e.g. Ads setup).
2. **Canonical state machine:** `[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]` (terminal) / `[Revision Requested]` (loops back to `[In Progress]`) / `[Blocked]` (pauses, then resumes to `[In Progress]`).
3. **Live Stream Sessions are explicitly excluded** from this engine — they remain vendor-executed (Module 10 confirmed); only the AM's request/reconcile actions are logged as plain activity history, never as a timed Task.
4. **Turnaround Time** is auto-computed, timestamp-based: starts the moment a Task first enters `[In Progress]`, stops the moment it first reaches `[Approved]`. Never user-editable.
5. **Revision rounds do NOT reset Turnaround Time.** Total Turnaround includes all revision cycles — the business cares about total time-to-approved, not just the first draft.
6. **Revision Turnaround** is a separate read-only field: time elapsed from the most recent `[Revision Requested]` to the next `[Submitted]`. It isolates "how fast did the PIC fix it" from "how long did the whole thing take," feeding a distinct Responsiveness signal.
7. **`[Blocked]` time is excluded** from Turnaround Time — the clock pauses on entry to `[Blocked]` and resumes on return to `[In Progress]`, since blocking usually reflects an external dependency, not the PIC's fault.
8. **Only SPV or Lead may transition a Task into `[Blocked]`** (confirmed). Staff and AM can flag/request a block, but cannot self-set it — this prevents the clock-pause from being gamed by the PIC whose own work is being measured.
9. **Hours Logged stays manual and optional** (unchanged from Module 7) — never auto-filled, never folded into Speed KPI scoring. It IS shown on the Task card next to Speed Score, for context only (confirmed) — visibility, not scoring.
10. **SLA Target is set individually per Task**, not inherited uniformly from the Brief (confirmed). Example: a client's overall Brief-level SLA might be 2 weeks for the full deliverable set, while individual child Tasks inside it carry their own targets — e.g. one Asset at 3 days, another at 5 days — set at breakdown time by whoever splits the Brief (Team Leader/SPV) based on each Task's complexity.
11. **Brief-level SLA vs. Task-level SLA** serve different purposes: Brief-level SLA is the client-facing overall deadline (already established, Module 6); Task-level SLA is the internal yardstick Speed Score is measured against. The two are not required to sum exactly, but Task-level SLAs should reasonably fit inside the Brief-level window — this is not system-enforced in v1 (see Open Assumptions).
12. **Speed Score** per Task = Turnaround Time ÷ Task-level SLA Target (read-only, auto-computed, expressed as %; under 100% = faster than SLA). **No upper cap** (confirmed) — a Task can show 300%, 400%, etc. on purpose, so a consistently problematic division or staff member is clearly visible rather than smoothed over.
13. **Staff-level Speed KPI** per period = average Speed Score across all Tasks the staff closed (`[Approved]`) in that period — feeds Module 14.
14. **Revision Count stays a separate Quality signal**, never blended into Speed Score. A Task that beat SLA but took 3 revisions is not reported as simply "fast" — both numbers are shown side-by-side.
15. **Revision Count auto-escalation** (confirmed): a Task reaching **Revision Count ≥ 3** auto-flags for Quality review (visible to Team Leader/SPV), separate from and in addition to Module 9's existing KOL-specific revision cap. The threshold of 3 is a working default — open for adjustment per division if 3 turns out too strict/loose once real data comes in.

---

## 3. Flow

1. Task is created (Asset row from Brief breakdown, Booking row, or the Brief itself for single-unit divisions) → status `[To Do]`, SLA Target inherited from parent Brief →
2. PIC starts work → `[In Progress]` → Turnaround clock starts →
3. PIC submits → `[Submitted]` → `[In Review]` →
4. Reviewer decides:
   - `[Approved]` → clock stops, Speed Score computed, Revision Count finalized →
   - `[Revision Requested]` → clock keeps running (Rule 5); a fresh Revision Turnaround sub-timer starts →
   - `[Blocked]` → clock pauses (Rule 7) →
5. From `[Revision Requested]`: PIC reworks → `[In Progress]` → `[Submitted]` again → loop until `[Approved]` →
6. From `[Blocked]`: external dependency resolves (may tie to Module 11's Dependency entity) → back to `[In Progress]`, clock resumes →
7. On `[Approved]`: system finalizes Turnaround Time, Speed Score, and Revision Count — all roll up into Daily Output / staff KPI (Module 7 pattern), then onward to Module 14.

---

## 4. Example — Alpha Digital

**Asset AST-202606-0045** (one of 12 Product Videos), PIC Rian, SLA Target = 48 hours.

| Time | Event | Status | Note |
|---|---|---|---|
| Day 1, 09:00 | Rian starts | `[In Progress]` | Clock starts |
| Day 2, 14:00 | Rian submits | `[Submitted]` → `[In Review]` | Elapsed = 29h |
| Day 2, 16:00 | Team Leader requests revision (color grading off-brand) | `[Revision Requested]` | Clock keeps running; Revision Turnaround sub-timer starts |
| Day 3, 10:00 | Rian resubmits | `[Submitted]` → `[In Review]` | Revision Turnaround = 18h |
| Day 3, 15:00 | Approved | `[Approved]` | Total Turnaround = 54h |

**Result:** Speed Score = 54 ÷ 48 = **112.5%** (8% over SLA), Revision Count = **1**. Rian's KPI shows both numbers together — the slight SLA miss is visible alongside the one revision that explains it, not as an unexplained lateness figure.

---

## 5. System Requirements

### 5.1 New computed fields (added to Asset, Creator Booking, and single-unit Brief-as-task)

| Field | Type | Computation |
|---|---|---|
| `turnaround_time` | read-only, hours | Sum of `[In Progress]` intervals from first entry to `[Approved]`, excluding `[Blocked]` intervals |
| `revision_turnaround` | read-only, hours | Latest `[Revision Requested]` → next `[Submitted]` interval |
| `speed_score` | read-only, % | `turnaround_time` ÷ SLA Target |
| `revision_count` | read-only, integer | Already established (M7/M9), referenced here for the side-by-side KPI report |

### 5.2 Derivation, not storage

All four fields above are **derived from immutable status-transition history** (house convention #1), never stored as independently-mutable fields — they must always be recomputable and auditable from the timestamp log.

### 5.3 SLA Target

Set **individually per Task** at Brief-breakdown time (by Team Leader/SPV), not inherited uniformly from the Brief/Service. Distinct from Brief-level SLA (client-facing overall deadline, Module 6). If a Task is created without its own SLA Target, Speed Score is flagged **N/A** — never silently defaulted or backfilled from the Brief level.

### 5.3a `[Blocked]` permission

Transitioning a Task into `[Blocked]` is restricted to SPV/Lead roles only (enforced via the Phase 0 Role Matrix permission check). Staff and AM can submit a block request, which appears as a pending flag until an SPV/Lead actions it — they cannot set `[Blocked]` directly themselves.

### 5.3b Ads adoption

Module 8's original "setup turnaround" language is now superseded — the Ads Brief-as-task computes `turnaround_time` / `speed_score` / `revision_count` through this Module 12 engine exactly like Creative's Asset and KOL's Creator Booking. No parallel definition is kept.

### 5.4 Blocked-interval tracking

Every `[Blocked]` enter/exit timestamp pair is logged per Task (a Task can be blocked more than once); all pairs are summed and subtracted from total elapsed time when computing `turnaround_time`.

### 5.5 KPI rollup feed

Per staff, per period: average Speed Score (uncapped, raw ratio — confirmed, so a persistently problematic division/staff is clearly visible rather than smoothed away), Revision Count distribution, Hours Logged total — reported as three separate series, never blended into one composite number, feeding Module 14. Tasks with Revision Count ≥ 3 are additionally surfaced as a Quality-review flag list (Rule 15).

### 5.6 Hours Logged

Unchanged from Module 7 in terms of input: simple manual numeric input per Task per day. Display: shown on the Task card directly alongside Speed Score (confirmed) — purely for context, never weighted into the score itself.

---

## 6. Confirmed Decisions (OA Resolutions)

| # | Question | Resolution |
|---|---|---|
| 1 | SLA Target scope | ✅ Set **individually per Task**, not shared uniformly across a Brief's children. Brief-level SLA (e.g. 2 weeks) is the client-facing overall deadline; each Task inside it (e.g. one Asset at 3 days, another at 5 days) carries its own target. |
| 2 | Speed Score capping | ✅ **No cap.** Raw ratio, intentionally — so a persistently problematic division/staff stays visible instead of being averaged away. |
| 3 | Who can set `[Blocked]` | ✅ **SPV/Lead only.** Staff and AM can request; they cannot self-set it. |
| 4 | Ads adoption | ✅ **Yes** — Ads Brief-as-task fully adopts this engine, replacing Module 8's original looser "setup turnaround" language. |
| 5 | Revision Count escalation | ✅ **Yes** — Revision Count ≥ 3 auto-flags for Quality review. (3 is a working default, open to retuning per division once real data comes in.) |
| 6 | Hours Logged visibility | ✅ **Shown on the Task card** alongside Speed Score, for context — not folded into scoring. |

### Still open

- Whether Task-level SLA totals should be system-validated against the Brief-level overall SLA window (e.g. warn if the sum of child Task SLAs exceeds the Brief deadline), or left as a planning judgment call for whoever breaks down the Brief. Not yet decided — flagged for Module 13/14 review since it touches Client Health scoring (late Briefs feed Health Score in Module 13).
- Exact Revision Count threshold (currently defaulted to 3) — confirm or adjust per division once live data is available.

---

## 7. Success Metrics

- **Activation event:** first Task closed `[Approved]` with an auto-computed Speed Score visible to both PIC and Lead, replacing manual/eyeballed lateness judgment.
- **North-star:** % of Tasks closed within SLA (Speed Score ≤ 100%), trending up over time, viewable per division and per staff.
- **Leading indicators:** average Revision Count per Task (quality trend — should fall as briefs/QC improve), total Blocked-time as a share of total elapsed time (external-dependency drag, useful input back into Module 11's Dependency review).

---

**Next:** Module 13 — Client Health Report.
