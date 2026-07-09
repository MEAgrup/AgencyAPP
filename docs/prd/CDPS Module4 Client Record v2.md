# CDPS — Module 4: Client Info / Client Record (v2)

> **v2 changes (9 Jul 2026):** applied Module 0 OD-1 — added `Commission & Payment PIC` and `Sales Allocation` fields (from the Closing Form, Module 0 §6); corrected stale module-number references (Client Health = Module 13, Client Portal = Module 15). No other rule changed.
>
> **Position in the journey:** the record the **entire post-sales journey hangs on**. Born at closing (Module 0 generates **Client ID + Transaction ID + Service ID(s)** there), it carries the client's identity, service list, platforms, and performance baselines forward to Admin & Finance, Account, the execution teams, and ultimately the **Client Health Report**. Its defining concern is **who can edit which field at which stage, and what locks**.

## Contents
1. Background & Objective
2. Core concept: when the Client Record is born + field provenance
3. Feature: Client Record fields & provenance
4. Feature: Lock matrix — who edits what, when
5. Feature: Payment-intent handoff (Sales → Admin & Finance)
6. Feature: Visibility (own clients vs all)
7. System Requirements (Roles + Features + field specs)
8. Resolved Decisions (Module 4)

---

## 1. Background & Objective

Once Sales closes a deal, the client's data must stop living on a lead/attempt and become a **single canonical Client Record** with a unique **Client ID** — so it can't bend or duplicate as it moves across Finance, Account, and four execution paths, and so the Client Health Report has one trustworthy source for GMV-before/after, services, and platforms.

The hard part is **integrity over time**: identity fields captured by Sales at the Qualified stage must **lock** (Module 0 locks Qualified data after submit), while a few operational fields (target, budget) stay revisable by Account, and outcome fields (current sales) are **auto-updated and read-only**. This module defines every field's **provenance, editability, and lock rule**.

Expected result: one immutable Client ID per client, no field drift, a clear audit trail of every correction, and a clean baseline for the Health Report.

---

## 2. Core concept: when the Client Record is born + field provenance

- The Client Record is **created at closing** (`Closed-Success`), when Module 0 generates **Client ID**, **Transaction ID**, and **Service ID(s)**. Before that, the data lives on the Qualified Lead Form / Negotiation / Closing form of the **winning attempt** (Module 1 §6).
- Fields arrive from **three stages**:
  1. **Qualified** (Sales, from client interview) → identity & baseline: Nama, Toko, Kota, Link Toko, Kategori, Platform List, GMV saat ini, Target GMV, Marketing Budget. *Locked after Qualified submit* (Module 0 §4).
  2. **Closing** (Sales) → Service List finalised → **Service IDs**; Client ID/Transaction ID generated; Origin Campaign + Sales PIC + **Commission & Payment PIC + Sales Allocation** stamped from the winning attempt's Closing Form (Module 0 §6, OD-1).
  3. **Post-close** (Account / system) → Total Sales (current actual) auto-updates; Target GMV / Marketing Budget revisable by Account; profile corrections only by an authorised role.
- The record links to: **Origin Campaign** (Module 3, from the won lead), **Transaction ID** (Finance), **Service IDs** (Account/execution), **Sales PIC** (the Primary Salesperson).

---

## 3. Feature: Client Record fields & provenance

### Rules
1. **Client ID** is generated **only at closing**, after all closing mandatory fields are complete (Module 0 §6); it is **immutable and never reused**.
2. Identity/baseline fields are carried from the **winning attempt's Qualified form** and were **already locked** at Qualified submit — the Client Record inherits them locked.
3. **Service List** becomes a set of **Service IDs** at closing; the set is immutable — additions/upsells are **new Services**, not edits (M4-OA-5).
4. **GMV saat ini** is the **baseline** (client's current monthly GMV at onboarding, 3-month average per M4-OA-3) and is **frozen at closing** — it is the "before" for the Health Report.
5. **Total Sales** is the client's **current actual sales/GMV** since onboarding — **auto-updated, read-only** — and is the "after" the Health Report compares against the baseline (M4-OA-1, source M4-OA-7).
6. **Target GMV** and **Marketing Budget** are Sales-set but **revisable by Account** during the engagement, every change logged (M4-OA-6).
7. Mandatory-field validation blocks closing if any required field is incomplete: `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.

### Example — Alpha Digital
Closed by **Budi** on **1 May 2026**:

| Field | Value | Stage / source |
|---|---|---|
| Client ID | `CLI-202605-0021` | Closing (system) |
| Nama (PIC) | (contact name) | Qualified (Sales) |
| Toko | Alpha Digital | Qualified (Sales) |
| Kota | Bandung | Qualified (Sales) |
| Link Toko | (store link) | Qualified (Sales) |
| Kategori | Fashion | Qualified (Sales) |
| Platform List | Shopee, TikTok Shop | Qualified (Sales) — M4-OA-2 |
| Service List | Pendampingan Establish TikTok; Jasa Buka Toko Online Basic; **Jasa Live Streaming Basic** | Closing → Service IDs |
| GMV saat ini (baseline) | Rp 50.000.000,00 / bln | Qualified, frozen at closing |
| Target GMV | Rp 100.000.000,00 / bln | Qualified (revisable by Account) |
| Marketing Budget | Rp 10.000.000,00 | Qualified (revisable by Account) |
| Total Sales (current) | auto-updated | post-close, read-only |
| Origin Campaign | — (scouted, no campaign) | Closing (from won lead) |
| Sales PIC | Budi (Primary Salesperson) | Closing (winning attempt) |
| Commission & Payment PIC | Budi (solo closing → = Primary) | Closing (Module 0 §6 Rule 4) |
| Sales Allocation | Budi 100% | Closing (read-only) |
| Transaction ID | `TRX-202605-0021` | Closing (Finance link) |

> Note the **Jasa Live Streaming Basic** service: per Phase 0 OA-1 this routes downstream to the **Live Stream vendor tracker** (Module 10, sister-company vendor), not an internal execution team.

---

## 4. Feature: Lock matrix — who edits what, when

This is the core integrity contract. The system **blocks** any edit not permitted by this matrix and logs every permitted change.

| Field | Captured at / by | Locked after | Editable post-close by |
|---|---|---|---|
| Client ID | Closing / system | always (immutable) | none |
| Nama (PIC) | Qualified / Sales | Closing | Account Lead or OD — correction only, logged (M4-OA-4) |
| Toko | Qualified / Sales | Qualified submit | Account Lead or OD — correction, logged |
| Kota | Qualified / Sales | Qualified submit | Account Lead or OD — correction, logged |
| Link Toko | Qualified / Sales | Qualified submit | Account Lead or OD — correction, logged |
| Kategori | Qualified / Sales | Qualified submit | Account Lead or OD — correction, logged |
| Platform List | Qualified / Sales | Qualified submit | Account Lead or OD — correction, logged |
| Service List → Service IDs | Closing / Sales | Closing | **No edit**; add/upsell = new Service. Sales-input errors use the **Void Service** path (SPV/Account Lead approval, logged), never a silent edit (M4-OA-5) |
| GMV saat ini (baseline) | Qualified / Sales | Closing (frozen) | OD only (exceptional correction), logged |
| Target GMV | Qualified / Sales | — (revisable) | **Account** (logged) |
| Marketing Budget | Qualified / Sales | — (revisable) | **Account** (logged) |
| Total Sales (current) | post-close / system | read-only (auto) | n/a |
| Origin Campaign | Closing / system | always | none |
| Sales PIC | Closing / system | — | reassign by Sales Lead, logged |
| **Commission & Payment PIC** | Closing / system (Module 0 §6 Rule 4) | — | reassign by Sales Lead, logged (e.g. PIC resigns) — payment reminders re-target automatically |
| **Sales Allocation** | Closing / system | always (read-only snapshot of the Closing Form split) | none — allocation errors are a commission dispute handled by Sales Lead outside field-editing, logged |

Rules:
1. **Sales cannot modify** identity data after the Qualified submit — it is locked when it becomes part of the Client Record.
2. Corrections to locked profile fields require an **authorised role** (Account Lead or OD), produce an **audit entry** (actor, before→after, timestamp), and never delete history.
3. Outcome fields (**Total Sales**) are **system-computed only** — no role can type into them (house convention §2.6).

---

## 5. Feature: Payment-intent handoff (Sales → Admin & Finance)

### Rules
1. "Setelah klien bilang bayar ke sales" → the Sales PIC sets a client-level **Payment Intent**, which **routes the client to Admin & Finance** for verification.
2. Payment Intent options reflect OA-2: `[Bayar Penuh (Lunas)]` (default), `[Bayar Sebagian]`, `[Termin]`, `[Bayar di Belakang]`.
3. Setting Payment Intent **does not** itself confirm money received — it only **hands off** to Finance, which sets the **authoritative Payment Status** (`lunas` / `tidak lunas` / `bayar sebagian`) and applies the routing rules in **Module 5**.
4. Until Finance verifies, the client sits in the Finance queue; the execution divisions do **not** receive it yet.
5. Collection reminders (installments, overdue) target the **Commission & Payment PIC**; verification and `[Jatuh Tempo]` flags stay with Finance (Module 0 OD-3, Phase 0 v2 §9).

### Flow
1. Client tells Sales they'll pay → Sales PIC opens the Client Record → sets **Payment Intent** (+ scheme: full / partial / termin / post-paid).
2. System routes the Client Record into the **Admin & Finance** queue (Module 5) and notifies Finance.
3. Finance verifies actual receipt → sets authoritative Payment Status → routes onward (Module 5).

### Example
Budi sets Alpha Digital's Payment Intent = `[Termin]` (client negotiated installments). The record enters Finance's queue; Finance will verify the first installment and route per Module 5. Installment reminders fire in-app to Budi (as Commission & Payment PIC) and to Finance.

---

## 6. Feature: Visibility (own clients vs all)

### Rules
1. **Sales Staff** sees **only their own clients** (a salesperson cannot see other salespeople's clients) and can log complaints / Health inputs **only** for clients they own. Salespeople listed in a client's **Sales Allocation** see that client (read-only) even if not Primary.
2. **Sales Lead/Head** sees all sales clients.
3. **Account Staff** sees **assigned clients**; **Account Lead** sees all account clients (detailed in Module 6).
4. **OD** read-only across all clients; **Director** full view.
5. Execution teams see the **Client + relevant Service IDs** only via their assigned tasks (Modules 6–10), not the full client roster.

---

## 7. System Requirements

### 7.1 Roles

| Role | Capabilities in Module 4 |
|---|---|
| **Sales Staff (PIC)** | At Qualified: enter identity/baseline (then locked). At/after closing: set **Payment Intent** for own clients; view own clients only. Cannot edit locked fields. |
| **Sales Lead/Head** | View all sales clients; reassign Sales PIC and Commission & Payment PIC (logged). |
| **Account Staff** | View **assigned** clients; revise **Target GMV / Marketing Budget** (logged). |
| **Account Lead/Head** | View all account clients; **correct** locked profile fields (logged). |
| **Admin & Finance** | Receive handoff; set authoritative Payment Status (Module 5). |
| **Org Development (OD)** | Read-only all clients + audit logs; exceptional baseline correction (logged); manages OKR. |
| **Director** | Full view; manage employees. |

### 7.2 Features
1. Client Record creation at closing (Client ID + provenance inheritance, incl. Commission & Payment PIC + Sales Allocation).
2. Field provenance & lock matrix (edit-by-stage-and-role + audit).
3. Payment-intent handoff (Sales → Finance routing).
4. Visibility (own clients vs all).

### 7.3 Field specs — Client Record (`CLI-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Client ID | system | auto | `CLI-YYYYMM-NNNN`, at closing; immutable. |
| Nama (PIC) | text only | **mandatory** | Contact person. Locked at closing. |
| Toko | text only | **mandatory** | Store/business name. Locked at Qualified. |
| Kota | text only | **mandatory** | Locked at Qualified. |
| Link Toko | link | **mandatory** | Locked at Qualified. |
| Kategori | multiple choice | **mandatory** | Business category. Locked at Qualified. |
| Platform List | multiple choice (checklist) | **mandatory** | e.g. Shopee, TikTok Shop, Tokopedia, Lazada, Others; per-platform sub-data (store link, start date, active status) per M4-OA-2. Locked at Qualified. |
| Service List → Service IDs | system (from selection) | **mandatory** | Set at closing; immutable set; upsell = new Service (M4-OA-5). |
| GMV saat ini (baseline) | number | **mandatory** | IDR/month, 3-month average (M4-OA-3); frozen at closing. |
| Target GMV | number | **mandatory** | IDR/month; revisable by Account (logged). |
| Marketing Budget | number | optional | IDR; revisable by Account (logged). |
| Total Sales (current) | number | auto read-only | Current actual sales/GMV; basis for growth (M4-OA-1/7). |
| Origin Campaign | link | system | `CMP-…` from won lead (may be empty if scouted). |
| Sales PIC | system | system | **Primary Salesperson** from Module 0 closing; reassignable by Sales Lead (logged). |
| **Commission & Payment PIC** | system (ref User) | system | From Closing Form (Module 0 §6 Rule 4); = Primary when closing solo; reassignable by Sales Lead (logged). Reminder target per OD-3. |
| **Sales Allocation** | system (read-only table) | system | Salesperson + % rows from the Closing Form; Σ = 100%; immutable snapshot. |
| Transaction ID | link | system | `TRX-…` (Finance). |
| Payment Intent | multiple choice | conditional | Full/Partial/Termin/Post-paid; triggers Finance handoff (§5). |

### 7.4 Constraints & non-functional
- Locked fields enforce edit-blocking server-side, not just UI.
- Every correction writes an immutable audit entry (actor, before→after, timestamp).
- IDR fields formatted per house convention (`Rp. 50.000.000,00`).
- Client ID is the join key for: Finance (Module 5), Account/execution (Modules 6–10), PM board (Module 11), **Client Health (Module 13)**, Team Performance modifier (Module 14), **Client Portal (Module 15)**.

---

## 8. Resolved Decisions (Module 4)

- **M4-OA-1 (Total Sales meaning) — ✅ Resolved.** "Total Sales" = the client's current cumulative actual sales/GMV **attributable to MEA-managed channels only** — not the client's entire business across channels MEA never touches. Compared against the GMV-saat-ini baseline for Health Report growth.
- **M4-OA-2 (Platform List) — ✅ Per-platform detail.** Each entry carries its own sub-data: store link, date MEA started managing it, active/inactive status.
- **M4-OA-3 (GMV baseline) — ✅ 3-month average**, frozen at closing.
- **M4-OA-4 (Profile correction rights) — ✅ Confirmed.** Account Lead or OD only, audited.
- **M4-OA-5 (Service List changes) — ✅ Resolved, with Void Service.** Immutable set; upsell = new Service. Sales input errors use the **Void Service** path (SPV/Head Sales or Account Lead approval, logged). **Cascade:** voiding a Service cancels its child Briefs not yet `[Approved]` → `[Cancelled — Service Voided]` (Module 6); already-Approved Briefs untouched.
- **M4-OA-6 (Target GMV / Marketing Budget revisions) — ✅ Confirmed.** Revisable by Account, logged.
- **M4-OA-7 (Total Sales data source) — ✅ Hybrid.** Auto-aggregated from execution/reporting data + AM manual entry allowed, tagged at a lower confidence tier (same Vendor-Reported vs Platform-Verified pattern as Module 10).
- **M4-OA-8 (Multi-salesperson closing — new, v2) — ✅ Resolved via Module 0 OD-1.** `Sales PIC` = Primary Salesperson; `Commission & Payment PIC` and read-only `Sales Allocation` added from the Closing Form. Confirmed by Nerissa, 9 Jul 2026.
