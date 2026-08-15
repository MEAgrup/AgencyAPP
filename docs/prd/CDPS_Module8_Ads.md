# CDPS — Module 8: Ads

> **Position in the journey:** the **execution-side detail** for every Brief that Module 6 dispatched to Ads. Unlike Creative's Assets (one-time submit-and-approve outputs), an ad campaign is a **living thing** — it launches, runs, gets optimized, and only the *initial setup* maps cleanly onto Module 6's Brief Kanban. This module separates "was the campaign set up correctly per the brief" (closes the Brief) from "how is the campaign actually performing over time" (the **Ad Campaign** record, which keeps running after the Brief is closed) — and closes the attribution loop opened in Module 7 §8 by writing GMV results back onto the specific Creative Asset that drove them.

## Contents
1. Background & Objective
2. Core concept: Brief (setup) vs Ad Campaign (ongoing) — and why this isn't Module 3's Campaign
3. Feature: Ads queue & roles
4. Feature: Ad Campaign creation & Creative Asset linkage
5. Feature: Periodic metrics & ROAS
6. Feature: Optimization Log (ongoing changes, not Brief revisions)
7. Feature: Attribution feedback — closing the loop to Creative
8. Feature: Ads KPIs — speed, ROAS, GMV impact
9. System Requirements (Roles + Features + field specs)
10. Open Assumptions (Module 8)

---

## 1. Background & Objective

An ad campaign isn't a file you submit once — it's launched, watched, and tweaked continuously for as long as it runs. Forcing it through the same submit-once-approve-once pattern as a Creative Asset would either freeze Ads out of normal optimization work or make every budget tweak look like a "revision" against the original brief, which it isn't.

This module draws a clean line: the **Brief** (Module 6) is satisfied once Ads proves the campaign was **launched correctly per the brief's instructions** — right platform, right budget, right objective. After that, the **Ad Campaign** keeps living on its own, tracked with periodic metrics and an **Optimization Log** for the inevitable ongoing changes, completely separate from the Brief's now-closed Kanban. It also explicitly disambiguates from Module 3's Campaign entity, which is MEA's *own* lead-gen effort — this module's Ad Campaign is the **client's** paid media, bought on the client's behalf.

Expected result: Ads can optimize freely without re-triggering brief approvals for every change, every optimization is still logged for accountability, ROAS is tracked as the execution-side north star, and — closing the loop from Module 7 — the system can finally answer "which specific video drove this GMV," not just "Ads spent X and got Y back."

---

## 2. Core concept: Brief (setup) vs Ad Campaign (ongoing) — and why this isn't Module 3's Campaign

- **Disambiguation (carried forward from Module 3 §2):** Module 3's `CMP-…` is **MEA's own** lead-generation campaign (TikTok Ads run by Marketing to acquire leads for MEA itself). This module's **Ad Campaign** (`ADC-…`) is the **client's** paid media — ads MEA runs *for* a client, funded by the client's Marketing Budget on their Client Record (Module 4). Different entity, different prefix, different owner of the budget — never conflate the two.
- **Brief lifecycle** (inherits Module 6's universal Brief Kanban): `[To Do]` → `[In Progress]` (Ads PIC sets the campaign up) → `[Submitted]` (campaign launched, setup details attached) → `[In Review]` (AM checks setup matches the brief) → `[Approved]` (Brief closes — setup confirmed correct) / `[Revision Requested]` (setup was wrong — wrong platform, wrong budget — fix before re-submitting).
- **Ad Campaign lifecycle** (separate, begins the moment Ads PIC starts setup, **outlives** the Brief): `[Active]` ↔ `[Paused]` → `[Ended]` (end date reached, budget exhausted, or manually stopped). The campaign keeps running and accumulating metrics regardless of the Brief's status above it.
- One Brief can spawn **multiple Ad Campaigns** (same fan-out principle as Module 7's Assets) — e.g. a "TikTok Ads Campaign" Brief might split into a Marketplace-ads campaign and a Social-ads campaign, each with separate budgets and metrics.
- **Recurring strategy cycles (✅ resolved, M8-OA-6):** when a Service needs a new strategy/budget cycle (e.g. quarterly re-strategy), Account creates a **new Brief** to formalize it — but the **same Ad Campaign continues uninterrupted**, never restarted. Only the Brief is new each cycle; the Ad Campaign's metrics and Optimization Log history stay continuous underneath it.

---

## 3. Feature: Ads queue & roles

### Rules
1. Ads roles: **Advertiser (Marketplace)**, **Advertiser (Social)**, plus an **Ads Team Leader** overseeing both.
2. Each Advertiser sees a personal queue of assigned Briefs/Ad Campaigns, across all clients, sorted by due date (for Brief setup) or by active-campaign health (for ongoing management).
3. Ads Team Leader can reassign PIC on any Brief/Ad Campaign (logged), same convention as Creative's Team Leader.

### Flow
1. Brief arrives from Module 6 in the Ads queue.
2. Team Leader assigns it to an Advertiser (Marketplace or Social, matching the Brief's platform).
3. Advertiser works the Brief through setup (§4) while it's still `[To Do]`/`[In Progress]`.

---

## 4. Feature: Ad Campaign creation & Creative Asset linkage

### Rules
1. An Ad Campaign is created while the parent Brief is `[In Progress]` — fields: Platform (Shopee Ads / TikTok Shop Ads / Social Ads), Objective, Budget, Start/End Date, **Target KPI** (ROAS or GMV or Spend cap, whichever the brief specifies — ✅ resolved, M8-OA-4: AM negotiates the initial figure with the Client, SPV Ads signs off on the final number before it's set; Advertisers never self-set targets from platform benchmarks alone).
2. **Creative Asset Linkage (mandatory before launch):** the Advertiser selects which approved Creative Asset(s) (Module 7, `AST-…`) are used as the ad's creative — filtered to that Client/Service so the Advertiser isn't hunting through unrelated clients' assets. A campaign can link multiple Assets (e.g. testing 2 video variants).
3. Submitting the Brief (moving it to `[Submitted]`) requires the linked Ad Campaign(s) to exist with these fields filled — system blocks with `[campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]`.
4. AM reviews the setup against the Brief's instructions (and, if Plan-gated, the original Strategy's Target KPI — Module 6 §4) → `[Approved]` (campaign goes/stays `[Active]`) or `[Revision Requested]` (setup wrong; Ad Campaign held, not launched with real spend until corrected).

### Flow
1. Advertiser creates the Ad Campaign record, links Creative Asset(s), submits the Brief.
2. AM reviews setup → Approved → Ad Campaign flips to `[Active]`, real spend begins.
3. From here, the Ad Campaign runs independently of the now-closed Brief.

### Example
Brief #2 ("TikTok Ads Campaign," Alpha Digital, from Module 6's example) is assigned to **Advertiser Kenny**. Kenny creates `ADC-202606-0008`: Platform = TikTok Shop Ads, Budget = Rp 8.000.000, Target KPI = ROAS ≥ 4x, and links Creative Asset `AST-202606-0031` (Rian's approved product video) as the ad creative. Sinta reviews, approves — Brief #2 closes `[Approved]`; `ADC-202606-0008` goes `[Active]`.

---

## 5. Feature: Periodic metrics & ROAS

### Rules
1. Metrics (Spend, GMV from Ads, and CTR/CVR where the platform provides them) are entered **periodically** against the Ad Campaign — confirmed (Phase 0 OA-4): **manual entry or file export upload** from the platform, not an automated pull yet.
2. Each metric entry covers a **period** (e.g. weekly) and is additive — system maintains running totals (Total Spend, Total GMV from Ads) alongside the latest period's numbers.
3. **ROAS** (read-only, auto-calculated) = Total GMV from Ads ÷ Total Spend — the execution-side north star for this module, distinct from Module 2's Marketing ROAS (which measures MEA's own lead-gen efficiency, not client ad performance).
4. Live Ads GMV feeds into the Client's overall GMV signal (alongside organic/other sources) for Health Score (Module 4/Phase 0 OA-3).

### Flow
1. Advertiser logs a metric entry each period (manual figures or an uploaded export file).
2. System recalculates running Spend, GMV from Ads, and ROAS.
3. AM/SPV can view the Ad Campaign's performance trend at any time without waiting for a formal review cycle.

### Example
Week 1: Kenny logs Spend Rp 2.000.000, GMV from Ads Rp 9.500.000 → running ROAS 4.75x, above the 4x target. Week 2: Spend Rp 2.000.000, GMV Rp 6.000.000 → running totals: Spend Rp 4.000.000, GMV Rp 15.500.000, ROAS 3.875x — dipping toward target, visible on Sinta's dashboard without anyone filing a report.

---

## 6. Feature: Optimization Log (ongoing changes, not Brief revisions)

### Rules
1. Any change to a **live** Ad Campaign (budget adjustment, targeting change, creative swap, schedule change, pause/resume) is recorded as an **Optimization entry** (`OPT-…`) — before value, after value, reason, actor, timestamp. This is **not** a Brief revision and does **not** reopen the Brief's Kanban (§2) — the Brief already closed once setup was approved.
2. Optimization entries are immutable history (house convention) — the full tuning history of a campaign stays visible even as the live values change.
3. Swapping the linked Creative Asset (e.g. underperforming video replaced with a new one) is logged the same way — old/new Asset IDs recorded, which matters for attribution (§7) since GMV from that point forward attributes to the new Asset, not the old one.

### Flow
1. AM/Advertiser identifies a needed change (from the metrics in §5, or AM feedback).
2. Advertiser applies the change directly on the Ad Campaign, system logs the Optimization entry automatically.
3. **No approval gate for routine optimizations** (visibility, not permission, is the control) — **except** any single budget adjustment **>50%**, which requires AM/SPV Ads sign-off before applying (✅ resolved, M8-OA-3).

### Example
After Week 2's dip (§5 example), Kenny swaps the linked creative from `AST-202606-0031` to a newer Asset Rian just delivered, logged as `OPT-202606-0014` (Change Type: Creative Swap, Reason: "ROAS trending down, testing fresher hook"). From this point, GMV attributes to the new Asset (§7).

---

## 7. Feature: Attribution feedback — closing the loop to Creative

### Rules
1. When an Ad Campaign's metrics are updated (§5), the system computes **Attributed GMV** for each currently-linked Creative Asset and writes it back to that Asset's `Attributed GMV` field (Module 7 §9.3) — closing the loop flagged as M7-OA-4.
2. **Default split logic:** if a campaign has exactly one linked Asset, 100% of that period's GMV attributes to it. If multiple Assets are linked simultaneously (e.g. A/B testing two videos), GMV splits **equally** across them by default — *(flagged as M8-OA-1, since platform-level per-creative breakdown, where available, would be more accurate than an equal split)*.
3. When an Asset is swapped out (§6 Rule 3), only GMV accrued **after** the swap attributes to the new Asset — prior GMV stays attributed to the original.
4. Attribution is read-only from Creative's side — only Ads/Reporting writes it; Creative can view but not edit.

### Flow
1. Each metric entry triggers a recompute of Attributed GMV across that period's linked Asset(s).
2. Values accumulate on the Asset record, visible on Creative's KPI dashboard (Module 7 §8).

### Example
Week 1's Rp 9.500.000 GMV attributes entirely to `AST-202606-0031` (sole linked Asset that week). After the Week 2 swap, subsequent GMV attributes to the new Asset instead — Rian's original video keeps its Week 1 attribution permanently, unaffected by the later swap.

---

## 8. Feature: Ads KPIs — speed, ROAS, GMV impact

### Rules
1. **Speed KPI** = Brief setup turnaround (time from Brief assigned to `[Submitted]`) per Advertiser, vs. the Brief's Due Date — mirrors Creative's Speed KPI (Module 7 §8), but only covers the one-time setup phase, not ongoing campaign management. **Note:** this is now formally computed through **Module 12's Task Execution engine** (`turnaround_time`/`speed_score`, uncapped by design) — superseding this section's original looser turnaround language, per Module 12 §5.3b.
2. **ROAS** (§5) is the central performance KPI per Advertiser/campaign — tracked against each campaign's Target KPI.
3. **GMV Impact** rolls up from Attributed GMV (§7) — visible per Advertiser (which campaigns they manage) and feeds the same Client Health/Team Performance pipeline as Creative's equivalent.
4. Optimization activity (count of Optimization entries per campaign) is tracked as a secondary signal — responsiveness to underperformance — but not folded into a formal score. **Escalation trigger (✅ resolved, M8-OA-5):** ROAS sitting below target for **2 consecutive metric-entry periods** auto-flags SPV Ads, logged, rather than relying on passive dashboard visibility alone.

### Example
Kenny's dashboard shows: Brief #2 setup turnaround 1 day (within SLA), running ROAS 3.875x (target 4x, flagged amber, not red), and 1 Optimization logged this campaign — visible context for his upcoming performance conversation with the Ads Team Leader.

---

## 9. System Requirements

### 9.1 Roles

| Role | Capabilities in Module 8 |
|---|---|
| **Advertiser (Marketplace / Social)** | Own Brief/Campaign queue; create Ad Campaigns, link Creative Assets, log periodic metrics, apply optimizations; see own KPIs. |
| **Ads Team Leader** | Reassign PICs (logged); view team's campaigns, metrics, KPIs; visibility on underperforming campaigns. |
| **Account Manager (AM)** | Reviews Brief setup (`[In Review]` → `[Approved]`/`[Revision Requested]`); views live campaign performance for owned clients. |
| **SPV / Head Account** | Sees all Ad Campaigns' performance; visibility on ROAS-underperforming campaigns across all clients. |
| **Creative** | Read-only view of which of their Assets are linked/attributed (Module 7 §8, §9.3). |
| **Org Development (OD)** | Read-only on all campaigns, metrics, Optimization Logs, audit logs. |
| **Director** | Full view. |

### 9.2 Features
1. Ad Campaign creation (distinct entity from Module 3's Campaign) + Creative Asset linkage.
2. Brief-setup approval gate (one-time, Module 6 Kanban) decoupled from ongoing campaign lifecycle.
3. Periodic metrics entry (manual/file-export) + running Spend/GMV/ROAS.
4. Optimization Log for ongoing changes (no Brief reopening).
5. Attribution feedback writing Attributed GMV back onto Creative Assets.
6. Ads KPIs: Speed, ROAS, GMV Impact, Optimization activity.

### 9.3 Field specs — Ad Campaign (`ADC-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Ad Campaign ID | system | auto | `ADC-YYYYMM-NNNN`. |
| Brief ID | reference | auto | Parent Brief. |
| Client ID | system | auto | Inherited via Brief → Service → Client. |
| Platform | single choice | **mandatory** | Shopee Ads / TikTok Shop Ads / Social Ads. |
| Objective | text/select | **mandatory** | e.g. Awareness, Traffic, Conversion/GMV. |
| Budget | number (Rp) | **mandatory** | Planned budget. |
| Start Date / End Date | date | **mandatory** | |
| Target KPI | text/number | **mandatory** | ROAS target, GMV target, or Spend cap — per Brief/Strategy. |
| Linked Creative Asset(s) | reference (multi) | **mandatory** before launch | From Module 7, filtered to Client/Service. |
| Status | system (state machine) | auto | `[Active]` / `[Paused]` / `[Ended]`. |
| Total Spend | system | auto | Sum of metric entries. |
| Total GMV from Ads | system | auto | Sum of metric entries. |
| ROAS | system | auto | Total GMV from Ads ÷ Total Spend. |

### 9.4 Field specs — Metric Entry (`MTR-…`, child of Ad Campaign)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Metric Entry ID | system | auto | `MTR-YYYYMM-NNNN`. |
| Ad Campaign ID | reference | auto | Parent. |
| Period | date range | **mandatory** | e.g. weekly window. |
| Spend | number (Rp) | **mandatory** | |
| GMV from Ads | number (Rp) | **mandatory** | |
| CTR / CVR | number (%) | optional | Where platform provides. |
| Entry Method | single choice | **mandatory** | `Manual` / `File Export`. |
| Entered By | reference (user) | auto | |

### 9.5 Field specs — Optimization Log (`OPT-…`, child of Ad Campaign)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Optimization ID | system | auto | `OPT-YYYYMM-NNNN`. |
| Ad Campaign ID | reference | auto | Parent. |
| Change Type | single choice | **mandatory** | Budget / Targeting / Creative Swap / Schedule / Other. |
| Before Value | text | **mandatory** | |
| After Value | text | **mandatory** | |
| Reason | text | **mandatory** | |
| Actor | reference (user) | auto | |
| Timestamp | system | auto | |

---

## 10. Resolved Decisions (Module 8)

- **M8-OA-1 (Attribution split logic) — ✅ Confirmed as proposed.** Equal split across simultaneously-linked Assets stays the default — no platform-native per-creative breakdown override, even where the platform could technically provide it (keeps the math simple and consistent across platforms).
- **M8-OA-2 (Metric entry cadence) — ✅ Weekly.** Formalizes the previously-informal weekly assumption into a confirmed requirement.
- **M8-OA-3 (Optimization approval) — ✅ Resolved.** Routine optimizations still need no approval gate (visibility-only, unchanged). **New threshold:** any single budget adjustment **>50%** requires AM/SPV Ads sign-off **before** applying — below that, Advertiser acts freely and the system just logs it.
- **M8-OA-4 (Target KPI source) — ✅ Resolved.** Target KPI must always trace back to an **AM-approved** target — AM negotiates the initial number with the Client, SPV Ads signs off on the final figure before it's set on the Ad Campaign. Advertisers don't self-set targets from platform benchmarks alone.
- **M8-OA-5 (Underperformance escalation) — ✅ Resolved, concrete trigger.** ROAS sitting below target for **2 consecutive metric-entry periods** (i.e. 2 consecutive weeks once M8-OA-2's weekly cadence is in effect) auto-flags SPV Ads, logged — beyond that, passive dashboard visibility alone isn't enough.
- **M8-ADD-1 (Target metrik per Brief + Laporan Mingguan Advertiser) — ✅ Ditambahkan pemilik 2026-08-14** (`DECISIONS.md`; migrasi `20260814100000`). Dua hal yang PRD ini tidak punya, diminta pemilik dari halaman `/tasks/BRF-…`:
  1. **Target metrik menempel pada BRIEF, bukan hanya pada Ad Campaign.** Enam angka — Ads spent, GMV, ROAS, view/impresi, CTR, CVR — ditetapkan **SPV/Lead Ads (atau Direksi)** bersamaan dengan penetapan PIC, jadi Advertiser tak pernah menerima brief tanpa angka yang harus dikejar. Semuanya opsional, minimal satu terisi. Ini **melengkapi**, bukan mengganti, §9.3 `Target KPI` milik Ad Campaign (satu KPI per kampanye, lahir belakangan). Sumber saran pre-fill: `Quantity/Target` brief (deliverable "Ads spent (Rp)") + Target KPI Strategy (M6) — saran tak pernah tersimpan sendiri; M8-OA-4 tetap berlaku penuh (Advertiser tidak menetapkan targetnya sendiri).
  2. **Laporan Mingguan per Brief oleh PIC.** Tiap minggu ISO (cadence M8-OA-2), Advertiser menulis **analisa performa** dan **saran perbaikan** untuk minggu berikutnya. Angka realisasi mingguan (§5) **tidak diketik** — dihitung ulang dari Metric Entry dan ditampilkan berdampingan dengan target di atas. Append-only: koreksi ditulis sebagai laporan minggu berikutnya. Ini **bukan** Catatan Divisi M6D RM-D6 (satu catatan per klien per minggu oleh lead divisi ke rekap AM) — ini per brief oleh eksekutornya, dan justru menjadi bahan mentah RM-D6.
- **M8-OA-6 (Brief stays open for recurring ad work) — ✅ Resolved.** A **new Brief is created each time there's a significant new strategy/budget cycle** (e.g. quarterly re-strategy) rather than one permanent setup Brief for the Service's lifetime. **Clarification (closes a cross-module gap):** the **same Ad Campaign (`ADC-…`) continues uninterrupted** across these cycles — only the Brief is new each time, to formalize the re-strategy approval; the Ad Campaign's metrics/Optimization Log history stays continuous and is never restarted.

---

**Next:** Module 9 — KOL (Brief intake from Module 6, creator-list output via Drive link, QC, time-tracking, and monthly reporting — the third execution division before Live Stream's vendor-tracker exception in Module 10).
