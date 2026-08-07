# CDPS — Module 1: Leads Database

> **Position in the journey:** the single source of truth that sits *before* and *under* the Sales module. Marketing pours leads in; Sales claims and works them; every dashboard (Marketing CPL/ROAS, Sales conversion, Campaign) reads from here. It does not contradict the reference Sales module — it generalises the lead lifecycle so a lead can exist *before* it becomes a sales-owned Prospect, and adds a **competitive-claim** path for marketing pool leads.

## Confirmed decisions carried into this build
- **OA-1 — Live Stream = outsourced vendor.** Live streaming is outsourced to a sister company acting as a vendor — **not** an internal execution team. It will be a **vendor-results tracker** module. (No impact on Module 1; recorded so the journey stays correct downstream.)
- **OA-2 — Payment.** Sales pushes for **lunas upfront**; **termin (installments)** and **post-paid (bayar di belakang)** exist as exceptions. The payment gate supports all three (Admin & Finance module).
- **OA-3 — Health.** Health formula proposed in the Client Health module; GMV growth ↑ = satisfaction ↑, GMV stuck = complaints, off-taste creative / many revisions = minus → **revision count must be tracked** (Creative + Task Execution).
- **OA-4 — Ads weekly summary.** **Manual metric entry OR file export** uploaded from the platform (not auto-pull yet).
- **OA-7 — Complaints.** Client Portal complaint intake confirmed; in practice clients usually complain via **WhatsApp through their Account Manager**, so the **Account door is primary**, Portal secondary.
- **M1-OA-1 — Competitive claim (RESOLVED).** Sales staff **self-claim** pool leads. **The same pool lead may be claimed by more than one staff — by design.** Whoever lands the contract **wins**; this measures **closing skill** head-to-head. (See §2 & §6.)
- **M1-OA-2 — "Real" lead = Qualified (RESOLVED).** Sales moves a lead to **Qualified** only when it is genuinely a **seller with potential**. So *Lead-Real-by-Sales* is counted at **≥ Qualified**. **Bad leads (Not Qualified) are captured and evaluated** by source/campaign. (See §8.)

## Contents
1. Background & Objective
2. Core concept: Lead record, Prospect attempts, Pool vs Scouted, competitive claim
3. Feature: Lead Intake — Marketing (single + bulk import)
4. Feature: Lead Intake — Sales (single registration)
5. Feature: Deduplication Engine
6. Feature: Competitive Claim, Ownership & Win Resolution
7. Feature: Lead History & Audit Log
8. Feature: Lead Quality — Real-by-Sales, Bad-Lead Evaluation, Dashboard counters
9. System Requirements (Roles + Features + field specs)
10. Open Assumptions (Module 1)

---

## 1. Background & Objective

MEA's lead data currently lives across spreadsheets and tools, so the same prospect can be worked twice, marketing-sourced leads get lost before Sales touches them, and there is no clean way to measure how many "leads" a campaign really produced versus how many became real, qualified sellers.

The **Leads Database** is the canonical registry of every lead from every source. It guarantees:
- **One record per real lead** (global dedup), no duplicate *records* across Marketing/Sales.
- A clean handoff from **Marketing pool leads** to **Sales prospects**, including a **competitive-claim** path that lets MEA measure each salesperson's **closing skill**.
- **Immutable history** (owners, attempts, status changes, source, activity) for audit, performance, and later Client Health linkage.
- The **single source** every dashboard reads, so *Lead-by-Dashboard*, *Lead-Real-by-Sales*, and **lead-quality** numbers come from one place and can't drift.

Expected result: no duplicate records, no lost marketing leads, fair head-to-head closing-skill measurement, and trustworthy lead-source attribution feeding CPL/ROAS and lead-quality.

---

## 2. Core concept: Lead record, Prospect attempts, Pool vs Scouted, competitive claim

This is the model the whole module rests on.

- A **Lead record** (`LEAD-…`) is the **one** canonical entry per real lead (one normalized phone = one record). Created the moment a valid lead enters the DB from **either** door.
- A **Prospect attempt** (`PRSP-…`) is a **salesperson's working copy** of that lead. The relationship is **one Lead record → one or more Prospect attempts**:
  - **Scouted / Sales-registered leads** → exactly **one** attempt (the finder owns it exclusively, per the reference).
  - **Pool / Marketing leads** → **one or more** attempts. The same pool lead may be claimed by several staff **simultaneously, by design** (M1-OA-1).
- **Win resolution:** the salesperson whose attempt reaches **`Closed - Success`** (lands the contract) **wins** the lead. At that moment the system **auto-closes** every other open competing attempt on that Lead record as **`[Closed - Kalah Kompetisi]`**. All attempts — winning and losing — are **retained** to compute **closing-skill** metrics (win rate on contested leads).
- A `[Pool]` lead with **zero** attempts has no Prospect ID and appears in no workspace, but still counts for its campaign's *Lead-by-Dashboard*.

So: **Lead record = the shared opportunity; Prospect attempt = a salesperson's run at it.** Competition is allowed only on **pool** leads; scouted leads stay exclusive (reference unchanged).

DB-level status set (wraps, never replaces, the reference's per-attempt sales statuses):

| Status | Level | Meaning | Prospect attempt? |
|---|---|---|---|
| `[Pool]` | Lead record | Marketing-sourced, claimable, 0..N attempts | maybe |
| `[Pending Validation]` | attempt | Sales-registered, validating dedup (reference) | yes |
| `[New Lead]` | attempt | Claimed/registered + validated; enters sales lifecycle | **yes (PRSP issued)** |
| `[Blocked - Duplikat]` | intake | New *external* intake collides with an active lead | no |
| `[Closed - Kalah Kompetisi]` | attempt | A competing attempt auto-closed because another attempt won | yes (retained) |
| *(reference statuses)* | attempt | Contacted → Qualified/Not Qualified → Negotiation → Closed-Success/Lost | yes |

---

## 3. Feature: Lead Intake — Marketing (single + bulk import)

### Rules
1. Marketing can add leads **one at a time** or **bulk-import** (CSV/XLSX export from an ads platform or event registration).
2. Every imported lead must pass **mandatory-field validation** + the **global dedup check** (§5) before it gets a `LEAD-…` ID.
3. A lead imported under a campaign is **linked to that Campaign ID**, and its **Source is auto-derived** from the campaign type (M1-OA-3).
4. Marketing-sourced leads land as **`[Pool]`** with **no attempts yet**.
5. Bulk import is **row-level**: valid rows imported, invalid/duplicate rows **rejected per-row with a reason**; one bad row never blocks the rest.
6. After import, the system shows a summary count + downloadable rejection list.
7. Marketing Staff sees only leads from **campaigns they own**; the Marketing Lead sees all.
8. Once a lead has **any active Sales attempt**, Marketing can no longer edit it — Marketing keeps **read-only** visibility for attribution (M1-OA-5).

### Flow
1. Marketing Staff opens **Import Leads**, selects the **origin Campaign**, uploads the file (or fills the single-lead form).
2. System validates each row for mandatory fields → then runs dedup (§5).
3. **Valid + unique** rows → `LEAD-…` generated, status `[Pool]`, Campaign ID linked, Source auto-set, created timestamp recorded.
4. **Missing mandatory data** → row rejected: `[data tidak lengkap, baris tidak diimport]`.
5. **Duplicate of an active external lead** → row rejected: `[lead sudah ada & sedang diproses, tidak diimport]`; attribution attempt **logged but not counted** (M1-OA-6).
6. **Duplicate of a Rejected / Not Qualified lead** → re-entry **allowed**; existing record reopened to `[Pool]`.
7. Summary: `[X lead berhasil diimport, Y ditolak (duplikat/data tidak lengkap)]` + rejection list.

### Example
On **3 March 2026**, Marketing Staff **Lia** imports leads from TikTok ads campaign **`CMP-202603-0007`** ("Promo Skilskul Maret"). File = **50 rows**.

| Outcome | Count | Reason |
|---|---|---|
| Imported → `[Pool]` | 46 | Valid + unique |
| Rejected | 2 | Duplicate of active external leads |
| Rejected | 2 | Missing phone number |

Result: 46 `[Pool]` leads linked to `CMP-202603-0007`, Source = **Leads - Iklan**. *Lead-by-Dashboard* = **46**.

---

## 4. Feature: Lead Intake — Sales (single + batch registration)

### Rules
1. Behaves exactly as the reference **Lead Registration** — same mandatory fields, same dedup, `[Pending Validation] → [New Lead]`, **Prospect ID** on success, **exclusive single owner** (scouted leads are not contestable).
2. Written into **this central table**, sharing the dedup namespace with Marketing-sourced leads.
3. Source uses the reference list: **Scouting · Leads - Socmed · Leads - Iklan · Website · Referral (Affiliasi) · Broadcast · Event · Kulwa · Database · Others …**.
4. **Batch: up to 5 prospects per submission under one Source** (owner decision 2026-08-07 — full rules in **M0 §3.1**, `docs/DECISIONS.md`). It is the SAME door: each row runs the §5 dedup engine, mints its own `LEAD-`/`PRSP-`, and commits in its own transaction, so one duplicate rejects only its own row. Over five → `[maksimal 5 lead per pendaftaran!]`. This is **not** the Marketing bulk import of §3: batch rows are owned prospect attempts, imported rows land in `[Pool]` unowned.

### Flow
Identical to the reference. On dedup collision with another salesperson's active scouted lead: `[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]`.

### Example
On **10 March 2026**, **Budi** registers four scouted leads — **ABC Media**, **Alpha Digital**, **Sini Store**, **Lulu Lala** — all valid → **`[New Lead]`** with Prospect IDs in Budi's workspace, each exclusively his. His attempt to register **Unicorn Digital** is **blocked** (active scouted lead owned by Andi).

---

## 5. Feature: Deduplication Engine

### Rules
1. Dedup runs on **every** intake (Marketing import, Marketing single, Sales registration).
2. **Primary match key = normalized phone** (strip leading `0`/`+62`, spaces, dashes). Secondary: Lead Name + Email (M1-OA-4).
3. Dedup prevents duplicate **Lead records** (one phone = one record). It does **not** prevent multiple **attempts** on the same `[Pool]` lead — that is the intended competition (§6).
4. Decision table for a **new external intake**:

| Existing record state | New external intake action |
|---|---|
| Active **scouted** attempt (`New Lead`…`Negotiation`) | **Block** — `[lead sedang diproses oleh sales lain (nama)]` |
| `[Pool]` (already in DB) | **Block as duplicate record** — point to existing `LEAD-…`; do not create a second record |
| `[Rejected]` / `[Not Qualified]` (all attempts terminal) | **Allow** re-entry; reopen existing record to `[Pool]` |
| `[Closed - Success]` (already a client) | **Block** — `[lead sudah menjadi klien]` (M1-OA-4) |

5. A **second salesperson claiming an existing `[Pool]` lead** is **not** a dedup event — it is a competitive claim (§6), which spawns a new attempt against the same record.
6. Every dedup decision is written to the lead's audit log.

### Example
The 2 rejected duplicates in Lia's import matched the **normalized phones** of two active scouted leads (owned by Andi & Budi) → both rows blocked, both attempts logged on the existing records, neither counted toward CPL.

### Last-Touch Campaign tracking (supports Module 2's confirmed attribution model)
Every time an external intake is **blocked as a duplicate** of an existing `[Pool]` record (decision-table row 2 above) under a *different* Campaign than the one already on file, the system still writes that newer Campaign into a separate, non-destructive field: **Last-Touch Campaign**. This never overwrites **Origin Campaign** (which stays the immutable first-touch record, used for client lineage in Modules 3–4) — it exists purely so Module 2 can credit marketing spend to whichever campaign most recently touched the lead before it converted, without disturbing the permanent "where did this client originally come from" history.

---

## 6. Feature: Competitive Claim, Ownership & Win Resolution

### Rules
1. **Pool leads are claimable by self-service.** Any Sales Staff may claim a `[Pool]` lead from the Pool view.
2. **Multiple staff may claim the same pool lead simultaneously** (by design). Each claim creates a **distinct Prospect attempt** (`PRSP-…`) linked to the one Lead record, and the lead appears in that staff member's workspace with its own timestamp.
3. **Scouted / Sales-registered leads are exclusive** — exactly one attempt, owner = the finder; not contestable (reference rule preserved).
4. On claim, mandatory sales fields are completed if missing → attempt status `[New Lead]` → **Prospect ID generated** → attempt enters the claimant's workspace; the claim is logged on the Lead record.
5. **Win resolution.** The first attempt to reach **`Closed - Success`** wins the Lead record:
   - System sets the Lead record's **winning attempt + winning salesperson**.
   - All other **open** attempts on that record auto-transition to **`[Closed - Kalah Kompetisi]`** with a timestamp + note `[lead dimenangkan oleh sales lain (nama)]`.
   - The downstream Client (Client ID, etc.) is created **only** from the winning attempt (handoff to Admin & Finance).
6. **Closing-skill measurement.** All attempts are retained. The system computes, per salesperson: **contested-lead win rate** = wins on contested leads ÷ contested attempts; plus raw close rate, average deal cycle (from attempt timestamps). These feed Team Performance (Module 11).
7. **Re-claim** of a `[Rejected]`/`[Not Qualified]` lead follows reference rule 9.

### Flow (competitive claim → win)
1. Sales Staff opens **Pool**, selects a `[Pool]` lead, clicks **Claim**.
2. System creates a `PRSP-…` attempt for that staff (other staff may already have their own attempt on the same lead).
3. Each staff works their attempt independently through the reference lifecycle.
4. When one attempt hits `Closed - Success` → win resolution (Rule 5) fires.
5. Losing attempts close as `[Closed - Kalah Kompetisi]`; metrics update.

### Example
On **5 March 2026**, both **Budi** and **Rian (sales)** claim **"Sini Store"** (`LEAD-202603-0031`, from Lia's import) — allowed. Two attempts exist: `PRSP-202603-0112` (Budi) and `PRSP-202603-0113` (Rian). On **18 March**, Budi reaches `Closed - Success`. The system marks Budi the winner; Rian's attempt auto-closes as `[Closed - Kalah Kompetisi]`. Budi +1 contested win; Rian +1 contested loss.

| LEAD ID | Lead Name | Source | Origin Campaign | Attempt (PRSP) | Owner | Attempt status |
|---|---|---|---|---|---|---|
| LEAD-202603-0031 | Sini Store | Leads - Iklan | CMP-202603-0007 | PRSP-202603-0112 | Budi | Closed - Success ✅ |
| LEAD-202603-0031 | Sini Store | Leads - Iklan | CMP-202603-0007 | PRSP-202603-0113 | Rian | Closed - Kalah Kompetisi |
| LEAD-202603-0019 | (pool lead) | Leads - Iklan | CMP-202603-0007 | — | — | Pool |
| LEAD-202602-0007 | Unicorn Digital | Scouting | — | PRSP-202602-0044 | Andi | Negotiation (exclusive) |

---

## 7. Feature: Lead History & Audit Log

### Rules
1. Every Lead record keeps a **full, immutable history**: all attempts and their owners, every status change (per attempt), source/origin campaign, claim & win-resolution events, dedup decisions, and import events.
2. History **cannot be edited or deleted by anyone**, including Directors (house convention §2.3).
3. Each entry records **actor, action, before→after, timestamp**.
4. Prospecting/deal/onboarding cycle timestamps and contested win/loss outcomes are derived from this log.

### Example
`LEAD-202603-0031` (Sini Store) history shows: created via import (3 Mar, Pool, CMP-…0007) → claimed by Budi (5 Mar) → claimed by Rian (5 Mar) → Budi Closed-Success (18 Mar, winner) → Rian auto-closed Kalah Kompetisi (18 Mar).

---

## 8. Feature: Lead Quality — Real-by-Sales, Bad-Lead Evaluation, Dashboard counters

### Rules
1. All counters are **system-computed, read-only**, reading from this single table.
2. **Qualified** = Sales judges the lead a **genuine seller with potential** (the bar for the reference's `Qualified` transition). This is the meaningful quality gate.
3. **Lead-by-Dashboard** (per campaign) = count of `LEAD-…` records with **Origin Campaign = that campaign**, excluding blocked duplicates.
4. **Lead-Real-by-Sales** (per campaign) = count of those leads where **at least one attempt reached ≥ `Qualified`** (M1-OA-2). A lead with multiple competing attempts is counted **once**.
5. **Lead-Quality Rate** (per campaign/source) = Lead-Real-by-Sales ÷ Lead-by-Dashboard.
6. **Bad-lead evaluation.** A lead is treated as **junk** for source evaluation when **all** its attempts terminate `Not Qualified` (or it ages in `[Pool]` past a TTL without being claimed — M1-OA-7). On `Not Qualified`, Sales records a **Not-Qualified Reason** (multiple choice — M1-OA-8). The system aggregates **junk count + reason breakdown by source/campaign**, exposed to Marketing (Module 2) and OD.
7. These feed the Marketing module's **Cost per Lead**, **ROAS**, and **Lead-Quality** views (basis per global OA-8).

### Example
For `CMP-202603-0007`: Lead-by-Dashboard = **46**; **12** leads reached ≥ Qualified → Lead-Real-by-Sales = **12**; **Lead-Quality Rate = 26%**. Of the 34 non-qualified, **18** were marked `Not Qualified` with reason breakdown — `[Bukan seller]`: 11, `[Tidak ada respon]`: 5, `[Kontak salah]`: 2 — flagging that this campaign pulls many non-sellers, despite a healthy raw lead count.

---

## 9. System Requirements

### 9.1 Roles

| Role | Capabilities in Module 1 |
|---|---|
| **Marketing Staff** | Add/import leads under **own campaigns**; view those leads + read-only downstream status; view own-campaign Lead-by-Dashboard / Real-by-Sales / Quality Rate / junk breakdown. Cannot edit once a lead has an active Sales attempt. |
| **Marketing Lead/Head** | Dashboard over **all** marketing leads; source/campaign breakdown; Dashboard-vs-Real + Quality + junk comparison across campaigns. |
| **Sales Staff** | Register own scouted leads (exclusive); **self-claim pool leads** (contested allowed); sees **own attempts only**. |
| **Sales Lead/Head** | Dashboard over **all** sales attempts; monitor contested leads + win/loss; closing-skill leaderboard. |
| **Org Development (OD)** | **Read-only** across all leads, attempts, activity logs, junk breakdown; **manages OKR**. |
| **Director** | Full view; manage employees. |

One account per employee; OD/Director layered as an additional role (house convention §2.7).

### 9.2 Features
1. Lead Intake — Marketing (single + bulk import, row-level validation, rejection list).
2. Lead Intake — Sales (reference registration into the shared table).
3. Deduplication Engine (global, phone-keyed, record-level).
4. Competitive Claim, Ownership & Win Resolution (pool → attempts → winner; closing-skill metric).
5. History & Audit Log (immutable, per attempt).
6. Lead Quality — Real-by-Sales, Bad-Lead Evaluation, Dashboard counters (auto, read-only).

### 9.3 Field specs

**Lead record (`LEAD-…`)**

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Lead ID | system | auto | `LEAD-YYYYMM-NNNN`, after validation. |
| Lead Name | text only | **mandatory** | Dedup secondary key. |
| Phone Number | number only | **mandatory** | **Dedup primary key** (normalized). |
| Email | text only | optional | Dedup secondary key. |
| Source | multiple choice | **mandatory** | Reference list. Auto-set from campaign on import (M1-OA-3). |
| Origin Division | multiple choice | system | `{Marketing, Sales}`. |
| Origin Campaign | link | conditional | Campaign ID; mandatory when Source ∈ {Leads-Iklan, Broadcast, Event, Kulwa}. |
| Record Status | system | system | `[Pool]` / reopened / has-attempts / won. |
| Winning Attempt | link | system | Set at win resolution. |
| Last-Touch Campaign | link | system | Most recent Campaign to touch this Lead, if different from Origin Campaign (see §5). Drives Module 2's attribution; never overwrites Origin Campaign. |
| Created Timestamp | date | auto | Immutable. |

**Prospect attempt (`PRSP-…`)**

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Prospect ID | system | auto | Generated at `[New Lead]` (reference). |
| Parent Lead | link | system | The `LEAD-…` record. |
| Owner (Salesperson) | system | system | Set on claim/registration. |
| Attempt Status | system | system | Reference statuses + `[Closed - Kalah Kompetisi]`. |
| Not-Qualified Reason | multiple choice | conditional | Mandatory when status → `Not Qualified` (M1-OA-8). |
| Last Status Timestamp | date | auto | Per transition. |

### 9.4 Constraints & non-functional
- **Dedup** runs synchronously on single intake, per-row on bulk import; large files processed without blocking other rows.
- **Phone normalization** configurable (default: strip `+62`/leading `0`, spaces, dashes).
- **Win resolution** must be atomic: closing other attempts + setting the winner happen in one transaction to avoid two winners.
- **History/audit** is append-only; no destructive operations in any UI.
- Exposes **read APIs** to: Marketing dashboard, Sales dashboard, Campaign module. Writes nothing to Client Health (begins post-close).

---

## 10. Resolved Decisions (Module 1)

- **M1-OA-1 — RESOLVED.** Self-claim enabled; contested (multi-staff) claims allowed on pool leads only — scouted leads stay exclusive. ✅
- **M1-OA-2 — RESOLVED.** Real-by-Sales counted at **≥ Qualified**.
- **M1-OA-3 (Source auto-derivation) — ✅ Adopted as proposed.** On import under a campaign, Source auto-sets from campaign type; Origin Campaign mandatory for ad/broadcast/event/kulwa.
- **M1-OA-4 (Dedup key) — ✅ Confirmed phone-first matching**, with one addition: if the normalized phone matches an existing record but the **Lead Name differs substantially**, the system still treats it as the same Lead record (per Rule, §5) but raises a **manual-review flag** rather than merging silently — covers the edge case of a shared/office number genuinely belonging to a different business. Dedup checks against **all historical Lead records, no time window** — a lead from years ago re-entering is matched against its original record, not treated as new.
- **M1-OA-5 (Marketing edit lock) — ✅ Adopted as proposed.** Once a lead has an active Sales attempt, Marketing visibility becomes read-only.
- **M1-OA-6 (Duplicate-import attribution) — ✅ Adopted as proposed.** Duplicate rows are dropped (not merged); the attempt is logged on the existing record but never counted toward CPL.
- **M1-OA-7 (Pool TTL) — ✅ N = 24 hours.** An unclaimed `[Pool]` lead past 24 hours is flagged **"stale"** (visible to Sales so it's prioritized/deprioritized appropriately) but stays claimable in `[Pool]` — not removed or auto-recycled. This same aging signal feeds Marketing's junk/source evaluation (§8).
- **M1-OA-8 (Not-Qualified Reason list) — ✅ Confirmed.** Closed list as proposed — `[Bukan seller]`, `[Tidak ada budget]`, `[Kontak salah/tidak valid]`, `[Tidak ada respon]`, `[Sudah jadi klien]`, `[Spam/duplikat]` — **plus the existing `[Lainnya …]` free-text fallback** for anything not covered, confirmed as essential rather than optional.

### Additional clarification (beyond the original OA list)

- **Locked-field correction audit.** When Account Lead/OD corrects a locked field (per the broader system convention), the correction log for Module 1 must be **queryable by staff who made the correction**, not just by record — so a Lead/SPV can spot a pattern (e.g. "this salesperson's leads need correction far more often than average") rather than only seeing individual fixes in isolation.

> **Next module:** Module 2 — **Marketing**, building directly on this database.
