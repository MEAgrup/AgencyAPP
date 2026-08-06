# CDPS — Module 6C: **Penentuan Kebutuhan Plan** (Service Satuan)

> **Scope.** How the system decides whether an assigned service is Plan-gated or goes straight to Brief, the form the AM fills to make that call, and how a **Plan without a Strategi** works — because à la carte services skip the Strategi layer entirely.
>
> Companion to Module 6A (Strategi) and 6B (Plan). **Body: English. Labels/statuses: Bahasa Indonesia.**

## Contents
1. Background
2. Locked decisions
3. Three service tiers — and why AM choice is bounded
4. The two consequences that need solving
5. Rules
6. Form structure — Section G-A → G-C
7. Plan Satuan — what changes vs Module 6B
8. Flow
9. Example
10. System Requirements
11. Open Assumptions
12. Success Metrics

---

## 1. Background

**Problem.** Not every service deserves a Plan. A one-off product-photo job or a single-campaign ads setup does not need monthly periods, weekly distribution, and a variance review — forcing it through that machinery makes AMs hate the system and fill it dishonestly. But the opposite failure is worse: a 6-month retainer with a GMV target running with no plan at all, invisible until it fails.

The Service Catalog (Module 4) already carries a `butuh_plan` flag. That flag is right for the extremes (Full Store Management always needs one; a single design request never does) and wrong for the middle, where the same service SKU can be a two-week one-off for one client and a rolling commitment for another. That judgement has to sit with the AM, who is the only person who has seen the deal.

**The risk in handing AMs a yes/no.** "Tidak butuh Plan" is less work, and nothing checks it. Given a free binary, the system converges on "no Plan" for everything — and the module quietly becomes optional. So the choice is kept, but it is bounded: the catalog locks the extremes, the system computes a recommendation from the deal's own attributes, and going against the recommendation is allowed but recorded and visible.

**Expected outcome.** Every assigned service has a recorded, reasoned Plan-gate decision — and the rate at which AMs override the recommendation is a measured number, not a mystery.

---

## 2. Locked decisions

| # | Decision | Value |
|---|---|---|
| S1 | Satuan service that needs a Plan | **Plan directly, no Strategi.** The 10-section Strategi is a Full-Management artefact only |
| S2 | Multiple satuan services for one client | **One combined Plan per client** — all satuan services land in the same Plan as rows |
| S3 | AM overriding the system recommendation | **Allowed. Mandatory reason + SPV notified.** Not blocked, not silent |
| S4 | Catalog tiers | Three: `Plan Wajib` (locked on) · `Plan Ditentukan AM` (the middle) · `Tanpa Plan` (locked off) |

---

## 3. Three service tiers

| Tier | Set by | AM can change? | Examples |
|---|---|---|---|
| **Plan Wajib** | Service Catalog (Module 4) | No | Full Store Management, retainer paket lengkap |
| **Plan Ditentukan AM** | Catalog marks it as AM-decided; the system recommends | Yes, with the G-B form | Ads management satuan, KOL package, live vendor booking, SKU optimization |
| **Tanpa Plan** | Service Catalog | No — but can be **escalated** later (Rule 11) | One-off design, single listing revamp, one-time audit |

The middle tier is where this module does its work. The other two exist so the middle stays small: if AMs are answering the G-B form for 90% of services, the catalog tiers are mis-set, not the form.

---

## 4. The two consequences that need solving

**(a) A Plan with no Strategi loses its inheritance.** Module 6B's Plan draws targets from Strategi D-2, floor price from E-4, resource ceilings from F, phases from G-1, big dates from G-2, and assumptions from D-8. Strip the Strategi and all of that has no source. Two of them matter enough that they cannot simply be dropped:

- **Targets.** Without D-2 there is nothing to compare actuals against, so variance becomes unmeasurable and the Plan degenerates into a to-do list. Solution: targets come from the **Service record** (deliverable quota + any KPI in the contract). Where a satuan service has no numeric KPI at all — common for pure-deliverable work — the Plan tracks **delivery** (quota met / on time) instead of performance, and says so explicitly rather than showing an empty GMV target.
- **Floor price.** The margin guardrail is a client-level fact, not a service-level one. Solution: floor price moves to an optional **client-level field** on the combined Plan header (GA-6), filled once, applying to every satuan service for that client.

Dropped deliberately: phases, big-date weighting, and the assumption register. A satuan service does not need a phased thesis, and inventing a mini-Strategi to hold three fields would rebuild the thing S1 just removed.

**(b) One Plan per client collides with per-contract Plans.** A client can hold a Full Management contract *and* buy satuan services. Module 6B says one Plan chain per **contract**; S2 says one Plan per **client**. Both are true at once, so they must be kept from overlapping:

> A client can have at most **one Plan Satuan** (client-scoped, continuous) plus **one Plan chain per Full-Management contract** (contract-scoped). A service belongs to exactly one of them — never both. Services inside a Full-Management contract never enter the Plan Satuan, even when purchased separately later; they attach to that contract's Plan.

Any service appearing in two Plans is a data-integrity bug, enforced by a DB constraint (§10), not a convention.

---

## 5. Rules

1. On service assignment, the system reads the catalog tier. `Plan Wajib` → Plan-gated, no form. `Tanpa Plan` → straight to Brief, no form. `Plan Ditentukan AM` → the **G-B determination form** is mandatory before any Brief can be created for that service.
2. The system computes a **recommendation** from the service's own attributes before the AM answers (Rule 3). The AM sees the recommendation and the triggers behind it, then decides.
3. **Recommendation logic.** Three hard triggers — any single one recommends a Plan:
   - service duration > 1 month, or recurring/retainer;
   - execution spans more than one division;
   - the contract carries a numeric performance target (GMV, ROAS, growth %), not just a deliverable count.
   Four soft triggers — two or more recommend a Plan:
   - deliverable quota above the per-division threshold (default: 20 items/month);
   - service value at or above the threshold (default: Rp 15jt/month);
   - work items have sequence dependencies (B cannot start before A);
   - the client is owed a periodic report or has an SLA.
   Zero hard, fewer than two soft → recommends **no Plan**.
4. **The AM decision is the decision (S3).** Agreeing with the recommendation needs no justification. Disagreeing requires a written reason and notifies SPV. It is never blocked and never held for approval — a pending approval on this gate would stall delivery for a service that may be two weeks long.
5. **Override direction is tracked separately.** `Tolak Plan` (system said yes, AM said no) and `Tambah Plan` (system said no, AM said yes) are distinct events. Only the first is an accountability risk; conflating them in reporting would hide it.
6. **One combined Plan Satuan per client (S2).** The first service determined to need a Plan **opens** it. Every later Plan-gated satuan service **joins** it as rows in the current open period — it never creates a second Plan.
7. **Period cycle for Plan Satuan** is anchored on the date the Plan was opened (`tanggal_mulai_siklus`, same anniversary-month logic as 6A Rule 17). Services joining mid-period enter the **current** period; their rows are tagged `Masuk Tengah Periode` and are excluded from that period's delivery-rate denominator, since they had a short runway.
8. **Plan Satuan does not expire with a service.** When every satuan service ends, the Plan goes `Dorman` — periods stop generating. A new Plan-gated satuan service **reactivates the same Plan** with a fresh period rather than opening a new one, so the client keeps one continuous history.
9. **No Strategi means no Strategi reference.** Plan rows in a Plan Satuan reference `service_id` instead of `strategi_pillar_id`. The `Di Luar Strategi` flag does not apply; its analogue is `Di Luar Service` — a row that maps to no purchased service, which is scope creep and flagged as such.
10. **Approval.** Same as 6B: the **first period only** needs SPV approval; later periods activate automatically. A service joining an already-approved Plan does not trigger a new approval — but if the joining service's own value exceeds the threshold (default Rp 15jt/month), SPV is notified.
11. **Escalation is always available.** A service running `Tanpa Plan` (either by catalog or by AM decision) can be escalated to Plan-gated at any time. Escalation is **forward-only**: rows are created from the escalation date onward; past work is not backfilled. Trigger sources: AM initiative, division request, or the system — if a service's attributes change so that a **hard** trigger now fires (a target is added, a second division is pulled in), the system raises `Plan Sekarang Disarankan` and the AM must re-answer G-B. An unanswered re-ask blocks nothing but appears on the SPV dashboard.
12. **De-escalation requires SPV approval.** Turning off a Plan on a running service is the one direction that needs a gate — it is the action that erases an accountability record, and it is not symmetric with Rule 4.
13. Every determination, override, escalation, and de-escalation writes to the immutable audit log (actor, WIB timestamp, recommendation, decision, reason).

---

## 6. Form structure

### SECTION G-A — Konteks Penugasan Service (auto + minimal AM input)
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| GA-1 | Service & Klien | `SVC-…`, nama service, klien, tier katalog | Auto | A |
| GA-2 | Durasi & Skema | Tanggal mulai–akhir, sekali/berulang, siklus penagihan | Auto from contract | A |
| GA-3 | Divisi Terlibat | Divisi eksekusi yang kena service ini | Auto + AM confirm | W |
| GA-4 | Deliverable & Kuota | Apa yang dijanjikan + jumlah per periode | Auto from catalog + AM adjust | W |
| GA-5 | Target Angka | Ada KPI numerik di kontrak? (GMV/ROAS/growth) — isi kalau ada | Currency/number | O |
| GA-6 | Floor Price Klien | Harga minimum per SKU untuk klien ini (berlaku lintas service satuan) | Struct per SKU | O |
| GA-7 | Plan Satuan Klien | Status Plan Satuan klien ini: belum ada / aktif (`PLAN-…`) / dorman | Auto | A |
| GA-8 | Plan Full Management | Apakah klien punya kontrak full management aktif? (agar service tidak masuk dua Plan) | Auto | A |

### SECTION G-B — Penentuan Kebutuhan Plan (inti modul ini)
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| GB-1 | Pemicu Terdeteksi | Daftar hard & soft trigger yang menyala + dasar angkanya | Auto | A |
| GB-2 | Rekomendasi Sistem | `Butuh Plan` / `Tanpa Plan` + ringkasan alasan | Auto | A |
| GB-3 | **Keputusan AM** | `Butuh Plan` / `Tanpa Plan` | Enum | W |
| GB-4 | Kesesuaian | Auto: `Sesuai Rekomendasi` / `Tolak Plan` / `Tambah Plan` | Auto | A |
| GB-5 | Alasan | Wajib kalau tidak sesuai rekomendasi. Free text — bukan enum, karena alasan yang sah tidak bisa diprediksi | Long text | W (kondisional) |
| GB-6 | Cara Pemantauan Alternatif | Kalau AM pilih `Tanpa Plan` padahal direkomendasikan: bagaimana service ini dipantau? | Text | W (kondisional) |
| GB-7 | Tanggal Tinjau Ulang | Kapan keputusan ini ditinjau lagi (default: tengah durasi service) | Date | W |
| GB-8 | Ringkasan Penugasan | **Hanya untuk jalur `Tanpa Plan`:** deliverable, deadline, divisi PIC, target/hasil yang diharapkan | Struct (4 field) | W (kondisional) |

**Design note on GB-8.** The no-Plan path keeps exactly four fields — deliberately small. If it grew to ten, AMs would start choosing whichever path had less typing, and the determination would stop being about the work.

### SECTION G-C — Eskalasi & Riwayat (auto, read-only)
| ID | Content |
|---|---|
| GC-1 | Riwayat keputusan: rekomendasi, keputusan AM, alasan, aktor, waktu |
| GC-2 | Pemicu baru yang muncul setelah keputusan (Rule 11) + status `Plan Sekarang Disarankan` |
| GC-3 | Eskalasi/de-eskalasi: tanggal, pemicu, siapa, status approval (de-eskalasi) |
| GC-4 | Baris Plan yang lahir dari service ini (kalau Plan-gated) |

---

## 7. Plan Satuan — what changes vs Module 6B

| Aspect | Plan Full Management (6B) | **Plan Satuan (this module)** |
|---|---|---|
| Scope | Per contract | **Per client**, continuous, dormant when idle |
| Parent | `STRG-…` (approved Strategi) | None. Parent is the **Service records** |
| Row parent (PC-3) | `strategi_pillar_id` | `service_id` |
| Deviation flag | `Di Luar Strategi` | `Di Luar Service` (scope creep) |
| Targets (P-B) | From Strategi D-2, adjustable per §3 asymmetry | From Service KPI (GA-5) if any; otherwise **delivery-based** (quota + on-time), and labelled as such |
| Target adjustment | Asymmetric rule with `defisit_terbawa` | Same asymmetry **only where a numeric KPI exists**. Delivery-based Plans have no target to lower — quota changes are contract amendments, not Plan edits |
| Floor price | Strategi E-4 | Client-level GA-6 |
| Phases / big-date weighting | Strategi G-1 / G-2 | Not used. Weekly split is even |
| Assumption register | Strategi D-8 | Not used |
| Actuals | GMV manual + metrics auto | Same hybrid. Delivery-based Plans: quota completion auto from Briefs, no manual GMV |
| Approval | First period only | First period only. New service joining ≥ threshold → SPV notified, not gated |
| Period review (P-F) | Full 8 fields | Reduced: what worked, what didn't, carry-over, client talking points. No strategy-vs-execution diagnosis (there is no strategy to blame) |
| Client visibility | Via the Strategi read-only link | Own read-only link, same token model, shareable rows only |

Everything else in 6B — row structure P-C, weekly derivation P-D, carry-over Rule 16, capacity objections Rule 18, soft commitment, manual Brief creation — applies unchanged.

---

## 8. Flow

1. Finance releases client → SPV assigns AM → AM assigns/records service (Module 6).
2. System reads catalog tier. `Plan Wajib` → Strategi flow (6A). `Tanpa Plan` → Brief creation opens immediately, GB-8 summary required. `Plan Ditentukan AM` → G-B form is required before Brief creation for that service.
3. System computes triggers and shows the recommendation (GB-1, GB-2).
4. AM decides (GB-3). If it matches the recommendation, done. If not: reason (GB-5) + alternative monitoring if declining a recommended Plan (GB-6), and SPV is notified. Either way, Brief creation unlocks immediately.
5. `Butuh Plan` → if the client has no Plan Satuan, one is opened with `tanggal_mulai_siklus` = today, period 1 in `Draft`, seeded with rows from the service's deliverable quota. If a Plan Satuan already exists and is `Aktif`, the service joins the current period as rows tagged `Masuk Tengah Periode`. If `Dorman`, it reactivates with a fresh period.
6. Period 1 → SPV approval (once per Plan, not per service). Later periods auto-activate. Everything downstream follows 6B.
7. `Tanpa Plan` → Briefs are created from GB-8 directly. At GB-7's review date, the system re-asks G-B once.
8. If a hard trigger appears later (target added, second division pulled in), `Plan Sekarang Disarankan` fires → AM re-answers. Escalation is forward-only.
9. De-escalation (turning a Plan off mid-service) → SPV approval required. Existing Plan rows are closed with a recorded reason, not deleted.

---

## 9. Example

**Client: Sini Store.** Buys two satuan services, no full-management contract.

**Service 1 — Ads Management, 3 months, Rp 12jt/month, ROAS target 5.0.** Catalog tier: `Plan Ditentukan AM`. Triggers: duration > 1 month ✅ (hard), numeric target ✅ (hard), single division, value below threshold, no sequence dependency, monthly report owed ✅ (soft). Two hard triggers → **system recommends Butuh Plan**. AM agrees. No reason needed.

→ `PLAN-2026-00412` opened for Sini Store, cycle start 14 Aug, period 1 = 14 Aug–13 Sep, `Draft`. Rows seeded from the Ads deliverable: campaign restructure, keyword expansion, weekly optimisation. Target: ROAS 5.0 (numeric KPI exists, so variance is performance-based). Floor price left empty — not relevant to ads-only work. SPV approves period 1.

**Service 2 — One-off product photo, 40 photos, 3 weeks, Rp 6jt.** Catalog tier: `Tanpa Plan`, locked. No form. AM fills GB-8: 40 photos, deadline 5 Sep, Creative, expected result "listing 12 SKU Pareto pakai foto baru". Briefs created directly. This service does **not** enter `PLAN-2026-00412`.

**Month 2 — client adds a KOL package, 25 creators, 2 months, Rp 9jt/month.** Tier: `Plan Ditentukan AM`. Triggers: duration > 1 month ✅ (hard), quota 25 above the 20 threshold ✅ (soft). One hard → **recommends Butuh Plan**. AM agrees. Because Sini Store's Plan Satuan is already `Aktif`, the KOL rows **join period 2** tagged `Masuk Tengah Periode` and are left out of period 2's delivery-rate denominator. No new approval — the service value is below the Rp 15jt notification threshold, so SPV is not even pinged.

**Counter-case — the override.** Had the AM decided `Tanpa Plan` for the Ads service (two hard triggers firing), the system would record `Tolak Plan`, demand a reason and an alternative monitoring method in GB-6, notify SPV, and count it in that AM's override rate. Delivery would not have been held up for a second.

---

## 10. System Requirements

**Entities.** `PLAN` gains `lingkup` ∈ `kontrak` / `klien`, nullable `strategi_id` (null for Plan Satuan), and `status_dormansi`. New table `SERVICE_PLAN_GATE`:

| Field | Type | Notes |
|---|---|---|
| `service_id` | FK | PK — one determination per service |
| `tier_katalog` | enum | `plan_wajib` / `ditentukan_am` / `tanpa_plan` |
| `pemicu_keras`, `pemicu_lunak` | jsonb | which triggers fired, with the values that fired them — stored, not recomputed, so a later threshold change never rewrites history |
| `rekomendasi` | enum | `butuh_plan` / `tanpa_plan` |
| `keputusan_am` | enum | same |
| `kesesuaian` | enum, computed | `sesuai` / `tolak_plan` / `tambah_plan` |
| `alasan`, `pemantauan_alternatif` | text | DB check: NOT NULL when `kesesuaian <> 'sesuai'` |
| `tanggal_tinjau_ulang` | date | drives the re-ask job |
| `ringkasan_penugasan` | jsonb | 4 fields, required when `keputusan_am = tanpa_plan` |
| `plan_id` | FK nullable | the Plan Satuan it joined |
| `riwayat` | jsonb[] | escalation/de-escalation trail |

**Integrity constraint for §4(b).** A partial unique index guaranteeing a service maps to at most one Plan, plus a check that a service belonging to a Full-Management contract cannot have `plan_id` pointing at a `lingkup = 'klien'` Plan. Enforced at DB level and mirrored in the TS permission/validation layer (frozen invariant: the two must not diverge).

**Thresholds are configuration, not constants.** `plan_gate_config` table: quota threshold (default 20/month), value threshold (default Rp 15jt/month), duration threshold (1 month), joining-service notification threshold (Rp 15jt/month). Editable by Direksi/Head of Account, versioned, and — because `pemicu_*` is stored per determination — changing a threshold never retroactively alters past decisions.

**State machine (machine #17: Plan Satuan dormancy).** `Aktif` → `Dorman` (all services ended) → `Aktif` (new Plan-gated service). Periods themselves use machine #16 from 6B unchanged.

**Scheduled jobs.** (a) daily — fire the G-B re-ask at `tanggal_tinjau_ulang`; (b) daily — re-evaluate hard triggers for services running `Tanpa Plan`, emit `plan_sekarang_disarankan` on a new hard trigger; (c) daily — flip a Plan Satuan to `Dorman` when its last service ends. Idempotent, WIB.

**Notification catalog.** Three more events, folded into the same single v2 amendment as 6A and 6B — **base 15 + 4 Strategi + 6 Plan + 3 Gate = 28 events, one migration.**

| Event | Fires when | Recipients |
|---|---|---|
| `gate_override_dicatat` | AM decision diverges from recommendation | SPV (payload distinguishes `tolak_plan` from `tambah_plan`) |
| `plan_sekarang_disarankan` | A hard trigger appears on a no-Plan service | AM + SPV |
| `gate_deeskalasi_diminta` | AM requests turning off a Plan mid-service | SPV (approval required) |

**Permissions.** AM: read/write G-A…G-B for own clients; cannot edit `tier_katalog` or thresholds. SPV/Head of Account: read all, approve de-escalation, edit thresholds if granted. Division lead: read the gate decision for services they execute (so they know why there is or is not a Plan). Direksi: read all + thresholds.

---

## 11. Open Assumptions

| ID | Assumption | Owner |
|---|---|---|
| GA-1 | Trigger thresholds (20 items/month, Rp 15jt/month, 1 month duration) are starting values. These decide how often the form recommends a Plan — worth setting from real service data rather than accepting mine | Yohan / Yulianti |
| GA-2 | Assumed the existing Service Catalog can carry a three-value tier. If `butuh_plan` is currently a boolean, it needs a migration to an enum — and every catalog entry needs re-tiering, which is a data task, not a code task | Hans + Yulianti |
| GA-3 | Assumed `Tanpa Plan` services still appear on the AM's workload view even without Plan rows, otherwise choosing no-Plan makes work invisible — which is itself an incentive to choose it | Yohan |
| GA-4 | Assumed a delivery-based Plan (no numeric KPI) is acceptable rather than requiring every Plan-gated service to have a target. The alternative — force a KPI — would push AMs to invent numbers | Yohan |
| GA-5 | Assumed `tanggal_tinjau_ulang` defaults to the midpoint of the service duration | Yulianti |
| GA-6 | Assumed a client's Plan Satuan and their Full-Management Plan are presented as separate client links, not merged into one client view | Yohan |
| GA-7 | Assumed de-escalation approval sits with SPV, same authority level as period-1 approval | Yulianti |
| GA-8 | Carried from 6A/6B: the catalog invariant test asserts a literal `== 15`; the amendment now covers 28 events and still needs sign-off before any of the three modules can ship notifications | Hans |

---

## 12. Success Metrics

**Activation event.** First service with a recorded G-B determination whose outcome is honoured — a Plan opened, or Briefs created from GB-8.

**North star.** % of assigned services with a recorded Plan-gate decision. Target 100% — this is a completeness metric, and anything below 100% means services are being executed outside the system's knowledge.

| Metric | Why | Target |
|---|---|---|
| **`Tolak Plan` rate, per AM** | The specific escape hatch S3 opens. Watch the distribution across AMs, not the average — one AM at 80% is the finding, and the average would hide it | < 20%, monitored per AM |
| `Tambah Plan` rate | AMs adding Plans the system didn't recommend. High = thresholds too loose, not a discipline problem | signal only |
| % `Tolak Plan` services that later escalate | Retrospective accuracy: how often "no Plan" turned out wrong | < 25% |
| % `Plan Ditentukan AM` of all assigned services | If most services land in the middle tier, the catalog tiers are mis-set (§3) | < 40% |
| % no-Plan services delivered on time | Tests whether the light path is actually sufficient. If this drops, the middle tier is too permissive | ≥ 90% |
| Median time from assignment → determination recorded | A gate nobody passes through promptly is a gate that blocks delivery | ≤ 1 working day |
| GB-6 fields with substantive content | Detects "alternative monitoring" answered with "dipantau manual" — the tell that the override was about workload | reviewed, not scored |

**Anti-vanity guard.** Do not report "% services with a Plan" as a health metric. It rises when AMs over-plan and falls when they correctly decline — neither direction means anything on its own. The pair that carries signal is the per-AM `Tolak Plan` rate against the on-time delivery rate of no-Plan services.
