# HRIS — Module 3: Campaign

> **Position in the journey:** the **thread**. A Campaign (`CMP-…`) is MEA's own lead-generation / acquisition effort. It is created by Marketing, carried into Sales ("Campaign: text terusan dari marketing"), and stays attached — via the leads it produces and the clients those leads become — all the way to Account and execution. It is the single key that answers *"which campaign ultimately produced this serviced client, and what did it cost vs return?"*
>
> **Disambiguation (important):** this is the **acquisition campaign**. It is **not** the client's ad campaign that the **Ads team** builds during execution ("eksekusi brief menjadi campaign yg memiliki ROAS tinggi") — that is a separate entity defined in the **Ads module**. (See M3-OA-1.)

## Contents
1. Background & Objective
2. Core concept: the Campaign as the acquisition thread
3. Feature: Campaign entity & lifecycle (status state machine)
4. Feature: Linkage & end-to-end traceability (leads → clients → execution)
5. Feature: Ownership & Lead/Staff visibility
6. System Requirements (Roles + Features + field specs)
7. Open Assumptions (Module 3)

---

## 1. Background & Objective

Marketing (Module 2) measures money and metrics; Sales (reference) carries a campaign label forward; but nothing today is the **one entity** that lets MEA trace a relationship from *first ad/event* → *lead* → *won client* → *the services that client receives*. Without it, attribution drifts, the same campaign name is typed three different ways, and "which acquisition effort actually produced paying, serviced clients?" can't be answered.

The **Campaign** module formalises `CMP-…` as that first-class thread. It owns the campaign's **identity, channel, dates, lifecycle, and ownership**, and is the **linkage hub** that the Leads Database, Marketing performance record, Sales, and (downstream) Client records all point at.

Expected result: one canonical campaign per effort; clean Marketing→Sales→Account traceability; trustworthy end-to-end attribution from spend to serviced client.

---

## 2. Core concept: the Campaign as the acquisition thread

- A **Campaign** (`CMP-…`) is created by a **Marketing Staff** owner.
- It is **1:1 with a Marketing Performance Record** (Module 2): the Campaign holds *identity + lifecycle*, the performance record holds *budget + metrics*. Budget/metrics are **not** duplicated here (M3-OA-5).
- Its **Channel** (e.g. TikTok Ads, IG, Event, Broadcast) drives the **Source** auto-set on every lead imported under it (closes M1-OA-3): `Campaign.Channel → Lead.Source`.
- The thread runs: **Campaign → Leads** (Origin Campaign on each `LEAD-…`) → **won attempt → Client** (the Client's Origin Campaign = this campaign) → **Account & execution** for that client. So from a Campaign you can walk forward to every client it produced and the services they're receiving — without the Campaign itself being an execution unit.
- A Campaign's status governs whether it **accepts new leads**, but **late conversions still attribute** to it after it closes, within a **3-month window** (M3-OA-4).

---

## 3. Feature: Campaign entity & lifecycle (status state machine)

### Rules
1. A `CMP-…` ID is generated **only after** mandatory fields are complete and validation passes (house convention §2.1).
2. Mandatory to create: **Campaign Name, Channel, Online/Offline, Start Date, Owner**. (Budget is captured on the 1:1 Marketing performance record — Module 2.)
3. **Status state machine** with explicit, system-enforced transitions:

| From | Allowed → To | Effect |
|---|---|---|
| `[Draft]` | `[Active]` | Campaign starts accepting leads (imports allowed). |
| `[Active]` | `[Paused]` | Temporarily stops accepting new leads; metrics stop accruing new attribution while paused (M3-OA-3 — tightened from initial draft). |
| `[Paused]` | `[Active]` | Resumes accepting leads. |
| `[Active]` / `[Paused]` | `[Closed]` | No new leads accepted; existing leads keep their lifecycle; **late conversions still attribute within a 3-month window** (M3-OA-4). |
| `[Closed]` | `[Archived]` | Read-only historical record; excluded from active dashboards. |

4. The system **blocks** any transition not in the table (e.g. `[Archived] → [Active]`) and shows `[transisi status tidak diizinkan]`.
5. Importing leads (Module 1) is only permitted while status ∈ `{Active}`; attempting an import under `[Draft]`/`[Paused]`/`[Closed]` → `[campaign belum/tidak aktif, lead tidak bisa diimport]`. A lead that does close after its Campaign reaches `[Closed]` still attributes **only within a 3-month (one quarter) window** from the Closed date (M3-OA-4) — beyond that window, the closing no longer credits the Campaign.
6. Every transition records actor + timestamp; history is immutable (house convention §2.3).

### Flow
1. Marketing Staff creates a Campaign (`[Draft]`) → fills name, channel, online/offline, start date.
2. On save + validation → `CMP-…` generated, status `[Draft]`.
3. Owner sets `[Active]` → leads can now be imported under it; Source auto-sets from Channel.
4. (Optional) `[Paused]` ↔ `[Active]` as needed.
5. At campaign end → `[Closed]`; late conversions still attribute within a 3-month window; finally `[Archived]`.

### Example
On **2 March 2026**, **Lia** creates **`CMP-202603-0007`** — Name "Promo Skilskul Maret", **Channel: TikTok Ads**, **Online ☑**, Start 2 Mar, Owner Lia → `[Draft]`. She sets it `[Active]`; the 46 imported leads (Module 1) auto-get **Source = Leads - Iklan** from the TikTok-Ads channel. On 31 Mar she sets it `[Closed]`; a lead that closes on 4 Apr still attributes to it.

---

## 4. Feature: Linkage & end-to-end traceability (leads → clients → execution)

### Rules
1. **Campaign → Leads:** every `LEAD-…` imported under the campaign carries its Campaign ID (Module 1). Count = Lead-by-Dashboard.
2. **Leads → Clients:** when a campaign lead's winning attempt reaches `Closed-Success`, the resulting **Client** record stores **Origin Campaign = this campaign** (set at closing, carried by the won attempt).
3. **Clients → Execution:** because the Client carries the campaign, Account & the execution teams can trace a serviced client back to its acquisition campaign (read-only; execution teams don't act on the campaign).
4. The Campaign exposes derived, read-only rollups: **Leads generated**, **Real leads (≥ Qualified)**, **Clients won (count)**, **Total client value won**, and a **client list** with each client's current service status (read from Account).
5. These rollups are read-only and **generally** reconcile with Module 2's metrics (single source — Leads DB + won deals) — with one confirmed, intentional exception: this Campaign's **"Clients won"** rollup uses **Origin Campaign** (first-touch, permanent lineage), while Module 2's **Attributed Sales** uses **Last-Touch Campaign** (M2-OA-2) for marketing-spend credit. For a single-touch lead the two always agree; for a multi-touch lead they can legitimately diverge, and that's by design, not a data error.

### Flow
1. Open a Campaign → see its lead funnel (Dashboard → Real → Won) and the **clients** it produced.
2. Click a won client → jump to its Client record / service progress (Account module) — closing the Marketing→Sales→Account→execution trace.

### Example
`CMP-202603-0007` rollup: Leads 46 → Real (≥Qualified) 12 → **Clients won 3** (Sini Store + 2), Total value won **Rp 21.900.000,00**. Clicking **Sini Store** opens its Client record, showing the services Account broke down for it — the full thread from one TikTok ad to a serviced client.

| Campaign | Channel | Status | Leads | Real | Clients won | Value won |
|---|---|---|---|---|---|---|
| CMP-202603-0007 (Promo Skilskul Maret) | TikTok Ads | Closed | 46 | 12 | 3 | Rp 21.900.000,00 |

---

## 5. Feature: Ownership & Lead/Staff visibility

### Rules
1. A Campaign has **one Marketing owner** (its creator); ownership may be **reassigned** to another Marketing Staff, logged with timestamp (M3-OA-6).
2. **Marketing Staff** sees and manages **own** campaigns only.
3. **Marketing Lead/Head** has a dashboard over **all** campaigns (status, channel, funnel rollups) and can reassign ownership.
4. **Sales** sees the campaign label on the leads/attempts they work (carried from Marketing) but does not edit the Campaign entity.
5. **OD** read-only across all campaigns + manages related OKR; **Directors** full view.

### Example
Lia owns `CMP-202603-0007`. When she moves teams, the Marketing Lead reassigns it to **Dina**; the handover is logged and Dina now manages it, while history (including Lia's ownership) is preserved.

---

## 6. System Requirements

### 6.1 Roles

| Role | Capabilities in Module 3 |
|---|---|
| **Marketing Staff** | Create/edit/own **own** campaigns; set lifecycle status (Draft→Active→Paused→Closed→Archived); view own funnel + client rollups. |
| **Marketing Lead/Head** | Dashboard over **all** campaigns; reassign ownership; monitor status/channel/funnel across campaigns. |
| **Sales** | Read-only campaign label on worked leads/attempts (carried forward); cannot edit Campaign. |
| **Account & execution** | Read-only trace: from a Client back to its Origin Campaign. |
| **Org Development (OD)** | Read-only all campaigns + activity logs; manages OKR. |
| **Director** | Full view; manage employees. |

### 6.2 Features
1. Campaign entity & lifecycle (status state machine + blocking).
2. Linkage & end-to-end traceability (leads → clients → execution).
3. Ownership & Lead/Staff visibility (incl. ownership reassignment).

### 6.3 Field specs — Campaign (`CMP-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Campaign ID | system | auto | `CMP-YYYYMM-NNNN`, after validation. |
| Campaign Name | text only | **mandatory** | Human label carried into Sales. |
| Channel | multiple choice | **mandatory** | Drives `Lead.Source` auto-set (M3-OA-2): TikTok Ads, IG, Website, Broadcast, Event, Kulwa, Referral, Scouting, Database, Others …. |
| Online/Offline | multiple choice (checklist) | **mandatory** | Multi-select `{Online, Offline}` (mirrors Module 2). |
| Start Date | date | **mandatory** | — |
| End Date | date | optional | Set on `[Closed]`. |
| Owner (Marketing Staff) | system | system | Reassignable, logged. |
| Status | system | system | Draft / Active / Paused / Closed / Archived. |
| Marketing Performance Record | link | system | 1:1 to Module 2 (budget + metrics live there). |
| Leads generated | number | auto read-only | From Leads DB. |
| Real leads (≥ Qualified) | number | auto read-only | From Leads DB. |
| Clients won | number | auto read-only | Clients with this Origin Campaign. |
| Total value won | number | auto read-only | Σ won-deal value (reconciles with Module 2). |

### 6.4 Constraints & non-functional
- Lead import gated on `status = Active` (Module 1 import checks this).
- Status transitions atomic + logged; invalid transitions blocked with BI message.
- Campaign is a **linkage hub**: it writes its ID onto Leads (at import) and is stamped onto Clients (at closing); rollups are **read-only** and reconcile with Module 2 and the Leads DB (one source of truth).
- IDR formatting per house convention.

### 6.5 Success Metrics (module health)
- **Adoption:** % of imported leads that carry a valid Campaign ID (target high → no orphan leads).
- **Traceability:** % of won clients with a resolvable Origin Campaign.
- **Hygiene:** count of duplicate/abandoned `[Draft]` campaigns (target low).

---

## 7. Resolved Decisions (Module 3)

- **M3-OA-1 (Campaign disambiguation) — ✅ Confirmed, no third category needed.** Module 3 Campaign = MEA's own acquisition/lead-gen effort (including MEA's own paid ads, tagged via the **Channel** field — e.g. "TikTok Ads" as a Channel value); Module 8's Ad Campaign = the separate client-facing paid-media entity. The two-entity split already cleanly covers MEA's own paid acquisition without needing a third category.
- **M3-OA-2 (Channel taxonomy → Source) — ✅ Left free-text for now.** Mappings added incrementally as new Channels come up, rather than a fixed upfront table.
- **M3-OA-3 (Paused state) — ✅ Confirmed, with a clarification.** The `[Paused]` state exists. Leads arriving while a Campaign is `[Paused]` do **not** count as attributed — Campaign must be `[Active]` to accept/attribute new leads (tightens the original "keeps accruing" default).
- **M3-OA-4 (Late conversions after Close) — ✅ Limited to one quarter (3 months).** A lead closing more than 3 months after its Campaign reaches `[Closed]` no longer attributes to that campaign (narrows the original "no time limit" default).
- **M3-OA-5 (Budget location) — ✅ Confirmed as proposed.** Budget + metrics live on the Module 2 performance record; Campaign holds identity/lifecycle/linkage only.
- **M3-OA-6 (Ownership reassignment) — ✅ Confirmed as proposed.** Reassignable by the Marketing Lead, logged, history preserved.

> **Next module:** Module 4 — **Client Info / Client Record** (`Client ID`; Nama, Toko, Kota, Link Toko, Kategori, Service List, Platform List, GMV saat ini, Target GMV, Marketing Budget, Total Sales; who edits at which stage; lock rules) — the record the whole post-sales journey hangs on.
