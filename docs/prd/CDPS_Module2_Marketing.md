# CDPS — Module 2: Marketing

> **Position in the journey:** the first operational division. Marketing runs campaigns (online/offline) on a budget, pours leads into the **Leads Database** (Module 1), and is measured on whether those leads convert — with **ROAS** as the most important objective. This module does **not** re-store leads; it holds the **per-campaign performance record** and reads lead counts + quality from Module 1. The Campaign as a first-class cross-journey entity is formalised in **Module 3**; here it is the unit of measurement.

## Contents
1. Background & Objective
2. Core concept: the Marketing Performance Record
3. Feature: Campaign Performance Record (inputs)
4. Feature: Auto-Metrics Engine (CPL · Cost-per-Real-Lead · ROAS · Quality)
5. Feature: Lead/Staff Dashboard split
6. System Requirements (Roles + Features + field specs)
7. Open Assumptions (Module 2)

---

## 1. Background & Objective

Marketing's job is to spend a budget on campaigns that produce **real, qualifiable seller leads** — not just raw lead volume. Today, budget, lead counts, and resulting sales sit in different sheets, so nobody can see a campaign's true **ROAS** or whether a campaign that "produced lots of leads" actually produced *sellers*.

This module records, **per campaign**, the marketing inputs (online/offline, budget, attributed sales) and auto-computes the metrics that matter: **Cost per Lead**, **Cost per Real Lead**, **Lead-Quality Rate**, and the north-star **ROAS**. It reuses Module 1's lead counts and **bad-lead evaluation** so a high-volume / low-quality campaign is visibly distinguished from a high-ROAS one.

Expected result: Marketing is steered by ROAS + lead quality, not vanity lead counts; weak campaigns and weak sources are caught early.

---

## 2. Core concept: the Marketing Performance Record

- One **Marketing Performance Record** exists **per Campaign** (`CMP-…`), 1:1 with the Campaign entity (Module 3).
- **Inputs** (entered by Marketing): campaign name, online/offline checklist, budget.
- **Read-only auto fields** (computed, never typed — house convention §2.6): Lead-by-Dashboard, Lead-Real-by-Sales, Lead-Quality Rate, attributed Sales, Cost per Lead, Cost per Real Lead, ROAS, junk-reason breakdown.
- Lead counts + quality come **straight from Module 1**; attributed Sales comes from **won deals** whose originating lead carries this Campaign ID (attribution per M2-OA-2).

---

## 3. Feature: Campaign Performance Record (inputs)

### Rules
1. A performance record is created per campaign; **Campaign name, Online/Offline, and Budget are mandatory** to start tracking.
2. **Online/Offline is a checklist** — a campaign may be **Online, Offline, or both** (M2-OA-4).
3. **Budget** is a positive number in IDR.
4. Incomplete mandatory inputs → save blocked: `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.
5. A Marketing Staff member owns and edits **only their own** campaign records; the Marketing Lead sees all.
6. Lead counts, quality, attributed Sales, and all cost/ROAS fields are **system-computed and read-only** — Marketing cannot type into them (no fudging).

### Flow
1. Marketing Staff creates a Campaign performance record → enters name, ticks Online and/or Offline, enters Budget → save (validation).
2. As leads are imported under this campaign (Module 1), **Lead-by-Dashboard** accrues automatically.
3. As Sales qualify attributed leads, **Lead-Real-by-Sales** + **Lead-Quality Rate** update; as attributed leads close, **Sales** accrues.
4. The Auto-Metrics Engine (§4) recomputes CPL, Cost-per-Real-Lead, and ROAS live.

### Example
On **2 March 2026**, Marketing Staff **Lia** creates the record for **`CMP-202603-0007`** ("Promo Skilskul Maret"): **Online ☑**, Offline ☐, **Budget Rp 5.000.000,00**. Imports 46 pool leads (Module 1 example). The record now tracks live.

---

## 4. Feature: Auto-Metrics Engine (CPL · Cost-per-Real-Lead · ROAS · Quality)

### Rules
1. **Lead-by-Dashboard** = count of `LEAD-…` records with this Campaign ID (Module 1 §8).
2. **Lead-Real-by-Sales** = count of those leads where ≥ 1 attempt reached **`Qualified`** (genuine seller + potential).
3. **Lead-Quality Rate** = Lead-Real-by-Sales ÷ Lead-by-Dashboard.
4. **Attributed Sales** = Σ of **won-deal (Closed-Success) transaction values** for leads whose **Last-Touch Campaign** (Module 1 §5) = this campaign — confirmed last-touch attribution (M2-OA-2; revenue basis = closing value, M2-OA-5). Auto, read-only.
5. **Cost per Lead (CPL)** = Budget ÷ Lead-by-Dashboard.
6. **Cost per Real Lead (CPRL)** = Budget ÷ Lead-Real-by-Sales (quality-adjusted; CPL's honest cousin).
7. **ROAS** = Attributed Sales ÷ Budget — the **north-star** marketing objective.
8. Division-by-zero (no leads / zero budget) renders as `—`, never an error.
9. **Junk breakdown** (from Module 1 bad-lead evaluation) is surfaced here per campaign/source so a low-ROAS campaign's cause (e.g. "pulls non-sellers") is visible.

### Example
`CMP-202603-0007` after the month closes:

| Metric | Value | Basis |
|---|---|---|
| Budget | Rp 5.000.000,00 | input |
| Lead-by-Dashboard | 46 | Module 1 |
| Lead-Real-by-Sales (≥ Qualified) | 12 | Module 1 |
| Lead-Quality Rate | 26% | 12 ÷ 46 |
| Closed deals (attributed) | 3 | won attempts on campaign leads |
| Attributed Sales | Rp 21.900.000,00 | Sini Store 9.000.000 + 6.900.000 + 6.000.000 |
| **ROAS** | **4.38** | 21.900.000 ÷ 5.000.000 |
| Cost per Lead | Rp 108.695 | 5.000.000 ÷ 46 |
| Cost per Real Lead | Rp 416.667 | 5.000.000 ÷ 12 |
| Junk breakdown | `[Bukan seller]` 11, `[Tidak ada respon]` 5, `[Kontak salah]` 2 | Module 1 |

Read: ROAS 4.38 is healthy, but a 26% quality rate + 11 non-sellers tells Lia the targeting pulls too many non-sellers — tighten the audience next round.

---

## 5. Feature: Lead/Staff Dashboard split

### Rules
1. **Marketing Staff** sees only **own campaigns** — their inputs + all auto-metrics + their junk breakdown.
2. **Marketing Lead/Head** has a **dashboard over all staff and all campaigns**: compare CPL, CPRL, ROAS, and Quality Rate across campaigns and across staff; sort/flag low-ROAS or low-quality campaigns.
3. The Lead dashboard is read-only over staff records (monitor, not edit).

### Example
The Marketing Lead's board for March ranks campaigns by ROAS; `CMP-202603-0007` shows ROAS 4.38 / Quality 26%, while a parallel offline event campaign shows ROAS 1.2 / Quality 9% — flagged red for review.

---

## 6. System Requirements

### 6.1 Roles

| Role | Capabilities in Module 2 |
|---|---|
| **Marketing Staff** | Create/edit **own** campaign performance records (name, online/offline, budget); import leads (Module 1); view own auto-metrics + junk breakdown. Cannot edit any auto field. |
| **Marketing Lead/Head** | Dashboard over **all** staff/campaigns; cross-campaign CPL/CPRL/ROAS/Quality comparison; flag weak campaigns. Read-only over staff records. |
| **Org Development (OD)** | Read-only across all marketing data + activity logs; **manages Marketing OKR** (e.g. ROAS target, Quality-Rate target). |
| **Director** | Full view; manage employees. |

### 6.2 Features
1. Campaign Performance Record (inputs + validation).
2. Auto-Metrics Engine (CPL, CPRL, ROAS, Quality, junk breakdown — all read-only).
3. Lead/Staff Dashboard split (Staff own; Lead all + comparison).

### 6.3 Field specs — Marketing Performance Record

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Campaign | link | **mandatory** | `CMP-…` (entity defined in Module 3); name shown as text. |
| Online/Offline | multiple choice (checklist) | **mandatory** | Multi-select `{Online, Offline}` (M2-OA-4). |
| Budget | number | **mandatory** | IDR, > 0. |
| Owner (Marketing Staff) | system | system | Record owner. |
| Lead-by-Dashboard | number | auto read-only | From Leads DB. |
| Lead-Real-by-Sales | number | auto read-only | ≥ Qualified, deduped per lead. |
| Lead-Quality Rate | number (%) | auto read-only | Real ÷ Dashboard. |
| Attributed Sales | number | auto read-only | Σ won-deal value, this campaign (M2-OA-2/5). |
| Cost per Lead | number | auto read-only | Budget ÷ Dashboard. |
| Cost per Real Lead | number | auto read-only | Budget ÷ Real. |
| ROAS | number | auto read-only | Sales ÷ Budget (**north-star**), basis = closing/booked value (M2-OA-5). |
| Collected-ROAS | number | auto read-only | Same formula, basis = verified-received amounts only (Module 5 Amount Verified) — confirmed secondary metric (M2-OA-5). |
| Junk breakdown | system | auto read-only | Not-Qualified reason counts (Module 1). |

### 6.4 Constraints & non-functional
- All metric fields recompute on the relevant Leads-DB / Sales events; division-by-zero → `—`.
- This module **reads** from Module 1 (lead counts/quality) and from Sales/Finance (won-deal values for attribution); it **writes** only its own inputs.
- IDR formatting per house convention (`Rp. 5.000.000,00`).

### 6.5 Success Metrics (marketing module health)
- **North-star:** ROAS per campaign and blended across the period.
- **Leading indicators:** Lead-Quality Rate, Cost per Real Lead (not raw CPL alone), junk-source share.
- **Activation (for the tool):** a campaign is "tracked" when it has Budget + Online/Offline + ≥ 1 attributed lead.

---

## 7. Resolved Decisions (Module 2)

- **M2-OA-1 (Metric basis) — ✅ Confirmed as proposed.** CPL = Budget ÷ Lead-by-Dashboard; Cost per Real Lead = Budget ÷ Lead-Real-by-Sales; ROAS = Attributed Sales ÷ Budget.
- **M2-OA-2 (Sales attribution model) — ✅ Last-touch.** A won deal's revenue is credited to the Lead's **Last-Touch Campaign** (Module 1 §5 addition) rather than its immutable Origin Campaign. **Note:** this means Module 2's Attributed Sales (marketing-efficiency view) and Module 3's "Clients Won" rollup (client-lineage view, which stays on Origin Campaign) can legitimately disagree for a multi-touch lead — intentional, since they answer different questions ("which spend gets credit" vs. "which effort first brought this client in"), not a reconciliation bug.
- **M2-OA-3 (Offline/paper leads) — ✅ Confirmed as proposed.** Offline-event leads are still imported into Module 1 (tagged Offline on the campaign's checklist) so they flow through the same pipeline automatically — no separate manual lead-count field in Module 2.
- **M2-OA-4 (Online/Offline checklist) — ✅ Confirmed as proposed.** Multi-select; a campaign can be both.
- **M2-OA-5 (Revenue basis for ROAS) — ✅ Resolved, two-part.** Headline ROAS uses **closing/booked value** (as proposed). **Collected-ROAS is also needed** (confirmed) — a secondary metric using only **verified-received** amounts (Module 5's Amount Verified), so Marketing doesn't get credit for deals that later fell through or were never fully paid.

> **Next module:** Module 3 — **Campaign**, formalising `CMP-…` as the first-class entity that threads Marketing → Sales → Account → execution (lifecycle, ownership, linkage to leads and clients).
