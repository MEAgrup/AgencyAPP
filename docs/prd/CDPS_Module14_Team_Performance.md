# CDPS — Module 14: Team Performance

**Status:** Draft awaiting Yohan's confirmation before developer ticketing
**Worked example:** Advertiser Kenny, June 2026
**Depends on:** Module 6 (Complaints), Module 7 (Output Quantity, GMV Impact), Module 8 (ROAS, GMV Impact, Optimization Activity), Module 9 (QC Pass Rate, Sourcing Turnaround), Module 12 (Speed Score, Revision Count), Module 13 (Client Health Score)

---

## 1. Background

Per-module KPIs already exist scattered across the system: Speed Score and Revision Count (Module 12), ROAS/GMV Impact/Optimization Activity (Module 8), Output Quantity (Module 7), QC Pass Rate and Sourcing Turnaround (Module 9). No module rolls these into one performance view per staff member, and nothing connects individual execution to actual client outcomes — an Advertiser could look great on personal Speed Score while every Client they touch sits in Module 13's "At Risk" band, and the system would never surface that mismatch.

Module 14 closes both gaps: (1) a per-staff, per-role rollup of KPIs that already exist elsewhere, and (2) a deliberately limited connection from Client Health Score outcomes back to the roles most responsible for them — this is also where Module 13's deferred Open Assumption #8 (AM-level rollup) gets resolved (§8 below).

---

## 2. Rules

1. Team Performance is computed **per staff, per month** (aligned with Module 13's confirmed monthly cadence). No new raw KPI is invented here — this module only aggregates and weights what Modules 7–9, 12, and 13 already produce.
2. Each role-type has its own **KPI Profile** (named, weighted set of inputs), since divisions measure fundamentally different things. **Raw-value components (GMV Impact, Output Quantity, Optimization Activity, Creator Count) are normalized as `Actual ÷ Period Target × 100`, capped at 100** (confirmed) — consistent with how ROAS Attainment is already capped in Module 13.

   | Role | Components (confirmed weights) |
   |---|---|
   | **Creative** (Editor/Designer/Copywriter) | Speed Score (M12) 30%, Output Quantity (Approved Assets/period, M7) 25%, GMV Impact (M7§7/M8§7) 25%, Revision Count (M12, inverse) 20% |
   | **Ads** (Advertiser) | Speed Score (M12) 25%, ROAS Attainment (own managed Ad Campaigns, M8) 30%, GMV Impact (M8) 25%, Optimization Activity (M8) 20% |
   | **KOL Coordinator** | **Creator Count** (Bookings reaching `[QC Passed]` in the period, vs. target — confirmed as the lead metric per Yohan: "what matters most for KOL is the number of creators") 30%, QC Pass Rate (M9 Monthly Report) 25%, Speed Score (M12, combined Sourcing+Delivery Turnaround vs SLA) 20%, Escalation Rate (inverse, M9) 25%. Sourcing Turnaround (M9) is still shown on the staff's own breakdown as a **reported diagnostic**, not weighted — it's largely already reflected inside the combined Speed Score. |
   | **Account Manager (AM)** | average Client Health Score across portfolio (M13) 50%, Complaint Resolution Speed (M6) 25%, Revision Escalation Rate across their Clients' Briefs (M6/M12) 25% |

3. **Cross-division Client-Outcome Modifier**: for Creative/Ads/KOL roles, a small additional modifier is layered on top of the core KPI Profile — the average of the Module 13 Health Score sub-component(s) most attributable to that division, across the Clients that staff member actually touched that month (e.g. an Advertiser's modifier draws from the average ROAS Attainment sub-score of their Clients; a Creative's modifier draws from the average Revision Burden sub-score of their Clients). **Capped at ±10 points** on the final 0–100 score — enough to matter, not enough to override the core KPI Profile.
4. **Final Individual Score** = weighted KPI Profile (Rule 2) + Client-Outcome Modifier (Rule 3, capped ±10), bounded 0–100 overall.
5. **Team-level rollup** = simple average of individual scores within a division/team for the period — no separate formula invented, just an aggregate view.
6. **Missing-component redistribution** applies exactly as in Module 13: if a KPI input is unavailable for a staff member in a period (e.g. a brand-new hire with no Assets closed yet), that component is excluded and its weight redistributed across the rest of that role's KPI Profile — never defaulted to 0.
7. **Visibility:** staff see their own score; Team Leader/SPV see their full team; OD/Director see everyone — consistent Role Matrix (Phase 0).
8. **This module produces a score, not an automatic consequence.** No auto-penalty or auto-bonus is wired here — what HR/management does with the number (coaching, review, incentive) is a separate decision outside this PRD's scope.

---

## 3. Flow

1. At month-end, the system pulls each staff member's per-module KPI inputs for the period (M7/M8/M9/M12, whichever apply to their role) →
2. System computes the role's weighted KPI Profile score, redistributing weight for any missing component →
3. System computes the Client-Outcome Modifier from Module 13 snapshots, scoped to Clients the staff touched that month, capped ±10 →
4. Final Individual Score = KPI Profile + Modifier, bounded 0–100 →
5. Team Leader/SPV/OD/Director view individual scores + team-rollup on a Team Performance dashboard →
6. Each staff member sees their own score with the **full breakdown** of which component pulled them up or down — never just one opaque number.

---

## 4. Example — Advertiser Kenny, June 2026

| Component | Raw / sub-score | Weight |
|---|---|---|
| Speed Score | avg 95% of SLA → KPI sub-score **100** (capped at 100 once at/under SLA, no bonus for finishing early — avoids rewarding rushed setup) | 25% |
| ROAS Attainment | 4.4x / 5.0x target × 100 = **88** | 30% |
| GMV Impact | Actual ÷ period target × 100, illustrative = **80** | 25% |
| Optimization Activity | Actual ÷ period target × 100, illustrative = **75** | 20% |

**KPI Profile = 0.25×100 + 0.30×88 + 0.25×80 + 0.20×75 = 86.4**

**Client-Outcome Modifier:** Kenny's Clients this month averaged a ROAS Attainment sub-score of 84 in their Module 13 snapshots (matches Alpha Digital's earlier example). Using a draft formula `clamp((avg − 80) ÷ 2, −10, +10)`: (84−80)/2 = **+2**.

**Final Score = 86.4 + 2 = 88.4**

Kenny's dashboard shows the 88.4 broken into all five numbers above — not just the final figure — so it's immediately clear the score is solid on Speed and ROAS, with GMV Impact and Optimization Activity using illustrative period-target figures (real targets pending once actual monthly targets are set per Advertiser).

---

## 5. System Requirements

### 5.1 New entity: Performance Score (`PERF-YYYYMM-NNNN`)

*(Implements the `PERF-…` entity reserved in Phase 0 §3 — "Performance Record... Auto-generated individual + team rollups, tied to OKR role." This module is that implementation.)*

| Field | Type | Notes |
|---|---|---|
| Staff ID | ref User | — |
| Role Type | enum: Creative / Ads / KOL / AM / … | determines which KPI Profile applies |
| Period | month | aligned to Module 13 cadence |
| KPI Profile Inputs | per component | raw value + sub-score used |
| Weights Used | record | post-redistribution, stored per snapshot (mirrors Module 13's pattern) |
| Client-Outcome Modifier | value + source | which Clients/Health-components contributed |
| Final Score | 0–100 | — |
| Computed At / By | timestamp / system | auto |

### 5.2 Role Type → KPI Profile mapping

Stored as configuration via an **admin UI** (confirmed) — Yohan/HR can retune weights per role over time without a redeploy.

### 5.3 Client-Outcome Modifier computation

Pulls from Module 13 `CHR-…` snapshots for the period, filtered to Clients where the staff member was PIC on at least one Brief/Task that month, averaging the Health Score sub-component(s) mapped to their role: **Creative → Revision Burden, Ads → ROAS Attainment, KOL Coordinator → Task Completion Rate** (confirmed).

### 5.4 Computation cadence

Monthly batch, immutable snapshot once created — same convention as Module 13.

### 5.5 Non-functional

Every score must be shown to its owner with a full component breakdown (Rule 8/Flow step 6) — never delivered as a single number with no explanation.

---

## 6. Confirmed Decisions (OA Resolutions)

| # | Question | Resolution |
|---|---|---|
| 1 | Speed KPI transform | ✅ 100 if Speed Score ≤100%, else `200 − Speed Score` (floored at 0). |
| 2 | Normalization basis (GMV Impact, Output Quantity, Optimization Activity, Creator Count) | ✅ `Actual ÷ Period Target × 100`, capped at 100. |
| 3 | Client-Outcome Modifier formula | ✅ `clamp((avg relevant sub-score − 80) ÷ 2, −10, +10)`. |
| 4 | Role→Health-component mapping for the Modifier | ✅ Creative → Revision Burden, Ads → ROAS Attainment, KOL Coordinator → Task Completion Rate. KOL's core KPI Profile also now leads with **Creator Count** (Rule 2) per Yohan's emphasis on creator volume. |
| 5 | KPI Profile weights configurability | ✅ Admin UI. |
| 6 | AM KPI Profile split | ✅ Confirmed as drafted (50% Health Score / 25% Complaint Resolution Speed / 25% Revision Escalation Rate). |
| 7 | New-hire grace period | ✅ Not needed — new staff are scored from month one like everyone else. |
| 8 | Team-level rollup weighting | ✅ Simple average (not volume-weighted) for v1. |

---

## 7. Success Metrics

- **Activation event:** Team Leader/SPV opens the Team Performance dashboard at least once per month per team.
- **North-star:** a real correlation between rising individual scores and rising Client Health Scores over time — this validates that the Client-Outcome Modifier is capturing something genuine, not just noise.
- **Leading indicators:** score distribution within a team (spotting both underperformance and unsustainable overload on top performers); Modifier magnitude trend (is the client-outcome link actually moving scores, or staying near zero and effectively irrelevant).

---

## 8. Closing Module 13's deferred question (AM-level rollup)

Module 13 (§6, OA-8) deferred the question of whether an AM's average Client Health Score should feed Module 14. The answer, now that Module 14's structure exists: **yes — it's the single largest component of the AM's own KPI Profile (50%, Rule 2)**, not just a side-rollup. This makes sense structurally: an AM doesn't execute Tasks the way Creative/Ads/KOL do (Module 12), so an AM's performance is, by the nature of the role, mostly a reflection of how healthy their Client portfolio is. The remaining 50% (Complaint Resolution Speed + Revision Escalation Rate) covers the parts of the AM's day-to-day that aren't already baked into the Health Score itself, to avoid double-counting the same signal twice.

---

## 9. Amendment note — Weekly-Recap Discipline component (M6D RM-9, owner 2026-08-13, **needs sign-off**)

Module 6D (Rekap Hasil Mingguan) added a weekly cross-division recap the AM/CRO owns. The owner decided
(`DECISIONS.md` 2026-08-13, RM-9) that recap **discipline** must be *both displayed* (on the health page, M6D
H-2) *and scored* — and that the scoring belongs **here in M14, not as an eighth Module 13 health component**
(scoring it inside M13 would re-weight the confirmed health weights and grade AM form-filling inside a
*client-health* number — M6D §8.4).

Concretely, this proposes:
- **AM role:** a new **Weekly-Recap Discipline** component = *% of the AM's active clients whose current-week
  recap was AM-closed on time and **never force-closed** (`pernah_ditutup_otomatis = false`)*. Normalized/capped
  like the other raw-value components (Rule 2). **Counts the permanent flag, not the final status** — a recap a
  Head reopened after auto-close (M6D RM-5) still carries `pernah_ditutup_otomatis = true`, so it counts against
  the AM even once completed; the Head's mercy rescues the data, not the score.
- **Division roles (Creative / Ads / KOL / Live):** a **Weekly-Note Compliance** component = *did the division
  file its now-mandatory weekly note (M6D RM-8) for the clients it touched*.

**Open for sign-off (RM-9a):** adding a component to the **confirmed** AM KPI Profile (50/25/25, §6 #6 / §7)
means re-weighting it. Recommendation on the table: carve a **10–15%** Weekly-Recap Discipline slice
proportionally from the existing three (e.g. **45 / 22.5 / 22.5 / 10**). The exact weights — and the division
profiles' new slice — need the owner's confirmation before build, exactly like the original 50/25/25 was
confirmed. M6D supplies the raw signal (recap close status + division-note presence); M14 computes the grade.
Tracked as **D-14** in `docs/backlog/M6D_BACKLOG.md`.

---

**Next:** Module 15 — Client Portal + Team Portal.
