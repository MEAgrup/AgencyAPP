# HRIS — Module 5: Admin & Finance

> **Position in the journey:** the **verification gate** between Sales closing a deal and Account actually starting work. Sales sets a *Payment Intent* on the Client Record (Module 4 §5); this module makes it **real** — confirming money actually arrived, handling the four payment schemes (Lunas / Bayar Sebagian / Termin / Bayar di Belakang), chasing overdue installments, and only then releasing the client into the **Account & Service** queue (Module 6). Nothing reaches execution without passing through here.

## Contents
1. Background & Objective
2. Core concept: Transaction record + Payment Status lifecycle
3. Feature: Payment verification (receiving the Sales handoff)
4. Feature: Payment scheme handling (4 schemes) + installment schedule
5. Feature: Routing gate — when does the client release to Account
6. Feature: Payment reminder dashboard
7. Feature: Contract & proof-of-payment record
8. System Requirements (Roles + Features + field specs)
9. Open Assumptions (Module 5)

---

## 1. Background & Objective

Sales is incentivized to close — not to chase money. The reference module already shows Sales pushing for `Lunas` upfront, but real deals land in installments (`Termin`) or even post-paid (`Bayar di Belakang`). If verification stays informal (WhatsApp screenshots, verbal confirmation), two failure modes appear: **Account starts work on unpaid clients** (cash-flow risk), or **paid clients sit idle** because nobody told Account it's safe to start (delivery-speed risk, hurts Health Score from day one).

This module gives Admin & Finance a single queue, a single source of truth for **Payment Status** (separate from Sales' *Payment Intent*, which is a declaration, not a fact), and an explicit, auditable **routing gate**: a Client Record cannot reach Account until Finance verifies something landed.

Expected result: every Client Record has a trustworthy payment trail, overdue installments surface automatically instead of being discovered when a client complains, and Account never wastes cycles on unpaid work.

---

## 2. Core concept: Transaction record + Payment Status lifecycle

- A **Transaction record** (`TRX-…`) is created **at closing**, alongside Client ID and Service ID(s) (Module 4 §2) — one Transaction per closed deal, carrying the **agreed total value** and the **Payment Intent** Sales declared (scheme + amount + due dates if termin).
- **Payment Status** lives on the Transaction, set **only by Admin & Finance** — this is the authoritative fact, distinct from Sales' Payment Intent (a promise) and from Account's downstream work (which reads Payment Status, never Payment Intent).
- **Status state machine:**
  `[Menunggu Verifikasi]` → `[Terverifikasi - Sebagian]` ↔ (further installments) → `[Lunas]`
  with `[Jatuh Tempo]` as a parallel flag (not a replacement status) raised when a termin due date passes unverified.
  - `[Menunggu Verifikasi]`: Transaction created, no payment confirmed yet. **Blocks Account routing.**
  - `[Terverifikasi - Sebagian]`: at least one payment confirmed, total agreed value not yet fully received (covers both `Bayar Sebagian` and `Termin` mid-schedule). **Unblocks Account routing** (see §5).
  - `[Lunas]`: full agreed value verified received. Terminal state for the Transaction.
  - `[Jatuh Tempo]` (flag, not terminal): an installment's due date passed without verification — drives the reminder dashboard (§6). Clears automatically when that installment is verified.
- Every status change is **immutable history**: actor, before→after, amount verified, timestamp, optional proof-of-payment attachment (house convention, Phase 0 §2).

---

## 3. Feature: Payment verification (receiving the Sales handoff)

### Rules
1. A Transaction enters Finance's queue the moment Sales sets Payment Intent on the Client Record (Module 4 §5) — status auto-initializes to `[Menunggu Verifikasi]`.
2. Finance verifies **actual receipt** (bank transfer confirmation, payment gateway record) — never takes Sales' or the client's word for it. Verification requires: amount received, date received, optional proof attachment.
3. Finance can verify a **partial amount** against the agreed total — system computes Amount Outstanding (read-only) automatically.
4. A verification cannot exceed the agreed total (system blocks over-verification with `[jumlah melebihi total transaksi, periksa kembali]`).
5. Only **Admin & Finance role** can write Payment Status; Sales and Account can read it.

### Flow
1. Transaction appears in Finance's queue with Payment Intent details (scheme, declared amount/schedule) inherited from Module 4.
2. Finance PIC opens the Transaction, confirms receipt against bank/gateway records, enters Amount Verified + date + proof.
3. System recalculates Amount Outstanding and updates Payment Status per the state machine (§2).
4. If scheme = `Termin`, system also marks which **Installment** (§4) this verification satisfies.

### Example
Budi (Sales) set Alpha Digital's Payment Intent to `[Termin]` (Module 4 §5 example). Transaction `TRX-202606-0014` enters Finance's queue at `[Menunggu Verifikasi]`, total agreed Rp 45.000.000 across 3 installments. Finance verifies receipt of Installment 1 (Rp 15.000.000) on 3 June → status becomes `[Terverifikasi - Sebagian]`, Amount Outstanding auto-shows Rp 30.000.000.

---

## 4. Feature: Payment scheme handling (4 schemes) + installment schedule

### Rules
1. **Lunas** — single verification, full amount. Status jumps straight to `[Lunas]`.
2. **Bayar Sebagian** — one partial verification expected upfront, remainder has **no fixed schedule** (client pays "whenever," tracked as Amount Outstanding with no due date / no `[Jatuh Tempo]` flag — there's nothing to be overdue against).
3. **Termin** — requires an **Installment schedule** (`INST-…`, child of the Transaction): N installments, each with amount + due date, set by Sales/Finance at intent time. Each installment is verified independently; `[Jatuh Tempo]` triggers per-installment if its due date passes unverified.
4. **Bayar di Belakang** (post-paid) — client receives service first, payment expected after an agreed point (e.g. after first month's results). System still creates a single Installment with a due date = the agreed post-paid date, so it surfaces on the reminder dashboard like Termin once that date approaches.
5. Switching schemes after intent (e.g. client renegotiates Lunas → Termin) requires Finance to log the change with reason (immutable history) — does not delete the original Transaction.

### Flow
1. At Payment Intent (Module 4 §5), Sales/Finance selects scheme. If `Termin` or `Bayar di Belakang`, schedule is entered (N installments × amount × due date, must sum to agreed total — system validates with `[total termin tidak sama dengan nilai transaksi]`).
2. Each Installment lives as its own row, status `[Belum Jatuh Tempo]` → `[Jatuh Tempo]` (if unpaid past due date) → `[Terverifikasi]`.
3. Transaction-level Payment Status (§2) is a roll-up: `[Lunas]` only when **every** Installment is `[Terverifikasi]`.

### Example
Unicorn Digital (Andi) — `Bayar Sebagian`: client pays Rp 10.000.000 upfront against a Rp 30.000.000 deal, remainder open-ended. Status: `[Terverifikasi - Sebagian]`, Amount Outstanding Rp 20.000.000, no reminder triggered (no due date exists for the remainder under this scheme).
Sini Store — `Lunas`: full Rp 20.000.000 verified same day as intent → `[Lunas]` immediately, no installment schedule needed.

---

## 5. Feature: Routing gate — when does the client release to Account

### Rules
1. **Default gate (✅ confirmed, M5-OA-1):** the Client Record releases to Account & Service (Module 6) the moment Payment Status first reaches `[Terverifikasi - Sebagian]` or `[Lunas]` — i.e. **first confirmed money in**, not full settlement, and not contingent on any percentage threshold. This matches agency practice (work starts once a deposit lands) and avoids stalling delivery while a Termin schedule is still running.
2. While status is `[Menunggu Verifikasi]`, the Client Record is **visible to Finance only** — Account cannot see it yet, preventing premature work starts.
3. Release is logged as an event on the Client Record (immutable), timestamped, referencing which verification triggered it.
4. **Contract-signing runs in parallel, never as a precondition (✅ resolved, M5-OA-3):** this routing gate depends only on payment verification. The separate 7-day contract-signing expectation (§7) is a compliance follow-up that surfaces as a visibility flag if missed — it never delays or blocks the Account routing above, even if the contract is still outstanding when payment verifies.
5. If a client's only verified payment is later disputed/reversed, Finance flags the Transaction `[Bermasalah]` — this does **not** auto-pull work back from Account. **Resolution authority (✅ resolved, M5-OA-5):** both SPV Finance and SPV Account must jointly approve next steps, logged; escalates to Director only if the two disagree or severity warrants it.

### Flow
1. Finance verifies the first payment (any scheme) → system checks: is this the first verification on this Transaction?
2. If yes → Client Record status flips from "awaiting finance" to **released** → appears in Account's intake queue (Module 6 §1).
3. Account is notified; Finance continues tracking remaining installments independently (§4) — Account's view never blocks on Finance's remaining schedule.

### Example
Alpha Digital's Installment 1 verification (§3 example) is the **first** verification on `TRX-202606-0014` → Client Record releases to Account the same day, even though 2 installments remain outstanding. Account begins onboarding (Module 6) while Finance keeps chasing Installments 2–3 independently.

---

## 6. Feature: Payment reminder dashboard

### Rules
1. Dashboard lists every Installment (Termin or Bayar di Belakang) whose due date is **within N days** (upcoming) or **already passed unverified** (`[Jatuh Tempo]`) — sorted overdue-first.
2. Each row shows: Client, Installment #, Amount, Due Date, Days Overdue (auto-calculated), assigned PIC (Sales who owns the relationship, since Finance verifies but Sales usually chases the client).
3. `[Jatuh Tempo]` installments trigger a flag visible to **both** Finance and the owning Sales PIC — Sales is expected to chase the client (relationship), Finance records the result.
4. Bayar Sebagian's open-ended remainder does **not** appear on this dashboard (no due date — see §4 Rule 2); it instead appears on a separate "Outstanding, No Due Date" list for awareness only, no overdue logic.

### Flow
1. System scans all Installments nightly (or on dashboard load) for due-date proximity/lapses.
2. Overdue ones surface at the top with a Bahasa Indonesia status label: `[jatuh tempo X hari, segera tindak lanjuti]`.
3. Sales/Finance follow up; once verified, the row disappears from the reminder list and the Installment moves to `[Terverifikasi]`.

### Example
Alpha Digital's Installment 2 (due 17 June, Rp 15.000.000) is unverified by 20 June → appears on the dashboard as `[jatuh tempo 3 hari, segera tindak lanjuti]`, visible to Budi (Sales PIC) and Finance simultaneously.

---

## 7. Feature: Contract & proof-of-payment record

### Rules
1. Each Transaction can attach a **Contract** (file/link) and one **proof-of-payment attachment per verification event** (so a 3-installment Termin deal has 3 separate proofs, each tied to its specific verification — not one bundled file).
2. Contract upload is optional at intent time but **mandatory before the Transaction can reach `[Lunas]`** (system blocks final verification with `[kontrak belum diupload, lengkapi sebelum verifikasi penuh]` if missing) — protects MEA legally before declaring a deal fully closed.
3. **Soft 7-day expectation (✅ new, resolves M5-OA-3):** from the moment a Client Record routes to Account (§5), if the signed contract hasn't been uploaded within 7 days, the Transaction surfaces on a Finance/SPV visibility flag — not a hard block on Account's ongoing work, just a compliance nudge so contracts don't quietly lag indefinitely behind delivery.
4. All attachments are permanent (no deletion, only superseding versions if a contract is amended — logged).

### Flow
1. Finance or Sales uploads the contract link/file to the Transaction at any point ≤ full settlement.
2. Each verification step (§3) optionally/recommendedly attaches its own proof.
3. At the verification that would bring status to `[Lunas]`, system checks contract presence before allowing the transition.

---

## 8. System Requirements

### 8.1 Roles

| Role | Capabilities in Module 5 |
|---|---|
| **Admin & Finance (Staff)** | Verify payments (amount, date, proof); set/update Payment Status; manage Installment schedule edits (logged); flag `[Bermasalah]`; own the reminder dashboard. |
| **Admin & Finance (Lead/Head)** | All Staff capabilities across all Transactions; jointly resolves `[Bermasalah]` flags with Account's SPV (M5-OA-5). |
| **Sales (PIC)** | Read own clients' Payment Status/Installments; chase overdue installments (relationship); cannot edit verification. |
| **Sales Lead/Head** | Read all sales' Transactions. |
| **Account** | Read Payment Status only (gate check) — no edit access; sees the client once released (§5). |
| **Org Development (OD)** | Read-only all Transactions + audit logs. |
| **Director** | Full view; resolves disputed/`[Bermasalah]` cases at final authority. |

### 8.2 Features
1. Transaction record + Payment Status lifecycle (state machine).
2. Payment verification (receipt confirmation against agreed total).
3. 4-scheme handling: Lunas, Bayar Sebagian, Termin, Bayar di Belakang (with Installment sub-entity).
4. Routing gate (first-payment release to Account).
5. Payment reminder dashboard (overdue + upcoming installments).
6. Contract & proof-of-payment attachment, gated before `[Lunas]`.

### 8.3 Field specs — Transaction (`TRX-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Transaction ID | system | auto | `TRX-YYYYMM-NNNN`, generated at closing (Module 4 §2); immutable. |
| Client ID | reference | auto | Links to `CLI-…`. |
| Payment Intent (scheme) | single choice | **mandatory** | `Lunas` / `Bayar Sebagian` / `Termin` / `Bayar di Belakang`. Set by Sales (Module 4 §5); changeable by Finance with logged reason. |
| Total Agreed Value | number (Rp) | **mandatory** | From closing. |
| Amount Verified (total) | system | auto | Sum of verified installments/partials. Read-only. |
| Amount Outstanding | system | auto | Total Agreed Value − Amount Verified. Read-only. |
| Payment Status | system (state machine) | auto | `[Menunggu Verifikasi]` / `[Terverifikasi - Sebagian]` / `[Lunas]`; `[Bermasalah]` as an override flag. |
| Contract Attachment | file/link | mandatory before `[Lunas]` | See §7. |
| Released to Account (timestamp) | system | auto | Set on first verification (§5). |

### 8.4 Field specs — Installment (`INST-…`, child of Transaction)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Installment ID | system | auto | `INST-YYYYMM-NNNN`. |
| Transaction ID | reference | auto | Parent. |
| Installment # | number | **mandatory** | Sequence within the schedule. |
| Amount | number (Rp) | **mandatory** | Must sum to Total Agreed Value across all installments. |
| Due Date | date | **mandatory** (Termin/Bayar di Belakang only) | Drives reminder dashboard. |
| Status | single choice (state machine) | auto | `[Belum Jatuh Tempo]` / `[Jatuh Tempo]` / `[Terverifikasi]`. |
| Verified Date | date | conditional | Set on verification. |
| Proof of Payment | file/link | recommended | One per installment. |
| Verified By | reference (user) | auto | Finance PIC who verified. |

---

## 9. Resolved Decisions (Module 5)

- **M5-OA-1 (Routing threshold) — ✅ Confirmed.** Client releases to Account on **first confirmed payment**, regardless of scheme — no higher percentage threshold required.
- **M5-OA-2 (Bayar Sebagian remainder) — ✅ Confirmed as proposed.** Genuinely open-ended — no automatic reminder, no due date; manual AM follow-up only. Stays on the separate "Outstanding, No Due Date" awareness list.
- **M5-OA-3 (Contract gate) — ✅ Resolved.** Contract is **not** required before work starts — the Transaction (and Account routing) can proceed on payment verification alone, as already designed. **New addition:** a soft **7-day expectation** is added from the moment a client routes to Account — if the signed contract hasn't arrived by then, it surfaces as a visibility flag to Finance/SPV (not a hard block on Account's work, and still independent of the existing hard gate at `[Lunas]`, §7 Rule 2).
  - **Precedence clarified (closes a cross-module gap):** the payment-verification gate (M5-OA-1) and the 7-day contract expectation are **parallel, not sequential** — if payment verifies before the contract is signed, Account still starts on schedule; the contract deadline is a compliance follow-up, never a blocker to starting delivery.
- **M5-OA-4 (Who chases overdue installments) — ✅ Confirmed as proposed.** Sales chases (relationship owner); Finance records the result.
- **M5-OA-5 (`[Bermasalah]` resolution authority) — ✅ Resolved, stricter than originally proposed.** Both **SPV Finance and SPV Account** must jointly approve next steps on a `[Bermasalah]` flag (not Finance Lead alone) — escalates to Director only if the two SPVs disagree or the case is severe enough to warrant it.
- **M5-OA-6 (Scheme change mid-flight) — ✅ Confirmed, authority made explicit.** Allowed with a logged reason (doesn't delete the original Transaction), and requires minimum **SPV/Head Finance** approval to action.

---

**Next:** Module 6 — Account & Service (client onboarding once released here, service-list breakdown into briefs for Creative/Ads/KOL/Live Stream, revision routing, and the second complaint door).
