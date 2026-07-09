# CDPS — Module 15: Client Portal + Team Portal

**Status:** Draft awaiting Yohan's confirmation before developer ticketing
**Worked examples:** Alpha Digital (Client Portal), Editor Rian (Team Portal)
**Depends on:** Module 6 (Complaints), Module 11 (Universal Board / My Tasks), Module 13 (Health Score — resolves the deferred client-facing decision), Module 14 (Performance Score)

**Note on numbering:** Module 6's original write-up referenced "Client Portal (Module 14)" as the secondary complaint channel — that was written before this module's final slot was confirmed. Read all such references as **Module 15**.

---

## 1. Background

Internally, AM/SPV/Director now have rich tooling across Modules 6–14. Two audiences still have nothing: **Clients** have zero self-serve visibility into their own progress (today they rely entirely on ad-hoc WhatsApp updates and the separately-built HTML report system), and **staff** still juggle four separate division screens with no single daily home base. Module 15 is the last module of this PRD and closes both gaps — a **Client Portal** (external, read-mostly, scoped to one Client) and a **Team Portal** (internal, a unified landing page over data that already exists in Modules 6–14, no new core data model).

This module also resolves Module 13's deferred client-facing question: **how much of the Health Score should a Client actually see.**

---

## 2. Rules — Client Portal

1. Client Portal is scoped to **one Client at a time**, but supports **multiple named contacts** under that same Client (confirmed multi-contact access) — not a single shared login. All contacts under a Client see the same scoped view by default (no internal role tiering for v1); each contact's own actions (e.g. who submitted a complaint) are still individually logged for audit.
2. **Service Progress** is shown per active Service, using a **client-friendly relabeling** of Module 11's Universal Column — never the internal status names or Brief/Task IDs:

   | Universal Column (internal) | Client-facing label |
   |---|---|
   | To Do | Queued |
   | In Progress | In Production |
   | Awaiting Review | Finalizing |
   | Blocked/Revision | In Review *(deliberately softened — "Blocked" sounds alarming to a client even when it's routine)* |
   | Done | Completed |

3. **Reports are natively embedded** in the Portal (confirmed — not a link-out to the existing HTML report system). The underlying report data/template still comes from `mea-client-reporting`; Module 15 renders it inside the Portal's own frame rather than sending the Client to a separate URL.
4. **Health Summary is band-only, never the raw 0–100 score or its formula** (resolves Module 13 Rule 11): Healthy → "On Track", Watch → "Needs Attention", At Risk → "Action Needed". No component breakdown, no number, ever — the internal weighting (Revision Burden, Complaints penalty, etc.) is operational detail, not something to hand a Client.
5. **Complaint submission** is a secondary channel (Module 6 confirmed AM-via-WhatsApp as primary). A Portal-submitted complaint creates a standard Complaint record tagged `source = Client Portal`, routed to the AM exactly like a WhatsApp-sourced one — no separate workflow. **An immediate auto-acknowledgment is sent on submission** (confirmed) — draft default copy: *"Komplain kamu sudah kami terima, tim akan merespon dalam 1 hari kerja."* Exact response-time promise (1 business day, drafted) can be adjusted later without changing the mechanism.
6. **Complaint history is submit-only** (confirmed) — Clients do not see a personal log of past complaints inside the Portal; all follow-up still happens via AM WhatsApp, consistent with Module 6's "WhatsApp is primary" spirit.
7. **Explicit exclusion list** (privacy boundary) — Client Portal must never show: internal Transaction/payment admin detail beyond the Client's own invoice/payment status, staff names or workload, Team Performance data, or internal Brief/Task IDs.

---

## 3. Rules — Team Portal

8. Team Portal introduces **no new entities** — it is a unified landing page aggregating what Module 11 ("My Tasks"), Module 14 (Performance Score), and the native division tools (Modules 7–10) already produce.
9. **Default staff landing page:** open Tasks (My Tasks, sorted by SLA-risk first), current month's running Performance Score with a breakdown and trend vs. prior months, and quick actions (status transitions, Hours Logged) without leaving the Portal.
10. **Team Leader/SPV variant** additionally shows: team-level Performance rollup (Module 14), Client Board shortcut (Module 11) for their team's Clients, and a **Block-request approval queue** — since only SPV/Lead can set `[Blocked]` (Module 12, confirmed), pending requests from staff/AM surface here as an actionable inbox item, not just passive viewing. **Rejecting a block request needs no reason/comment** (confirmed) — a plain approve/reject is enough.
11. **Management Dashboard** (confirmed, new — for Director/OD/management-level roles): a dedicated portfolio-wide view showing **every Client's Health Score band (Module 13) at a glance** — not scoped to one AM's portfolio like the AM's own Module 14 view, but the full client base. This is explicitly a Client-health-monitoring view, distinct from (though linkable to) the Team Performance rollup — management's primary question is "which Clients across the whole agency need attention," not "which staff member's score moved."

---

## 4. Flow

**Client Portal:**
1. Client (any of their named contacts) logs in → lands on Service Progress (relabeled Universal Column, Rule 2) →
2. Client views embedded reports natively inside the Portal (Rule 3) →
3. Client sees Health Summary band only (Rule 4) →
4. Client submits a complaint via form → Complaint record created, `source = Client Portal`, contact logged → auto-acknowledgment shown/sent immediately (Rule 5) → routed to AM exactly as Module 6 already defines →
5. AM handles it through the existing Module 6 Complaint flow; no separate Portal-side resolution workflow, no client-visible status history (Rule 6).

**Team Portal:**
1. Staff logs in → lands on My Tasks, sorted by nearest SLA-risk first →
2. Staff transitions Task status / logs hours directly from this view (delegates to the native Module 7/8/9/10 mechanics underneath) →
3. Staff checks their Performance tab → sees the current month's running score, full breakdown, and trend →
4. If SPV/Lead: sees Team rollup, Client Board shortcut, and actions the Block-approval queue (plain approve/reject, no reason required) →
5. If Director/OD/management: opens the Management Dashboard instead — a portfolio-wide scan of every Client's Health band, independent of any single AM's view.

---

## 5. Example

**Client Portal — Alpha Digital's contact logs in:**
- TikTok Shop Full Management → **"In Production"** (internally: Awaiting Review)
- Single KOL Booking → **"Completed"**
- Health Summary → **"On Track"**
- Opens the embedded monthly report, rendered natively inside the Portal frame (no redirect to a separate report URL).
- Submits a complaint about a late video delivery → Complaint logged, `source = Client Portal`, contact identity logged → immediate acknowledgment shown → routed to Sinta (AM) — same downstream handling as if it came through WhatsApp. If a second contact at Alpha Digital logs in later, they see the exact same Service Progress and Health Summary — not a personalized subset.

**Team Portal — Editor Rian logs in:**
- My Tasks: `AST-202606-0045` still open, surfaced first (nearest SLA).
- My Performance: this month's running score-so-far with a live breakdown (Speed / Output Quantity / GMV Impact / Revision Count) — same "always show the breakdown, never just a number" principle as Module 14.

---

## 6. System Requirements

### 6.1 Client Portal

- **Access model:** multi-contact (confirmed) — a Client can have several named contacts, each with their own login, all seeing the identical scoped view; each contact's actions individually attributed for audit (e.g. who submitted which complaint).
- **Service Progress mapping:** fixed lookup table (Rule 2) — applied at render time, no Universal Column relabeling logic duplicated elsewhere.
- **Health Summary translation:** fixed lookup table (Rule 4) — band → label only, no numeric field ever exposed via this view.
- **Reports:** natively embedded (confirmed) — Portal renders `mea-client-reporting` output inside its own frame rather than linking out; requires the report system's output to be embeddable (iframe or equivalent), not just a standalone downloadable file.
- **Complaint form:** subset of Module 6's Complaint fields (description, optional attachment, optional client-chosen severity tag) → creates Complaint with `source = Client Portal` and submitting-contact reference → triggers an immediate acknowledgment message (Rule 5).
- **Exclusion enforcement:** Portal's data layer must be a strict allow-list (Service Progress, embedded reports, Health band, complaint form) — never a filtered version of the internal Client Board; built as its own narrow view, not a permission-trimmed copy of Module 11.

### 6.2 Team Portal

- Pure aggregation/view layer: reads from Module 11 (My Tasks), Module 14 (Performance Score), Module 12 (Block-request status).
- Role-based landing variants: Staff / Team Leader-SPV / Director-OD-Management.
- Block-approval queue: surfaces any Task with a pending block-request (Module 12 Rule 8) to SPV/Lead as an actionable item (approve → transitions to `[Blocked]`; reject → stays in prior status, requester notified, **no reason field required**, confirmed).

### 6.3 Management Dashboard (Director/OD/management-level)

- New view (confirmed, not previously scoped): pulls every Client's latest Health Score Snapshot (`CHR-…`, Module 13) — band, trend direction, and which component is currently dragging the score — across the **entire client base**, not filtered to one AM.
- Sortable/filterable by band (surface all "At Risk" Clients first), by AM, by division mix.
- Read-only — Management Dashboard does not introduce new actions; its job is visibility, with drill-through into the relevant Client Board (Module 11) or Health Score snapshot (Module 13) for any Client that needs attention.

---

## 7. Confirmed Decisions (OA Resolutions)

| # | Question | Resolution |
|---|---|---|
| 1 | Client Portal access model | ✅ Multi-contact — several named contacts per Client, all seeing the same scoped view. |
| 2 | Health Summary wording | ✅ Confirmed as drafted ("On Track" / "Needs Attention" / "Action Needed"). |
| 3 | Reports: link-out vs. embed | ✅ Natively embedded inside the Portal. |
| 4 | Complaint auto-acknowledgment | ✅ Yes — immediate message on submission (draft copy + 1-business-day response promise, adjustable later). |
| 5 | Director/OD Team Portal variant | ✅ Resolved as a dedicated **Management Dashboard** — portfolio-wide Client Health Score summary across the whole client base, not a lightweight copy of the staff/SPV Team Portal. |
| 6 | Block-request rejection | ✅ No reason/comment required — plain approve/reject. |
| 7 | Client-visible complaint history | ✅ Submit-only, confirmed — no personal complaint log shown to Clients. |

---

## 8. Success Metrics

- **Client Portal — Activation:** % of Clients who log in at least once per month post-onboarding. **North-star:** measurable drop in routine "what's the status" WhatsApp volume to AMs after launch. **Leading indicator:** complaint-source split (Portal vs. WhatsApp) over time.
- **Team Portal — Activation:** staff use the Portal as their daily landing page instead of logging into four separate division tools. **North-star:** reduction in time-to-first-action each day. **Leading indicator:** % of Task status transitions performed via the Portal vs. native division screens.

---

## 9. PRD Status — End of Phase 1

This closes all 15 modules (+ Phase 0 foundation) of the CDPS PRD. Recommended next steps before developer ticketing:

1. Resolve the remaining field-level Open Assumptions still outstanding from Modules 1–10 (carried over from the original session, mostly minor).
2. All of Module 15's own assumptions are now confirmed (§7) — nothing outstanding here.
3. Run a final cross-module consistency pass — confirm every ID convention, role-permission rule, and status transition agrees across all 15 modules (e.g. Module 12's canonical Task machine vs. Module 9's native KOL Booking states, Module 11's Universal Column vs. Module 15's client-facing relabeling).
4. Hand the full set to developers for backlog ticketing.

---

**This is the final module in the original 15-module scope.**
