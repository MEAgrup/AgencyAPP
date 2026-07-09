# CDPS — Wave 1 Backlog (Money Path: M0, M1, M4, M5)

> Prerequisite: Sprint 0 exit criteria passed (S0-12). Each ticket references its PRD section — read it fully before implementing. DoD from CLAUDE.md applies. Order within each epic matters; epics M0/M1 can run in parallel, M4 needs M0 closing, M5 needs M4 handoff.

## Epic M1 — Leads Database
- **W1-01 · LEAD registry + registration door** (M1 §3–4): central `LEAD-` entity; Sales single registration; dedup decision table (active-external ⇒ blocked with BI message; Rejected/Not Qualified ⇒ reopen; Pool ⇒ claim). AC: table-driven dedup tests match the PRD decision table exactly.
- **W1-02 · Bulk import (Marketing)** (M1 §3): CSV/bulk import gated on parent Campaign `[Active]` (stub campaign flag until M3 in Wave 3 — log in DECISIONS.md); per-row rejects with reasons, import report. AC: rejected rows change nothing; report reconciles totals.
- **W1-03 · Pool claim + competitive win resolution** (M1 §6): claim spawns `PRSP-`; first `Closed-Success` wins; open competitor attempts auto-close `[Closed - Kalah Kompetisi]` + notification. AC: two-claimant fixture resolves correctly with full audit.
- **W1-04 · Bad-lead evaluation + Last-Touch field** (M1 §7, M2-OA-2): Not-Qualified reason taxonomy; `Last-Touch Campaign` non-destructive field distinct from Origin. AC: junk breakdown query returns reason counts.

## Epic M0 — Sales
- **W1-05 · Attempt lifecycle** (M0 §2–4): `Pending Validation`→…→`Contacted`→`Qualified/Not Qualified` on the S0-05 engine; `Blocked` disables all actions. AC: every transition in STATE_MACHINES.md §1 tested.
- **W1-06 · Qualified Lead Form** (M0 §4.3): all fields incl. the 5 NEW ones; max-5 services `[maksimal pilih 5 jasa saja!]`; auto Estimasi Nilai + Komisi from Master Service List version-at-date (S0-09); lock-on-submit. AC: post-submit edit by salesperson denied server-side; komisi matches a hand-computed fixture.
- **W1-07 · Negotiation — non-nego path** (M0 §5): service confirm screen, standard-terms validation, `Negotiation - Auto Approved`. AC: any custom term forces switch to nego flow.
- **W1-08 · Negotiation — full flow + approval** (M0 §5): versioned proposals; Superior approve/counter/reject (notes mandatory on counter & reject); accept-counter sync; notifications per catalog. AC: version history immutable; approval restricted to Sales Head/SPV (PERMISSIONS.md).
- **W1-09 · Closing Form** (M0 §6): preload+lock approved value/services/Primary; ≤5 salespeople; allocation Σ=100% else blocked; Commission & Payment PIC when >1; generates `CLI-`/`TRX-`/Service IDs atomically (prefix per DECISIONS.md O1). AC: partial failure leaves zero orphan IDs; win resolution (W1-03) fires.

## Epic M4 — Client Record
- **W1-10 · Record birth + provenance inheritance** (M4 v2 §2–3): create at `Closed-Success`; inherit locked Qualified data + Origin Campaign + PICs + Sales Allocation. AC: Alpha Digital fixture reproduces the M4 v2 §3 table field-for-field.
- **W1-11 · Lock matrix enforcement** (M4 v2 §4): server-side edit blocking per the full matrix; corrections by authorised roles write before→after audit. AC: one test per matrix row (allow + deny cases).
- **W1-12 · Void Service + cascade** (M4-OA-5): SPV/Account-Lead-approved void; child Briefs not `[Approved]` → `[Cancelled — Service Voided]` (Brief entity exists as minimal stub until M6 — log scope in DECISIONS.md). AC: approved Briefs untouched; void never deletes.
- **W1-13 · Payment Intent handoff** (M4 v2 §5): 4 intent options; routes to Finance queue; record invisible to Account until gate (W1-16). AC: Account role cannot query pre-verification clients.

## Epic M5 — Admin & Finance
- **W1-14 · Transaction + Installment schedule** (M5 §2–4): `TRX-` init `[Menunggu Verifikasi]`; Termin ⇒ `INST-` rows (amount+due date); scheme switch logged with reason. AC: rollup `[Lunas]` only when all INST `[Terverifikasi]`.
- **W1-15 · Verification flows, 4 schemes** (M5 §4): Lunas single-jump; Bayar Sebagian (no due date ⇒ no `[Jatuh Tempo]`); Termin per-installment; proof-of-payment attachment; Amount Verified/Outstanding auto. AC: the 3 worked examples (Alpha Digital, Unicorn Digital, Sini Store) pass as fixtures.
- **W1-16 · Routing gate** (M5 §5, M5-OA-1): first `[Terverifikasi - Sebagian]`/`[Lunas]` releases the Client to Account intake. AC: gate fires exactly once; pre-gate invisibility enforced.
- **W1-17 · Reminder dashboard + dual-audience reminders** (M5 §6 + OD-3): `[Jatuh Tempo]` per-installment flag; H-3 + overdue in-app notifications to Commission & Payment PIC + Finance. AC: notification recipients match the Phase 0 v2 §9 catalog.
- **W1-18 · Contract 7-day flag + `[Bermasalah]`** (M5 §7, M5-OA-5): parallel (non-blocking) contract expectation; dispute flag with joint SPV Finance+Account resolution, Director escalation path. AC: flag never blocks routing; resolution requires both approvals.

## Closing the wave
- **W1-19 · Data migration import** (DECISIONS.md O6): spreadsheet leads/clients through the M1 dedup engine — never direct inserts; dry-run report first. AC: dry-run/real-run counts reconcile; every imported row has audit provenance.
- **W1-20 · Wave 1 UAT + exit review**: one real deal end-to-end (registration → qualified → nego approval → closing → IDs → Termin schedule → verification → routed to Account queue); commission spot-checked vs Master Service List by Sales Head. Go/no-go for Wave 2 logged in DECISIONS.md.
