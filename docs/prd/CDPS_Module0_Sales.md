# CDPS — Module 0: Sales (Performance Management — Sales)

**Status:** ✅ **Final — all decisions confirmed (Nerissa, 9 Jul 2026). Ready for developer ticketing.**
**Source document:** `HRIS - Performance Management (Sales)` (the "reference standard" cited throughout Phase 0)
**Position in the journey:** the **entry point** of the entire CDPS. Sales registers/claims leads, qualifies them, negotiates, and closes. Closing generates **Client ID + Transaction ID + Service ID(s)** — the moment Module 4's Client Record is born and Module 5's Finance flow begins.
**Feeds:** Module 1 (Leads Database — central registry & attempts), Module 4 (Client Record), Module 5 (Admin & Finance).

---

## 0. Change log vs. the original document

Fixes **applied** in this merge (no decision needed):

1. **Status labels standardized** — the original used `Closed - Success`, `Closing - Rejected`, and `Closed - Lost` inconsistently. Canonical terminal states are now **`Closed-Success`** and **`Closed-Lost`** everywhere (matches Phase 0 §5).
2. **Qualified Lead Form extended** — added the 5 fields Module 4 §2 expects to be captured at the Qualified stage: **Nama (PIC klien), Platform List, GMV saat ini (3-month average), Target GMV, Marketing Budget** (§4.3, marked **NEW**). Without these, the Client Record is created incomplete at closing.
3. **Duplicated example removed** — the Closing example no longer repeats the Qualified-stage example text.
4. **Reconciliation with Module 1 made explicit** — the "one lead, one owner" rule applies to **Scouted/Sales-registered leads only**; Marketing **Pool** leads are claimable by multiple salespeople as separate Prospect attempts (`PRSP-…`) per Module 1 §6. Not a conflict — a scope split (§2).

Items **flagged, not decided** — see §9 Open Decisions: Sales-PIC mapping to Module 4 (OD-1), Master Service List ownership (OD-2), payment-reminder responsibility split (OD-3).

---

## 1. Background & Objective

Employee, performance, and operational data are spread across tools and spreadsheets. This module supports the end-to-end sales process — prospect handling to deal closure: registering leads, tracking qualification and negotiation, marking closing status, and handing off payment tracking. It is the front door through which every Client in CDPS is created.

---

## 2. Core concept: attempt lifecycle + relationship to Module 1

- The unit Sales works on is a **Prospect attempt** (`PRSP-YYYYMM-NNNN` — the original's "Prospect ID"). Every attempt is linked to exactly one central **Lead record** (`LEAD-…`, Module 1).
- **Scouted / Sales-registered leads:** exclusive — exactly one attempt, owner = the registering salesperson. Duplicates of an active scouted lead are blocked: `[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama sales)]`.
- **Pool leads (Marketing-imported, Module 1):** claimable by multiple salespeople simultaneously; each claim = its own `PRSP-…` attempt on the same Lead record. First attempt to reach `Closed-Success` wins; open competitors auto-close as `[Closed - Kalah Kompetisi]` (Module 1 §6).
- Re-registration of a lead whose prior status is `Rejected` / `Not Qualified` is allowed; the existing Lead record is reopened, never duplicated.
- Attempt lifecycle: `Pending Validation` → `New Lead` → `Contacted` → (`Qualified` | `Not Qualified`) → `Negotiation` (variants below) → **`Closed-Success`** | **`Closed-Lost`**. `Blocked` applies at intake (duplicate collision).
- All history (owners, transitions, negotiation versions, activity) is immutable and timestamped (house convention §2.3); timestamps drive prospecting duration, deal cycle, and onboarding cycle metrics.

---

## 3. Feature: Lead Registration (Sales door)

### Rules
1. Every lead must be registered before any follow-up activity; mandatory identity data required.
2. Incomplete mandatory data → submission blocked, no ID generated, lead invisible in workspace: `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.
3. Duplicate validation runs on Lead Name + Phone (normalized) + Email per Module 1's dedup decision table:
   - Active attempt exists (scouted, another salesperson) → blocked with `[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]`.
   - Existing record `[Pool]` → this is a **claim**, not a new record (Module 1 §6).
   - Existing record `Rejected` / `Not Qualified` → re-entry allowed, record reopened.
4. On successful submission: status `New Lead`, submitter = official owner, timestamp generated, attempt appears in the salesperson's workspace.

### Flow
1. Salesperson fills the registration form → 2. system dedup validation → 3. mandatory-field validation → 4. pass → `New Lead` + `PRSP-…` generated + timestamp; fail → blocked with the relevant `[...]` message.

### Example
10 Mar 2026 — Budi registers 4 leads successfully (ABC Media, Alpha Digital, Sinii Store, Lulu Lala → all `New Lead`). His 5th entry, Unicorn Digital, is blocked — active prospect owned by Andi. 28 Mar — Andi sets Unicorn Digital to `Rejected`. 29 Mar — Budi re-registers it successfully and becomes the new owner; full prior history retained.

### Registration form fields
| Field | Type | Mandatory | Scope |
|---|---|---|---|
| Source | multiple choice: Scouting / Leads-Socmed / Leads-Iklan / Website / Referral (Affiliasi) / Broadcast / Event / Kulwa / Database / Others | ✅ | **per submission** |
| Origin Campaign | picker (CMP-) or the explicit "di luar campaign" declaration; conditionally mandatory per M1 §9.3 | conditional | **per submission** |
| Lead Name | text only | ✅ | per prospect |
| Phone Number | number only | ✅ | per prospect |
| Email | text only | optional | per prospect |

### 3.1 Batch registration — up to 5 prospects per submission
*(Owner decision 2026-08-07 — QA revisi, `docs/DECISIONS.md`.)*

One submission carries **1..5 prospect rows** under a single Source and a single Origin Campaign decision: a salesperson who scouted five contacts in one sitting registers them with one click instead of retyping the Source five times. Exceeding five → `[maksimal 5 lead per pendaftaran!]`.

Rules:
1. Every row runs the FULL §3 rule set — dedup decision table, mandatory fields, its own `LEAD-`/`PRSP-` ids, its own audit trail. Batch adds no new registration semantics.
2. **Per-row verdicts, not all-or-nothing.** A row that collides rejects itself with its verbatim `[...]`; every other row stays registered. The response is a report (`registered` / `rejected` / summary line / per-row rows).
3. Two rows carrying the same phone: the first registers, the second meets the salesperson's own open attempt and is refused `[anda sudah memiliki prospek aktif untuk lead ini]`.
4. Submission-level refusals reject the WHOLE batch and register nothing: an empty or over-cap list, the M1 §9.3 conditional-mandatory campaign rule (the Source is shared, so the rule describes the submission), and a picked campaign that does not exist.

### Example — batch
7 Aug 2026 — Budi registers 3 scouted prospects in one submit (Source `Scouting`, outside any campaign). Rows 1 and 3 land as `New Lead`; row 2 duplicates a phone Budi already holds, so it comes back rejected while rows 1 and 3 stay registered. He fixes row 2's number in place and submits again.

---

## 4. Feature: Lead Status Update & Qualified stage

### Rules — status update
1. New attempts start at `New Lead`; only `New Lead` can move to `Contacted` (after a real action: call, chat, meeting, visit).
2. `Blocked` attempts cannot be updated or followed up.
3. From `Contacted`: choose `Qualified` or `Not Qualified`. Only `Qualified` proceeds to Negotiation → Closing.
4. Every transition is timestamped and immutable.

### Rules — Qualified Lead Form
1. Selecting `Qualified` opens the **Qualified Lead Form**; the status does **not** change until the form is successfully submitted (exit without submit → stays `Contacted`).
2. Max **10** services selectable; exceeding → `[maksimal pilih 10 jasa saja!]`, submission blocked. *(Raised from 5 by owner decision 2026-08-07 — QA revisi, see `docs/DECISIONS.md`.)*
3. **Estimasi Nilai Transaksi** and **Perhitungan Komisi** are auto-computed from the Master Service List and **read-only** (house convention §2.6).
3a. The same service may appear **at most once** in a selection; a duplicate is blocked with the default `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`. Quantity is the field for "two of this service" — a second row would duplicate the closing's Service rows and inflate the transaction total. *(Clarified 2026-08-07; applies to the negotiation and Edit Service sets too.)*
4. On successful submission the entered client data is **locked** (Sales can no longer edit — Module 4 inherits these fields locked).

### 4.3 Qualified Lead Form fields
| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Nama Toko | text only | ✅ | Locked after submit |
| **Nama (PIC klien)** | text only | ✅ | **NEW** — required by Module 4 §3 |
| Link Toko | link | ✅ | Locked after submit |
| Kategori Bisnis | multiple choice | ✅ | Locked after submit |
| Kota | text only | ✅ | Locked after submit |
| **Platform List** | multiple choice (checklist): Shopee / TikTok Shop / Tokopedia / Lazada / Others | ✅ | **NEW** — per-platform sub-data per Module 4 M4-OA-2 |
| **GMV saat ini** | number (IDR/month) | ✅ | **NEW** — average of the client's **last 3 months** (M4-OA-3); becomes the frozen Health-Report baseline at closing |
| **Target GMV** | number (IDR/month) | ✅ | **NEW** — revisable later by Account (M4-OA-6) |
| **Marketing Budget** | number (IDR) | optional | **NEW** — revisable later by Account (M4-OA-6) |
| Jasa Ditawarkan | multiple choice from Master Service List, max **10** | ✅ | See OD-2 (list ownership). Cap raised 5 → 10, owner decision 2026-08-07. Editable after the offer via the Edit Service door (§5.1) until closing |
| Estimasi Nilai Transaksi | number | auto read-only | Σ standard prices of selected services |
| Perhitungan Komisi | number/rule | auto read-only | From Master Service List commission rules |

### Example
20 Apr 2026 — Budi qualifies Alpha Digital, selecting Pendampingan Establish TikTok (Rp. 9.000.000,00), Jasa Buka Toko Online Basic (Rp. 6.000.000,00), Jasa Live Streaming Basic (Rp. 6.900.000,00). Estimasi Nilai Transaksi auto-fills **Rp. 21.900.000,00** (read-only); commission rule displays read-only; on submit the client data locks and the attempt moves to Negotiation eligibility.

---

## 5. Feature: Negotiation

### Rules
1. Only `Qualified` attempts (form submitted) may enter Negotiation. On entry, salesperson selects **Negotiation Required** or **No Negotiation Required**.
2. **No Negotiation** = client accepts standard pricing, standard commission, full payment. **Negotiation** = client wants changes to price, commission %, or payment terms (installments).

### Flow — Non-Negotiation
1. Select `No Negotiation Required` → Service Selection & Confirmation screen: (a) previously selected services (name, standard price, standard commission, checkbox — deselect allowed), (b) additional services from the **Master Service List** (standard terms only).
2. Validation: all selected services must use standard price/commission/full payment; any custom term → blocked, prompted to switch to the Negotiation flow.
3. Pass → negotiation record generated with standard terms, status **`Negotiation - Auto Approved`** (bypasses superior), **Proceed to Closing** enabled.

### Flow — Negotiation Required
1. Negotiation Form: previously selected services (price editable **only** here) + additional services from the Master Service List.
2. Per selected service: proposed price / commission / payment terms (as applicable) + optional notes. ≥1 service and all mandatory fields required; fail → blocked.
3. Pass → negotiation record versioned, status **`Negotiation - Pending Approval`**, routed to Superior.

### 5.1 Feature: Edit Service before closing
*(Owner decision 2026-08-07 — QA revisi, `docs/DECISIONS.md`.)*

After several rounds of negotiation the set of services the client actually buys is often **not** the set offered at the Qualified stage. Closing freezes that set into `Service` rows + the Transaction total, so the final set must be editable up to — and only up to — the moment of closing.

#### Rules
1. Available on an attempt in `Negotiation - Approved` or `Negotiation - Auto Approved` (the window between approval and closing). Any other status is refused: still-negotiating attempts have their own doors, and a `Closed-Success` deal is a Client Record, not a proposal.
2. A revision appends a **new proposal version**; no earlier version is ever mutated (house convention §2.3). Closing reads the **latest** version, so the revision is what is born as Services.
3. Routing reuses §5's own rule rather than inventing one:
   - **all lines at standard MSL terms** → status unchanged, still ready to close. Standard terms are exactly what the Non-Negotiation flow lets bypass the superior, so re-picking standard services cannot require an approval the original selection did not.
   - **any custom price / commission** → back to `Negotiation - Pending Approval`, superior notified. A salesperson must never be able to rewrite money the superior already approved.
4. A line submitted **without** a price is priced by the system from the MSL version effective now (calculator subtotal + that version's commission rule) — auto-calculated and read-only, per house convention §2.4. The client never sends rupiah for an added service.
5. The 1..10 service cap and "no duplicate service in one set" apply here as on the Qualified Form.
6. Services added here inherit their **Requires Strategy Plan** flag from the MSL version they were priced from, exactly as offered services inherit it from the version pinned at Qualified (M6 §2).

#### Related fix in the same round
§5's negotiation and non-negotiation flows both specify "additional services from the Master Service List" — add/remove was never implemented (only re-pricing was). Both flows now support it: the Non-Negotiation path is a Service Selection & Confirmation screen at standard terms, the Negotiation path allows add/remove alongside custom pricing.

### Flow — Superior approval
1. Superior is notified; the Negotiation Detail Page shows lead info, version number, proposed vs. standard values per service, and notes.
2. Actions:
   - **Approve** → `Negotiation - Approved`; terms locked; Proceed to Closing enabled.
   - **Revise / Counter Offer** → revised terms + mandatory notes → `Negotiation - Revision Required` → salesperson either **accepts** (system syncs values → `Negotiation - Approved`) or **resubmits** (new version → back to `Pending Approval`).
   - **Reject** → `Negotiation - Rejected` + mandatory notes; salesperson may submit a fresh proposal or set the attempt to **`Closed-Lost`**.

---

## 6. Feature: Closing

### Rules
1. Only `Negotiation - Approved` / `Negotiation - Auto Approved` attempts may close; anything else is blocked.
2. The attempt owner who navigated negotiation is the **Primary Salesperson** — mandatory, locked on the form.
3. Primary may add up to 4 more salespeople (**max 5 total**). Closing achievement is split by an **allocation %** that must total exactly 100% (else blocked).
4. If >1 salesperson, exactly **one Commission & Payment PIC** must be designated (then locked) — payment reminders and commission-collection tracking are directed exclusively to this PIC.
5. Mandatory before submission: Client Information (pre-filled from Qualified, locked), Service Details (final set), Sales Allocation, Contract Terms (start date, duration, commission config per service/transaction), Payment Scheme (`Bayar Penuh (Lunas)` / `Bayar Sebagian` / `Termin` / `Bayar di Belakang` — aligned with Module 4 §5 / Module 5).
6. The system uses the **final approved transaction value** (negotiated or auto-approved baseline) as the basis for all allocations.
7. On successful submission the system generates **Client ID** (`CLI-…`), **Transaction ID** (`TRX-…`), and **Service ID(s)** — Module 4's Client Record is born here, inheriting all locked Qualified data, Origin Campaign (from the won lead, Module 1/3), and the winning salesperson.
8. `Termin` scheme → the system generates a **Payment Schedule** (due date + amount + Sales PIC per installment) → materialized as `INST-…` children of the Transaction in Module 5.
9. **Achievement recognition:** *Closing achievement* is recorded at submission (feeds OKR/performance, no payout). *Commission achievement* is recognized **only after client payment is verified by Finance** (Module 5 Amount Verified), calculated on the actual paid amount.
10. Win resolution: if the lead was contested (Pool), this closing fires Module 1 §6 — competitor attempts auto-close `[Closed - Kalah Kompetisi]`.

### Flow
1. Salesperson sets status to Closing → validation of negotiation status → Closing Form.
2. System pre-loads & locks: final approved value, approved services, Primary Salesperson.
3. (Optional) add salespeople (≤5) → set allocation % (must equal 100%) → designate Commission & Payment PIC if >1.
4. Submit → Client ID / Transaction ID / Service IDs generated → client routes to **Payment Intent → Admin & Finance queue** (Module 4 §5, Module 5).
5. System starts reminder/tracking automation for the PIC; all events logged per transaction, client, and salesperson.

### Example
1 May 2026 — Budi closes Alpha Digital: 3 services, total closing value **Rp. 21.900.000,00**. Budi closes solo (Primary = PIC by default). System generates `CLI-202605-0021`, `TRX-202605-0021`, 3 Service IDs; Budi sets Payment Intent = `[Termin]`; the record enters Finance's verification queue (Module 5). Budi's closing achievement records immediately; his commission waits for verified payment.

---

## 7. System Requirements

### 7.1 Roles
| Role | Capabilities in Module 0 |
|---|---|
| **Salesperson (Staff)** | Register/claim leads; manage **own** attempts only; Qualified form; negotiation proposals; closing for own attempts. |
| **Head / Supervisor (Sales)** | All staff capabilities + negotiation approval (Approve / Counter / Reject) + sales analytics dashboard + monthly achievement vs OKR. |
| **Org Development (OD)** | Read-only across sales activity + activity logs; inputs/manages Sales OKR. |
| **Director** | Full view; manage employees. |

One account per employee (>100 employees, incl. HRD & Directors); OD/Director are layered additional roles — **sourced from the HRIS employee sync (nama + role) via the CDPS role-mapping table** (see Integration Contract).

### 7.2 Constraints & non-functional
- All validation server-side; blocked transitions change nothing and show the BI `[...]` message.
- Estimasi Nilai Transaksi, Perhitungan Komisi, allocation math: system-computed, read-only.
- History immutable, incl. negotiation versions (before→after per version).
- IDR format `Rp. X.XXX.XXX,00`; IDs `PREFIX-YYYYMM-NNNN`.
- Notifications (superior approval, PIC payment reminders) required — **channel spec pending the global Notification Spec** (flagged in the package-level review; applies to all modules).

---

## 8. Success Metrics
- **Activation:** % of leads worked that exist in the system before first follow-up (target: 100% — no off-system prospecting).
- **North-star:** closing rate + deal-cycle duration per salesperson (from immutable timestamps).
- **Leading indicators:** Qualified rate per source; negotiation approval turnaround; contested-lead win rate (Module 1 §6).

---

## 9. Resolved Decisions (confirmed by Nerissa, 9 Jul 2026)

| # | Question | Resolution |
|---|---|---|
| **OD-1** | Sales-PIC mapping to Module 4 | ✅ **As proposed.** Module 4 `Sales PIC` = **Primary Salesperson**; two fields added to the Client Record (Module 4 v2): `Commission & Payment PIC` (ref User; = Primary when closing solo) and `Sales Allocation` (system read-only table: salesperson + %, from the Closing Form). Module 4 lock rules unchanged. |
| **OD-2** | Master Service List ownership | ✅ **Owned by the Sales division.** Master entries (name, standard price, standard commission, active flag) are managed by **Sales Head/SPV**, versioned & logged; the closing salesperson selects from the list, and per-deal custom terms go through the Negotiation approval flow as already designed. Full spec: Phase 0 v2 §10. *(Guardrail: edit rights sit one level above the closer so commission math stays non-fudgeable — house convention §2.6.)* |
| **OD-3** | Payment-reminder split vs Module 5 | ✅ **As proposed.** One `INST-…` schedule, two audiences: **Sales PIC = collection** (chasing the client, commission follow-up); **Finance = verification & authoritative Payment Status** (`[Jatuh Tempo]`, routing gate). Both notified in-app per Phase 0 v2 §9. |

**Notification channel (global):** ✅ confirmed **in-app/workspace only** for v1 — see Phase 0 v2 §9.

---

**Ticketing note:** this module precedes Module 1 in build order. Epic sequence becomes: Phase 0 → **Module 0 (Sales)** → Modules 1–15.
