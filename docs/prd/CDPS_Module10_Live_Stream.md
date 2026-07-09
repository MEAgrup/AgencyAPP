# CDPS — Module 10: Live Stream

> **Position in the journey:** the **confirmed exception** to every execution-division pattern used in Modules 7–9. MEA does **not** run live streaming itself — it's outsourced to a **sister-company vendor**. This module is a **tracker, not an execution system**: there's no internal Kanban, no PIC doing the work inside CDPS, no Asset/Campaign/Booking fan-out tied to internal staff. What this module records is simpler and narrower — **what MEA (via the AM) requested from the vendor, and what the vendor actually delivered** — so live-stream results still feed Client Health and reporting like every other division's work, without pretending MEA controls a process it doesn't.

## Contents
1. Background & Objective
2. Core concept: Live Stream Session (request + result, one entity)
3. Feature: Session request
4. Feature: Result capture & reconciliation
5. Feature: GMV feed into Client Health
6. System Requirements (Roles + Features + field specs)
7. Open Assumptions (Module 10)

---

## 1. Background & Objective

Every other execution module (Creative, Ads, KOL) assumes MEA has a PIC who can be assigned, reviewed, and held to a revision loop. Live streaming breaks that assumption entirely: the actual broadcast is run by a **sister-company vendor**, not MEA staff. Building an internal Kanban for work MEA doesn't perform would be fiction — worse, it would imply a level of control (reassigning PICs, enforcing revision SLAs) that doesn't exist in this relationship.

So this module does the honest, narrower thing: track the **request** sent to the vendor and the **result** the vendor reports back, side by side, so any gap between the two is visible — and so the client still gets credit (in GMV/Health terms) for live-stream performance even though MEA didn't produce the stream itself.

Expected result: AM has a clean record of what was asked of the vendor, what came back, and whether they matched — without forcing a vendor relationship into a staff-management data model that doesn't fit it.

---

## 2. Core concept: Live Stream Session (request + result, one entity)

- A **Live Stream Session** (`LSS-…`) is a child of a Live Stream Brief (Module 6 §6 Rule 2) — one row per scheduled/held session. A single Brief can generate **multiple Sessions** over time if the service is recurring (e.g. a weekly live-stream package), same fan-out logic as Asset/Ad Campaign/Booking in the other execution modules.
- Unlike those modules, a Session has **no internal status machine for "work being done"** — there's no `[In Progress]` because MEA isn't the one streaming. Its lifecycle is just: `[Requested]` → `[Confirmed by Vendor]` → `[Completed]` → `[Reconciled]` / `[Discrepancy Flagged]`.
- The Brief itself (Module 6's universal Kanban) closes to `[Approved]` once its Session(s) reach `[Reconciled]` — there is no AM "review of work product" step here; reconciliation against the vendor's own reported numbers **is** the review.

---

## 3. Feature: Session request

### Rules
1. AM creates a Session once the Live Stream Brief is dispatched — fields: requested date/time, platform (TikTok Shop Live / Shopee Live), target duration, products/talent to feature, special instructions.
2. The request is sent to the vendor **outside the system** (the vendor has no CDPS access) — this record exists so MEA has its own copy of what was asked, independent of whatever the vendor's side shows.
3. Vendor confirmation (accepting the schedule) is logged manually by AM once received — `[Confirmed by Vendor]`.

### Flow
1. AM fills in the request fields, sends it to the vendor via whatever channel they normally use (WhatsApp/email — outside CDPS scope).
2. Vendor confirms → AM marks `[Confirmed by Vendor]`.
3. Session sits at this status until the scheduled date passes and results come in (§4).

### Example
Alpha Digital later **adds a Live Stream package as an upsell** (a new Service on the immutable Service List, per Module 4 §5 Rule "any add/upsell = new Service"). Sinta creates a Live Stream Brief, then a Session `LSS-202607-0002`: requested for 5 July, TikTok Shop Live, target duration 2 hours, featuring the 3 newest SKUs. Vendor confirms the slot the same day.

---

## 4. Feature: Result capture & reconciliation

### Rules
1. After the session airs, the vendor reports results (via their own channel — report file, WhatsApp summary, dashboard screenshot). AM enters these into the Session: actual date/time held, actual duration, viewers (peak/average if available), orders generated, GMV from the session, and a **Vendor Report Link** (attachment — the vendor's own proof/report, kept for audit).
2. Session moves to `[Completed]` once result fields are filled.
3. AM **reconciles**: compares requested vs. actual (duration, products featured, schedule adherence). Matches → `[Reconciled]` (Brief closes). Meaningful gaps (e.g. session ran 45 minutes instead of the requested 2 hours, or featured the wrong SKUs) → `[Discrepancy Flagged]`, with notes — routed to SPV/Account for follow-up with the vendor relationship (a business-partner conversation, not an internal performance review — see M10-OA-3).
4. A `[Discrepancy Flagged]` Session does **not** block the Brief from later closing once the discrepancy is addressed/accepted — it's a visibility flag, not a hard gate.

### Flow
1. Session airs (outside CDPS).
2. AM logs results + vendor report link → `[Completed]`.
3. AM reconciles against the original request → `[Reconciled]` or `[Discrepancy Flagged]`.
4. If flagged, SPV/Account follows up with the vendor; once resolved (or accepted as-is), AM updates to `[Reconciled]`.

### Example
`LSS-202607-0002` airs for only 1 hour 20 minutes instead of the requested 2 hours. Sinta logs the actual numbers (Viewers: 1,200 peak; Orders: 18; GMV: Rp 6.400.000) with the vendor's report link attached, flags `[Discrepancy Flagged]` — "durasi di bawah target, perlu dikonfirmasi ke vendor." After a conversation with the vendor (outside system) clarifying a technical issue that day, Sinta updates to `[Reconciled]` — the Brief closes.

---

## 5. Feature: GMV feed into Client Health

### Rules
1. **GMV from Live** (per Session, summed at the Service/Client level) feeds the client's overall GMV signal **the same way** Ads' GMV from Ads does (Module 8 §5 Rule 4) — Health Score doesn't care which division produced the GMV, only that it's real and verified.
2. Because the underlying numbers are **vendor-self-reported**, not platform-verified the way Module 8's metrics can be cross-checked against ad-platform exports, this GMV is flagged at a lower confidence tier by default (visible as a data-source tag, not a hidden caveat) — see M10-OA-5.

### Flow
Reconciled Sessions' GMV rolls up automatically into the Client's GMV signal used by Health Score (Module 4/Phase 0 OA-3), tagged with its vendor-reported source.

---

## 6. System Requirements

### 6.1 Roles

| Role | Capabilities in Module 10 |
|---|---|
| **Account Manager (AM)** | Creates Session requests; logs vendor-reported results; reconciles; flags discrepancies. |
| **SPV / Head Account** | Visibility on all Sessions, especially `[Discrepancy Flagged]`; owns the vendor-relationship follow-up. |
| **Vendor (sister company)** | No system access — represented entirely through AM-entered request/result data. |
| **Org Development (OD)** | Read-only on all Sessions + audit logs. |
| **Director** | Full view; final say on persistent vendor-performance issues. |

### 6.2 Features
1. Live Stream Session entity — request fields + result fields on one record, no internal execution Kanban.
2. Manual vendor-confirmation logging (no vendor system access).
3. Result capture with attached vendor report (audit trail).
4. Reconciliation (requested vs. actual) with a non-blocking discrepancy flag.
5. GMV feed into Client Health, tagged at a distinct confidence tier from platform-verified Ads data.

### 6.3 Field specs — Live Stream Session (`LSS-…`)

| Field | Type | Mandatory | Notes |
|---|---|---|---|
| Session ID | system | auto | `LSS-YYYYMM-NNNN`. |
| Brief ID | reference | auto | Parent Brief. |
| Platform | single choice | **mandatory** | TikTok Shop Live / Shopee Live. |
| Requested Date/Time | datetime | **mandatory** | |
| Target Duration | number (hours) | **mandatory** | |
| Products/Talent to Feature | text | optional | |
| Special Instructions | text | optional | |
| Status | system (state machine) | auto | `[Requested]` → `[Confirmed by Vendor]` → `[Completed]` → `[Reconciled]`/`[Discrepancy Flagged]`. |
| Actual Date/Time Held | datetime | conditional | Filled after airing. |
| Actual Duration | number (hours) | conditional | |
| Viewers (Peak/Avg) | number | optional | Depends on vendor's reporting detail. |
| Orders Generated | number | conditional | |
| GMV from Live | number (Rp) | conditional | Feeds Client GMV signal (§5). |
| Vendor Report Link | link | **mandatory** before `[Completed]` | Audit trail. |
| Reconciliation Notes | text | conditional | Required on `[Discrepancy Flagged]`. |
| Data Confidence Tier | system | auto | `Vendor-Reported` (default here) vs. `Platform-Verified` (used elsewhere, e.g. Module 8). |

---

## 7. Resolved Decisions (Module 10)

- **M10-OA-1 (Vendor liaison) — ✅ Confirmed as proposed.** AM handles the vendor relationship directly (request + reconciliation) — no dedicated Live Stream Coordinator role.
- **M10-OA-2 (Vendor settlement) — ✅ Resolved.** Settlement/cost tracking with the sister-company vendor stays **entirely outside CDPS** — this module tracks performance results only (requested vs. actual, GMV). The intercompany billing arrangement is handled separately, outside this system's scope.
- **M10-OA-3 (Discrepancy escalation) — ✅ Resolved.** SPV is notified **in real-time**, the moment a discrepancy is flagged (not batched into a periodic report) — logged for Director visibility. Stays a business-relationship conversation with the vendor, not an internal performance-management flow.
- **M10-OA-4 (Recurring sessions vs. fresh Briefs) — ✅ Confirmed as proposed.** One Live Stream Brief holds multiple Sessions across a recurring package's life (e.g. one Brief per month/period covering several weekly sessions) — Sessions don't each spawn a brand-new Brief.
- **M10-OA-5 (GMV confidence tier) — ✅ Confirmed as proposed.** Vendor-reported GMV counts at **full value** toward the Client's GMV signal — tagged with a visible "Vendor-Reported" badge for transparency, but **never numerically discounted** against platform-verified sources.

---

**Next:** Module 11 — Project Management / Kanban (the cross-division task spine tying Service → Brief breakdown into a unified board view, dependency management across Creative/Ads/KOL/Live Stream, now that all four execution divisions are defined).
