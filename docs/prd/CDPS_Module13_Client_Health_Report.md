# CDPS — Module 13: Client Health Report

**Status:** Draft awaiting Yohan's confirmation before developer ticketing
**Worked example:** Alpha Digital, Week of June 22–28, 2026
**Depends on:** Module 4 (GMV/Client), Module 5 (Payment), Module 6 (Complaints), Module 8 (ROAS), Module 12 (Task Completion / Revision Count). Module 15 (CSAT/Client Portal — not yet built) is a forward dependency for the Satisfaction component.

---

## 1. Background

GMV, payment timeliness, ROAS, complaints, task completion, and revision counts already each live in their own module. No module has combined them into a single number an AM/SPV/Director can scan at a glance to know "is this Client okay or not." Module 13 is purely an **aggregation and scoring layer** — it introduces no new raw data, only a weighted 0–100 Health Score computed from data that already exists elsewhere in the system.

Expected outcome: one Health Score per Client, refreshed on a fixed cadence, with a clear band (Healthy / Watch / At Risk) for triage, plus full drill-down into the raw numbers behind it so a low score is always explainable.

---

## 2. Rules

1. **Health Score is computed per Client**, not per Service or Brief — it reflects the Client's overall relationship health.
2. **Seven named components**, each normalized to a 0–100 sub-score before weighting:
   - GMV Growth (Module 4)
   - Task Completion Rate (Module 12)
   - ROAS Attainment (Module 8)
   - Payment Timeliness (Module 5)
   - Revision Burden (Module 12)
   - Complaints (Module 6)
   - Satisfaction — **placeholder only**, always N/A until Module 15's CSAT/Client Portal exists; never fabricated from a proxy metric.
3. **Confirmed weights:** GMV Growth 25%, ROAS Attainment 25%, Task Completion 10%, Revision Burden 10%, Complaints 10%, Satisfaction 10%, Payment Timeliness 10%.
4. **Missing-component redistribution:** if a component has no data for a Client in a given period (e.g. no Ads service → no ROAS; brand-new Client → no GMV history yet; Satisfaction always, until Module 15 exists), it is **excluded**, and its weight is redistributed proportionally across the remaining available components — never defaulted to 0 or 100, which would unfairly tank or inflate the score.
5. **Sub-score normalization (capped 0–100 each)**, for the composite calculation only:
   - GMV Growth = `(Current GMV − Baseline GMV) / (Target GMV − Baseline GMV) × 100`, capped at 100.
   - Task Completion Rate = % of Tasks closed `[Approved]` within SLA (Speed Score ≤ 100%) in the period.
   - ROAS Attainment = `Current Period ROAS / Target ROAS × 100`, capped at 100.
   - Payment Timeliness = % of due Installments/Payments that never triggered `[Jatuh Tempo]`.
   - Revision Burden = `100 − min(avg Revision Count in period × 20, 100)`.
   - Complaints = `100 − Σ(severity penalty per complaint)`, capped at 0 — **upgraded** (no longer the flat interim penalty) now that Module 6 resolved its severity scale: **Low −5, Medium −15, High −30** per complaint logged in the period (exact point values are working defaults, adjustable once real data comes in).
6. **Capping is intentional and different from Module 12.** Module 12's Speed Score is deliberately uncapped (diagnostic, single-axis). Health Score is a composite triage number — capping each sub-score at 100 prevents one over-performing metric from masking a genuinely failing one. The **raw, uncapped sub-metrics are always shown alongside the capped score** for diagnosis, so nothing is hidden — only the composite math is bounded.
7. **Score bands** (confirmed): 80–100 = Healthy, 60–79 = Watch, below 60 = At Risk.
8. **New Clients get a 1-month grace period** (confirmed): GMV Growth is excluded entirely for a Client's first full month, weight redistributed (Rule 4) — a Day-1 Client should never show "0% growth" as a penalty.
9. **Snapshots are immutable once created** (`CHR-…`), consistent with house convention — historical trend only ever reads from saved snapshots, never from a retroactively-recomputed number.
10. A **live preview** of the current, not-yet-closed month's score is available read-only (for AM checking mid-month) but is never stored and never appears on the historical trend line — only finalized snapshots do.
11. **Visibility:** AM/SPV/OD/Director (Role Matrix, Phase 0). Not yet client-facing — whether/how to expose this externally is a Module 15 decision, not made here.
12. If a Client drops a full band month-over-month (e.g. Healthy → Watch), the system flags it for SPV review — **visibility-only**, no hard gate (consistent with the no-approval-gate-by-default pattern from Module 8/Module 11).
13. **ROAS inclusion is a per-Client team override** (confirmed): ROAS Attainment is included by default whenever the Client has an active Ads service, but AM/SPV can manually toggle it OFF for that Client (e.g. campaign too new for reliable ROAS data) or — once an Ads service exists — back ON. When toggled OFF, ROAS Attainment is excluded and its weight redistributed exactly like a missing-data case (Rule 4). A Client with no Ads service at all still shows ROAS as structurally N/A regardless of the toggle.

---

## 3. Flow

1. At each month boundary (confirmed monthly cadence), the system pulls closed-period data from Module 4 (GMV), Module 5 (payment), Module 6 (complaints), Module 8 (ROAS — if included per Rule 13), Module 12 (Task Completion, Revision Count) →
2. System computes each available sub-score, redistributing weight for any excluded component (Rule 4) →
3. System computes the weighted Health Score (0–100) and assigns a band →
4. Snapshot (`CHR-…`) is saved immutable, surfaced on the Client Board (extends Module 11) and a dedicated Health Report view →
5. AM/SPV drill into the snapshot to see every raw, uncapped sub-metric behind the score →
6. If the Client's band dropped from the previous snapshot, SPV gets a visibility flag (Rule 12) →
7. Trend line across all snapshots is shown per Client over time.

---

## 4. Example — Alpha Digital, Month of June 2026 (June 1–30)

| Component | Raw value | Sub-score (capped) |
|---|---|---|
| GMV Growth | Baseline Rp50M → Target Rp80M → Current Rp62M | (62−50)/(80−50) × 100 = **40** |
| ROAS Attainment | Target 5.0x, actual 4.2x (toggle: included — Alpha Digital has an active Ads service) | 4.2/5.0 × 100 = **84** |
| Task Completion Rate | 9 of 10 Tasks closed within SLA | **90** |
| Revision Burden | avg Revision Count = 1.2 | 100 − (1.2 × 20) = **76** |
| Complaints | 1 Low-severity complaint logged via AM WhatsApp | 100 − 5 (Low severity penalty) = **95** |
| Satisfaction | N/A (Module 15 not built) | excluded, weight redistributed |
| Payment Timeliness | 1 Installment, paid on time, no `[Jatuh Tempo]` | **100** |

With Satisfaction's 10% redistributed proportionally across the other six (each weight scaled up by ÷0.9):

| Component | Weight after redistribution |
|---|---|
| GMV Growth | 27.78% |
| ROAS Attainment | 27.78% |
| Task Completion | 11.11% |
| Revision Burden | 11.11% |
| Complaints | 11.11% |
| Payment Timeliness | 11.11% |

**Health Score = 0.2778×40 + 0.2778×84 + 0.1111×90 + 0.1111×76 + 0.1111×95 + 0.1111×100 ≈ 74.6 → Band: Watch**

Diagnosis at a glance: everything except GMV Growth looks solid — the weak 40 on GMV is what's pulling an otherwise-healthy account into the Watch band, even with ROAS now carrying equal weight to GMV. Sinta knows exactly where to focus the conversation with Alpha Digital, without opening five different modules.

---

## 5. System Requirements

### 5.1 New entity: Client Health Report Snapshot (`CHR-YYYYMM-NNNN`)

*(Implements the `CHR-…` entity reserved in Phase 0 §3 — "Client Health Report... Auto-generated; one rolling record per client." This module is that implementation.)*

| Field | Type | Notes |
|---|---|---|
| Client ID | ref CLI | — |
| Period Start / End | date | one calendar month |
| Sub-scores | per component | both raw (uncapped) and capped value used in weighting |
| Component Weights Used | record | actual weights after redistribution — stored per snapshot, since missing/toggled-off components can change weights month to month |
| ROAS Inclusion Toggle | boolean | snapshot of the toggle state (Rule 13) at computation time, for audit |
| Final Health Score | 0–100 | — |
| Band | enum: Healthy / Watch / At Risk | — |
| Computed At | timestamp | auto |
| Computed By | system | auto |

### 5.2 Computation

Monthly batch job (confirmed cadence). Snapshots are immutable once created — no retroactive edits, only new snapshots going forward.

### 5.3 Live preview

Read-only, computed on every Client Board view open for the current, not-yet-closed month. Not stored, not part of the historical trend.

### 5.4 ROAS Inclusion Toggle

A simple per-Client boolean, settable by AM/SPV. Default = `true` if Client has an active Ads service, `false` otherwise. Team can override either direction at any time; the toggle state is captured in each snapshot for audit (Rule 13).

### 5.5 Dependency flags

- **Complaints formula upgraded** to severity-weighted (Low −5/Medium −15/High −30) now that Module 6 has resolved its complaint severity scale — no longer the flat interim penalty.
- **Satisfaction is a placeholder field** (always N/A) until Module 15's CSAT/Client Portal exists. It must never be backfilled from a proxy metric (e.g. complaint count) — that would misrepresent an unmeasured signal as measured.

### 5.6 Non-functional

- Snapshot history must support multi-period trend charting per Client.
- Every snapshot must log which components were included vs. excluded, to avoid "why did my score jump" confusion when a component's availability changes between periods.

---

## 6. Confirmed Decisions (OA Resolutions)

| # | Question | Resolution |
|---|---|---|
| 1 | Component weights | ✅ GMV Growth 25%, ROAS Attainment 25%, Task Completion 10%, Revision Burden 10%, Complaints 10%, Satisfaction 10%, Payment Timeliness 10%. |
| 2 | Score bands | ✅ 80–100 Healthy, 60–79 Watch, below 60 At Risk. |
| 3 | Revision Burden curve | ✅ `100 − avg×20`, capped at 0. |
| 4 | Complaints formula | ✅ **Upgraded** to severity-weighted (Low −5 / Medium −15 / High −30), using Module 6's now-resolved 3-tier severity scale — no longer the flat interim penalty. |
| 5 | New-client grace period | ✅ 1 full month before GMV Growth is included. |
| 6 | Snapshot cadence | ✅ Monthly. |
| 7 | ROAS Attainment scope | ✅ Included by default whenever an active Ads service exists, but team can manually toggle it on/off per Client (Rule 13) rather than the system rigidly excluding it. |
| 8 | AM-level rollup into Module 14 | ⏳ Deferred — to be addressed once Module 14 (Team Performance) is drafted, since it needs Module 14's KPI structure defined first to connect cleanly. |

---

## 7. Success Metrics

- **Activation event:** an AM checks at least one Client's Health Score per month, replacing fragmented manual checks across Modules 4/5/6/8/12.
- **North-star:** % of Clients that drop into the "At Risk" band and receive a logged SPV review/intervention within a defined window — the score isn't just a number, it triggers action.
- **Leading indicators:** distribution of Clients across bands over time (ecosystem health trend); frequency of band-drop flags raised.

---

## 8. Amendment — the Health view as the client summary surface (added 2026-08-12)

> **Cross-module amendment, owner request 2026-08-12** (`docs/DECISIONS.md`). Scope: **the view only.** The Health *Score* — its seven components (Rule 2), its confirmed weights (Rule 3 / §6 #1), its redistribution (Rule 4), normalization (Rule 5), bands (Rule 7) and immutable snapshots (Rule 9) — is **unchanged by this amendment.** Nothing below adds, removes, or re-weights a component.

**The requirement.** `/health` is expected to be the one page that summarises a client: *"summary dari semua report, progress, ada komplain atau tidak, dan hasil."* Today the view renders the score's arithmetic (score + band + 7-component breakdown + trend + ROAS toggle) — faithful to §5, but short of both that expectation and **Phase 0 v2 Diagram 3**, which specified this dashboard as including Alerts/issue count, per-platform project status, and performance metrics. Those halves were never built because no layer consolidated them per client. **Module 6D (Rekap Hasil Mingguan)** is that layer.

**What the view gains** (read-only blocks below the existing score/band header — full contract in **M6D §8**):

| Block | Content | Source |
|---|---|---|
| H-1 Hasil & Progress Mingguan | Latest closed week: # video (M7) · # live (M10) · # creator (M9) · # campaign/optimasi (M8) + total view, `GMV Eksekusi (interim)`, CTR, CVR, ROAS, spend + delta vs prior week + AM/CRO narrative headline | M6D `WRR-` |
| H-2 Status Laporan | Recap freshness/discipline: current week's status, AM-closed vs `Ditutup Otomatis` over last 4 weeks, open `Sengketa Angka`. **Displayed, never scored** | M6D `WRR-` |
| H-3 Komplain | Open/active complaints with severity + status — "ada komplain atau tidak" answered directly, not only as the Complaints sub-score | M6 `CPL-` |
| H-4 Kesiapan Klien (Interview) | Optional context: latest interview verdict + `prasyarat_status`, advisory only (the verdict gates nothing — Interview v5) | Interview module |

**Invariants this amendment must not break.**
1. **Two GMV figures now appear on one page and must be labelled distinctly:** the score's GMV Growth reads **client GMV (Module 4)** — the official monthly figure; H-1 shows **`GMV Eksekusi (interim)`** — weekly, execution-sourced (Ads + Live + affiliate), read-only. They are never summed. Same discipline for ROAS: H-1's Ads-channel ROAS vs the score's capped, toggle-governed **ROAS Attainment** (Rule 13).
2. **Still an aggregation layer** (§1): the view stores nothing, and no `CHR-` snapshot is rewritten to embed recap data (Rule 9). H-1…H-4 are a live read *beside* the immutable snapshot.
3. **Still not client-facing** (Rule 11): client-facing health stays band-only through Module 15's allow-list. None of H-1…H-4 is exposed there.
4. **Per-block permission degradation:** the view keeps its own gate; each block respects its source's scope and renders as *absent* rather than erroring the page (notably H-4's narrower interview-verdict scope).
5. **Portfolio landing page** gains one row per active client: band, band-drop flag (Rule 12), open-complaint count, and recap freshness — the management triage screen Rule 12 and Module 15 Rule 11 already imply.

**Deliberately not done:** recap discipline as an eighth scored component. It would force a re-weight and would grade AM form-filling inside a client-health number; if it is to be graded at all, Module 14 (Team Performance, AM role) is the correct home. Owner decision open as **M6D RM-9**. Also out of scope until their sources exist: **CPC / CPM** and **Upcoming Milestones** from Diagram 3 (unmodelled — M6D RM-11).

---

**Next:** Module 14 — Team Performance.
